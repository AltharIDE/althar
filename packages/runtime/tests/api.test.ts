import { randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep, win32 } from 'node:path'
import { MessageChannel } from 'node:worker_threads'

import { Api, ApiError, clientProtocol, emitterPort, type ThreadSnapshot, type WatchEvent } from '@althar/contracts'
import {
  type AgentDefinition,
  AgentExited,
  AgentRequestFailed,
  AgentStartFailed,
  OptionUnavailable,
  TurnInProgress,
} from '@althar/provider-adapters'
import { scenarios } from '@althar/provider-adapters/testing'
import { assert, describe, it } from '@effect/vitest'
import { Cause, Context, Duration, Effect, Fiber, Layer, Option, Stream } from 'effect'
import { RpcClient } from 'effect/rpc'
import { SqlClient } from 'effect/sql'

import { fakeGitHub, writeCatalog } from '../../skills/tests/support'
import { connection, isInside, services } from '../src/Api'
import {
  ChangedSinceSeen,
  CantMerge,
  PushRefused,
  EffortUnchanged,
  GitFailed,
  NoChangeToOpen,
  ModelUnchanged,
  NotARepository,
  NotAnIssue,
  RepositoriesNeeded,
  NotFound,
  NothingToWaitFor,
  OutwardUncertain,
  SessionFailed,
  TaskRefused,
} from '../src/errors'
import { NotConnected } from '../src/Connections'
import { Folders } from '../src/Folders'
import { itemOf, stuckOf } from '../src/Queries'
import { agentSaid, summarize, words } from '../src/words'
import { type AgentEntry, Agents, Connectors, type RuntimeOptions } from '../src/Config'
import { type Failure, Failures } from '../src/Failures'
import { Secrets } from '../src/Secrets'
import { ConnectorFailed, products } from '@althar/connectors'
import { makeFakeService } from '@althar/connectors/testing'

import { callTool, fakeAgents, fakeConnectors, HOST, hosted, repository, ROOMY, ROOMY_DISK } from './support'

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
    /** The editors a task's files open in, and what opening one does. */
    readonly editors?: RuntimeOptions['editors']
    /** The machine how many agents are at work at once comes from: a large one unless a test says. */
    readonly machine?: { readonly cores: number; readonly memory: number }
    /** A skills store and the catalog it is seeded from, and how GitHub is reached. */
    readonly skills?: RuntimeOptions['skills']
    readonly fetch?: RuntimeOptions['fetch']
    /** The agents, where a test changes one: the fake ones otherwise. */
    readonly agents?: Layer.Layer<Agents>
  } = {},
) =>
  Effect.gen(function* () {
    const channel = new MessageChannel()
    yield* Effect.addFinalizer(() => Effect.sync(() => channel.port1.close()))
    const context = yield* Layer.build(
      services({
        database: ':memory:',
        worktreeRoot: mkdtempSync(join(tmpdir(), 'althar-worktrees-')),
        appVersion: '0.0.0-test',
        deviceName: 'Test Mac',
        agents: options.agents ?? fakeAgents({}, options.signedOut),
        secrets: Secrets.memory(),
        connectors: options.connectors ?? fakeConnectors({}),
        accountsRoot: mkdtempSync(join(tmpdir(), 'althar-accounts-')),
        artifactsRoot: mkdtempSync(join(tmpdir(), 'althar-artifacts-')),
        ...(options.noTerminal === true
          ? {}
          : { openTerminal: (line: string) => Effect.sync(() => void opened.push(line)).pipe(Effect.as(true)) }),
        ...(options.countdown === undefined ? {} : { countdown: options.countdown }),
        ...(options.editors === undefined ? {} : { editors: options.editors }),
        ...(options.skills === undefined ? {} : { skills: options.skills }),
        ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
        busy: { machine: options.machine ?? ROOMY },
        // A roomy disk, so no finished task's folder goes for the Mac running the tests being full.
        disk: () => Effect.succeed(ROOMY_DISK),
        // A pull request with no checks has none: no test waits for a host to show them.
        checksAppear: Duration.zero,
      }),
    )
    // Each window's connection runs on a fiber of its own, as in the app: it ends when its client goes.
    yield* Effect.forkScoped(Layer.launch(connection(emitterPort(channel.port1, (data) => data))).pipe(Effect.provideContext(context)))
    const protocol = yield* Layer.build(clientProtocol(emitterPort(channel.port2, (data) => data)))
    const client = yield* RpcClient.make(Api).pipe(Effect.provideContext(protocol))
    /** A folder the person chose, as the app's main process allows it. */
    const grant = (path: string) => Context.get(context, Folders).allow(path)
    /** Reads or writes the runtime's store directly, for what no client does. */
    const store = <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) => effect.pipe(Effect.provideContext(context))
    return { client, grant, store, context }
  })

/** The fake agents, with one of them changed: to make what Althar asks of it fail. */
const agentsWith = (agentId: string, change: (definition: AgentDefinition) => AgentDefinition) =>
  Layer.effect(
    Agents,
    Effect.gen(function* () {
      const agents = yield* Agents
      const changed = (entry: AgentEntry): AgentEntry =>
        entry.definition.id === agentId ? { ...entry, definition: change(entry.definition) } : entry
      return Agents.of({ list: agents.list.map(changed), get: (id) => Effect.map(agents.get(id), changed) })
    }),
  ).pipe(Layer.provide(fakeAgents()))

/** What the runtime reports it kept or couldn't do, from now on, as the desktop app hears it. */
const reported = <R>(context: Context.Context<R>) =>
  Effect.gen(function* () {
    const heard: Array<Failure> = []
    yield* Effect.forkScoped(
      Stream.runForEach(Context.get(context, Failures).events, (failure) => Effect.sync(() => void heard.push(failure))),
    )
    // Listening before anything is said.
    yield* Effect.sleep('20 millis')
    return heard
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
  it.live('reads what a running command has printed so far, and what it printed once its turn was stopped', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { client, grant } = yield* connected()
        const project = yield* client.OpenProject({ commandId: commandId(), grant: yield* grant(repository()) })
        const task = yield* client.CreateTask({ commandId: commandId(), projectId: project.id, title: 'Run the server' })
        yield* client.StartSession({ commandId: commandId(), threadId: task.threadId, agentId: 'codex' })
        yield* eventually(client.GetThread({ threadId: task.threadId }), (thread) => idle(thread) && thread.items.length > 0)
        yield* client.Send({ commandId: commandId(), threadId: task.threadId, body: scenarios.streams, disposition: 'after_current' })
        const running = yield* eventually(client.GetThread({ threadId: task.threadId }), (thread) =>
          thread.items.some((item) => item.kind === 'tool_call' && item.content.command === 'npm run dev'),
        )
        const run = running.items.find((item) => item.kind === 'tool_call' && item.content.command === 'npm run dev')
        // A window that opens now reads what it printed before it looked.
        const soFar = yield* eventually(client.ReadOutput({ threadId: task.threadId, itemId: run?.id ?? '' }), (read) =>
          read.text.includes('ready in 3 ms'),
        )
        assert.isTrue(soFar.text.startsWith('ready in 1 ms'))
        yield* client.Interrupt({ commandId: commandId(), threadId: task.threadId })
        const stopped = yield* eventually(client.GetThread({ threadId: task.threadId }), (thread) =>
          thread.items.some((item) => item.id === run?.id && item.kind === 'tool_call' && item.content.output !== null),
        )
        const ended = stopped.items.find((item) => item.id === run?.id)
        const lines = ended?.kind === 'tool_call' ? (ended.content.output?.lines ?? 0) : 0
        assert.isAtLeast(lines, 3)
        const kept = yield* client.ReadOutput({ threadId: task.threadId, itemId: run?.id ?? '' })
        assert.strictEqual(kept.text.split('\n').filter((line) => line !== '').length, lines)
      }),
    ),
  )

  it.live('streams a command’s output, then reads what it printed and the document the agent wrote', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { client, grant } = yield* connected()
        const project = yield* client.OpenProject({ commandId: commandId(), grant: yield* grant(repository()) })
        const task = yield* client.CreateTask({ commandId: commandId(), projectId: project.id, title: 'Hand it back' })
        const outputs = yield* Effect.forkChild(
          Stream.runCollect(
            Stream.take(
              Stream.filter(client.Watch({}), (event) => event._tag === 'Output' && event.threadId === task.threadId),
              // At most one every 50 ms: a command that ends sooner may stream once, and the rest is read from what was kept.
              1,
            ),
          ),
        )
        yield* Effect.sleep('50 millis')
        yield* client.StartSession({ commandId: commandId(), threadId: task.threadId, agentId: 'codex' })
        yield* eventually(client.GetThread({ threadId: task.threadId }), (thread) => idle(thread) && thread.items.length > 0)
        yield* client.Send({ commandId: commandId(), threadId: task.threadId, body: scenarios.handsBack, disposition: 'after_current' })
        const thread = yield* eventually(
          client.GetThread({ threadId: task.threadId }),
          (value) => idle(value) && value.items.some((item) => item.kind === 'agent_message' && item.content.text.includes('charges')),
        )
        const streamed = (yield* Fiber.join(outputs)) as ReadonlyArray<WatchEvent>
        assert.isTrue(streamed.every((event) => event._tag === 'Output' && event.text.startsWith(' ✓ charges/limit')))
        const tools = thread.items.flatMap((item) => (item.kind === 'tool_call' ? [item] : []))
        const ran = tools.find((item) => item.content.command === 'npm test')
        const printed = ' ✓ charges/limit (14)\n ✓ refunds/router (38)\n 52 passed\n'
        assert.deepStrictEqual(
          [ran?.content.exit, ran?.content.output],
          [0, { kept: true, lines: 3, bytes: Buffer.byteLength(printed), dropped: 0, error: null }],
        )
        assert.deepStrictEqual(yield* client.ReadOutput({ threadId: task.threadId, itemId: ran?.id ?? '' }), { text: printed, dropped: 0 })
        const lint = tools.find((item) => item.content.command === 'npm run lint')
        assert.deepStrictEqual([lint?.content.status, lint?.content.exit, lint?.content.output?.lines], ['failed', 1, 3])
        // The screenshot, by its digest and size; the document by its path.
        const shot = tools.find((item) => item.content.pictures.length > 0)
        assert.deepInclude(shot?.content.pictures[0], { mediaType: 'image/png', width: 480, height: 300, unkept: null })
        const wrote = tools.find((item) => item.content.files.some((file) => file.how === 'wrote'))
        const path = wrote?.content.files[0]?.path ?? ''
        assert.match(path, /[/\\]docs[/\\]notes\.md$/)
        const document = yield* client.ReadDocument({ threadId: task.threadId, path })
        assert.deepStrictEqual([document.lines, document.body.startsWith('# Notes')], [8, true])
        assert.deepStrictEqual((yield* client.ReadDocument({ threadId: task.threadId, path: 'docs/notes.md' })).body, document.body)
        // What the message handed back: a file it points at, and a picture.
        const said = thread.items.findLast((item) => item.kind === 'agent_message')
        assert.deepStrictEqual(
          said?.kind === 'agent_message' ? [said.content.files.map((file) => file.how), said.content.pictures.length] : [],
          [['linked'], 1],
        )
        // Only markdown, only inside the worktree, and only what is there.
        const refused = (asked: string) =>
          Effect.map(Effect.flip(client.ReadDocument({ threadId: task.threadId, path: asked })), (error) => error.message)
        assert.strictEqual(yield* refused('report.csv'), 'Only markdown documents open here. Open the file in your editor.')
        assert.strictEqual(yield* refused('/etc/../etc/hosts.md'), "That document isn't there any more.")
        assert.strictEqual(yield* refused('docs/gone.md'), "That document isn't there any more.")
        assert.strictEqual(
          (yield* Effect.flip(client.ReadOutput({ threadId: task.threadId, itemId: shot?.id ?? '' }))).message,
          "That output isn't there any more.",
        )
        // The coordinator writes no documents.
        const coordinator = yield* client.GetCoordinator({ projectId: project.id })
        assert.strictEqual(
          (yield* Effect.flip(client.ReadDocument({ threadId: coordinator.threadId, path: 'docs/notes.md' }))).reason,
          'NotFound',
        )
      }),
    ),
  )

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
        // What it does when an agent is out of usage: moves on, until the person says it asks them, or waits.
        assert.strictEqual(project.usageLimit, 'move')
        yield* client.SetUsageLimit({ commandId: commandId(), projectId: project.id, policy: 'ask' })
        assert.strictEqual((yield* client.ListProjects()).projects.find((summary) => summary.id === project.id)?.usageLimit, 'ask')
        yield* client.SetUsageLimit({ commandId: commandId(), projectId: project.id, policy: 'wait' })
        assert.strictEqual((yield* client.ListProjects()).projects.find((summary) => summary.id === project.id)?.usageLimit, 'wait')
        const creating = { commandId: commandId(), projectId: project.id, title: 'Say hello', description: 'Briefly.' }
        const task = yield* client.CreateTask(creating)
        assert.strictEqual((yield* client.CreateTask(creating)).id, task.id)
        assert.strictEqual(task.branch, 'althar/say-hello')
        const listed = yield* client.ListProjects()
        assert.deepStrictEqual(
          listed.projects.map((summary) => [summary.id, summary.tasks]),
          [[project.id, 1]],
        )
        // The home has the project; left, it reads what the loop did from then.
        const firstLook = yield* client.GetHome({})
        assert.deepStrictEqual([firstLook.looked, firstLook.projects.map((summary) => summary.id)], [null, [project.id]])
        yield* client.LeftHome({ commandId: commandId() })
        assert.isNotNull((yield* client.GetHome({})).looked)
        assert.strictEqual((yield* client.GetHome({ since: '2026-01-01T00:00:00.000Z' })).since, '2026-01-01T00:00:00.000Z')
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

        // A page of the newest, reaching back to the start of its round, what the person said; then the one before it, and one item by id.
        const newest = yield* client.GetThread({ threadId: task.threadId, limit: 1 })
        assert.deepStrictEqual(texts(newest), ['hello', 'Hello'])
        assert.isTrue(newest.earlier)
        const before = yield* client.GetThread({ threadId: task.threadId, before: newest.items[0]?.sequence ?? 0, limit: 1 })
        assert.isTrue(texts(before).every((text) => text?.startsWith('echo: You are working on a task') === true))
        assert.isFalse(before.earlier)
        // What the agent already has can't be taken back.
        assert.strictEqual(
          (yield* Effect.flip(client.TakeBack({ commandId: commandId(), itemId: newest.items[0]?.id ?? '' }))).message,
          "The agent already has that message, so it can't be taken back.",
        )
        assert.isEmpty((yield* client.GetThread({ threadId: task.threadId, limit: 0 })).items)
        const reply = yield* client.GetThreadItem({ threadId: task.threadId, itemId: newest.items[1]?.id ?? '' })
        assert.deepStrictEqual(reply.content, { text: 'Hello', pictures: [], files: [] })

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
          pictures: [],
          files: [],
          output: null,
          exit: null,
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
        yield* client.SetModelBlocked({ commandId: commandId(), agentId: 'codex', model: 'large', blocked: true })
        assert.deepStrictEqual((yield* client.GetModels({})).find((agent) => agent.agentId === 'codex')?.blocked, ['large'])
        yield* client.SetModelBlocked({ commandId: commandId(), agentId: 'codex', model: 'large', blocked: false })
        assert.deepStrictEqual((yield* client.GetModels({})).find((agent) => agent.agentId === 'codex')?.blocked, [])

        // How full the agent's context is reaches a client as the agent says it, and its session says it after.
        const contexts = yield* Effect.forkChild(
          Stream.runCollect(
            Stream.take(
              Stream.filter(client.Watch({}), (event) => event._tag === 'Context'),
              1,
            ),
          ),
        )
        yield* Effect.sleep('50 millis')
        yield* client.Send({ commandId: commandId(), threadId: task.threadId, body: scenarios.updates, disposition: 'after_current' })
        const [usage] = (yield* Fiber.join(contexts)) as ReadonlyArray<WatchEvent>
        assert.deepStrictEqual(usage, { _tag: 'Context', threadId: task.threadId, used: 1200, size: 200_000 })
        const full = yield* eventually(client.GetThread({ threadId: task.threadId, limit: 0 }), (value) => value.session?.context != null)
        assert.deepStrictEqual(full.session?.context, { used: 1200, size: 200_000 })
        yield* client.Interrupt({ commandId: commandId(), threadId: task.threadId })
        yield* client.StopSession({ commandId: commandId(), threadId: task.threadId })
        assert.isNull((yield* client.GetThread({ threadId: task.threadId })).session)
      }),
    ),
  )

  it.live('says which agents more accounts can be added to: none whose sign-in every folder shares', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { client } = yield* connected({
          agents: agentsWith('codex', (definition) => ({ ...definition, home: { ...definition.home, accounts: 'one' } })),
        })
        const status = yield* client.Status({})
        assert.deepStrictEqual(
          status.agents.map((agent) => [agent.id, agent.addsAccounts]),
          [
            ['claude-code', true],
            ['codex', false],
            ['opencode', true],
          ],
        )
      }),
    ),
  )

  it.live('keeps a failed account check to that account, shows the rest as they are, and reports it', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { client, context } = yield* connected({
          agents: agentsWith('codex', (definition) => ({
            ...definition,
            signIn: {
              ...definition.signIn,
              status: () => {
                throw new Error('Codex’s status command is not there')
              },
            },
          })),
        })
        const heard = yield* reported(context)
        const status = yield* client.Status({ recheck: true })
        assert.deepStrictEqual(
          status.agents.map((agent) => [agent.id, agent.signIn, agent.accounts.map((account) => account.signIn), agent.problem]),
          [
            ['claude-code', 'signed_in', ['signed_in'], null],
            ['codex', 'unknown', ['unknown'], null],
            ['opencode', 'signed_in', ['signed_in'], null],
          ],
        )
        const [failure] = yield* eventually(
          Effect.sync(() => heard),
          (list) => list.length > 0,
        )
        assert.deepInclude(failure, {
          where: 'Status.account',
          agent: 'codex',
          name: 'Error',
          message: 'Codex’s status command is not there',
        })
        assert.include(failure?.stack ?? '', 'Codex’s status command is not there')
      }),
    ),
  )

  it.live('says an agent it couldn’t check on that agent alone, and the others as they are', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { client, context } = yield* connected({
          agents: agentsWith('opencode', (definition) =>
            Object.defineProperty({ ...definition }, 'cli', {
              get: () => {
                throw new TypeError('No command for OpenCode')
              },
            }),
          ),
        })
        const heard = yield* reported(context)
        const status = yield* client.Status({})
        const [claude, codex, opencode] = status.agents
        assert.deepStrictEqual([claude?.signIn, claude?.problem, codex?.signIn, codex?.problem], ['signed_in', null, 'signed_in', null])
        assert.deepInclude(opencode, { id: 'opencode', signIn: 'unknown', accounts: [], version: null, installed: true, download: null })
        assert.strictEqual(opencode?.problem, "Althar couldn't check Fake opencode. Its log has the details.")
        const [failure] = yield* eventually(
          Effect.sync(() => heard),
          (list) => list.some((each) => each.where === 'Status.agent'),
        )
        assert.deepInclude(failure, { where: 'Status.agent', agent: 'opencode', name: 'TypeError', message: 'No command for OpenCode' })
      }),
    ),
  )

  it.live('reports a call that failed for no reason of the person’s by the call’s name, and not one they can put right', () =>
    Effect.scoped(
      Effect.gen(function* () {
        // Even what stands in for an agent it couldn't check fails: the call does, at its edge.
        const { client, context } = yield* connected({
          agents: agentsWith('codex', (definition) =>
            Object.defineProperty({ ...definition }, 'signIn', {
              get: () => {
                throw new RangeError('Codex has no sign-in')
              },
            }),
          ),
        })
        const heard = yield* reported(context)
        const error = yield* Effect.flip(client.Status({}))
        assert.deepStrictEqual([error.reason, error.message], ['Unknown', "Althar's runtime couldn't do that. Its log has the details."])
        const failures = yield* eventually(
          Effect.sync(() => heard),
          (list) => list.some((each) => each.where === 'Status'),
        )
        assert.deepInclude(
          failures.find((each) => each.where === 'Status'),
          { where: 'Status', agent: null, name: 'RangeError', message: 'Codex has no sign-in' },
        )
        // Something the person can put right is theirs to see, never reported.
        const before = heard.length
        assert.strictEqual((yield* Effect.flip(client.ReadOutput({ threadId: 'thr_none', itemId: 'itm_none' }))).reason, 'NotFound')
        yield* Effect.sleep('50 millis')
        assert.strictEqual(heard.length, before)
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

  it.live('hands a thread to another agent with what the person said, through the API', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { client, grant } = yield* connected()
        const project = yield* client.OpenProject({ commandId: commandId(), grant: yield* grant(repository()) })
        const task = yield* client.CreateTask({ commandId: commandId(), projectId: project.id, title: 'Retry' })
        yield* client.SwitchAgent({ commandId: commandId(), threadId: task.threadId, agentId: 'codex', model: 'large' })
        yield* eventually(client.GetThread({ threadId: task.threadId }), (thread) => idle(thread) && thread.items.length > 0)
        const switching = { commandId: commandId(), threadId: task.threadId, agentId: 'opencode', body: 'Take it from here' }
        yield* client.SwitchAgent(switching)
        // Sent again, it is the same switch: the message isn't said twice.
        yield* client.SwitchAgent(switching)
        const after = yield* eventually(
          client.GetThread({ threadId: task.threadId }),
          (thread) => idle(thread) && thread.session?.agentId === 'opencode',
        )
        assert.deepStrictEqual(
          after.items.filter((item) => item.kind === 'user_message').map((item) => item.content.text),
          ['Take it from here'],
        )
      }),
    ),
  )

  it.live('says when the turn running started, which the wait for its first word is counted from, and when it ended', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { client, grant } = yield* connected()
        const project = yield* client.OpenProject({ commandId: commandId(), grant: yield* grant(repository()) })
        const { threadId } = yield* client.GetCoordinator({ projectId: project.id })
        const sent = Date.now()
        yield* client.Send({
          commandId: commandId(),
          threadId,
          body: 'Why is checkout slow? [answers-after:1s]',
          disposition: 'after_current',
        })
        const thinking = yield* eventually(
          client.GetCoordinator({ projectId: project.id }),
          (snapshot) => snapshot.session?.turnRunning === true,
        )
        const started = Date.parse(thinking.session?.turnStartedAt ?? '')
        assert.isAtLeast(started, sent)
        assert.isAtMost(started, Date.now())
        // Before its first turn ends, none has.
        assert.isNull(thinking.session?.turnEndedAt)
        const answered = yield* eventually(
          client.GetCoordinator({ projectId: project.id }),
          (snapshot) => snapshot.session !== null && !snapshot.session.turnRunning,
        )
        assert.isNull(answered.session?.turnStartedAt)
        // Between turns, when the last ended: what was said before it has been answered.
        assert.isAtLeast(Date.parse(answered.session?.turnEndedAt ?? ''), started)
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
          { title: 'Run make deploy', reason: 'Deploying or publishing always asks.', command: 'make deploy' },
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
        // ...and who did, and what they said.
        assert.deepInclude(deploy?.kind === 'tool_call' ? deploy.content : {}, { declinedBy: 'person', declinedWhy: 'Not today' })
      }),
    ),
  )

  it.live("reads a project's notes, and drops one as the person, for good", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { client, grant, context } = yield* connected()
        const project = yield* client.OpenProject({ commandId: commandId(), grant: yield* grant(repository()) })
        const access = { role: 'coordinator' as const, projectId: project.id, threadId: 'none', sessionId: 'none', taskId: null }
        yield* callTool(access, 'keep_note', { note: 'Issue drafts need an approval card.' }).pipe(Effect.provideContext(context))
        const [note] = yield* client.GetProjectNotes({ projectId: project.id })
        assert.deepInclude(note, { body: 'Issue drafts need an approval card.', keptBy: 'coordinator' })
        yield* client.DropProjectNote({ commandId: commandId(), projectId: project.id, noteId: note?.id ?? '' })
        assert.deepStrictEqual(yield* client.GetProjectNotes({ projectId: project.id }), [])
        // The coordinator doesn't see it again.
        assert.strictEqual(yield* callTool(access, 'list_notes').pipe(Effect.provideContext(context)), 'The project has no notes yet.')
        // One that isn't there, or a project that isn't, says so.
        const missing = yield* Effect.flip(client.DropProjectNote({ commandId: commandId(), projectId: project.id, noteId: 'note_gone' }))
        assert.strictEqual(missing.reason, 'NotFound')
        const gone = yield* Effect.flip(client.GetProjectNotes({ projectId: 'proj_gone' }))
        assert.strictEqual(gone.reason, 'NotFound')
      }),
    ),
  )

  it.live("says a project's note in the person's words, as the coordinator then reads it, within a note's bounds", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { client, grant, context } = yield* connected()
        const project = yield* client.OpenProject({ commandId: commandId(), grant: yield* grant(repository()) })
        const access = { role: 'coordinator' as const, projectId: project.id, threadId: 'none', sessionId: 'none', taskId: null }
        yield* callTool(access, 'keep_note', { note: 'Issue drafts need an approval card.' }).pipe(Effect.provideContext(context))
        const [note] = yield* client.GetProjectNotes({ projectId: project.id })
        const noteId = note?.id ?? ''
        yield* client.EditProjectNote({
          commandId: commandId(),
          projectId: project.id,
          noteId,
          body: '  Issue drafts need an approval card,\n on every tracker. ',
        })
        // Kept as one line, by whoever kept it first, and the coordinator reads the new words.
        assert.deepInclude((yield* client.GetProjectNotes({ projectId: project.id }))[0], {
          id: noteId,
          body: 'Issue drafts need an approval card, on every tracker.',
          keptBy: 'coordinator',
        })
        assert.include(yield* callTool(access, 'list_notes').pipe(Effect.provideContext(context)), 'on every tracker.')
        // Empty or too long, it says so and stays as it was.
        const empty = yield* Effect.flip(client.EditProjectNote({ commandId: commandId(), projectId: project.id, noteId, body: ' ' }))
        assert.strictEqual(empty.reason, 'NoteRefused')
        const long = yield* Effect.flip(
          client.EditProjectNote({ commandId: commandId(), projectId: project.id, noteId, body: 'x'.repeat(301) }),
        )
        assert.match(long.message, /at most 300 characters/)
        assert.strictEqual(
          (yield* client.GetProjectNotes({ projectId: project.id }))[0]?.body,
          'Issue drafts need an approval card, on every tracker.',
        )
        // A dropped one can't be changed.
        yield* client.DropProjectNote({ commandId: commandId(), projectId: project.id, noteId })
        const dropped = yield* Effect.flip(
          client.EditProjectNote({ commandId: commandId(), projectId: project.id, noteId, body: 'Again.' }),
        )
        assert.strictEqual(dropped.message, "That note isn't there any more.")
      }),
    ),
  )

  it.live('keeps an always answer as a rule, and a call the rules screen now covers is answered by it', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { client, grant } = yield* connected()
        const project = yield* client.OpenProject({ commandId: commandId(), grant: yield* grant(repository()) })
        yield* client.SetProjectRules({ commandId: commandId(), projectId: project.id, permissions: 'ask' })
        const task = yield* client.CreateTask({ commandId: commandId(), projectId: project.id, title: 'Look' })
        yield* client.SwitchAgent({ commandId: commandId(), threadId: task.threadId, agentId: 'codex', model: 'large' })
        yield* eventually(client.GetThread({ threadId: task.threadId }), (thread) => idle(thread) && thread.items.length > 0)
        const run = (command: string) =>
          client.Send({ commandId: commandId(), threadId: task.threadId, body: `${scenarios.run}${command}`, disposition: 'after_current' })

        yield* run('git status')
        const waiting = yield* eventually(client.GetThread({ threadId: task.threadId }), (thread) => thread.attention.length === 1)
        assert.deepStrictEqual(waiting.attention[0]?.always?.allow, ['exact', 'prefix'])
        yield* client.Answer({ commandId: commandId(), attentionId: waiting.attention[0]?.id ?? '', decision: 'allow', always: 'prefix' })
        const rules = yield* client.GetProjectRules({ projectId: project.id })
        assert.deepStrictEqual(rules.commands, [{ pattern: 'git status', decision: 'allow' }])
        yield* eventually(client.GetThread({ threadId: task.threadId }), (thread) => idle(thread) && thread.attention.length === 0)

        // Taken off on the rules screen, the next asks; put back there, the call waiting is answered by it.
        yield* client.SetProjectRules({ commandId: commandId(), projectId: project.id, commands: [] })
        yield* run('git status -s')
        yield* eventually(client.GetThread({ threadId: task.threadId }), (thread) => thread.attention.length === 1)
        yield* client.SetProjectRules({
          commandId: commandId(),
          projectId: project.id,
          commands: [{ pattern: 'git status -s', decision: 'allow', match: 'exact' }],
        })
        const after = yield* eventually(
          client.GetThread({ threadId: task.threadId }),
          (thread) =>
            idle(thread) && thread.attention.length === 0 && thread.items.filter((item) => item.kind === 'tool_call').length === 2,
        )
        const last = after.items.filter((item) => item.kind === 'tool_call').at(-1)
        assert.deepStrictEqual(last?.kind === 'tool_call' ? last.content.allowedBy : undefined, {
          pattern: 'git status -s',
          match: 'exact',
        })
        assert.deepStrictEqual((yield* client.GetProjectRules({ projectId: project.id })).alwaysAllow, [])
        // An always that wasn't offered says so in words.
        const refused = yield* Effect.flip(
          client.Answer({ commandId: commandId(), attentionId: 'att_missing', decision: 'allow', always: 'kind' }),
        )
        assert.strictEqual(refused.reason, 'NotFound')
      }),
    ),
  )

  it.live('reads a folder the person chose, and opens the repositories they kept in it, never a path outside what they chose', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { client, grant } = yield* connected()
        const folder = realpathSync(mkdtempSync(join(tmpdir(), 'althar-folder-')))
        for (const name of ['api', 'web']) {
          const made = repository()
          execFileSync('git', ['clone', '-q', made, join(folder, name)])
        }
        const chosen = yield* grant(folder)
        const reading = yield* client.ReadFolder({ grant: chosen })
        assert.deepStrictEqual([reading.kind, reading.repositories.map((found) => found.name)], ['folder', ['api', 'web']])
        // A path the window names outside the folder the person chose isn't opened.
        const elsewhere = yield* Effect.flip(
          client.OpenProject({ commandId: commandId(), grant: chosen, repositories: [{ grant: chosen, path: repository() }] }),
        )
        assert.strictEqual(elsewhere.reason, 'NotFound')
        const project = yield* client.OpenProject({
          commandId: commandId(),
          grant: chosen,
          name: 'Meridian',
          repositories: [{ grant: chosen, path: join(folder, 'web') }],
        })
        assert.deepStrictEqual([project.name, project.repository, project.repositories], ['Meridian', folder, ['web']])
        assert.deepStrictEqual((yield* client.ReadFolder({ grant: chosen })).project, { id: project.id, name: 'Meridian' })
        // Made on purpose, under the window's id and in the ink it showed, from the same folder: a project of its own.
        const projectId = `proj_${'2'.repeat(32)}`
        const made = yield* client.OpenProject({
          commandId: commandId(),
          grant: chosen,
          name: 'Northwind',
          repositories: [{ grant: chosen, path: join(folder, 'api') }],
          projectId,
          ink: 'umber',
        })
        assert.deepStrictEqual([made.id, made.name, made.ink, made.repositories], [projectId, 'Northwind', 'umber', ['api']])
        const taken = yield* Effect.flip(client.OpenProject({ commandId: commandId(), grant: chosen, projectId }))
        assert.strictEqual(taken.reason, 'ProjectRefused')
      }),
    ),
  )

  it.live('says what went wrong, in words', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { client, grant } = yield* connected()
        const plain = mkdtempSync(join(tmpdir(), 'althar-plain-'))
        const error = yield* Effect.flip(client.OpenProject({ commandId: commandId(), grant: yield* grant(plain) }))
        assert.instanceOf(error, ApiError)
        assert.deepStrictEqual(
          [error.reason, error.message],
          ['NotARepository', `${plain} isn't a git repository, in one, or a folder with one directly inside it. Choose another folder.`],
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
          ['SessionFailed', "missing couldn't start. althar-no-such-agent isn't installed, or isn't on this computer's PATH."],
        )
        const thread = yield* client.GetThread({ threadId: task.threadId })
        assert.deepStrictEqual(thread.items.at(-1)?.content, {
          source: 'runtime',
          severity: 'error',
          title: "Fake missing couldn't start.",
          description: "althar-no-such-agent isn't installed, or isn't on this computer's PATH.",
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
          const chosen = mkdtempSync(join(tmpdir(), 'althar-chosen-'))
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
          // A project's rule for accounts: rotation, off until turned on, and which accounts each agent may use there.
          const project = yield* client.OpenProject({ commandId: commandId(), grant: yield* grant(repository()) })
          assert.deepStrictEqual([project.rotateAccounts, project.onlyAccounts], [false, null])
          yield* client.SetProjectAccounts({ commandId: commandId(), projectId: project.id, rotate: true, only: { codex: [work.id] } })
          const listed = (yield* client.ListProjects()).projects.find((each) => each.id === project.id)
          assert.deepStrictEqual([listed?.rotateAccounts, listed?.onlyAccounts], [true, { codex: [work.id] }])
          yield* client.SetProjectAccounts({ commandId: commandId(), projectId: project.id, rotate: true, only: null })
          assert.isNull((yield* client.ListProjects()).projects.find((each) => each.id === project.id)?.onlyAccounts)
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

describe('a project’s vocabulary, through the API', () => {
  it.live('says the names its code uses that have parts, its files’ among them, and not plain words', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { client, grant } = yield* connected()
        const repo = repository()
        mkdirSync(join(repo, 'src'))
        writeFileSync(
          join(repo, 'src', 'RefundLedger.ts'),
          'export class RefundLedger {\n  idempotency_key = MAX_RETRIES\n  useEffect() { return this.idempotency_key }\n}\nconst a-b = plain\n',
        )
        writeFileSync(join(repo, 'src', 'charges-api.ts'), 'export const settleCharge = () => handleCharge()\n')
        writeFileSync(join(repo, 'image.png'), Buffer.from([0, 1, 2, 3]))
        const run = (...args: Array<string>) =>
          execFileSync('git', args, {
            cwd: repo,
            env: {
              ...process.env,
              GIT_AUTHOR_NAME: 'T',
              GIT_AUTHOR_EMAIL: 't@a.test',
              GIT_COMMITTER_NAME: 'T',
              GIT_COMMITTER_EMAIL: 't@a.test',
            },
          })
        run('add', '.')
        run('commit', '-q', '-m', 'Ledger')
        const project = yield* client.OpenProject({ commandId: commandId(), grant: yield* grant(repo) })
        const words = yield* client.GetVocabulary({ projectId: project.id })
        for (const word of [
          'RefundLedger',
          'RefundLedger.ts',
          'idempotency_key',
          'useEffect',
          'MAX_RETRIES',
          'settleCharge',
          'handleCharge',
          'charges-api',
          'charges-api.ts',
        ])
          assert.include(words, word)
        for (const word of ['README', 'plain', 'export', 'image.png', 'a-b']) assert.notInclude(words, word)
        // Used most, said first.
        assert.isBelow(words.indexOf('RefundLedger'), words.indexOf('settleCharge'))

        const missing = yield* Effect.flip(client.GetVocabulary({ projectId: 'proj_missing' }))
        assert.strictEqual(missing.reason, 'NotFound')
      }),
    ),
  )
})

describe('settings, through the API', () => {
  it.live('has Althar as co-author until the person turns it off, and keeps that', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { client } = yield* connected()
        const line = 'Co-authored-by: Althar <337922799+AltharAi@users.noreply.github.com>'
        assert.deepStrictEqual((yield* client.GetSettings({})).coAuthor, { on: true, line })
        yield* client.SetCoAuthor({ commandId: commandId(), on: false })
        assert.deepStrictEqual((yield* client.GetSettings({})).coAuthor, { on: false, line })
        yield* client.SetCoAuthor({ commandId: commandId(), on: true })
        assert.isTrue((yield* client.GetSettings({})).coAuthor.on)
      }),
    ),
  )

  it.live('posts the team’s reviews without asking only once the person turns it on, and takes review drafts’ commands', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { client } = yield* connected()
        assert.isFalse((yield* client.GetSettings({})).postTeamReviews)
        yield* client.SetPostTeamReviews({ commandId: commandId(), on: true })
        assert.isTrue((yield* client.GetSettings({})).postTeamReviews)
        yield* client.SetPostTeamReviews({ commandId: commandId(), on: false })
        assert.isFalse((yield* client.GetSettings({})).postTeamReviews)
        // A draft that isn't there is said so, whichever the command.
        const draftId = `rdr_${'0'.repeat(32)}`
        for (const refused of [
          client.ChangeReviewDraft({
            commandId: commandId(),
            draftId,
            verdict: 'comment',
            summary: 'x',
            comments: [{ id: 'c1', kept: false }],
          }),
          client.ChangeReviewDraft({ commandId: commandId(), draftId }),
          client.PostReviewDraft({ commandId: commandId(), draftId }),
          client.DiscardReviewDraft({ commandId: commandId(), draftId }),
        ])
          assert.strictEqual((yield* Effect.flip(refused)).reason, 'NotFound')
      }),
    ),
  )

  it.live('says how many agents this Mac runs at once and why, takes the person’s number at once, and goes back to the default', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { client, store } = yield* connected({ machine: { cores: 10, memory: 16 * 1024 ** 3 } })
        const machine = { count: 4, cores: 10, memory: 16 }
        assert.deepStrictEqual((yield* client.GetSettings({})).agentsAtOnce, { count: 4, own: null, machine })
        // The default isn't kept: only what the person sets.
        const kept = store(
          Effect.flatMap(SqlClient.SqlClient, (sql) => sql<{ value: string }>`SELECT value FROM settings WHERE key = 'agents_at_once'`),
        )
        assert.deepStrictEqual(yield* kept, [])
        yield* client.SetAgentsAtOnce({ commandId: commandId(), count: 2 })
        assert.deepStrictEqual((yield* client.GetSettings({})).agentsAtOnce, { count: 2, own: 2, machine })
        assert.deepStrictEqual(yield* kept, [{ value: '2' }])
        yield* client.SetAgentsAtOnce({ commandId: commandId(), count: 9 })
        assert.deepStrictEqual((yield* client.GetSettings({})).agentsAtOnce, { count: 9, own: 9, machine })
        yield* client.SetAgentsAtOnce({ commandId: commandId(), count: null })
        assert.deepStrictEqual((yield* client.GetSettings({})).agentsAtOnce, { count: 4, own: null, machine })
        assert.deepStrictEqual(yield* kept, [])
      }),
    ),
  )
})

describe('finished tasks’ folders, through the API', () => {
  it.live('keeps when they go, lists one with its size, removes it by hand, and brings it back as it opens in an editor', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const opens: Array<string> = []
        const { client, grant, store } = yield* connected({
          editors: {
            list: () => [{ id: 'zed', name: 'Zed' }],
            open: (_editor, folder) => Effect.sync(() => void opens.push(folder)).pipe(Effect.as(true)),
          },
        })
        assert.strictEqual((yield* client.GetSettings({})).folderWait, 'smart')
        yield* client.SetFolderWait({ commandId: commandId(), wait: 'never' })
        assert.strictEqual((yield* client.GetSettings({})).folderWait, 'never')
        const project = yield* client.OpenProject({ commandId: commandId(), grant: yield* grant(repository()) })
        const task = yield* client.CreateTask({ commandId: commandId(), projectId: project.id, title: 'Add a retry' })
        const worktree = (yield* client.GetThread({ threadId: task.threadId })).task.worktree ?? ''
        execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@t.test', 'commit', '-q', '--allow-empty', '-m', 'Retry'], {
          cwd: worktree,
        })
        yield* store(
          Effect.flatMap(
            SqlClient.SqlClient,
            (sql) =>
              sql`UPDATE tasks SET state = 'done', settled_at = ${new Date(Date.now() - 86_400_000).toISOString()} WHERE id = ${task.id}`,
          ),
        )
        const listed = yield* eventually(client.GetTaskFolders({}), (folders) => !folders.measuring && folders.folders.length === 1)
        assert.deepStrictEqual(
          listed.folders.map((folder) => [folder.taskId, folder.threadId, folder.title, folder.kind, folder.held]),
          [[task.id, task.threadId, 'Add a retry', 'merged', null]],
        )
        assert.isTrue((listed.folders[0]?.bytes ?? 0) > 0)
        assert.isNotNull(listed.disk)
        const removed = yield* client.RemoveTaskFolder({ commandId: commandId(), taskId: task.id, seen: null })
        assert.strictEqual(removed.failed, 0)
        assert.isFalse(existsSync(worktree))
        assert.strictEqual((yield* client.GetThread({ threadId: task.threadId })).task.folder, 'removed')
        assert.deepStrictEqual((yield* client.CleanUpFolders({ commandId: commandId() })).failed, 0)
        // Opened in an editor, it comes back first, and counts as opened.
        assert.isTrue(yield* client.OpenInEditor({ commandId: commandId(), taskId: task.id, editor: 'zed' }))
        assert.isTrue(existsSync(worktree))
        assert.strictEqual(opens.length, 1)
        const opened = yield* store(
          Effect.flatMap(SqlClient.SqlClient, (sql) => sql<{ openedAt: string | null }>`SELECT opened_at FROM tasks WHERE id = ${task.id}`),
        )
        assert.isNotNull(opened[0]?.openedAt)
        const items = (yield* client.GetThread({ threadId: task.threadId })).items
        assert.deepStrictEqual(
          items.flatMap((item) => (item.kind === 'notice' && item.content.role === 'folder' ? [item.content.title.split(' · ')[0]] : [])),
          ['You removed its folder', 'Folder back from its branch'],
        )
        // Opened today, it is held back.
        const again = yield* eventually(client.GetTaskFolders({}), (folders) => folders.folders.length === 1)
        assert.strictEqual(again.folders[0]?.held?.why, 'opened')
      }),
    ),
  )
})

describe('this computer’s load, through the API', () => {
  it.live('says how hard this computer works, read as it is, checked on the way', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { client } = yield* connected()
        const load = yield* client.GetLoad({})
        assert.isAbove(load.memoryTotal, 0)
        assert.isAtMost(load.memoryUsed, load.memoryTotal)
        assert.lengthOf(load.history, 1)
        // Nothing of Althar's runs, so its part is none; or unknown, where processes can't be listed.
        if (load.shares !== null) assert.lengthOf(load.shares, 0)
      }),
    ),
  )
})

describe('project rules, through the API', () => {
  it.live('turns each repository-files setting on alone, and keeps the others off', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { client, grant } = yield* connected()
        const project = yield* client.OpenProject({ commandId: commandId(), grant: yield* grant(repository()) })
        const one = yield* client.SetProjectRules({
          commandId: commandId(),
          projectId: project.id,
          repositoryFiles: { writeSkills: true, writeOpenSpec: false, pushProtected: false },
        })
        assert.deepStrictEqual(one.repositoryFiles, { writeSkills: true, writeOpenSpec: false, pushProtected: false })
        // An unrelated change leaves them as they are.
        const other = yield* client.SetProjectRules({ commandId: commandId(), projectId: project.id, moveIssues: false })
        assert.deepStrictEqual(other.repositoryFiles, { writeSkills: true, writeOpenSpec: false, pushProtected: false })
        assert.deepStrictEqual((yield* client.GetProjectRules({ projectId: project.id })).repositoryFiles, other.repositoryFiles)
      }),
    ),
  )

  it.live('reads a project’s rules, and changes them in part as the person', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { client, grant } = yield* connected()
        const project = yield* client.OpenProject({ commandId: commandId(), grant: yield* grant(repository()) })
        const { conventions, ...rules } = yield* client.GetProjectRules({ projectId: project.id })
        assert.deepStrictEqual(rules, {
          projectId: project.id,
          revision: 1,
          permissions: 'rules',
          allowEverything: false,
          alwaysAsk: ['default-branch', 'force-push', 'many-branches', 'delete-branch', 'deploy', 'outside'],
          never: [],
          alwaysAllow: [],
          commands: [],
          end: null,
          resolveConflicts: false,
          usageLimit: 'move',
          rotateAccounts: false,
          onlyAccounts: null,
          branchPattern: null,
          titlePattern: null,
          moveIssues: true,
          changeIssues: false,
          // Skill and OpenSpec files stay out of the repositories, and off the remote, until the person says.
          repositoryFiles: { writeSkills: false, writeOpenSpec: false, pushProtected: false },
          // A repository with no packages, on no host: only what every lead runs outside its sandbox.
          sandbox: {
            commands: ['ps', 'env -i'],
            hosts: [],
            edits: { commands: { added: [], removed: [] }, hosts: { added: [], removed: [] } },
          },
        })
        // A repository that says nothing of its pull requests: Althar's own names, and no template.
        assert.deepStrictEqual(
          conventions.map(({ branch, title, template }) => ({ branch, title, template })),
          [{ branch: null, title: null, template: null }],
        )
        const changed = yield* client.SetProjectRules({
          commandId: commandId(),
          projectId: project.id,
          alwaysAsk: ['default-branch', 'deploy'],
          never: ['force-push'],
          commands: [{ pattern: 'terraform *', decision: 'ask' }],
          end: 'ready',
          resolveConflicts: true,
          usageLimit: 'wait',
          rotateAccounts: true,
          onlyAccounts: { codex: ['acc_x'] },
        })
        assert.deepStrictEqual(
          [
            changed.alwaysAsk,
            changed.never,
            changed.commands,
            changed.end,
            changed.resolveConflicts,
            changed.usageLimit,
            changed.rotateAccounts,
            changed.onlyAccounts,
          ],
          [
            ['default-branch', 'deploy'],
            ['force-push'],
            [{ pattern: 'terraform *', decision: 'ask' }],
            'ready',
            true,
            'wait',
            true,
            { codex: ['acc_x'] },
          ],
        )
        // What leads' sandboxes let through, changed in part: a list given is kept whole, tidied, and the other stays.
        const reached = yield* client.SetProjectRules({
          commandId: commandId(),
          projectId: project.id,
          // Never a wildcard: the rules couldn't check each host under it.
          sandbox: { hosts: { added: ['https://Registry.Acme.dev/npm', 'not a host', '*.acme.dev'], removed: [] } },
        })
        assert.deepStrictEqual(reached.sandbox.hosts, ['registry.acme.dev'])
        const trimmed = yield* client.SetProjectRules({
          commandId: commandId(),
          projectId: project.id,
          sandbox: { commands: { added: ['bunx  playwright *'], removed: ['env -i'] } },
        })
        assert.deepStrictEqual([trimmed.sandbox.commands, trimmed.sandbox.hosts], [['ps', 'bunx playwright'], ['registry.acme.dev']])
        // Back to deciding the ending by the host, and every account; the rest stays.
        const back = yield* client.SetProjectRules({ commandId: commandId(), projectId: project.id, end: null, onlyAccounts: null })
        assert.deepStrictEqual(
          [back.end, back.onlyAccounts, back.rotateAccounts, back.never, back.resolveConflicts],
          [null, null, true, ['force-push'], true],
        )
        assert.deepStrictEqual(yield* client.GetProjectRules({ projectId: project.id }), back)
        // Allow everything is a switch over the mode (ADR-043): the mode is kept under it, and holds again once it is off.
        const allowing = yield* client.SetProjectRules({
          commandId: commandId(),
          projectId: project.id,
          permissions: 'coordinator',
          allowEverything: true,
        })
        assert.deepStrictEqual([allowing.permissions, allowing.allowEverything], ['coordinator', true])
        const off = yield* client.SetProjectRules({ commandId: commandId(), projectId: project.id, allowEverything: false })
        assert.deepStrictEqual([off.permissions, off.allowEverything], ['coordinator', false])
        const missing = yield* Effect.flip(client.GetProjectRules({ projectId: 'proj_missing' }))
        assert.strictEqual(missing.reason, 'NotFound')
        const noTask = yield* Effect.flip(
          client.SetTaskAllowEverything({ commandId: commandId(), taskId: 'task_missing', allowEverything: true }),
        )
        assert.strictEqual(noTask.reason, 'NotFound')
      }),
    ),
  )

  it.live('refuses a list changed against rules that moved on since, and an allow over what comes first', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { client, grant } = yield* connected()
        const project = yield* client.OpenProject({ commandId: commandId(), grant: yield* grant(repository()) })
        const seen = yield* client.GetProjectRules({ projectId: project.id })
        const changed = yield* client.SetProjectRules({
          commandId: commandId(),
          projectId: project.id,
          commands: [{ pattern: 'bun test', decision: 'never' }],
          expectedRevision: seen.revision,
        })
        assert.strictEqual(changed.revision, seen.revision + 1)
        // The same list again, as read before that change: refused, and what changed is kept.
        const stale = yield* Effect.flip(
          client.SetProjectRules({ commandId: commandId(), projectId: project.id, commands: [], expectedRevision: seen.revision }),
        )
        assert.strictEqual(stale.reason, 'RulesChanged')
        const allowed = yield* Effect.flip(
          client.SetProjectRules({
            commandId: commandId(),
            projectId: project.id,
            commands: [{ pattern: 'bun test', decision: 'allow' }],
            expectedRevision: changed.revision,
          }),
        )
        assert.deepStrictEqual(
          [allowed.reason, allowed.message],
          [
            'RuleOnAnotherList',
            'Commands starting “bun test” are on “Never”, which comes first, so nothing changed. Take them off “Never” first.',
          ],
        )
        assert.deepStrictEqual((yield* client.GetProjectRules({ projectId: project.id })).commands, [
          { pattern: 'bun test', decision: 'never' },
        ])
      }),
    ),
  )

  it.live('names branches and titles by the person’s patterns, over the repository’s, and goes back to the repository’s', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { client, grant } = yield* connected()
        const project = yield* client.OpenProject({ commandId: commandId(), grant: yield* grant(repository()) })
        const set = yield* client.SetProjectRules({
          commandId: commandId(),
          projectId: project.id,
          branchPattern: 'feature/{key}-{slug}',
          titlePattern: '{key}: {title}',
        })
        assert.deepStrictEqual([set.branchPattern, set.titlePattern], ['feature/{key}-{slug}', '{key}: {title}'])
        // A task with no issue leaves the key out, with what held it.
        const task = yield* client.CreateTask({ commandId: commandId(), projectId: project.id, title: 'Say hello' })
        assert.strictEqual(task.branch, 'feature/say-hello')
        // Taken back, or emptied: the repository's again, here Althar's own.
        const back = yield* client.SetProjectRules({
          commandId: commandId(),
          projectId: project.id,
          branchPattern: null,
          titlePattern: ' ',
        })
        assert.deepStrictEqual([back.branchPattern, back.titlePattern], [null, null])
        const next = yield* client.CreateTask({ commandId: commandId(), projectId: project.id, title: 'Say goodbye' })
        assert.strictEqual(next.branch, 'althar/say-goodbye')
      }),
    ),
  )
})

/** A folder holding a repository for each name, each with one commit, and each remote given as `name=url`. */
const folderWith = (repositories: Readonly<Record<string, ReadonlyArray<string>>>) => {
  const folder = realpathSync(mkdtempSync(join(tmpdir(), 'althar-folder-')))
  for (const [name, remotes] of Object.entries(repositories)) {
    const path = join(folder, name)
    mkdirSync(path)
    const git = (...args: Array<string>) => execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@t.test', ...args], { cwd: path })
    git('init', '-q', '-b', 'main')
    writeFileSync(join(path, 'README.md'), `# ${name}\n`)
    git('add', '.')
    git('commit', '-q', '-m', 'Start')
    for (const remote of remotes) git('remote', 'add', ...remote.split('='))
  }
  return folder
}

/** Every file under a folder, with what it holds, and what git says of each repository in it: how the person left it. */
const asLeft = (folder: string) =>
  readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .toSorted((a, b) => a.localeCompare(b))
    .map((path) => `${path}:${readFileSync(path).toString('hex')}`)
    .join('\n')

describe('editors, through the API', () => {
  it('tells a file in a task’s folder from one out of it, as Windows writes paths too', () => {
    assert.isTrue(isInside('/w/api', '/w/api/src/a.ts'))
    assert.isTrue(isInside('C:\\w\\api', 'C:\\w\\api\\src\\a.ts', win32))
    assert.isTrue(isInside('C:\\w\\api', 'C:\\w\\api\\..notes', win32))
    for (const out of ['C:\\w\\api', 'C:\\w\\api-2\\a.ts', 'C:\\w\\a.ts', 'D:\\w\\api\\a.ts'])
      assert.isFalse(isInside('C:\\w\\api', out, win32))
  })

  it.live('lists the editors here, and opens one on a task’s folder at its file, never a path outside it', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const opens: Array<[string, string, string | null, number | null]> = []
        const { client, grant } = yield* connected({
          editors: {
            list: () => [{ id: 'zed', name: 'Zed' }],
            open: (editor, folder, file, line) => Effect.sync(() => void opens.push([editor, folder, file, line])).pipe(Effect.as(true)),
          },
        })
        assert.deepStrictEqual(yield* client.ListEditors({}), [{ id: 'zed', name: 'Zed' }])
        const project = yield* client.OpenProject({ commandId: commandId(), grant: yield* grant(repository()) })
        const task = yield* client.CreateTask({ commandId: commandId(), projectId: project.id, title: 'Edit' })
        const worktree = realpathSync((yield* client.GetThread({ threadId: task.threadId })).task.worktree ?? '')
        assert.isTrue(yield* client.OpenInEditor({ commandId: commandId(), taskId: task.id, editor: 'zed', path: 'src/a.ts', line: 12 }))
        assert.isTrue(yield* client.OpenInEditor({ commandId: commandId(), taskId: task.id, editor: 'zed' }))
        assert.isFalse(yield* client.OpenInEditor({ commandId: commandId(), taskId: task.id, editor: 'zed', path: '../../etc/passwd' }))
        // Nor out by a link inside it.
        symlinkSync(tmpdir(), join(worktree, 'out'))
        assert.isFalse(yield* client.OpenInEditor({ commandId: commandId(), taskId: task.id, editor: 'zed', path: 'out/anything.txt' }))
        // Nor by a link to a folder that isn't there yet.
        symlinkSync(join(tmpdir(), `althar-nowhere-${Date.now()}`), join(worktree, 'gone'))
        assert.isFalse(yield* client.OpenInEditor({ commandId: commandId(), taskId: task.id, editor: 'zed', path: 'gone/new.ts' }))
        assert.deepStrictEqual(opens, [
          ['zed', worktree, join(worktree, 'src/a.ts'), 12],
          ['zed', worktree, null, null],
        ])
      }),
    ),
  )

  it.live('finds, reads and opens the code an agent names: a task’s in its worktree, the coordinator’s on the default branch', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const opens: Array<[string, string, string | null, number | null]> = []
        const { client, grant } = yield* connected({
          editors: {
            list: () => [{ id: 'zed', name: 'Zed' }],
            open: (editor, folder, file, line) => Effect.sync(() => void opens.push([editor, folder, file, line])).pipe(Effect.as(true)),
          },
        })
        const folder = realpathSync(repository())
        const project = yield* client.OpenProject({ commandId: commandId(), grant: yield* grant(folder) })
        const task = yield* client.CreateTask({ commandId: commandId(), projectId: project.id, title: 'Retry later' })
        const worktree = realpathSync((yield* client.GetThread({ threadId: task.threadId })).task.worktree ?? '')
        mkdirSync(join(worktree, 'src'))
        writeFileSync(join(worktree, 'src', 'retry.ts'), 'export function retryLater() {\n  return 1\n}\n')

        // The lead's names, in its worktree as it is: what it hasn't committed, and a name in code it declared there.
        const named = yield* client.FindCode({
          threadId: task.threadId,
          messages: [{ names: ['src/retry.ts:2', 'retry.ts', 'README.md', 'retryLater', 'npm test'] }],
        })
        assert.deepStrictEqual(
          [named.place.kind, named.place.repositories.length, named.place.repositories[0]?.branch.startsWith('althar/')],
          ['task', 1, true],
        )
        assert.deepStrictEqual(
          named.messages[0]?.found.map((found) => (found.kind === 'file' ? [found.path, found.line, found.changed] : [found.kind])),
          [
            ['src/retry.ts', 2, { add: 3, del: 0 }],
            ['src/retry.ts', undefined, { add: 3, del: 0 }],
            ['README.md', undefined, null],
            ['src/retry.ts', 1, { add: 3, del: 0 }],
          ],
        )
        assert.deepInclude(yield* client.ReadCode({ threadId: task.threadId, path: 'src/retry.ts' }), { from: 1, total: 3, cut: false })
        assert.strictEqual(
          (yield* Effect.flip(client.ReadCode({ threadId: task.threadId, path: '../outside.ts' }))).message,
          "That file isn't there any more.",
        )
        assert.isTrue(
          yield* client.OpenCode({ commandId: commandId(), threadId: task.threadId, editor: 'zed', path: 'src/retry.ts', line: 2 }),
        )
        // A file that isn't there opens its folder alone; one out of it, nothing.
        assert.isTrue(
          yield* client.OpenCode({ commandId: commandId(), threadId: task.threadId, editor: 'zed', path: 'src/gone.ts', line: 4 }),
        )
        assert.isFalse(yield* client.OpenCode({ commandId: commandId(), threadId: task.threadId, editor: 'zed', path: '../x.ts' }))

        // The coordinator's, on the default branch: what the task wrote isn't there, and opens in the person's own checkout.
        const { threadId } = yield* client.GetCoordinator({ projectId: project.id })
        const said = yield* client.FindCode({ threadId, messages: [{ names: ['README.md:1', 'src/retry.ts'] }] })
        assert.deepStrictEqual([said.place.kind, said.place.repositories[0]?.branch], ['default', 'main'])
        assert.deepStrictEqual(
          said.messages[0]?.found.map((found) => [found.kind, found.name]),
          [
            ['file', 'README.md:1'],
            ['missing', 'src/retry.ts'],
          ],
        )
        assert.deepInclude(yield* client.ReadCode({ threadId, path: 'README.md' }), { text: '# Meridian\n', total: 1 })
        assert.isTrue(yield* client.OpenCode({ commandId: commandId(), threadId, editor: 'zed', path: 'README.md', line: 1 }))
        assert.deepStrictEqual(opens, [
          ['zed', worktree, join(worktree, 'src/retry.ts'), 2],
          ['zed', worktree, null, null],
          ['zed', folder, join(folder, 'README.md'), 1],
        ])
      }),
    ),
  )
})

describe('a project’s menu, through the API', () => {
  it.live('renames a project, draws it in another ink, and adds, leaves out and changes its repositories', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { client, grant } = yield* connected()
        const folder = folderWith({ 'meridian-api': [], 'meridian-web': [] })
        const project = yield* client.OpenProject({ commandId: commandId(), grant: yield* grant(folder) })
        const named = (yield* client.ListProjects()).projects.find((summary) => summary.id === project.id)

        // Renamed, it keeps its slug, and so its worktrees' folders, and its ink.
        yield* client.RenameProject({ commandId: commandId(), projectId: project.id, name: '  Refunds v2 ' })
        const renamed = (yield* client.ListProjects()).projects.find((summary) => summary.id === project.id)
        assert.deepStrictEqual([renamed?.name, renamed?.slug, renamed?.ink], ['Refunds v2', named?.slug, named?.ink])
        assert.strictEqual(
          (yield* Effect.flip(client.RenameProject({ commandId: commandId(), projectId: project.id, name: ' ' }))).message,
          'Give the project a name.',
        )

        // Its mark is drawn in the ink the person picks, which stays; the drawing, from its id, is the same.
        const other = named?.ink === 'rose' ? 'umber' : 'rose'
        const { cursor } = yield* client.ListProjects()
        yield* client.SetProjectInk({ commandId: commandId(), projectId: project.id, ink: other })
        const inked = (yield* client.ListProjects()).projects.find((summary) => summary.id === project.id)
        assert.deepStrictEqual([inked?.ink, inked?.name], [other, 'Refunds v2'])
        // Every window hears the project changed, and reads it again.
        const heard = yield* Stream.runHead(
          Stream.filter(client.Watch({ since: cursor }), (event) => event._tag === 'Changed' && event.aggregateType === 'project'),
        )
        assert.deepStrictEqual(
          Option.map(heard, (event) => (event._tag === 'Changed' ? [event.aggregateId, event.projectId] : [])),
          Option.some([project.id, project.id]),
        )
        assert.strictEqual(
          (yield* Effect.flip(client.SetProjectInk({ commandId: commandId(), projectId: 'project_gone', ink: 'teal' }))).message,
          "That project isn't there any more.",
        )

        // Each repository has a role, suggested by its name, which the person can change.
        const read = yield* client.GetRepositories({ projectId: project.id })
        assert.deepStrictEqual(
          read.map((repository) => [repository.name, repository.role, repository.branch, repository.fork, repository.tasks]),
          [
            ['meridian-api', 'service', 'main', null, 0],
            ['meridian-web', 'frontend', 'main', null, 0],
          ],
        )
        const [api, web] = read
        yield* client.SetRepository({ commandId: commandId(), projectId: project.id, repositoryId: api?.id ?? '', role: 'library' })
        assert.strictEqual((yield* client.GetRepositories({ projectId: project.id }))[0]?.role, 'library')
        // Only a fork has somewhere else for its pull requests to go.
        assert.strictEqual(
          (yield* Effect.flip(
            client.SetRepository({ commandId: commandId(), projectId: project.id, repositoryId: api?.id ?? '', changeTarget: 'upstream' }),
          )).reason,
          'ProjectRefused',
        )

        // A task made with a repository keeps it when it is left out; new tasks can't name it.
        const task = yield* client.CreateTask({
          commandId: commandId(),
          projectId: project.id,
          title: 'Restyle',
          repositories: ['meridian-web'],
        })
        yield* client.LeaveOutRepository({ commandId: commandId(), projectId: project.id, repositoryId: web?.id ?? '' })
        assert.deepStrictEqual(
          (yield* client.GetRepositories({ projectId: project.id })).map((repository) => repository.name),
          ['meridian-api'],
        )
        assert.deepStrictEqual((yield* client.ListProjects()).projects.find((summary) => summary.id === project.id)?.repositories, [
          'meridian-api',
        ])
        assert.strictEqual(
          (yield* Effect.flip(
            client.CreateTask({ commandId: commandId(), projectId: project.id, title: 'Again', repositories: ['meridian-web'] }),
          )).reason,
          'RepositoriesNeeded',
        )
        assert.strictEqual((yield* client.GetThread({ threadId: task.threadId })).task.branch, 'althar/restyle')
        // The last one stays: a task needs somewhere to work.
        assert.strictEqual(
          (yield* Effect.flip(client.LeaveOutRepository({ commandId: commandId(), projectId: project.id, repositoryId: api?.id ?? '' })))
            .message,
          'The project needs a repository for its tasks to work in. Add another before leaving this one out.',
        )

        // Added again, it comes back as it was; a fork comes with where its pull requests open.
        yield* client.AddRepositories({ commandId: commandId(), projectId: project.id, grant: yield* grant(join(folder, 'meridian-web')) })
        const forked = folderWith({
          'refund-docs': ['origin=git@github.com:you/refund-docs.git', 'upstream=https://github.com/meridian/refund-docs.git'],
        })
        yield* client.AddRepositories({ commandId: commandId(), projectId: project.id, grant: yield* grant(forked) })
        const again = yield* client.GetRepositories({ projectId: project.id })
        assert.deepStrictEqual(
          again.map((repository) => [repository.id === web?.id, repository.name, repository.role, repository.tasks]),
          [
            [false, 'meridian-api', 'library', 0],
            [true, 'meridian-web', 'frontend', 1],
            [false, 'refund-docs', 'docs', 0],
          ],
        )
        const docs = again[2]
        assert.deepStrictEqual(docs?.fork, { fork: 'you/refund-docs', upstream: 'meridian/refund-docs', target: 'fork' })
        // Its work goes to GitHub, which Althar knows but isn't connected to; one with no remote stays here.
        assert.deepStrictEqual(docs?.host, {
          product: 'github',
          name: 'GitHub',
          instance: null,
          path: 'you/refund-docs',
          url: 'https://github.com/you/refund-docs',
          account: null,
        })
        assert.isNull(again[0]?.host)
        yield* client.SetRepository({
          commandId: commandId(),
          projectId: project.id,
          repositoryId: docs?.id ?? '',
          changeTarget: 'upstream',
        })
        assert.strictEqual((yield* client.GetRepositories({ projectId: project.id }))[2]?.fork?.target, 'upstream')
        // A folder inside one it has already adds nothing more.
        mkdirSync(join(folder, 'meridian-api', 'src'))
        yield* client.AddRepositories({
          commandId: commandId(),
          projectId: project.id,
          grant: yield* grant(join(folder, 'meridian-api', 'src')),
        })
        assert.lengthOf(yield* client.GetRepositories({ projectId: project.id }), 3)
        // Its tasks' worktrees are in a folder named for it, as it was made.
        assert.strictEqual(
          (yield* client.ListProjects()).projects.find((summary) => summary.id === project.id)?.worktrees?.endsWith(`${sep}${named?.slug}`),
          true,
        )
        assert.isNull(named?.worktrees)
        // A folder with no repository adds nothing.
        assert.strictEqual(
          (yield* Effect.flip(
            client.AddRepositories({
              commandId: commandId(),
              projectId: project.id,
              grant: yield* grant(realpathSync(mkdtempSync(join(tmpdir(), 'althar-empty-')))),
            }),
          )).reason,
          'NotARepository',
        )
      }),
    ),
  )

  it.live('removes a project: its agents stop and its plans don’t start, and its folders stay exactly as they were', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { client, grant } = yield* connected({ countdown: Duration.minutes(5) })
        const folder = folderWith({ api: ['origin=git@github.com:meridian/api.git'] })
        const project = yield* client.OpenProject({ commandId: commandId(), grant: yield* grant(folder) })
        const other = yield* client.OpenProject({ commandId: commandId(), grant: yield* grant(repository()) })

        // A task whose lead works until it is stopped, and a plan counting down.
        const task = yield* client.StartTask({
          commandId: commandId(),
          projectId: project.id,
          title: 'Retry',
          description: '[lead:hang]',
          steps: [
            { key: 'implement', agentId: 'codex', model: null, skipped: false },
            { key: 'review', agentId: 'claude-code', model: null, skipped: true },
          ],
        })
        yield* eventually(client.GetThread({ threadId: task.threadId }), (thread) => thread.session?.turnRunning === true)
        const coordinator = yield* client.GetCoordinator({ projectId: project.id })
        yield* client.Send({
          commandId: commandId(),
          threadId: coordinator.threadId,
          body: 'Add docs. [coordinator:plan]',
          disposition: 'after_current',
        })
        const planned = yield* eventually(client.GetCoordinator({ projectId: project.id, limit: 50 }), (snapshot) =>
          snapshot.items.some((item) => item.kind === 'task' && item.content.plan !== null && item.content.phase === 'planned'),
        )
        const card = planned.items.find((item) => item.kind === 'task' && item.content.phase === 'planned')
        const before = asLeft(folder)

        const removing = { commandId: commandId(), projectId: project.id }
        yield* client.RemoveProject(removing)
        // Retried, it is the same removal.
        yield* client.RemoveProject(removing)
        assert.deepStrictEqual(
          (yield* client.ListProjects()).projects.map((summary) => summary.id),
          [other.id],
        )
        assert.deepStrictEqual(
          (yield* client.GetHome({})).projects.map((summary) => summary.id),
          [other.id],
        )
        // The lead and the coordinator stop.
        yield* eventually(client.GetThread({ threadId: task.threadId }), (thread) => thread.session === null)
        yield* eventually(client.GetCoordinator({ projectId: project.id }), (snapshot) => snapshot.session === null)
        // A window that hadn't heard can't start its plan, a task, an agent, or the coordinator again.
        assert.strictEqual(
          (yield* Effect.flip(client.CreateTask({ commandId: commandId(), projectId: project.id, title: 'One more' }))).message,
          "That project isn't there any more.",
        )
        const planId = card?.kind === 'task' ? (card.content.plan?.id ?? '') : ''
        assert.strictEqual(
          (yield* Effect.flip(client.StartPlan({ commandId: commandId(), planId }))).message,
          "That plan isn't there any more.",
        )
        assert.strictEqual(
          (yield* Effect.flip(client.StartSession({ commandId: commandId(), threadId: task.threadId, agentId: 'codex' }))).message,
          "That project isn't there any more.",
        )
        assert.strictEqual(
          (yield* Effect.flip(
            client.Send({ commandId: commandId(), threadId: coordinator.threadId, body: 'Hello?', disposition: 'after_current' }),
          )).message,
          "That project isn't there any more.",
        )
        // The task's run ended, and nothing asks the person about it.
        const thread = yield* client.GetThread({ threadId: task.threadId })
        assert.strictEqual(thread.attention.length, 0)
        // The folders are exactly as they were; the task's worktree stays where it was made.
        assert.strictEqual(asLeft(folder), before)
        assert.isTrue(existsSync(thread.task.worktree ?? ''))
        // Gone from Althar, it can't be changed, and opening its folder again makes a new project.
        assert.strictEqual(
          (yield* Effect.flip(client.RenameProject({ commandId: commandId(), projectId: project.id, name: 'Back' }))).message,
          "That project isn't there any more.",
        )
        assert.notStrictEqual((yield* client.OpenProject({ commandId: commandId(), grant: yield* grant(folder) })).id, project.id)
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

  it.live('leaves a plain task that finished in Needs you once the person opens it, until they mark it done or keep it for later', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { client, grant } = yield* connected()
        const project = yield* client.OpenProject({ commandId: commandId(), grant: yield* grant(repository()) })
        // A plain task is one the coordinator starts with no plan, and stays one though its lead commits, on a branch of its own; one
        // the person starts is a change, though it makes nothing.
        const coordinator = yield* client.GetCoordinator({ projectId: project.id })
        yield* client.Send({
          commandId: commandId(),
          threadId: coordinator.threadId,
          body: 'Which partners still call v1? [coordinator:start] [lead:commit] [lead:finish]',
          disposition: 'after_current',
        })
        const change = yield* client.StartTask({
          commandId: commandId(),
          projectId: project.id,
          title: 'Retry',
          description: '[lead:finish]',
          steps: [{ key: 'implement', agentId: 'claude-code', model: null, skipped: false }],
        })
        const both = yield* eventually(
          client.GetBoard({ projectId: project.id }),
          (board) => board.tasks.length === 2 && board.tasks.every((one) => one.phase === 'ready'),
        )
        assert.sameDeepMembers(
          both.tasks.map((one) => [one.title, one.kind]),
          [
            ['Which partners still call v1', 'plain'],
            ['Retry', 'change'],
          ],
        )
        const question = both.tasks.find((one) => one.kind === 'plain')
        assert.isNotNull(question?.branch)
        yield* client.SeeTask({ commandId: commandId(), taskId: question?.taskId ?? '' })
        yield* client.SeeTask({ commandId: commandId(), taskId: change.id })
        const phases = Effect.map(client.GetBoard({ projectId: project.id }), (board) => board.tasks.map((one) => [one.title, one.phase]))
        // Opened, both still wait on the person.
        assert.sameDeepMembers(yield* phases, [
          ['Which partners still call v1', 'ready'],
          ['Retry', 'ready'],
        ])
        // Kept for later, the plain task is out of Needs you; a change can't be kept, nor marked done.
        yield* client.KeepTaskForLater({ commandId: commandId(), taskId: question?.taskId ?? '' })
        yield* client.KeepTaskForLater({ commandId: commandId(), taskId: change.id })
        yield* client.MarkTaskDone({ commandId: commandId(), taskId: change.id })
        assert.sameDeepMembers(yield* phases, [
          ['Which partners still call v1', 'kept'],
          ['Retry', 'ready'],
        ])
        // Marked done, it settles.
        yield* client.MarkTaskDone({ commandId: commandId(), taskId: question?.taskId ?? '' })
        assert.sameDeepMembers(yield* phases, [
          ['Which partners still call v1', 'settled'],
          ['Retry', 'ready'],
        ])
        const unknown = yield* Effect.flip(client.SeeTask({ commandId: commandId(), taskId: 'task_nothing' }))
        assert.strictEqual(unknown.reason, 'NotFound')
      }),
    ),
  )

  it.live('has the project’s leads resolve what already conflicts as soon as its rules say they do, and a task say otherwise', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { client, grant } = yield* connected()
        const root = repository()
        const project = yield* client.OpenProject({ commandId: commandId(), grant: yield* grant(root) })
        const task = yield* client.StartTask({
          commandId: commandId(),
          projectId: project.id,
          title: 'Retry',
          description: '[lead:finish] [lead:edit] [lead:resolve]',
          steps: [{ key: 'implement', agentId: 'claude-code', model: null, skipped: false }],
        })
        yield* eventually(client.GetBoard({ projectId: project.id }), (board) =>
          board.tasks.some((one) => one.taskId === task.id && one.phase === 'ready'),
        )
        // The default branch moves on, conflicting with what it changed; nobody merges, so nothing finds it.
        const git = (...args: Array<string>) =>
          execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@t.test', ...args], { cwd: root, stdio: 'pipe' })
        writeFileSync(join(root, 'change.txt'), 'rate limits\n')
        git('add', '.')
        git('commit', '-q', '-m', 'Limit rates')
        const resolvedIn = (thread: ThreadSnapshot) =>
          thread.items.some(
            (item) => item.kind === 'notice' && item.content.title?.startsWith('The lead resolved the conflict with main') === true,
          )
        const before = yield* client.GetThread({ threadId: task.threadId })
        assert.deepStrictEqual(before.task.resolveConflicts, { task: null, project: false })
        // The task says otherwise, then goes back to the project's say: neither asks the lead anything.
        yield* client.SetTaskResolveConflicts({ commandId: commandId(), taskId: task.id, resolveConflicts: false })
        assert.deepStrictEqual((yield* client.GetThread({ threadId: task.threadId, limit: 0 })).task.resolveConflicts, {
          task: false,
          project: false,
        })
        yield* client.SetTaskResolveConflicts({ commandId: commandId(), taskId: task.id, resolveConflicts: null })
        // The project turns its leads resolving conflicts on: the lead resolves it now, with no Merge pressed.
        yield* client.SetProjectRules({ commandId: commandId(), projectId: project.id, resolveConflicts: true })
        const after = yield* eventually(
          Effect.andThen(Effect.sleep('80 millis'), client.GetThread({ threadId: task.threadId })),
          resolvedIn,
        )
        assert.deepStrictEqual(after.task.resolveConflicts, { task: null, project: true })
        assert.isFalse(resolvedIn(before))
      }),
    ),
  )

  it.live('gives a conflict to the person when they interrupt the lead resolving it, or while Althar waits for its checks', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { client, grant, store } = yield* connected()
        const root = repository()
        const project = yield* client.OpenProject({ commandId: commandId(), grant: yield* grant(root) })
        const task = yield* client.StartTask({
          commandId: commandId(),
          projectId: project.id,
          title: 'Retry',
          description: '[lead:finish] [lead:edit] [lead:resolve-wait]',
          steps: [{ key: 'implement', agentId: 'claude-code', model: null, skipped: false }],
        })
        yield* eventually(client.GetBoard({ projectId: project.id }), (board) =>
          board.tasks.some((one) => one.taskId === task.id && one.phase === 'ready'),
        )
        const git = (...args: Array<string>) =>
          execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@t.test', ...args], { cwd: root, stdio: 'pipe' })
        writeFileSync(join(root, 'change.txt'), 'rate limits\n')
        git('add', '.')
        git('commit', '-q', '-m', 'Limit rates')
        const rounds = () =>
          store(
            Effect.flatMap(
              SqlClient.SqlClient,
              (sql) => sql<{ id: string; state: string; failure: string | null }>`
                SELECT id, state, failure FROM conflict_resolutions WHERE task_id = ${task.id} ORDER BY created_at, rowid`,
            ),
          )
        const asked = () =>
          store(
            Effect.flatMap(
              SqlClient.SqlClient,
              (sql) => sql<{ n: number }>`
                SELECT count(*) AS n FROM user_inputs WHERE thread_id = ${task.threadId} AND body LIKE '%Bring the branch up to date%'`,
            ),
          )
        // The task has its lead resolve what conflicts, which it works at.
        yield* client.SetTaskResolveConflicts({ commandId: commandId(), taskId: task.id, resolveConflicts: true })
        yield* eventually(
          Effect.andThen(Effect.sleep('40 millis'), client.GetThread({ threadId: task.threadId, limit: 0 })),
          (thread) => thread.session?.turnRunning === true,
        )
        assert.deepStrictEqual(
          (yield* rounds()).map((round) => round.state),
          ['resolving'],
        )
        // The window's interrupt: the conflict is the person's, as the lead left it, and the lead isn't asked again.
        yield* client.Interrupt({ commandId: commandId(), threadId: task.threadId })
        const [interrupted] = yield* rounds()
        assert.strictEqual(interrupted?.state, 'failed')
        assert.match(interrupted?.failure ?? '', /^You interrupted the lead\. /)
        const thread = yield* eventually(client.GetThread({ threadId: task.threadId }), (one) => one.session?.turnRunning !== true)
        assert.isTrue(
          thread.items.some(
            (item) => item.kind === 'notice' && item.content.title?.startsWith('The lead couldn’t resolve the conflict with main') === true,
          ),
        )
        yield* Effect.sleep('300 millis')
        assert.deepStrictEqual(yield* asked(), [{ n: 1 }])
        // Waiting for the checks on what Althar pushed, an interrupt hands those over too.
        const checking = yield* store(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient
            const id = `cres_${randomBytes(16).toString('hex')}`
            const at = new Date().toISOString()
            yield* sql`INSERT INTO conflict_resolutions ${sql.insert({
              id,
              projectId: project.id,
              taskId: task.id,
              pullRequestUrl: 'https://github.test/meridian/api/pull/1',
              conflicts: '[]',
              state: 'checking',
              pushedHead: 'a'.repeat(40),
              createdAt: at,
              updatedAt: at,
            })}`
            return id
          }),
        )
        // Whether or not a lead is there to interrupt.
        yield* Effect.exit(client.Interrupt({ commandId: commandId(), threadId: task.threadId }))
        assert.deepStrictEqual((yield* rounds()).find((round) => round.id === checking)?.state, 'resolved')
      }),
    ),
  )

  it.live('stops, resumes, abandons and reopens a task', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { client, grant, store } = yield* connected({ countdown: Duration.minutes(5) })
        const project = yield* client.OpenProject({ commandId: commandId(), grant: yield* grant(repository()) })
        const task = yield* client.StartTask({
          commandId: commandId(),
          projectId: project.id,
          title: 'Retry',
          description: '[lead:wait]',
          steps: [{ key: 'implement', agentId: 'claude-code', model: null, skipped: false }],
        })
        const working = yield* eventually(
          client.GetThread({ threadId: task.threadId, limit: 0 }),
          (thread) => thread.session?.turnRunning === true,
        )
        assert.deepStrictEqual([working.task.actions, working.task.planId], [['stop', 'abandon'], null])
        // A conflict whose checks Althar waits for, as one its lead resolved leaves it: stopping hands it to the person (ADR-030).
        const waiting = () =>
          store(
            Effect.gen(function* () {
              const sql = yield* SqlClient.SqlClient
              const id = `cres_${randomBytes(16).toString('hex')}`
              const at = new Date().toISOString()
              yield* sql`INSERT INTO conflict_resolutions ${sql.insert({
                id,
                projectId: project.id,
                taskId: task.id,
                pullRequestUrl: 'https://github.test/meridian/api/pull/1',
                conflicts: '[]',
                state: 'checking',
                pushedHead: 'a'.repeat(40),
                createdAt: at,
                updatedAt: at,
              })}`
              return id
            }),
          )
        const stateOf = (id: string) =>
          store(
            Effect.flatMap(SqlClient.SqlClient, (sql) => sql<{ state: string }>`SELECT state FROM conflict_resolutions WHERE id = ${id}`),
          )
        const checking = yield* waiting()
        const stopping = { commandId: commandId(), taskId: task.id }
        yield* client.StopTask(stopping)
        // Sent again by a retry, it is one stop.
        yield* client.StopTask(stopping)
        const stopped = yield* client.GetThread({ threadId: task.threadId, limit: 0 })
        assert.deepStrictEqual([stopped.task.phase, stopped.task.actions, stopped.session], ['stopped', ['resume', 'abandon'], null])
        assert.deepStrictEqual(yield* stateOf(checking), [{ state: 'resolved' }])
        yield* client.ResumeTask({ commandId: commandId(), taskId: task.id, agentId: 'codex', model: 'large', effort: 'high' })
        const resumed = yield* eventually(client.GetThread({ threadId: task.threadId, limit: 0 }), (thread) => thread.session !== null)
        assert.strictEqual(resumed.session?.agentId, 'codex')
        // Renamed by the person, even now; a retry is one rename, and an empty title is refused.
        const rename = { commandId: commandId(), taskId: task.id, title: ' Retry the checkout ' }
        yield* client.RenameTask(rename)
        yield* client.RenameTask(rename)
        assert.strictEqual((yield* client.GetThread({ threadId: task.threadId, limit: 0 })).task.title, 'Retry the checkout')
        assert.strictEqual(
          (yield* Effect.flip(client.RenameTask({ commandId: commandId(), taskId: task.id, title: ' ' }))).message,
          'Give the task a title.',
        )
        yield* client.AbandonTask({ commandId: commandId(), taskId: task.id })
        const abandoned = yield* client.GetThread({ threadId: task.threadId, limit: 0 })
        assert.deepStrictEqual([abandoned.task.state, abandoned.task.phase, abandoned.task.actions], ['abandoned', 'settled', ['reopen']])
        yield* client.ReopenTask({ commandId: commandId(), taskId: task.id })
        const reopened = yield* client.GetThread({ threadId: task.threadId, limit: 0 })
        assert.deepStrictEqual([reopened.task.state, reopened.task.actions], ['open', ['resume', 'abandon']])
        // Resumed with its last lead.
        yield* client.ResumeTask({ commandId: commandId(), taskId: task.id })
        const again = yield* eventually(client.GetThread({ threadId: task.threadId, limit: 0 }), (thread) => thread.session !== null)
        assert.strictEqual(again.session?.agentId, 'codex')
        // So does stopping its lead alone.
        const checkingAgain = yield* waiting()
        yield* client.StopSession({ commandId: commandId(), threadId: task.threadId })
        assert.deepStrictEqual(yield* stateOf(checkingAgain), [{ state: 'resolved' }])
        // On an agent picked with no model or effort of its own, as the window sends one: its own.
        yield* client.StopTask({ commandId: commandId(), taskId: task.id })
        yield* client.ResumeTask({ commandId: commandId(), taskId: task.id, agentId: 'claude-code', model: null, effort: null })
        const picked = yield* eventually(client.GetThread({ threadId: task.threadId, limit: 0 }), (thread) => thread.session !== null)
        assert.strictEqual(picked.session?.agentId, 'claude-code')
        assert.strictEqual(
          (yield* Effect.flip(client.AbandonTask({ commandId: commandId(), taskId: 'task_missing' }))).message,
          "That task isn't there any more.",
        )
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
          [[call?.id ?? '', 'stuck', 'Nobody home', task.threadId]],
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
          offered.products.map((product) => [
            product.product,
            product.service,
            product.browserSignIn,
            product.selfHosted,
            product.hostedUrl,
          ]),
          [
            ['github', 'github', false, true, 'https://github.com'],
            ['linear', 'linear', false, false, 'https://linear.app'],
            ['trello', 'trello', false, false, 'https://trello.com'],
            ['jira_dc', 'jira', false, true, null],
          ],
        )
        assert.deepStrictEqual(offered.products[0]?.tokenPrefixes, ['github_pat_', 'ghp_'])
        assert.deepStrictEqual(offered.places, [])
        // Trello's token goes with an API key: where a token is made for one, and what a key is checked against.
        assert.deepInclude(offered.products[0], { tokenNeeds: null, tokenHelpForKey: null, keyChecks: [] })
        const trello = offered.products.find((product) => product.product === 'trello')
        assert.strictEqual(trello?.tokenNeeds, 'key')
        assert.strictEqual(trello?.tokenHelpForKey, products.trello.token.helpForKey)
        assert.deepStrictEqual(trello?.keyChecks, products.trello.token.keyChecks)
        assert.lengthOf(offered.connections, 0)
        // Without Althar's app registered, the browser sign-in isn't offered; a pasted token is.
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
        // Where its code is, as the list and connecting say it: on the GitHub its remote names.
        assert.deepStrictEqual((yield* client.ListConnections()).places, [
          { product: 'github', webUrl: HOST, project: project.name, remote: null, repositories: ['meridian/api'] },
        ])
        const guide = yield* client.GetConnectGuide({ service: 'github' })
        assert.deepStrictEqual(guide.places, [
          { product: 'github', webUrl: HOST, project: project.name, remote: 'origin', repositories: ['meridian/api'] },
        ])
        assert.deepStrictEqual(guide.clis, [])
        // A token is made on each instance it knows, filled in for its places: a classic one on a company's own server.
        assert.deepStrictEqual(
          guide.tokenPages.map((page) => page.webUrl),
          ['https://github.com', HOST],
        )
        assert.strictEqual(
          guide.tokenPages.find((page) => page.webUrl === HOST)?.url,
          `${HOST}/settings/tokens/new?description=Althar&scopes=repo%2Cworkflow`,
        )
        // What the connection can do there, as the service says.
        const can = yield* client.CheckConnection({ connectionId: signedIn.id })
        assert.deepStrictEqual(
          can.lines.map((line) => [line.need, line.state]),
          [
            ['account', 'ok'],
            ['reach', 'ok'],
            ['push', 'ok'],
            ['changes', 'ok'],
            ['checks', 'ok'],
            ['issues', 'ok'],
          ],
        )
        // gh isn't signed in here; and a server that doesn't answer is said to be one.
        const noCli = yield* Effect.flip(client.ConnectCli({ commandId: commandId(), product: 'github', webUrl: HOST }))
        assert.deepStrictEqual([noCli.reason, noCli.message], ['CliSignedOut', "gh isn't signed in to github.test on this computer."])
        const server = yield* client.FindServer({ service: 'jira', webUrl: 'jira.meridian.dev' })
        assert.deepStrictEqual(server, { product: null, webUrl: 'https://jira.meridian.dev', reason: 'unreachable', tokenPage: null })
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
        assert.strictEqual(started.branch, 'althar/mer-231-rate-limit-refunds')
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
        // The person stops listening to it.
        const listened = thread.task.changes[0]
        assert.isTrue(listened?.listening)
        yield* client.StopListening({ commandId: commandId(), taskId: started.id, url: listened?.url ?? '' })
        assert.isFalse((yield* client.GetThread({ threadId: started.threadId })).task.changes[0]?.listening)
        // It has its pull request already: there is none to open.
        const opened = yield* Effect.flip(client.OpenChange({ commandId: commandId(), taskId: started.id }))
        assert.deepStrictEqual([opened.reason, opened.message], ['NoChangeToOpen', 'The task already has its pull request.'])

        // A task created from #12 keeps it as its issue.
        const created = yield* client.CreateTask({ commandId: commandId(), projectId: project.id, title: 'Fix the limit', issue: '#12' })
        assert.strictEqual(created.branch, 'althar/issue-12-fix-the-limit')

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

  it('says the rest of what can go wrong as the window shows it, and a reason it has no words for in general ones', () => {
    const said = (error: unknown) => words(error, name).message
    const cases: ReadonlyArray<readonly [unknown, string]> = [
      [
        { _tag: 'InstallFailed', agentId: 'opencode', summary: 'GitHub couldn’t be reached to find OpenCode.' },
        'GitHub couldn’t be reached to find OpenCode.',
      ],
      [{ _tag: 'AlwaysNotOffered' }, "That can't be kept as a rule for this request. Answer it once instead."],
      [{ _tag: 'QuestionUnanswered' }, 'Answer each question: pick an option, or write your own.'],
      [{ _tag: 'NotHeld' }, "The step isn't waiting for its usage limit any more: it carried on, or was stopped."],
      [{ _tag: 'LaunchRefused', message: 'Codex needs Node 20 or later.' }, 'Codex needs Node 20 or later.'],
      [
        { _tag: 'SignOutFailed', line: 'codex logout' },
        "Althar couldn't sign this account out, so it kept it and its folder. Try again, or run this in a terminal, then remove it: codex logout. If the agent isn't on this computer any more, remove it anyway; its sign-in may stay behind.",
      ],
      [{ _tag: 'DraftClosed', state: 'filed' }, 'That issue is filed already. Change it on its tracker.'],
      [{ _tag: 'DraftClosed', state: 'archived' }, 'That issue draft can’t change now.'],
      [{ _tag: 'DraftUntitled' }, 'An issue needs a title.'],
      [{ _tag: 'CliUnanswered', tool: 'gh' }, "gh didn't answer in time. Try again in a moment."],
      [
        { _tag: 'CliElsewhere', tool: 'glab', address: 'http://git.example' },
        "Althar only gives glab's sign-in to a server it knows, over HTTPS. http://git.example isn't one.",
      ],
      [
        { _tag: 'OtherAccount', login: 'dana', expected: 'meridian-bot' },
        "This token is dana's. Make one as meridian-bot, or connect dana as well from the list.",
      ],
      [
        { _tag: 'RuleOnAnotherList', exact: true, pattern: 'rm -rf build', list: 'ask' },
        '“rm -rf build” is on “Always ask me”, which comes first, so nothing changed. Take it off “Always ask me” first.',
      ],
      [
        { _tag: 'PushRefused', remote: 'origin', why: 'refused', said: 'pre-receive hook declined.' },
        'origin refused the push: pre-receive hook declined.',
      ],
      [
        { _tag: 'NoChangeToOpen', why: 'uncommitted', detail: 'src/a.ts' },
        'The lead left changes it didn’t commit, in src/a.ts. Ask it to commit them or clear them away, then open the pull request again.',
      ],
      [
        { _tag: 'NoChangeToOpen', why: 'uncommitted', detail: '' },
        'The lead left changes it didn’t commit. Ask it to commit them or clear them away, then open the pull request again.',
      ],
      [
        { _tag: 'NoChangeToOpen', why: 'conflicts', detail: 'README.md' },
        'The new commits don’t apply on the default branch as it is now: they conflict in README.md. Ask the lead to merge the default branch into its branch (merge, don’t rebase), then open the pull request again.',
      ],
      [
        { _tag: 'NoChangeToOpen', why: 'conflicts', detail: '' },
        'The new commits don’t apply on the default branch as it is now: they conflict. Ask the lead to merge the default branch into its branch (merge, don’t rebase), then open the pull request again.',
      ],
      // A reason added since, with no words of its own yet: the general sentence for its kind.
      [{ _tag: 'ProjectRefused', reason: 'new_reason' }, "Althar can't change the project that way."],
      [{ _tag: 'DocumentRefused', reason: 'new_reason' }, 'Althar can’t show that file here.'],
      [{ _tag: 'ImageRefused', reason: 'new_reason', name: 'shot.png' }, "Althar can't send that image."],
      [{ _tag: 'NoteRefused', why: 'new_reason' }, 'Althar can’t keep that note.'],
      [{ _tag: 'CantMerge', why: 'new_reason', detail: 'It moved.' }, "Althar couldn't merge it. It moved."],
      [{ _tag: 'AccountRefused', reason: 'new_reason' }, "Althar can't add that account."],
    ]
    for (const [error, words] of cases) assert.strictEqual(said(error), words, JSON.stringify(error))
  })

  it("says each of the runtime's errors as the window shows it", () => {
    const said = (error: unknown) => words(error, name).message
    assert.strictEqual(
      said(new NotARepository({ path: '/tmp/x' })),
      "/tmp/x isn't a git repository, in one, or a folder with one directly inside it. Choose another folder.",
    )
    assert.strictEqual(
      said(new RepositoriesNeeded({ unknown: [], choices: ['api', 'web'] })),
      "Say which of the project's repositories the task changes: api, web.",
    )
    assert.strictEqual(
      said(new RepositoriesNeeded({ unknown: ['mobile'], choices: ['api', 'web'] })),
      'The project has no repository called mobile. It has api, web.',
    )
    assert.strictEqual(said(new NotFound({ kind: 'attention_request', id: 'a' })), "That call isn't there any more.")
    assert.strictEqual(
      said(new NothingToWaitFor({ attentionId: 'a' })),
      "The agent didn't say when its limit resets, so there's no time to wait for. Pick another model, or try it again.",
    )
    assert.strictEqual(said(new NotFound({ kind: 'something new', id: 'a' })), "That thing isn't there any more.")
    assert.strictEqual(said({ _tag: 'UnknownAgent', agentId: 'cursor' }), 'Althar has no agent called cursor.')
    assert.strictEqual(
      said({
        _tag: 'SecretsUnavailable',
        reason: 'Althar has nowhere safe to keep sign-ins: install and start a keyring (gnome-keyring or KWallet), then try again.',
        keyring: true,
      }),
      'Althar has nowhere safe to keep sign-ins: install and start a keyring (gnome-keyring or KWallet), then try again.',
    )
    // Anything else that couldn't be kept — a file that won't write, a bad name, an empty reason — gets the generic sentence.
    assert.strictEqual(
      said({ _tag: 'SecretsUnavailable', reason: "Couldn't write: Error: EACCES: permission denied" }),
      "Althar's runtime couldn't do that. Its log has the details.",
    )
    assert.strictEqual(
      said({ _tag: 'SecretsUnavailable', reason: '', keyring: true }),
      "Althar's runtime couldn't do that. Its log has the details.",
    )
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
    assert.strictEqual(said({ _tag: 'DatabaseInUse' }), 'Another copy of Althar is using this profile.')
    assert.strictEqual(said(new TurnInProgress({ sessionId: 's' })), 'The lead is still on its last turn.')
    // What a code host or tracker said, or why it couldn't be asked.
    const host = (reason: ConnectorFailed['reason'], message = '') => said(new ConnectorFailed({ product: 'github', reason, message }))
    assert.strictEqual(host('unauthorized'), "GitHub no longer takes Althar's sign-in. Sign in to it again.")
    assert.strictEqual(host('forbidden', 'Resource not accessible'), "GitHub won't let this account do that: Resource not accessible.")
    assert.strictEqual(host('forbidden'), "GitHub won't let this account do that.")
    assert.strictEqual(host('not_found'), "GitHub can't find it any more.")
    assert.strictEqual(host('rate_limited'), 'GitHub is asking Althar to slow down. Try again in a little while.')
    assert.strictEqual(host('unreachable'), "Althar couldn't reach GitHub. Try again in a moment.")
    assert.strictEqual(host('invalid_response'), "GitHub answered in a way Althar didn't understand.")
    assert.strictEqual(host('rejected', 'Pull Request is not mergeable'), 'GitHub said no: Pull Request is not mergeable.')
    assert.strictEqual(said(new ConnectorFailed({ product: 'gitea' as never, reason: 'rejected', message: '' })), 'The service said no.')
    assert.strictEqual(
      said(new NotConnected({ product: 'linear', what: 'MER-1' })),
      "Althar isn't connected to Linear. Connect it, then try again.",
    )
    assert.strictEqual(
      said(new NotAnIssue({ link: 'https://gitlab.com/meridian/api/-/merge_requests/3', what: 'merge request' })),
      'That link is to a merge request, not an issue.',
    )
    assert.strictEqual(
      said(new OutwardUncertain({ operation: 'merge' })),
      "Althar can't tell whether that went through: its answer was lost. Look on the host before trying again.",
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
    assert.deepStrictEqual(
      (
        [
          ['untracked', 'new.ts in /code/web'],
          ['moved', 'web’s main'],
        ] as const
      ).map(([why, detail]) => said(new CantMerge({ taskId: 't', why, detail }))),
      [
        'The merge would overwrite files git doesn’t track: new.ts in /code/web. Move them away, then merge again.',
        'web’s main moved while Althar was merging, so nothing was merged. Merge again.',
      ],
    )
    assert.strictEqual(
      said({ _tag: 'NoChangeToOpen', why: 'something new' }),
      "The task's work isn't done yet. Its pull request opens when it is.",
    )
    // A push the remote refused says how to put it right.
    assert.deepStrictEqual(
      (['behind', 'denied', 'moved', 'never'] as const).map((why) => said(new PushRefused({ taskId: 't', why, remote: 'origin/main' }))),
      [
        'origin/main has commits that aren’t here yet, so it didn’t take the push. Bring them in, then push again.',
        'git couldn’t sign in to push to origin/main. Push once from a terminal so your sign-in is kept, then push again here.',
        'origin/main has commits pushed since you looked, so nothing was replaced. Look again before replacing them.',
        'The project’s rules never allow force pushes, so origin/main’s commits stay. Ask the lead to merge instead.',
      ],
    )
    assert.strictEqual(
      said(new PushRefused({ taskId: 't', why: 'refused', remote: 'origin/main', said: 'protected branch hook declined' })),
      'origin/main refused the push: protected branch hook declined.',
    )
    // Nowhere to push a branch to.
    assert.strictEqual(
      said(new NotFound({ kind: 'remote', id: 't' })),
      'Its repositories have no remote to push to. Add one with git, then push again.',
    )
    // Refused without a word why: just that it was.
    assert.strictEqual(said(new PushRefused({ taskId: 't', why: 'refused', remote: 'origin/main' })), 'origin/main refused the push.')
    // A task's course: a merged task stays done, and one whose worktree and branch went can't be reopened.
    assert.strictEqual(said(new TaskRefused({ taskId: 't', why: 'merged' })), 'The task is merged, so it stays done.')
    assert.strictEqual(
      said(new TaskRefused({ taskId: 't', why: 'branch_gone' })),
      'The task’s worktree and its branch are both gone, so it can’t be reopened on them.',
    )
    assert.strictEqual(said(new TaskRefused({ taskId: 't', why: 'abandoned' })), 'The task is abandoned. Reopen it to carry on.')
    // One with a reason these words don't know says only that it can't be done.
    assert.strictEqual(said({ _tag: 'TaskRefused', why: 'something new' }), "Althar can't change the task that way.")
    // A merge that conflicts carries its files, for the window to have the lead settle them.
    assert.deepStrictEqual(words(new CantMerge({ taskId: 't', why: 'conflicts', detail: 'README.md' }), name), {
      reason: 'CantMerge',
      message:
        'It conflicts with the default branch, in README.md. Tell the lead to merge the default branch into its branch (merge, don’t rebase), then merge again.',
      why: 'conflicts',
      detail: 'README.md',
    })
    assert.deepStrictEqual(words(new Error('boom'), name), {
      reason: 'Unknown',
      message: "Althar's runtime couldn't do that. Its log has the details.",
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
    // An agent that couldn't start says why, as Althar put it then, and nothing more where it had nothing to say.
    const unstarted = (summary: string) => new SessionFailed({ agentId: 'codex', reason: 'spawn codex ENOENT', summary })
    assert.strictEqual(
      summarize(Cause.fail(unstarted("codex isn't installed, or isn't on this computer's PATH."))),
      "codex isn't installed, or isn't on this computer's PATH.",
    )
    assert.strictEqual(summarize(Cause.fail(unstarted(''))), '')
    assert.strictEqual(summarize(Cause.empty), '')
    // A command the sandbox could not take out to the device says what to put right, not that it is missing.
    assert.include(
      agentSaid(
        new AgentStartFailed({ command: 'flatpak-spawn', reason: 'Portal call failed: org.freedesktop.DBus.Error.ServiceUnknown' }),
      ) ?? '',
      'org.freedesktop.Flatpak',
    )
    assert.include(
      agentSaid(new AgentStartFailed({ command: 'opencode', reason: 'spawn flatpak-spawn ENOENT' })) ?? '',
      'org.freedesktop.Flatpak',
    )
    // The same where it started and then could not reach the device: the bridge's sentence, not "the agent stopped".
    assert.include(
      agentSaid(
        new AgentExited({
          code: 1,
          signal: null,
          stderr:
            'Portal call failed: org.freedesktop.DBus.Error.ServiceUnknown\nHint: --host only works when the Flatpak is allowed to talk to org.freedesktop.Flatpak',
        }),
      ) ?? '',
      'org.freedesktop.Flatpak',
    )
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
      content: { text: 'Now', links: [], pictures: [] },
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
      pictures: [],
      files: [],
      output: null,
      exit: null,
    })
    assert.deepStrictEqual(itemOf(row('plan', { entries: 'none' }))?.content, { entries: [] })
    assert.deepStrictEqual(itemOf(row('notice', { source: 'agent', severity: 'loud', title: 'Hm' }))?.content, {
      source: 'agent',
      severity: 'info',
      title: 'Hm',
      description: null,
    })
    assert.deepStrictEqual(itemOf({ ...row('agent_message', null), content: 'not json' })?.content, { text: '', pictures: [], files: [] })
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
        built: null,
        evidence: [],
        unverified: null,
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
      built: null,
      evidence: [],
      unverified: null,
      agentId: null,
      change: null,
    })
    // Evidence as the lead's step keeps it: a picture by its digest, a command with its exit, and what wasn't shown; what it can't read is left out.
    const digest = 'a'.repeat(64)
    assert.deepStrictEqual(
      itemOf(
        row('step_result', {
          summary: 'Done.',
          evidence: [
            {
              kind: 'screenshot',
              caption: 'The Evidence section',
              picture: { artifactId: 'art_1', sha256: digest, mediaType: 'image/png', bytes: 10, width: 4, height: 2, name: 'shot.png' },
              path: 'shot.png',
              command: null,
              exit: null,
              text: null,
              dropped: 0,
            },
            { kind: 'command', caption: 'The tests', picture: null, command: 'bun test', exit: 0, text: '3 passed\n', dropped: 2 },
            { kind: 'magic', caption: 'Unknown' },
            { kind: 'note', caption: '' },
          ],
          unverified: ['Not tried with a real microphone', 4],
        }),
      )?.content,
      {
        step: 'implement',
        round: 0,
        summary: 'Done.',
        verdict: null,
        findings: [],
        built: null,
        evidence: [
          {
            kind: 'screenshot',
            caption: 'The Evidence section',
            picture: { digest, mediaType: 'image/png', bytes: 10, width: 4, height: 2, name: 'shot.png', unkept: null },
            command: null,
            exit: null,
            text: null,
            dropped: 0,
          },
          { kind: 'command', caption: 'The tests', picture: null, command: 'bun test', exit: 0, text: '3 passed\n', dropped: 2 },
        ],
        unverified: ['Not tried with a real microphone'],
        agentId: null,
        change: null,
      },
    )
  })
})

describe('the skills page', () => {
  const A = 'a'.repeat(40)
  const B = 'b'.repeat(40)
  const skill = (name: string, body: string) => `---\nname: ${name}\ndescription: Use when testing ${name}.\nlicense: MIT\n---\n${body}`
  const store = async () => {
    const catalog = mkdtempSync(join(tmpdir(), 'althar-skills-catalog-'))
    await writeCatalog(catalog, { alpha: { 'SKILL.md': skill('alpha', 'Default.\n') } }, { alpha: ['subagents'] })
    return { root: mkdtempSync(join(tmpdir(), 'althar-skills-store-')), catalog }
  }
  /** What the record keeps of the person's changes to skills, in order: each skill's revision, the act, its payload and command. */
  const skillActs = Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{ id: string; revision: number; type: string; payload: string; command: string | null }>`
      SELECT aggregate_id AS id, aggregate_revision AS revision, type, payload, command_id AS command
      FROM record_events WHERE aggregate_type = 'skill' ORDER BY sequence`
    return rows.map(({ payload, command, ...row }) => ({
      ...row,
      payload: JSON.parse(payload) as Record<string, unknown>,
      commandId: command,
    }))
  })

  it.live('says skills are off where the runtime has no store', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { client } = yield* connected()
        assert.deepStrictEqual(yield* client.ListSkills({}), { enabled: false, catalogRevision: null, skills: [] })
        assert.strictEqual((yield* Effect.flip(client.CheckSkillUpdates({}))).message, 'Skills are off in this runtime.')
      }),
    ),
  )

  it.live('lists the catalog’s skills off, turns one on and off, and keeps one Althar ships from being removed', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { client, store: record } = yield* connected({ skills: yield* Effect.promise(store) })
        const listed = yield* client.ListSkills({})
        assert.deepStrictEqual(
          [listed.enabled, listed.catalogRevision, listed.skills.map((one) => [one.id, one.source, one.active, one.needs, one.license])],
          [true, 'fixture-1', [['alpha', 'althar-default', false, ['subagents'], 'MIT']]],
        )
        assert.strictEqual(listed.skills[0]?.description, 'Use when testing alpha.')
        const on = commandId()
        const alpha = yield* client.SetSkillActive({ commandId: on, id: 'alpha', active: true })
        assert.isTrue(alpha.active)
        const off = yield* client.SetSkillActive({ commandId: commandId(), id: 'alpha', active: false })
        assert.isFalse(off.active)
        // Each switch is the person's act, recorded under the window's command with the version it was at.
        const acts = yield* record(skillActs)
        assert.deepStrictEqual(
          acts.map(({ id, revision, type, payload }) => [id, revision, type, payload]),
          [
            ['alpha', 1, 'skill.turned_on', { treeHash: alpha.treeHash }],
            ['alpha', 2, 'skill.turned_off', { treeHash: alpha.treeHash }],
          ],
        )
        assert.strictEqual(acts[0]?.commandId, on)
        const refused = yield* Effect.flip(client.UninstallSkill({ commandId: commandId(), id: 'alpha' }))
        assert.deepStrictEqual([refused.reason, refused.message], ['SkillRefused', 'alpha comes with Althar; turn it off instead.'])
        // A refused change records nothing.
        assert.lengthOf(yield* record(skillActs), 2)
      }),
    ),
  )

  it.live('finds, reviews and installs a skill from GitHub, offers its update, and rolls it back', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const repos = {
          'o/r': {
            refs: { main: A, HEAD: A, 'feature/x': A } as Record<string, string>,
            commits: { [A]: { 'skills/beta/SKILL.md': skill('beta', 'One.\n'), 'hooks/start.sh': 'x' } } as Record<
              string,
              Record<string, string>
            >,
          },
        }
        const { access } = fakeGitHub(repos)
        const { client, store: record } = yield* connected({
          skills: yield* Effect.promise(store),
          ...(access.fetch === undefined ? {} : { fetch: access.fetch }),
        })
        const found = yield* client.FindSkills({ source: 'https://github.com/o/r' })
        assert.deepStrictEqual(found, { repo: 'o/r', ref: 'HEAD', sha: A, paths: ['skills/beta'] })
        assert.deepStrictEqual(yield* client.FindSkills({ source: 'https://github.com/o/r/tree/feature/x/skills/beta' }), {
          repo: 'o/r',
          ref: 'feature/x',
          sha: A,
          paths: ['skills/beta'],
        })
        const card = yield* client.StageSkill({ repo: 'o/r', ref: 'main', subpath: 'skills/beta' })
        assert.deepStrictEqual(
          [card.id, card.installable, card.installed, card.files.map((file) => file.path)],
          ['beta', true, null, ['SKILL.md']],
        )
        // Staging installs nothing.
        assert.deepStrictEqual(
          (yield* client.ListSkills({})).skills.map((one) => one.id),
          ['alpha'],
        )
        const installed = yield* client.ApproveSkill({ commandId: commandId(), id: card.id, ...card.source, treeHash: card.treeHash })
        assert.deepStrictEqual(
          [installed.source, installed.repo, installed.sha, installed.review, installed.active],
          ['github', 'o/r', A, 'reviewed', true],
        )

        repos['o/r'].commits[B] = { 'skills/beta/SKILL.md': skill('beta', 'Two.\n') }
        repos['o/r'].refs.main = B
        const [update] = yield* client.CheckSkillUpdates({})
        assert.strictEqual(update?.state, 'available')
        if (update?.state !== 'available') return
        yield* client.ApproveSkill({ commandId: commandId(), id: 'beta', ...update.card.source, treeHash: update.card.treeHash })
        const back = yield* client.RollBackSkill({ commandId: commandId(), id: 'beta' })
        assert.deepStrictEqual([back.sha, back.canRollBack], [A, false])
        yield* client.UninstallSkill({ commandId: commandId(), id: 'beta' })
        // What the person approved, rolled back and removed, each with the version it concerned.
        const from = { source: 'github', repo: 'o/r', subpath: 'skills/beta', ref: 'main' }
        assert.deepStrictEqual(
          (yield* record(skillActs)).map(({ id, revision, type, payload }) => [id, revision, type, payload]),
          [
            ['beta', 1, 'skill.approved', { ...from, sha: A, treeHash: card.treeHash, active: true }],
            ['beta', 2, 'skill.approved', { ...from, sha: B, treeHash: update.card.treeHash, active: true }],
            ['beta', 3, 'skill.rolled_back', { ...from, sha: A, treeHash: card.treeHash }],
            ['beta', 4, 'skill.removed', { ...from, sha: A, treeHash: card.treeHash }],
          ],
        )
        assert.strictEqual(
          (yield* Effect.flip(client.FindSkills({ source: 'https://gitlab.com/o/r' }))).message,
          "https://gitlab.com/o/r isn't a GitHub repository; paste its address or owner/name.",
        )
      }),
    ),
  )
})
