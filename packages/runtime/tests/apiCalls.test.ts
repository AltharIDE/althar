import { randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MessageChannel } from 'node:worker_threads'

import { Api, ApiError, clientProtocol, emitterPort, type ThreadSnapshot } from '@althar/contracts'
import { scenarios, SCREENSHOT_PNG } from '@althar/provider-adapters/testing'
import { assert, describe, it } from '@effect/vitest'
import { Context, Duration, Effect, Fiber, Layer, Stream } from 'effect'
import { RpcClient } from 'effect/rpc'

import { connection, services } from '../src/Api'
import { Folders } from '../src/Folders'
import { Secrets } from '../src/Secrets'

import { fakeAgents, fakeConnectors, repository, ROOMY } from './support'

/*
 * What the window asks of the runtime less often, through the API as the
 * app's window has it: what a project runs, what a lead left running, finding
 * tasks, answering a lead's question, handing a thread over with images, a
 * project's accounts, and what can't be done, in the person's words.
 */

const commandId = () => `cmd_${randomBytes(16).toString('hex')}`

/** The runtime serving the API on one end of a channel, and a client on the other; a project open, with a task. */
const connected = Effect.gen(function* () {
  const channel = new MessageChannel()
  yield* Effect.addFinalizer(() => Effect.sync(() => channel.port1.close()))
  const context = yield* Layer.build(
    services({
      database: ':memory:',
      worktreeRoot: mkdtempSync(join(tmpdir(), 'althar-worktrees-')),
      appVersion: '0.0.0-test',
      deviceName: 'Test Mac',
      agents: fakeAgents(),
      secrets: Secrets.memory(),
      connectors: fakeConnectors({}),
      accountsRoot: mkdtempSync(join(tmpdir(), 'althar-accounts-')),
      artifactsRoot: mkdtempSync(join(tmpdir(), 'althar-artifacts-')),
      busy: { machine: ROOMY },
      checksAppear: Duration.zero,
    }),
  )
  yield* Effect.forkScoped(Layer.launch(connection(emitterPort(channel.port1, (data) => data))).pipe(Effect.provideContext(context)))
  const protocol = yield* Layer.build(clientProtocol(emitterPort(channel.port2, (data) => data)))
  const client = yield* RpcClient.make(Api).pipe(Effect.provideContext(protocol))
  const grant = (path: string) => Context.get(context, Folders).allow(path)
  const project = yield* client.OpenProject({ commandId: commandId(), grant: yield* grant(repository()) })
  const task = yield* client.CreateTask({ commandId: commandId(), projectId: project.id, title: 'Retry checkout' })
  return { client, project, task }
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

/** What a call that can't be done says, as the window shows it. */
const refused = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.map(Effect.flip(effect), (error) => {
    assert.instanceOf(error, ApiError)
    return error instanceof ApiError ? error.message : ''
  })

const SERVES = 'node -e "setInterval(() => {}, 1000)"'

describe('what a project runs, from the window', () => {
  it.live('keeps runnables in the person’s order, runs one and stops it, and clears a run that ended by itself', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { client, project } = yield* connected
        const projectId = project.id
        const [repository] = yield* client.GetRepositories({ projectId })
        const serve = yield* client.KeepRunnable({ commandId: commandId(), projectId, name: 'Server', command: SERVES })
        const once = yield* client.KeepRunnable({
          commandId: commandId(),
          projectId,
          name: 'Once',
          command: 'echo done',
          repository: repository?.name ?? '',
        })
        // Changed by its id, it is the same runnable, renamed.
        assert.deepStrictEqual(
          yield* client.KeepRunnable({ commandId: commandId(), projectId, id: serve.id, name: 'Dev server', command: SERVES }),
          { id: serve.id },
        )
        yield* client.OrderRunnables({ commandId: commandId(), projectId, ids: [once.id, serve.id] })
        const kept = (yield* client.GetCoordinator({ projectId })).runnables.filter((runnable) => !runnable.own)
        assert.deepStrictEqual(
          kept.map((runnable) => [runnable.id, runnable.name, runnable.command, runnable.from]),
          [
            [once.id, 'Once', 'echo done', 'person'],
            [serve.id, 'Dev server', SERVES, 'person'],
          ],
        )

        // Run by its id, the window hears of it as it starts.
        const heard = yield* Effect.forkChild(
          Stream.runHead(Stream.filter(client.Watch({}), (event) => event._tag === 'Launches' && event.launches.length > 0)),
        )
        yield* Effect.sleep('50 millis')
        const running = yield* client.RunProject({ commandId: commandId(), projectId, taskId: null, threadId: null, runnableId: serve.id })
        assert.deepInclude(running, { label: 'Dev server', runnableId: serve.id, where: 'main', ended: null })
        yield* Fiber.join(heard)
        yield* client.StopLaunch({ commandId: commandId(), id: running.id })
        assert.deepStrictEqual((yield* client.GetCoordinator({ projectId })).launches, [])

        // With none named, the first runs: this one ends by itself, and stays until it is cleared.
        const first = yield* client.RunProject({ commandId: commandId(), projectId, taskId: null, threadId: null })
        assert.strictEqual(first.runnableId, once.id)
        const [ended] = (yield* eventually(client.GetCoordinator({ projectId }), (snapshot) =>
          snapshot.launches.some((launch) => launch.ended !== null),
        )).launches
        assert.deepInclude(ended?.ended, { code: 0 })
        yield* client.ClearLaunch({ commandId: commandId(), id: first.id })
        assert.deepStrictEqual((yield* client.GetCoordinator({ projectId })).launches, [])

        yield* client.DropRunnable({ commandId: commandId(), projectId, id: once.id })
        assert.deepStrictEqual(
          (yield* client.GetCoordinator({ projectId })).runnables.filter((runnable) => !runnable.own).map((runnable) => runnable.id),
          [serve.id],
        )
      }),
    ),
  )
})

describe('what a lead left running, from the window', () => {
  it.live('shows it as the window hears of it, stops it, and clears one that ended by itself', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { client, task } = yield* connected
        const { threadId } = task
        yield* client.StartSession({ commandId: commandId(), threadId, agentId: 'claude-code' })
        yield* eventually(client.GetThread({ threadId }), (thread) => idle(thread) && thread.items.length > 0)
        const heard = yield* Effect.forkChild(
          Stream.runHead(Stream.filter(client.Watch({}), (event) => event._tag === 'Background' && event.background.length > 0)),
        )
        yield* Effect.sleep('50 millis')
        yield* client.Send({ commandId: commandId(), threadId, body: scenarios.background, disposition: 'after_current' })
        yield* Fiber.join(heard)
        const serving = yield* eventually(client.GetThread({ threadId }), (thread) => thread.session?.background[0]?.url != null)
        const left = serving.session?.background[0]
        assert.deepInclude(left, { command: 'bun dev', url: 'http://localhost:5173/', ended: null })
        yield* client.StopBackground({ commandId: commandId(), threadId, id: left?.id ?? '' })
        assert.deepStrictEqual((yield* client.GetThread({ threadId })).session?.background, [])

        yield* client.Send({ commandId: commandId(), threadId, body: '[lead:serve-exits]', disposition: 'after_current' })
        const exited = yield* eventually(client.GetThread({ threadId }), (thread) => thread.session?.background[0]?.ended != null)
        const gone = exited.session?.background[0]
        assert.strictEqual(gone?.ended?.code, 1)
        yield* client.ClearBackground({ commandId: commandId(), threadId, id: gone?.id ?? '' })
        assert.deepStrictEqual((yield* client.GetThread({ threadId })).session?.background, [])
      }),
    ),
  )
})

describe('finding tasks, from the window', () => {
  it.live('finds them in one project or every one, at most as many as asked, and says which one is at work', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { client, project, task } = yield* connected
        yield* client.CreateTask({ commandId: commandId(), projectId: project.id, title: 'Retry refunds' })
        yield* client.CreateTask({ commandId: commandId(), projectId: project.id, title: 'Retry payouts' })
        const titles = (found: { readonly tasks: ReadonlyArray<{ readonly title: string }> }) => found.tasks.map((each) => each.title)
        assert.sameMembers(titles(yield* client.SearchTasks({ text: 'retry' })), ['Retry checkout', 'Retry refunds', 'Retry payouts'])
        const two = titles(yield* client.SearchTasks({ text: 'retry', projectId: project.id, limit: 2 }))
        assert.lengthOf(new Set(two), 2)
        assert.deepStrictEqual(titles(yield* client.SearchTasks({ text: 'checkout', projectId: project.id })), ['Retry checkout'])

        // Its lead mid-turn, it is found as at work.
        yield* client.StartSession({ commandId: commandId(), threadId: task.threadId, agentId: 'codex' })
        yield* eventually(client.GetThread({ threadId: task.threadId }), (thread) => idle(thread) && thread.items.length > 0)
        const before = (yield* client.SearchTasks({ text: 'checkout' })).tasks[0]?.phase
        yield* client.Send({ commandId: commandId(), threadId: task.threadId, body: scenarios.slow, disposition: 'after_current' })
        yield* eventually(client.GetThread({ threadId: task.threadId }), (thread) => thread.session?.turnRunning === true)
        assert.strictEqual((yield* client.SearchTasks({ text: 'checkout' })).tasks[0]?.phase, 'running')
        assert.notStrictEqual(before, 'running')
        yield* client.Interrupt({ commandId: commandId(), threadId: task.threadId })
      }),
    ),
  )
})

describe('a lead’s question, from the window', () => {
  it.live('answers it in the task’s turn, and the lead goes on', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { client, task } = yield* connected
        const { threadId } = task
        yield* client.StartSession({ commandId: commandId(), threadId, agentId: 'codex' })
        yield* eventually(client.GetThread({ threadId }), (thread) => idle(thread) && thread.items.length > 0)
        yield* client.Send({ commandId: commandId(), threadId, body: scenarios.questions, disposition: 'after_current' })
        const asking = yield* eventually(client.GetThread({ threadId }), (thread) =>
          thread.attention.some((call) => call.kind === 'question'),
        )
        const call = asking.attention.find((each) => each.kind === 'question')
        const answers = Object.fromEntries(
          (call?.question?.fields ?? []).map((field) => [field.id, { values: [field.options[0]?.value ?? ''] }]),
        )
        yield* client.AnswerQuestion({ commandId: commandId(), attentionId: call?.id ?? '', answers })
        const answered = yield* eventually(client.GetThread({ threadId }), (thread) => idle(thread) && thread.attention.length === 0)
        const question = answered.items.find((item) => item.kind === 'question')
        assert.strictEqual(question?.kind === 'question' ? question.content.state : undefined, 'answered')
      }),
    ),
  )
})

describe('handing a thread over, from the window', () => {
  it.live('says what the person said with it, dictated, with the images they sent, to the agent it goes to', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { client, task } = yield* connected
        const { threadId } = task
        yield* client.SwitchAgent({
          commandId: commandId(),
          threadId,
          agentId: 'claude-code',
          effort: 'high',
          body: 'What is off here?',
          images: [{ data: SCREENSHOT_PNG, name: 'shot.png' }],
          dictated: true,
        })
        const thread = yield* eventually(
          client.GetThread({ threadId }),
          (value) => idle(value) && value.items.some((item) => item.kind === 'user_message'),
        )
        const message = thread.items.find((item) => item.kind === 'user_message')
        const content = message?.kind === 'user_message' ? message.content : undefined
        assert.strictEqual(content?.text, 'What is off here?')
        assert.isTrue(message?.kind === 'user_message' && message.input?.dictated === true)
        assert.deepStrictEqual(
          content?.pictures.map((picture) => [picture.name, picture.mediaType]),
          [['shot.png', 'image/png']],
        )
        assert.strictEqual(thread.session?.agentId, 'claude-code')
      }),
    ),
  )
})

describe('a project’s accounts, from the window', () => {
  it.live('keeps which accounts it uses where only whether it rotates them changes', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { client, project } = yield* connected
        const projectId = project.id
        const set = yield* client.SetProjectRules({
          commandId: commandId(),
          projectId,
          rotateAccounts: true,
          onlyAccounts: { codex: ['acct_work'] },
        })
        assert.deepStrictEqual([set.rotateAccounts, set.onlyAccounts], [true, { codex: ['acct_work'] }])
        const rotating = yield* client.SetProjectRules({ commandId: commandId(), projectId, rotateAccounts: false })
        assert.deepStrictEqual([rotating.rotateAccounts, rotating.onlyAccounts], [false, { codex: ['acct_work'] }])
        // Every account again: none named.
        const all = yield* client.SetProjectRules({ commandId: commandId(), projectId, onlyAccounts: null })
        assert.deepStrictEqual([all.rotateAccounts, all.onlyAccounts], [false, null])
      }),
    ),
  )
})

describe('what the window reads less often', () => {
  it.live(
    'reads a thread with its files fresh from git, the coordinator’s before an item, and a repository on a host it doesn’t know',
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { client, project, task } = yield* connected
          const fresh = yield* client.GetThread({ threadId: task.threadId, fresh: true })
          assert.strictEqual(fresh.threadId, task.threadId)
          const coordinator = yield* client.GetCoordinator({ projectId: project.id })
          const earlier = yield* client.GetCoordinator({ projectId: project.id, before: (coordinator.items.at(-1)?.sequence ?? 0) + 1 })
          assert.deepStrictEqual(
            earlier.items.map((item) => item.id),
            coordinator.items.map((item) => item.id),
          )
          const [before] = yield* client.GetRepositories({ projectId: project.id })
          execFileSync('git', ['remote', 'add', 'origin', 'https://git.example.test/meridian/api.git'], { cwd: before?.path ?? '' })
          const [after] = yield* client.GetRepositories({ projectId: project.id })
          // Known by its address alone: no product, no account, its path from the remote.
          assert.deepStrictEqual(after?.host, {
            product: null,
            name: 'git.example.test',
            instance: null,
            path: 'meridian/api',
            url: null,
            account: null,
          })
        }),
      ),
  )

  it.live('opens nothing in an editor where none is set up', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { client, task } = yield* connected
        assert.deepStrictEqual(yield* client.ListEditors({}), [])
        assert.isFalse(yield* client.OpenInEditor({ commandId: commandId(), taskId: task.id, editor: 'zed', path: 'README.md' }))
      }),
    ),
  )
})

describe('what can’t be done, from the window', () => {
  it.live('says why, in the person’s words', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { client, task } = yield* connected
        const notHeld = "The step isn't waiting for its usage limit any more: it carried on, or was stopped."
        assert.strictEqual(yield* refused(client.HandOverHeld({ commandId: commandId(), taskId: task.id, agentId: 'codex' })), notHeld)
        assert.strictEqual(
          yield* refused(
            client.HandOverHeld({ commandId: commandId(), taskId: task.id, agentId: 'codex', accountId: 'acct_work', model: 'large' }),
          ),
          notHeld,
        )
        assert.strictEqual(
          yield* refused(client.AnswerQuestion({ commandId: commandId(), attentionId: 'att_none', answers: {} })),
          "That call isn't there any more.",
        )
        // A connection gone meanwhile, signed in to again by any way.
        const gone = "That thing isn't there any more."
        assert.strictEqual(
          yield* refused(client.StartSignIn({ commandId: commandId(), product: 'github', connectionId: 'conn_gone' })),
          gone,
        )
        assert.strictEqual(
          yield* refused(
            client.ConnectToken({ commandId: commandId(), product: 'github', token: 'ghp_x', key: 'k', connectionId: 'conn_gone' }),
          ),
          gone,
        )
        assert.strictEqual(
          yield* refused(
            client.ConnectCli({ commandId: commandId(), product: 'github', webUrl: 'https://github.com', connectionId: 'conn_gone' }),
          ),
          gone,
        )
        // Images for a thread that has gone aren't kept.
        assert.strictEqual(
          yield* refused(
            client.Send({
              commandId: commandId(),
              threadId: 'thr_gone',
              body: 'Look',
              disposition: 'after_current',
              images: [{ data: SCREENSHOT_PNG, name: 'shot.png' }],
            }),
          ),
          "That task isn't there any more.",
        )
      }),
    ),
  )

  it.live('gives a retried command its first answer, for as many commands as it keeps, and forgets the oldest', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { client, task } = yield* connected
        const start = { commandId: commandId(), threadId: task.threadId, agentId: 'codex' }
        const sessionId = yield* client.StartSession(start)
        // Retried, it is the same start, not another.
        assert.strictEqual(yield* client.StartSession(start), sessionId)
        // A thousand commands later, it is forgotten: run again, it finds the agent it started at work.
        yield* Effect.forEach(
          Array.from({ length: 1_000 }, () => commandId()),
          (id) => client.CancelAccountSignIn({ commandId: id, flowId: 'signin_none' }),
          { discard: true, concurrency: 16 },
        )
        assert.strictEqual(yield* refused(client.StartSession(start)), 'An agent is already working on this task.')
      }),
    ),
  )
})
