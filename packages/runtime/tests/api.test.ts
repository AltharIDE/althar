import { randomBytes } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MessageChannel } from 'node:worker_threads'

import { Api, ApiError, clientProtocol, emitterPort, type ThreadSnapshot, type WatchEvent } from '@charrette/contracts'
import { AgentExited, AgentRequestFailed, AgentStartFailed, OptionUnavailable, TurnInProgress } from '@charrette/provider-adapters'
import { scenarios } from '@charrette/provider-adapters/testing'
import { assert, describe, it } from '@effect/vitest'
import { Cause, Context, Duration, Effect, Fiber, Layer, Stream } from 'effect'
import { RpcClient } from 'effect/rpc'

import { connection, services } from '../src/Api'
import { GitFailed, ModelUnchanged, NotARepository, NotFound, SessionFailed } from '../src/errors'
import { Folders } from '../src/Folders'
import { itemOf } from '../src/Queries'
import { agentSaid, summarize, words } from '../src/words'
import { fakeAgents, repository } from './support'

const commandId = () => `cmd_${randomBytes(16).toString('hex')}`

/** The runtime serving the API on one end of a channel, and a client on the other, as the app's window has it. */
const connected = (options: { readonly countdown?: Duration.Duration; readonly signedOut?: ReadonlyArray<string> } = {}) =>
  Effect.gen(function* () {
    const channel = new MessageChannel()
    yield* Effect.addFinalizer(() => Effect.sync(() => channel.port1.close()))
    const context = yield* Layer.build(
      services({
        database: ':memory:',
        worktreeRoot: mkdtempSync(join(tmpdir(), 'charrette-worktrees-')),
        appVersion: '0.0.0-test',
        deviceName: 'Test Mac',
        agents: fakeAgents({}, options.signedOut),
        ...(options.countdown === undefined ? {} : { countdown: options.countdown }),
      }),
    )
    // Each window's connection runs on a fiber of its own, as in the app: it ends when its client goes.
    yield* Effect.forkScoped(Layer.launch(connection(emitterPort(channel.port1, (data) => data))).pipe(Effect.provideContext(context)))
    const protocol = yield* Layer.build(clientProtocol(emitterPort(channel.port2, (data) => data)))
    const client = yield* RpcClient.make(Api).pipe(Effect.provideContext(protocol))
    /** A folder the person chose, as the app's main process allows it. */
    const grant = (path: string) => Context.get(context, Folders).allow(path)
    return { client, grant }
  })

const eventually = <A>(effect: Effect.Effect<A, unknown>, check: (value: A) => boolean) =>
  Effect.gen(function* () {
    for (let tries = 0; tries < 250; tries += 1) {
      const value = yield* Effect.orDie(effect)
      if (check(value)) return value
      yield* Effect.sleep('20 millis')
    }
    return yield* Effect.die(new Error('Timed out'))
  })

const idle = (thread: ThreadSnapshot) => thread.session !== null && !thread.session.turnRunning
const texts = (thread: ThreadSnapshot) => thread.items.map((item) => ('text' in item.content ? item.content.text : item.kind))

describe('the API', () => {
  it.live('opens a project by its grant, runs a task, and says what changes after a cursor', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { client, grant } = yield* connected()
        const status = yield* client.Status({})
        assert.strictEqual(status.apiVersion, 1)
        assert.deepStrictEqual(
          status.agents.map((agent) => [agent.id, agent.signIn]),
          [
            ['claude-code', 'signed_in'],
            ['codex', 'signed_in'],
            ['opencode', 'signed_in'],
          ],
        )
        assert.deepStrictEqual(yield* client.Status({ recheck: true }), yield* client.Status({}))

        const opening = { commandId: commandId(), grant: yield* grant(repository()) }
        const project = yield* client.OpenProject(opening)
        assert.strictEqual(project.tasks, 0)
        // The same command again is a retry: the first one's result, and no second project.
        assert.deepStrictEqual(yield* client.OpenProject(opening), project)
        const creating = { commandId: commandId(), projectId: project.id, title: 'Say hello', description: 'Briefly.' }
        const task = yield* client.CreateTask(creating)
        assert.strictEqual((yield* client.CreateTask(creating)).id, task.id)
        assert.strictEqual(task.branch, 'charrette/say-hello')
        const listed = yield* client.ListProjects()
        assert.deepStrictEqual(
          listed.projects.map((summary) => [summary.id, summary.tasks]),
          [[project.id, 1]],
        )
        assert.deepStrictEqual(
          (yield* client.ListTasks({ projectId: project.id })).tasks.map((summary) => summary.title),
          ['Say hello'],
        )

        // Watching from the list's cursor: what changed since, each change with its thread when it has one.
        const changed = yield* Effect.forkChild(
          Stream.runCollect(
            Stream.take(
              Stream.filter(
                client.Watch({ since: listed.cursor }),
                (event) => event._tag === 'Changed' && event.threadId === task.threadId,
              ),
              1,
            ),
          ),
        )
        const streamed = yield* Effect.forkChild(
          Stream.runCollect(
            Stream.take(
              Stream.filter(client.Watch({}), (event) => event._tag === 'Streaming'),
              1,
            ),
          ),
        )
        yield* Effect.sleep('50 millis')
        const starting = { commandId: commandId(), threadId: task.threadId, agentId: 'codex' }
        const sessionId = yield* client.StartSession(starting)
        // A retried start is the same start.
        assert.strictEqual(yield* client.StartSession(starting), sessionId)
        yield* eventually(client.GetThread({ threadId: task.threadId }), (thread) => idle(thread) && thread.items.length > 0)
        yield* client.Send({ commandId: commandId(), threadId: task.threadId, body: scenarios.hello, disposition: 'after_current' })
        const thread = yield* eventually(client.GetThread({ threadId: task.threadId }), (value) => texts(value).at(-1) === 'Hello')
        assert.isAbove(thread.cursor, listed.cursor)
        assert.strictEqual(thread.task.title, 'Say hello')
        assert.strictEqual(thread.session?.agentId, 'codex')
        assert.deepStrictEqual(thread.session?.models, ['small', 'large'])
        assert.deepStrictEqual(texts(thread).slice(-2), ['hello', 'Hello'])
        const [change] = (yield* Fiber.join(changed)) as ReadonlyArray<WatchEvent>
        assert.strictEqual(change?._tag === 'Changed' ? change.projectId : undefined, project.id)
        assert.isAbove(change?._tag === 'Changed' ? change.cursor : 0, listed.cursor)
        const [live] = (yield* Fiber.join(streamed)) as ReadonlyArray<WatchEvent>
        assert.strictEqual(live?._tag === 'Streaming' ? live.threadId : undefined, task.threadId)

        // A page of the newest, then the one before it, and one item by id.
        const newest = yield* client.GetThread({ threadId: task.threadId, limit: 1 })
        assert.deepStrictEqual(texts(newest), ['Hello'])
        assert.isTrue(newest.earlier)
        const before = yield* client.GetThread({ threadId: task.threadId, before: newest.items[0]?.sequence ?? 0, limit: 1 })
        assert.deepStrictEqual(texts(before), ['hello'])
        assert.isEmpty((yield* client.GetThread({ threadId: task.threadId, limit: 0 })).items)
        const reply = yield* client.GetThreadItem({ threadId: task.threadId, itemId: newest.items[0]?.id ?? '' })
        assert.deepStrictEqual(reply.content, { text: 'Hello' })

        // A tool call keeps what the thread shows: the files it touched, not its raw input and output.
        yield* client.Send({ commandId: commandId(), threadId: task.threadId, body: scenarios.tool, disposition: 'after_current' })
        const tooled = yield* eventually(client.GetThread({ threadId: task.threadId }), (value) =>
          value.items.some((item) => item.kind === 'tool_call' && item.content.status === 'completed'),
        )
        const tool = tooled.items.find((item) => item.kind === 'tool_call')
        assert.deepStrictEqual(tool?.kind === 'tool_call' ? tool.content : undefined, {
          title: 'Write hello.txt',
          toolKind: 'edit',
          status: 'completed',
          command: null,
          locations: [{ path: 'hello.txt' }],
          declined: false,
        })

        const choosing = { commandId: commandId(), threadId: task.threadId, model: 'large' }
        yield* client.SetModel(choosing)
        yield* client.SetModel(choosing)
        assert.strictEqual((yield* client.GetThread({ threadId: task.threadId })).session?.model, 'large')
        yield* client.Interrupt({ commandId: commandId(), threadId: task.threadId })
        yield* client.StopSession({ commandId: commandId(), threadId: task.threadId })
        assert.isNull((yield* client.GetThread({ threadId: task.threadId })).session)
      }),
    ),
  )

  it.live('hears a change as soon as it is written, not at the next poll', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { client, grant } = yield* connected()
        const project = yield* client.OpenProject({ commandId: commandId(), grant: yield* grant(repository()) })
        const { cursor } = yield* client.ListProjects()
        const heard = yield* Effect.forkChild(
          Stream.runHead(Stream.filter(client.Watch({ since: cursor }), (event) => event._tag === 'Changed')),
        )
        // Let the watch reach its wait, so only a wake-up can bring the change in time.
        yield* Effect.sleep('100 millis')
        const started = Date.now()
        yield* client.CreateTask({ commandId: commandId(), projectId: project.id, title: 'Quick' })
        yield* Fiber.join(heard)
        // The fallback read is a second away; the signal brings it far sooner.
        assert.isBelow(Date.now() - started, 500)
      }),
    ),
  )

  it.live('asks the person, and takes their answer', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { client, grant } = yield* connected()
        const project = yield* client.OpenProject({ commandId: commandId(), grant: yield* grant(repository()) })
        const task = yield* client.CreateTask({ commandId: commandId(), projectId: project.id, title: 'Deploy' })
        yield* client.SwitchAgent({ commandId: commandId(), threadId: task.threadId, agentId: 'codex', model: 'large' })
        yield* eventually(client.GetThread({ threadId: task.threadId }), (thread) => idle(thread) && thread.items.length > 0)
        yield* client.Send({
          commandId: commandId(),
          threadId: task.threadId,
          body: scenarios.commandChoices,
          disposition: 'after_current',
        })
        const waiting = yield* eventually(client.GetThread({ threadId: task.threadId }), (thread) => thread.attention.length === 1)
        assert.deepStrictEqual(
          { title: waiting.attention[0]?.title, reason: waiting.attention[0]?.reason, command: waiting.attention[0]?.command },
          { title: 'Run make deploy', reason: 'Deploying or publishing always asks.', command: 'Run make deploy' },
        )
        assert.strictEqual((yield* client.ListProjects()).projects[0]?.waiting, 1)
        const answering = {
          commandId: commandId(),
          attentionId: waiting.attention[0]?.id ?? '',
          decision: 'reject' as const,
          reason: 'Not today',
        }
        yield* client.Answer(answering)
        // Answered twice by a retry, it is answered once.
        yield* client.Answer(answering)
        const after = yield* eventually(
          client.GetThread({ threadId: task.threadId }),
          (thread) => idle(thread) && thread.attention.length === 0,
        )
        assert.strictEqual(after.attention.length, 0)
        // What the person turned down says so.
        const deploy = after.items.find((item) => item.kind === 'tool_call')
        assert.isTrue(deploy?.kind === 'tool_call' && deploy.content.declined)
      }),
    ),
  )

  it.live('says what went wrong, in words', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { client, grant } = yield* connected()
        const plain = mkdtempSync(join(tmpdir(), 'charrette-plain-'))
        const error = yield* Effect.flip(client.OpenProject({ commandId: commandId(), grant: yield* grant(plain) }))
        assert.instanceOf(error, ApiError)
        assert.deepStrictEqual(
          [error.reason, error.message],
          ['NotARepository', `${plain} isn't in a git repository. Choose a folder inside one.`],
        )
        // The window can't name a folder the person didn't choose.
        assert.strictEqual(
          (yield* Effect.flip(client.OpenProject({ commandId: commandId(), grant: 'grant_made_up' }))).message,
          "That folder isn't there any more.",
        )
        assert.strictEqual((yield* Effect.flip(client.GetThread({ threadId: 'thr_missing' }))).message, "That task isn't there any more.")
        assert.strictEqual(
          (yield* Effect.flip(client.StopSession({ commandId: commandId(), threadId: 'thr_missing' }))).message,
          'No agent is working on this task.',
        )
        const project = yield* client.OpenProject({ commandId: commandId(), grant: yield* grant(repository()) })
        const task = yield* client.CreateTask({ commandId: commandId(), projectId: project.id, title: 'Nothing' })
        const refused = yield* Effect.flip(client.StartSession({ commandId: commandId(), threadId: task.threadId, agentId: 'missing' }))
        assert.deepStrictEqual(
          [refused.reason, refused.message],
          ['SessionFailed', "missing couldn't start. charrette-no-such-agent isn't installed, or isn't on this Mac's PATH."],
        )
        const thread = yield* client.GetThread({ threadId: task.threadId })
        assert.deepStrictEqual(thread.items.at(-1)?.content, {
          source: 'runtime',
          severity: 'error',
          title: "Fake missing couldn't start.",
          description: "charrette-no-such-agent isn't installed, or isn't on this Mac's PATH.",
        })
        assert.strictEqual(
          (yield* Effect.flip(client.GetThreadItem({ threadId: task.threadId, itemId: 'itm_missing' }))).reason,
          'NotFound',
        )
      }),
    ),
  )
})

describe('the coordinator, through the API', () => {
  it.live('plans what the person asks for, and takes their changes to the plan', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { client, grant } = yield* connected({ countdown: Duration.minutes(5) })
        const project = yield* client.OpenProject({ commandId: commandId(), grant: yield* grant(repository()) })
        const empty = yield* client.GetCoordinator({ projectId: project.id })
        assert.deepStrictEqual([empty.items.length, empty.session, empty.suggested?.agentId], [0, null, 'claude-code'])
        yield* client.Send({
          commandId: commandId(),
          threadId: empty.threadId,
          body: 'Add a retry. [coordinator:plan]',
          disposition: 'after_current',
        })
        const planned = yield* eventually(client.GetCoordinator({ projectId: project.id, limit: 50 }), (snapshot) =>
          snapshot.items.some((item) => item.kind === 'task'),
        )
        const card = planned.items.find((item) => item.kind === 'task')
        const planId = card?.kind === 'task' ? (card.content.plan?.id ?? '') : ''
        assert.strictEqual(planned.session?.agentId, 'claude-code')
        yield* client.HoldPlan({ commandId: commandId(), planId })
        yield* client.ChangePlan({
          commandId: commandId(),
          planId,
          steps: [
            { key: 'implement', agentId: 'codex', model: 'large', skipped: false },
            { key: 'review', agentId: 'claude-code', model: null, skipped: true },
          ],
        })
        const held = yield* client.GetThreadItem({ threadId: planned.threadId, itemId: card?.id ?? '' })
        assert.deepStrictEqual(
          held.kind === 'task' ? [held.content.phase, held.content.plan?.steps.map((step) => [step.agentId, step.skipped])] : [],
          [
            'held',
            [
              ['codex', false],
              ['claude-code', true],
            ],
          ],
        )
        yield* client.StartPlan({ commandId: commandId(), planId })
        const started = yield* eventually(
          client.GetThreadItem({ threadId: planned.threadId, itemId: card?.id ?? '' }),
          (item) => item.kind === 'task' && item.content.phase === 'running',
        )
        assert.isTrue(started.kind === 'task' && started.content.startedAt !== null)
        // The person's mistakes, in words.
        assert.strictEqual(
          (yield* Effect.flip(client.StartPlan({ commandId: commandId(), planId: 'pln_missing' }))).message,
          "That plan isn't there any more.",
        )
        assert.strictEqual(
          (yield* Effect.flip(client.GetCoordinator({ projectId: 'prj_missing' }))).message,
          "That project isn't there any more.",
        )
      }),
    ),
  )

  it.live('starts a task the person plans themselves, and shows it as a card', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { client, grant } = yield* connected()
        const project = yield* client.OpenProject({ commandId: commandId(), grant: yield* grant(repository()) })
        const starting = {
          commandId: commandId(),
          projectId: project.id,
          title: 'Tidy the README',
          description: 'Short. [lead:finish] [review:pass]',
          steps: [
            { key: 'implement' as const, agentId: 'codex', model: null, skipped: false },
            { key: 'review' as const, agentId: 'claude-code', model: 'large', skipped: false },
          ],
        }
        const task = yield* client.StartTask(starting)
        assert.strictEqual(task.title, 'Tidy the README')
        // Sent again by a retry, it starts once.
        assert.strictEqual((yield* client.StartTask(starting)).id, task.id)
        yield* client.StartTask({ ...starting, commandId: commandId(), title: 'No description', description: undefined })
        const snapshot = yield* eventually(client.GetCoordinator({ projectId: project.id }), (coordinator) =>
          coordinator.items.some((item) => item.kind === 'task' && item.content.phase === 'ready'),
        )
        const card = snapshot.items.find((item) => item.kind === 'task' && item.content.phase === 'ready')
        assert.deepStrictEqual(card?.kind === 'task' ? [card.content.slug, card.content.summary] : [], ['tidy-the-readme', 'Did the task.'])
        const review = (yield* client.GetThread({ threadId: card?.kind === 'task' ? card.content.threadId : '' })).items.find(
          (item) => item.kind === 'step_result' && item.content.step === 'review',
        )
        assert.deepStrictEqual(review?.kind === 'step_result' ? [review.content.verdict, review.content.agentId] : [], [
          'pass',
          'claude-code',
        ])
      }),
    ),
  )

  it.live("offers the person another agent when the coordinator's isn't signed in", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { client, grant } = yield* connected({ signedOut: ['claude-code'] })
        const project = yield* client.OpenProject({ commandId: commandId(), grant: yield* grant(repository()) })
        const snapshot = yield* client.GetCoordinator({ projectId: project.id })
        assert.deepStrictEqual(snapshot.suggested, { agentId: 'claude-code', agentName: 'Fake claude-code', model: null, available: false })
        const refused = yield* Effect.flip(
          client.Send({ commandId: commandId(), threadId: snapshot.threadId, body: 'Hello', disposition: 'after_current' }),
        )
        assert.deepStrictEqual(
          [refused.reason, refused.message],
          [
            'CoordinatorUnavailable',
            "Fake claude-code isn't signed in, so the coordinator can't start on it. Pick another agent for the coordinator, or sign in with its own tool.",
          ],
        )
        // Started on another agent, it waits for what the person says.
        yield* client.StartSession({ commandId: commandId(), threadId: snapshot.threadId, agentId: 'codex', model: 'large' })
        yield* client.Send({ commandId: commandId(), threadId: snapshot.threadId, body: 'Hello', disposition: 'after_current' })
        const answered = yield* eventually(
          client.GetCoordinator({ projectId: project.id }),
          (coordinator) => coordinator.items.filter((item) => item.kind === 'agent_message').length > 0,
        )
        assert.deepStrictEqual([answered.session?.agentId, answered.session?.model], ['codex', 'large'])
        assert.deepStrictEqual((yield* client.GetCoordinator({ projectId: project.id })).suggested?.model, 'large')
        // Stopped, it starts again on the same agent and model when the person next says something.
        yield* client.StopSession({ commandId: commandId(), threadId: snapshot.threadId })
        yield* eventually(client.GetCoordinator({ projectId: project.id }), (coordinator) => coordinator.session === null)
        yield* client.Send({ commandId: commandId(), threadId: snapshot.threadId, body: 'Again', disposition: 'after_current' })
        const again = yield* eventually(client.GetCoordinator({ projectId: project.id }), (coordinator) => coordinator.session !== null)
        assert.deepStrictEqual([again.session?.agentId, again.session?.model], ['codex', 'large'])
      }),
    ),
  )
})

describe('words', () => {
  const name = (agentId: string) => (agentId === 'codex' ? 'Codex' : agentId)

  it("says each of the runtime's errors as the window shows it", () => {
    const said = (error: unknown) => words(error, name).message
    assert.strictEqual(said(new NotARepository({ path: '/tmp/x' })), "/tmp/x isn't in a git repository. Choose a folder inside one.")
    assert.strictEqual(said(new NotFound({ kind: 'attention_request', id: 'a' })), "That call isn't there any more.")
    assert.strictEqual(said(new NotFound({ kind: 'something new', id: 'a' })), "That thing isn't there any more.")
    assert.strictEqual(said({ _tag: 'UnknownAgent', agentId: 'cursor' }), 'Charrette has no agent called cursor.')
    assert.strictEqual(said({ _tag: 'SessionRunning' }), 'An agent is already working on this task.')
    assert.strictEqual(said(new SessionFailed({ agentId: 'codex', reason: 'stack', summary: '' })), "Codex couldn't start.")
    assert.strictEqual(
      said(new ModelUnchanged({ agentId: 'codex', model: 'huge', summary: "The agent doesn't offer huge." })),
      "Codex is still on its old model. The agent doesn't offer huge.",
    )
    assert.strictEqual(said(new ModelUnchanged({ agentId: 'codex', model: 'huge', summary: '' })), 'Codex is still on its old model.')
    assert.strictEqual(said({ _tag: 'AttentionClosed' }), 'That call was already answered, or the agent took it back.')
    assert.strictEqual(
      said(new GitFailed({ args: ['worktree', 'add'], cwd: '/r', stderr: 'fatal: a branch named x already exists\n' })),
      "git worktree didn't work: fatal: a branch named x already exists.",
    )
    assert.strictEqual(said(new GitFailed({ args: ['fetch'], cwd: '/r', stderr: '' })), "git fetch didn't work.")
    assert.strictEqual(said({ _tag: 'CommandIdReused' }), 'That request was already used for something else. Try again.')
    assert.strictEqual(said({ _tag: 'DatabaseInUse' }), 'Another copy of Charrette is using this profile.')
    assert.strictEqual(said(new TurnInProgress({ sessionId: 's' })), 'The lead is still on its last turn.')
    assert.deepStrictEqual(words(new Error('boom'), name), {
      reason: 'Unknown',
      message: "Charrette's runtime couldn't do that. Its log has the details.",
    })
  })

  it("says what an agent's own errors mean", () => {
    assert.strictEqual(
      agentSaid(new AgentStartFailed({ command: 'opencode', reason: 'spawn opencode EACCES' })),
      "opencode wouldn't start: spawn opencode EACCES.",
    )
    assert.strictEqual(
      agentSaid(new AgentExited({ code: 1, signal: null, stderr: 'warming up\nout of memory\n' })),
      'The agent stopped: out of memory.',
    )
    assert.strictEqual(agentSaid(new AgentExited({ code: 1, signal: null, stderr: '' })), 'The agent stopped.')
    const failed = (failure: AgentRequestFailed['failure'], resetsAt?: string) =>
      agentSaid(
        new AgentRequestFailed({
          method: 'session/prompt',
          failure,
          message: 'Something odd',
          ...(resetsAt === undefined ? {} : { resetsAt }),
        }),
      )
    assert.strictEqual(failed('auth_required'), "The agent isn't signed in. Sign in with its own tool, then try again.")
    assert.strictEqual(failed('usage_limit'), "The agent's usage limit is reached.")
    assert.strictEqual(failed('usage_limit', '15:00'), "The agent's usage limit is reached until 15:00.")
    assert.strictEqual(failed('context_full'), "The agent's context is full.")
    assert.strictEqual(failed('unknown'), 'Something odd.')
    assert.strictEqual(
      agentSaid(new OptionUnavailable({ configId: 'model', value: 'huge', available: [] })),
      "The agent doesn't offer huge.",
    )
    assert.isUndefined(agentSaid('nothing'))
    assert.strictEqual(summarize(Cause.fail(new AgentExited({ code: 1, signal: null, stderr: '' }))), 'The agent stopped.')
    assert.strictEqual(summarize(Cause.die(new Error('It broke'))), 'It broke.')
    assert.strictEqual(summarize(Cause.empty), '')
  })
})

describe('thread items', () => {
  const row = (
    kind: string,
    content: unknown,
    input: { state: 'queued'; disposition: string } | null = null,
    decision: string | null = null,
  ) => ({
    id: 'i1',
    sequence: 1,
    kind,
    content: JSON.stringify(content),
    agentId: 'codex',
    inputState: input?.state ?? null,
    disposition: input?.disposition ?? null,
    decision,
    createdAt: '2026-09-29T12:00:00.000Z',
  })

  it('gives each kind its own content, and leaves out kinds the window has no use for yet', () => {
    assert.deepStrictEqual(itemOf(row('user_message', { text: 'Now' }, { state: 'queued', disposition: 'interrupt_and_continue' })), {
      id: 'i1',
      sequence: 1,
      agentId: 'codex',
      createdAt: '2026-09-29T12:00:00.000Z',
      kind: 'user_message',
      content: { text: 'Now' },
      input: { state: 'queued', interrupting: true },
    })
    const tool = itemOf(
      row(
        'tool_call',
        {
          title: 'Run it',
          rawInput: { command: ['bash', '-lc', 'make test'] },
          locations: [{ path: '/w/a', line: 2 }, { line: 3 }],
        },
        null,
        'reject',
      ),
    )
    assert.deepStrictEqual(tool?.content, {
      title: 'Run it',
      toolKind: 'other',
      status: 'pending',
      command: "bash -lc 'make test'",
      locations: [{ path: '/w/a', line: 2 }],
      declined: true,
    })
    assert.deepStrictEqual(itemOf(row('plan', { entries: 'none' }))?.content, { entries: [] })
    assert.deepStrictEqual(itemOf(row('notice', { source: 'agent', severity: 'loud', title: 'Hm' }))?.content, {
      source: 'agent',
      severity: 'info',
      title: 'Hm',
      description: null,
    })
    assert.deepStrictEqual(itemOf({ ...row('agent_message', null), content: 'not json' })?.content, { text: '' })
    assert.isUndefined(itemOf(row('something_new', {})))
    assert.deepStrictEqual(
      itemOf(
        row('step_result', {
          step: 'review',
          round: 1,
          verdict: 'changes_requested',
          summary: 'One thing.',
          findings: [
            { severity: 'loud', claim: 'x', line: 3 },
            { severity: 'blocking', file: 'a.ts', claim: 'y' },
            { severity: 'nit', claim: 'z' },
          ],
          agentId: 'codex',
        }),
      )?.content,
      {
        step: 'review',
        round: 1,
        summary: 'One thing.',
        verdict: 'changes_requested',
        findings: [
          { severity: 'minor', file: null, line: 3, claim: 'x' },
          { severity: 'blocking', file: 'a.ts', line: null, claim: 'y' },
          { severity: 'nit', file: null, line: null, claim: 'z' },
        ],
        agentId: 'codex',
      },
    )
    assert.deepStrictEqual(itemOf(row('step_result', { summary: 'Done.' }))?.content, {
      step: 'implement',
      round: 0,
      summary: 'Done.',
      verdict: null,
      findings: [],
      agentId: null,
    })
  })
})
