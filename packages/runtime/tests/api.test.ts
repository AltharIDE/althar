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
import {
  ChangedSinceSeen,
  EffortUnchanged,
  GitFailed,
  NoChangeToOpen,
  ModelUnchanged,
  NotARepository,
  NotFound,
  OutwardUncertain,
  SessionFailed,
} from '../src/errors'
import { NotConnected } from '../src/Connections'
import { Folders } from '../src/Folders'
import { itemOf, stuckOf } from '../src/Queries'
import { agentSaid, summarize, words } from '../src/words'
import { Connectors } from '../src/Config'
import { Secrets } from '../src/Secrets'
import { ConnectorFailed, products } from '@charrette/connectors'
import { makeFakeService } from '@charrette/connectors/testing'

import { fakeAgents, fakeConnectors, HOST, hosted, repository } from './support'

const commandId = () => `cmd_${randomBytes(16).toString('hex')}`

/** Lines the runtime would have opened in Terminal. */
const opened: Array<string> = []

/** The runtime serving the API on one end of a channel, and a client on the other, as the app's window has it. */
const connected = (
  options: {
    readonly countdown?: Duration.Duration
    readonly signedOut?: ReadonlyArray<string>
    readonly connectors?: Layer.Layer<Connectors>
    /** Where the app can't open Terminal, as the command-line client. */
    readonly noTerminal?: boolean
  } = {},
) =>
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
        secrets: Secrets.memory(),
        connectors: options.connectors ?? fakeConnectors({}),
        accountsRoot: mkdtempSync(join(tmpdir(), 'charrette-accounts-')),
        ...(options.noTerminal === true
          ? {}
          : { openTerminal: (line: string) => Effect.sync(() => void opened.push(line)).pipe(Effect.as(true)) }),
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
        // What it does when an agent is out of usage: moves on, until the person says it waits.
        assert.strictEqual(project.usageLimit, 'move')
        yield* client.SetUsageLimit({ commandId: commandId(), projectId: project.id, policy: 'wait' })
        assert.strictEqual((yield* client.ListProjects()).projects.find((summary) => summary.id === project.id)?.usageLimit, 'wait')
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
        // A task made by hand shows in the coordinator's thread as its card, once however often it was asked for.
        assert.deepStrictEqual(
          (yield* client.GetCoordinator({ projectId: project.id })).items.map((item) =>
            item.kind === 'task' ? [item.content.slug, item.content.plan, item.content.lead, item.content.startedAt] : [],
          ),
          [['say-hello', null, null, null]],
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
        yield* client.SetEffort({ commandId: commandId(), threadId: task.threadId, effort: 'high' })
        assert.strictEqual((yield* client.GetThread({ threadId: task.threadId })).session?.effort, 'high')
        const offered = yield* client.GetModels({})
        assert.deepStrictEqual(
          offered.map((agent) => agent.agentId),
          ['claude-code', 'codex', 'opencode'],
        )
        yield* client.SetDefaultEffort({ commandId: commandId(), agentId: 'codex', model: 'large', effort: 'high' })
        const codex = (yield* client.GetModels({})).find((agent) => agent.agentId === 'codex')
        assert.deepStrictEqual(codex?.defaults, [{ model: 'large', effort: 'high' }])
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

describe('accounts, through the API', () => {
  it.live(
    'lists each agent’s accounts, adds one in a folder of its own or one a person chose, signs it in, and orders, renames and removes them',
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { client, grant } = yield* connected()
          const codex = (yield* client.Status({})).agents.find((agent) => agent.id === 'codex')
          assert.deepStrictEqual(
            codex?.accounts.map((account) => [account.name, account.home, account.signIn, account.paidBy, account.outUntil]),
            [['main', null, 'signed_in', 'plan', null]],
          )
          const work = yield* client.AddAccount({ commandId: commandId(), agentId: 'codex', name: 'work' })
          assert.isNotNull(work.home)
          assert.strictEqual(work.adoptedFrom, null)
          const chosen = mkdtempSync(join(tmpdir(), 'charrette-chosen-'))
          const client2 = yield* client.AddAccount({
            commandId: commandId(),
            agentId: 'codex',
            name: 'Client',
            grant: yield* grant(chosen),
          })
          assert.deepStrictEqual([client2.home, client2.adoptedFrom], [chosen, 'a folder you chose'])
          const signIn = yield* client.SignInAccount({ commandId: commandId(), accountId: work.id })
          assert.deepStrictEqual(signIn, { line: `FAKE_HOME='${work.home}' fake-login codex`, opened: true })
          assert.include(opened, signIn.line)
          yield* client.OrderAccounts({ commandId: commandId(), agentId: 'codex', accountIds: [client2.id] })
          yield* client.RenameAccount({ commandId: commandId(), accountId: work.id, name: 'Work plan' })
          yield* client.RemoveAccount({ commandId: commandId(), accountId: client2.id })
          assert.deepStrictEqual(
            (yield* client.Status({})).agents.find((agent) => agent.id === 'codex')?.accounts.map((account) => account.name),
            ['main', 'Work plan'],
          )
          assert.deepStrictEqual(yield* client.FindAccounts({ agentId: 'opencode' }), { found: [] })
          const refused = yield* Effect.flip(client.RemoveAccount({ commandId: commandId(), accountId: codex?.accounts[0]?.id ?? '' }))
          assert.deepStrictEqual(
            [refused.reason, refused.message],
            ['AccountRefused', "That's the agent's usual sign-in, its first account: it stays."],
          )
          // Where nothing can open Terminal, the person is given the line to run.
          const { client: plain } = yield* connected({ noTerminal: true })
          const [main] = (yield* plain.Status({})).agents.find((agent) => agent.id === 'codex')?.accounts ?? []
          assert.deepStrictEqual(yield* plain.SignInAccount({ commandId: commandId(), accountId: main?.id ?? '' }), {
            line: 'fake-login codex',
            opened: false,
          })
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
          // What happens when the work is done can change too: here, the branch pushed only.
          end: 'none',
        })
        const held = yield* client.GetThreadItem({ threadId: planned.threadId, itemId: card?.id ?? '' })
        assert.strictEqual(held.kind === 'task' ? held.content.plan?.end : undefined, 'none')
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

  it.live('shows a step that needs the person as a call, and takes their answer', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { client, grant } = yield* connected()
        const project = yield* client.OpenProject({ commandId: commandId(), grant: yield* grant(repository()) })
        const task = yield* client.StartTask({
          commandId: commandId(),
          projectId: project.id,
          title: 'Nobody home',
          steps: [{ key: 'implement', agentId: 'missing', model: null, skipped: false }],
        })
        const waiting = yield* eventually(client.GetThread({ threadId: task.threadId }), (thread) => thread.attention.length === 1)
        const call = waiting.attention[0]
        assert.deepStrictEqual(
          [call?.kind, call?.stuck?.step, call?.stuck?.why, call?.stuck?.agentId],
          ['stuck', 'implement', 'failed_to_start', 'missing'],
        )
        // On the board, the call waits on the person, with the task it holds, and the task says it waits.
        const board = yield* client.GetBoard({ projectId: project.id })
        assert.deepStrictEqual(
          board.calls.map((waits) => [waits.id, waits.kind, waits.taskTitle, waits.threadId]),
          [[call?.id, 'stuck', 'Nobody home', task.threadId]],
        )
        assert.deepInclude(board.tasks[0], { taskId: task.id, phase: 'waiting', state: 'open', changed: null })
        const answering = { commandId: commandId(), attentionId: call?.id ?? '', answer: { kind: 'retry' as const, agentId: 'codex' } }
        yield* client.AnswerStuck(answering)
        // Sent again by a retry, it is answered once.
        yield* client.AnswerStuck(answering)
        const after = yield* eventually(client.GetThread({ threadId: task.threadId }), (thread) => thread.attention.length === 0)
        assert.strictEqual(after.session?.agentId, 'codex')
        // Answered, it leaves the board.
        assert.notInclude(
          (yield* client.GetBoard({ projectId: project.id })).calls.map((waits) => waits.id),
          call?.id,
        )
        assert.strictEqual(
          (yield* Effect.flip(client.AnswerStuck({ ...answering, commandId: commandId() }))).message,
          'That call was already answered, or the agent took it back.',
        )
      }),
    ),
  )

  it.live("offers the person another agent when the coordinator's isn't signed in", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { client, grant } = yield* connected({ signedOut: ['claude-code'] })
        const project = yield* client.OpenProject({ commandId: commandId(), grant: yield* grant(repository()) })
        const snapshot = yield* client.GetCoordinator({ projectId: project.id })
        assert.deepStrictEqual(snapshot.suggested, {
          agentId: 'claude-code',
          agentName: 'Fake claude-code',
          model: null,
          effort: null,
          available: false,
        })
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
        yield* client.StartSession({ commandId: commandId(), threadId: snapshot.threadId, agentId: 'codex', model: 'large', effort: 'low' })
        yield* client.Send({ commandId: commandId(), threadId: snapshot.threadId, body: 'Hello', disposition: 'after_current' })
        const answered = yield* eventually(
          client.GetCoordinator({ projectId: project.id }),
          (coordinator) => coordinator.items.filter((item) => item.kind === 'agent_message').length > 0,
        )
        assert.deepStrictEqual([answered.session?.agentId, answered.session?.model], ['codex', 'large'])
        const { suggested } = yield* client.GetCoordinator({ projectId: project.id })
        assert.deepStrictEqual([suggested?.model, suggested?.effort], ['large', 'low'])
        // Stopped, it starts again on the same agent and model when the person next says something.
        yield* client.StopSession({ commandId: commandId(), threadId: snapshot.threadId })
        yield* eventually(client.GetCoordinator({ projectId: project.id }), (coordinator) => coordinator.session === null)
        yield* client.Send({ commandId: commandId(), threadId: snapshot.threadId, body: 'Again', disposition: 'after_current' })
        const again = yield* eventually(client.GetCoordinator({ projectId: project.id }), (coordinator) => coordinator.session !== null)
        assert.deepStrictEqual([again.session?.agentId, again.session?.model, again.session?.effort], ['codex', 'large', 'low'])
      }),
    ),
  )
})

describe('code hosts and trackers, through the API', () => {
  it.live('connects them, lists the person’s issues, starts a task from one, and marks its pull request ready', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { working, bare } = hosted()
        const github = makeFakeService({ pushUrl: () => bare })
        github.addRepository(['meridian', 'api'])
        github.addIssue({ ref: 'meridian/api#12', title: 'Refunds ignore the limit' })
        const linear = makeFakeService({ product: 'linear' })
        linear.addIssue({ ref: 'MER-231', title: 'Rate-limit refunds like charges' })
        const jira = makeFakeService({ product: 'jira_dc' })
        const { client, grant } = yield* connected({
          countdown: Duration.millis(100),
          connectors: Layer.succeed(
            Connectors,
            Connectors.of({
              ...Context.get(yield* Layer.build(fakeConnectors({ github, linear })), Connectors),
              // A product only on a company's own server, offered by its address.
              products: [
                ...Context.get(yield* Layer.build(fakeConnectors({ github, linear })), Connectors).products,
                { ...products.jira_dc, make: () => ({ tracker: jira }) },
              ],
            }),
          ),
        })

        const offered = yield* client.ListConnections()
        assert.deepStrictEqual(
          offered.products.map((product) => [product.product, product.browserSignIn, product.selfHosted, product.hostedUrl]),
          [
            ['github', false, true, 'https://github.com'],
            ['linear', false, false, 'https://linear.app'],
            ['jira_dc', false, true, null],
          ],
        )
        assert.lengthOf(offered.connections, 0)
        // Without Charrette's app registered, the browser sign-in isn't offered; a pasted token is.
        const unavailable = yield* Effect.flip(client.StartSignIn({ commandId: commandId(), product: 'github' }))
        assert.strictEqual(unavailable.reason, 'SignInUnavailable')
        assert.strictEqual((yield* Effect.flip(client.GetSignIn({ flowId: 'nope' }))).reason, 'NotFound')
        yield* client.CancelSignIn({ commandId: commandId(), flowId: 'nope' })
        const signedIn = yield* client.ConnectToken({ commandId: commandId(), product: 'github', webUrl: HOST, token: 'ghp_x' })
        assert.deepInclude(signedIn, { product: 'github', webUrl: HOST, auth: 'token', state: 'ready' })
        yield* client.ConnectToken({ commandId: commandId(), product: 'linear', token: 'lin_api_x' })
        // A company's own server, by its address, with a token that goes with the account's email.
        const own = yield* client.ConnectToken({
          commandId: commandId(),
          product: 'jira_dc',
          webUrl: 'https://jira.meridian.dev',
          user: 'you@meridian.dev',
          token: 'pat',
        })
        assert.strictEqual(own.webUrl, 'https://jira.meridian.dev')
        assert.strictEqual(
          (yield* Effect.flip(client.StartSignIn({ commandId: commandId(), product: 'github', webUrl: 'https://git.meridian.dev' })))
            .reason,
          'SignInUnavailable',
        )
        assert.lengthOf((yield* client.ListConnections()).connections, 3)

        const project = yield* client.OpenProject({ commandId: commandId(), grant: yield* grant(working) })
        const { issues } = yield* client.ListIssues({ projectId: project.id })
        assert.sameMembers(
          issues.map((issue) => issue.key),
          ['MER-231', '#12'],
        )

        // A task from an issue, ending with a draft pull request since GitHub is connected.
        const started = yield* client.StartTask({
          commandId: commandId(),
          projectId: project.id,
          title: 'Rate-limit refunds',
          description: '[lead:finish] [lead:edit]',
          steps: [{ key: 'implement', agentId: 'claude-code', model: null, skipped: false }],
          issue: 'MER-231',
        })
        assert.strictEqual(started.branch, 'charrette/mer-231-rate-limit-refunds')
        const thread = yield* eventually(client.GetThread({ threadId: started.threadId }), (snapshot) => snapshot.task.changes.length === 1)
        assert.strictEqual(thread.task.issue?.key, 'MER-231')
        assert.deepInclude(thread.task.changes[0], { number: 1, draft: true, state: 'open', short: 'PR', prefix: '#' })
        // What it changed, as the accept view lists it, and a file's diff, read from git when asked for.
        assert.deepStrictEqual(thread.task.files, [
          { path: 'change.txt', from: null, status: 'added', add: 1, del: 0, binary: false, uncommitted: false },
        ])
        assert.strictEqual(thread.task.commits, 1)
        const diff = yield* client.GetFileDiff({ taskId: started.id, path: 'change.txt' })
        assert.deepStrictEqual(diff.lines, [
          { kind: 'hunk', text: '@@ -0,0 +1 @@' },
          { kind: 'added', new: 1, text: 'change' },
        ])
        // Only a file the task changed can be read this way.
        const refused = yield* Effect.flip(client.GetFileDiff({ taskId: started.id, path: '../../../../etc/hosts' }))
        assert.strictEqual(refused._tag, 'ApiError')
        yield* client.MarkReady({ commandId: commandId(), taskId: started.id })
        assert.isFalse((yield* client.GetThread({ threadId: started.threadId })).task.changes[0]?.draft)
        // On the board it is ready to accept, its pull request with it.
        const ready = (yield* client.GetBoard({ projectId: project.id })).tasks.find((task) => task.taskId === started.id)
        assert.deepInclude(ready, { phase: 'ready', changed: null })
        assert.strictEqual(ready?.change?.number, 1)
        yield* client.RefreshTask({ commandId: commandId(), taskId: started.id })
        // It has its pull request already: there is none to open.
        const opened = yield* Effect.flip(client.OpenChange({ commandId: commandId(), taskId: started.id }))
        assert.deepStrictEqual([opened.reason, opened.message], ['NoChangeToOpen', 'The task already has its pull request.'])

        // A task created from #12 keeps it as its issue.
        const created = yield* client.CreateTask({ commandId: commandId(), projectId: project.id, title: 'Fix the limit', issue: '#12' })
        assert.strictEqual(created.branch, 'charrette/issue-12-fix-the-limit')

        // A planned task's ending can change before it starts.
        const planned = yield* client.StartTask({
          commandId: commandId(),
          projectId: project.id,
          title: 'Push only',
          steps: [{ key: 'implement', agentId: 'claude-code', model: null, skipped: false }],
          end: 'none',
        })
        assert.strictEqual(planned.title, 'Push only')

        yield* client.Disconnect({ commandId: commandId(), connectionId: signedIn.id })
        assert.lengthOf((yield* client.ListConnections()).connections, 2)
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
    assert.strictEqual(
      said(new EffortUnchanged({ agentId: 'codex', effort: 'max', summary: 'It offers no choice of effort.' })),
      'Codex still thinks as hard as it did. It offers no choice of effort.',
    )
    assert.strictEqual(said(new EffortUnchanged({ agentId: 'codex', effort: 'max', summary: '' })), 'Codex still thinks as hard as it did.')
    assert.strictEqual(said({ _tag: 'AttentionClosed' }), 'That call was already answered, or the agent took it back.')
    assert.strictEqual(
      said(new GitFailed({ args: ['worktree', 'add'], cwd: '/r', stderr: 'fatal: a branch named x already exists\n' })),
      "git worktree didn't work: fatal: a branch named x already exists.",
    )
    assert.strictEqual(said(new GitFailed({ args: ['fetch'], cwd: '/r', stderr: '' })), "git fetch didn't work.")
    assert.strictEqual(said({ _tag: 'CommandIdReused' }), 'That request was already used for something else. Try again.')
    assert.strictEqual(said({ _tag: 'DatabaseInUse' }), 'Another copy of Charrette is using this profile.')
    assert.strictEqual(said(new TurnInProgress({ sessionId: 's' })), 'The lead is still on its last turn.')
    // What a code host or tracker said, or why it couldn't be asked.
    const host = (reason: ConnectorFailed['reason'], message = '') => said(new ConnectorFailed({ product: 'github', reason, message }))
    assert.strictEqual(host('unauthorized'), "GitHub no longer takes Charrette's sign-in. Sign in to it again.")
    assert.strictEqual(host('forbidden', 'Resource not accessible'), "GitHub won't let this account do that: Resource not accessible.")
    assert.strictEqual(host('forbidden'), "GitHub won't let this account do that.")
    assert.strictEqual(host('not_found'), "GitHub can't find it any more.")
    assert.strictEqual(host('rate_limited'), 'GitHub is asking Charrette to slow down. Try again in a little while.')
    assert.strictEqual(host('unreachable'), "Charrette couldn't reach GitHub. Try again in a moment.")
    assert.strictEqual(host('invalid_response'), "GitHub answered in a way Charrette didn't understand.")
    assert.strictEqual(host('rejected', 'Pull Request is not mergeable'), 'GitHub said no: Pull Request is not mergeable.')
    assert.strictEqual(said(new ConnectorFailed({ product: 'gitea' as never, reason: 'rejected', message: '' })), 'The service said no.')
    assert.strictEqual(
      said(new NotConnected({ product: 'linear', what: 'MER-1' })),
      "Charrette isn't connected to Linear. Connect it, then try again.",
    )
    assert.strictEqual(
      said(new OutwardUncertain({ operation: 'merge' })),
      "Charrette can't tell whether that went through: its answer was lost. Look on the host before trying again.",
    )
    assert.strictEqual(
      said(new ChangedSinceSeen({ taskId: 't' })),
      'The pull request changed since you looked at it. Have another look before you accept it.',
    )
    assert.deepStrictEqual(
      (['working', 'stopped', 'settled'] as const).map((why) => said(new NoChangeToOpen({ taskId: 't', why }))),
      [
        "The task's work isn't done yet. Its pull request opens when it is.",
        'The task’s work stopped before it was done, so it has no pull request to open.',
        'The task is settled, so its branch stays as it is.',
      ],
    )
    assert.strictEqual(
      said({ _tag: 'NoChangeToOpen', why: 'something new' }),
      "The task's work isn't done yet. Its pull request opens when it is.",
    )
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

describe('steps that need the person', () => {
  it('reads what a call says, and makes do with what it lacks', () => {
    assert.deepStrictEqual(stuckOf({ step: 'settle', why: 'round_limit', detail: 'Fixed.', agentId: 'codex', round: 3, open: 2 }), {
      step: 'settle',
      why: 'round_limit',
      detail: 'Fixed.',
      agentId: 'codex',
      round: 3,
      open: 2,
    })
    for (const why of ['no_report', 'session_ended', 'restarted']) assert.strictEqual(stuckOf({ why }).why, why)
    assert.strictEqual(stuckOf({ step: 'review' }).step, 'review')
    assert.deepStrictEqual(stuckOf({}), { step: 'implement', why: 'failed_to_start', detail: null, agentId: null, round: 0, open: 0 })
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
      content: { text: 'Now', links: [] },
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
        change: null,
      },
    )
    assert.deepStrictEqual(itemOf(row('step_result', { summary: 'Done.' }))?.content, {
      step: 'implement',
      round: 0,
      summary: 'Done.',
      verdict: null,
      findings: [],
      agentId: null,
      change: null,
    })
  })
})
