import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MessageChannel } from 'node:worker_threads'

import { Api, clientProtocol, emitterPort } from '@althar/contracts'
import { assert, it } from '@effect/vitest'
import { removeTreeSync } from '@althar/testing'
import { Context, Deferred, Duration, Effect, Fiber, Layer, Option } from 'effect'
import { RpcClient } from 'effect/rpc'
import { TestClock } from 'effect/testing'
import { SqlClient } from 'effect/sql'

import { Accounts } from '../src/Accounts'
import { connection, services } from '../src/Api'
import { Coordinator } from '../src/Coordinator'
import { Instance } from '../src/Instance'
import { Projects } from '../src/Projects'
import { applyRules } from '../src/rulesChange'
import * as Runtime from '../src/Runtime'
import { Secrets } from '../src/Secrets'
import { Sessions } from '../src/Sessions'
import { fakeAgents, fakeConnectors, onTestClock, repository, ROOMY, runtime, until } from './support'

it.effect.each(['allowed', 'excluded'] as const)('wakes on news when the previous account is %s', (access) =>
  onTestClock(
    Effect.gen(function* () {
      const projects = yield* Projects
      const coordinator = yield* Coordinator
      const sessions = yield* Sessions
      const sql = yield* SqlClient.SqlClient
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      const threadId = yield* coordinator.thread(project.projectId)
      const accounts = yield* Accounts
      const [main] = yield* accounts.of('claude-code')
      const work = yield* accounts.add({ agentId: 'claude-code', name: 'Work' })
      const person = (yield* Instance).personId
      yield* applyRules(project.projectId, { accountStrategy: 'first' }, person)
      yield* sessions.start({ threadId, agentId: 'claude-code', accountId: work.id })
      yield* coordinator.say({
        envelope: yield* Runtime.envelope('thread.send', {}),
        threadId,
        body: 'Hello',
        disposition: 'after_current',
      })
      const first = Option.getOrThrow(
        yield* until(sessions.running(threadId), (one) => Option.isSome(one) && one.value.turnEndedAt !== null),
      )
      yield* TestClock.adjust(Duration.seconds(5))
      assert.strictEqual(Option.getOrThrow(yield* sessions.running(threadId)).sessionId, first.sessionId)
      yield* TestClock.adjust(Duration.seconds(20))
      yield* until(sessions.running(threadId), Option.isNone)
      if (access === 'excluded') yield* applyRules(project.projectId, { onlyAccounts: { 'claude-code': [main!.id] } }, person)
      const news = 'A task needs attention.'
      yield* coordinator.say({
        envelope: yield* Runtime.envelope('coordinator.news', {}),
        threadId,
        body: news,
        disposition: 'after_current',
        quiet: true,
        origin: 'news',
      })
      const next = Option.getOrThrow(
        yield* until(sessions.running(threadId), (one) => Option.isSome(one) && one.value.sessionId !== first.sessionId),
      )
      assert.strictEqual(first.accountId, work.id)
      assert.strictEqual(next.accountId, access === 'allowed' ? work.id : main!.id)
      const inputs = sql<{ state: string }>`SELECT state FROM user_inputs WHERE thread_id = ${threadId} AND body = ${news}`
      yield* until(inputs, (rows) => rows[0]?.state === 'delivered')
      const [turn] = yield* sql<{ prompt: string }>`SELECT prompt FROM turn_deliveries WHERE provider_session_id = ${next.sessionId}`
      assert.include(turn!.prompt, 'Hello')
      assert.include(turn!.prompt, news)
    }).pipe(Effect.provide(runtime(':memory:', {}, { idle: { coordinator: Duration.seconds(10) } }))),
  ),
)

it.effect('keeps the second account when the window starts the sleeping coordinator', () =>
  onTestClock(
    Effect.gen(function* () {
      const { port1, port2 } = new MessageChannel()
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          port1.close()
          port2.close()
        }),
      )
      const context = yield* Layer.build(
        services({
          database: ':memory:',
          worktreeRoot: mkdtempSync(join(tmpdir(), 'althar-coordinator-window-')),
          appVersion: '0.0.0-test',
          deviceName: 'Test Mac',
          agents: fakeAgents(),
          accountsRoot: mkdtempSync(join(tmpdir(), 'althar-coordinator-window-accounts-')),
          secrets: Secrets.memory(),
          connectors: fakeConnectors({}),
          busy: { machine: ROOMY },
          idle: { coordinator: Duration.seconds(10) },
        }),
      )
      yield* Effect.forkScoped(
        Layer.launch(
          connection(
            emitterPort(port1, (data) => data),
            { kind: 'window' },
          ),
        ).pipe(Effect.provideContext(context)),
      )
      const protocol = yield* Layer.build(clientProtocol(emitterPort(port2, (data) => data)))
      const client = yield* RpcClient.make(Api).pipe(Effect.provideContext(protocol))
      const coordinator = Context.get(context, Coordinator)
      const sessions = Context.get(context, Sessions)
      const accounts = Context.get(context, Accounts)
      yield* Effect.gen(function* () {
        const project = yield* (yield* Projects).open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
        const threadId = yield* coordinator.thread(project.projectId)
        yield* applyRules(project.projectId, { accountStrategy: 'first' }, (yield* Instance).personId)
        const work = yield* accounts.add({ agentId: 'claude-code', name: 'Work' })
        yield* sessions.start({ threadId, agentId: 'claude-code', accountId: work.id })
        yield* coordinator.say({
          envelope: yield* Runtime.envelope('thread.send', {}),
          threadId,
          body: 'Hello',
          disposition: 'after_current',
        })
        const first = Option.getOrThrow(
          yield* until(sessions.running(threadId), (one) => Option.isSome(one) && one.value.turnEndedAt !== null),
        )
        yield* TestClock.adjust(Duration.seconds(25))
        yield* until(sessions.running(threadId), Option.isNone)
        const id = yield* client.StartSession({ commandId: 'cmd_0123456789abcdef0123456789abcdef', threadId, agentId: 'claude-code' })
        assert.notStrictEqual(id, first.sessionId)
        assert.strictEqual(Option.getOrThrow(yield* sessions.running(threadId)).accountId, work.id)
      }).pipe(Effect.provideContext(context))
    }),
  ),
)

it.effect('delivers an input accepted while the old coordinator is closing', () => {
  let entered!: () => void
  let release!: () => void
  let sessionToClose: string | undefined
  const closing = new Promise<void>((resolve) => (entered = resolve))
  const closed = new Promise<void>((resolve) => (release = resolve))
  return onTestClock(
    Effect.gen(function* () {
      const projects = yield* Projects
      const coordinator = yield* Coordinator
      const sessions = yield* Sessions
      const sql = yield* SqlClient.SqlClient
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      const threadId = yield* coordinator.thread(project.projectId)
      yield* coordinator.say({
        envelope: yield* Runtime.envelope('thread.send', {}),
        threadId,
        body: 'Hello',
        disposition: 'after_current',
      })
      const first = Option.getOrThrow(
        yield* until(sessions.running(threadId), (one) => Option.isSome(one) && one.value.turnEndedAt !== null),
      )
      const [provider] = yield* sql<{
        externalSessionId: string
      }>`SELECT external_session_id FROM provider_sessions WHERE id = ${first.sessionId}`
      sessionToClose = provider!.externalSessionId
      const advance = yield* Effect.forkChild(TestClock.adjust(Duration.seconds(25)))
      yield* Effect.promise(() => closing)
      const news = 'Arrived during close'
      const sending = yield* Effect.forkChild(
        coordinator.say({
          envelope: yield* Runtime.envelope('coordinator.news', {}),
          threadId,
          body: news,
          disposition: 'after_current',
          quiet: true,
          origin: 'news',
        }),
      )
      const inputs = sql<{ state: string }>`SELECT state FROM user_inputs WHERE thread_id = ${threadId} AND body = ${news}`
      yield* until(inputs, (rows) => rows[0]?.state === 'queued')
      release()
      yield* Fiber.join(advance)
      yield* Fiber.join(sending)
      yield* until(inputs, (rows) => rows[0]?.state === 'delivered')
      const next = Option.getOrThrow(yield* sessions.running(threadId))
      assert.notStrictEqual(next.sessionId, first.sessionId)
      assert.strictEqual(next.accountId, first.accountId)
    }).pipe(
      Effect.ensuring(Effect.sync(() => release())),
      Effect.provide(
        runtime(
          ':memory:',
          {
            beforeClose: async (sessionId) => {
              if (sessionId === sessionToClose) {
                entered()
                await closed
              }
            },
          },
          { idle: { coordinator: Duration.seconds(10) } },
        ),
      ),
    ),
  )
})

it.effect.each(['starts', 'fails'] as const)('keeps input sent during retirement when the next provider %s', (wake) => {
  const retiring = Deferred.makeUnsafe<void>()
  const release = Deferred.makeUnsafe<void>()
  return onTestClock(
    Effect.gen(function* () {
      const projects = yield* Projects
      const coordinator = yield* Coordinator
      const sessions = yield* Sessions
      const sql = yield* SqlClient.SqlClient
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      const threadId = yield* coordinator.thread(project.projectId)
      yield* coordinator.say({
        envelope: yield* Runtime.envelope('thread.send', {}),
        threadId,
        body: 'Hello',
        disposition: 'after_current',
      })
      const first = Option.getOrThrow(
        yield* until(sessions.running(threadId), (one) => Option.isSome(one) && one.value.turnEndedAt !== null),
      )
      const advance = yield* Effect.forkChild(TestClock.adjust(Duration.seconds(25)))
      yield* Deferred.await(retiring)
      assert.isTrue(Option.getOrThrow(yield* sessions.running(threadId)).stopping)
      const body = 'During retirement'
      yield* coordinator.say({ envelope: yield* Runtime.envelope('thread.send', {}), threadId, body, disposition: 'after_current' })
      const input = sql<{ state: string }>`SELECT state FROM user_inputs WHERE thread_id = ${threadId} AND body = ${body}`
      assert.strictEqual((yield* input)[0]?.state, 'queued')
      if (wake === 'fails')
        yield* sql`INSERT INTO turn_undo_recoveries (command_id, thread_id, plans, state)
          VALUES ('prepared-undo', ${threadId}, '[]', 'prepared')`
      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(advance)
      if (wake === 'fails') {
        const notices = sql<{ description: string }>`
          SELECT json_extract(content, '$.description') AS description FROM thread_items
          WHERE thread_id = ${threadId} AND kind = 'notice' AND json_extract(content, '$.title') = 'The coordinator couldn’t start.'`
        yield* until(notices, (rows) => rows.some((row) => row.description.includes('still queued')))
        assert.strictEqual((yield* input)[0]?.state, 'queued')
        assert.isTrue(Option.isNone(yield* sessions.running(threadId)))
        yield* sql`UPDATE turn_undo_recoveries SET state = 'recovered' WHERE command_id = 'prepared-undo'`
        yield* coordinator.say({
          envelope: yield* Runtime.envelope('thread.send', {}),
          threadId,
          body: 'Try again',
          disposition: 'after_current',
        })
      }
      yield* until(input, (rows) => rows[0]?.state === 'delivered')
      assert.notStrictEqual(Option.getOrThrow(yield* sessions.running(threadId)).sessionId, first.sessionId)
    }).pipe(
      Effect.ensuring(Deferred.succeed(release, undefined)),
      Effect.provide(
        runtime(
          ':memory:',
          {},
          {
            idle: {
              coordinator: Duration.seconds(10),
              beforeCoordinatorStop: () => Effect.andThen(Deferred.succeed(retiring, undefined), Deferred.await(release)),
            },
          },
        ),
      ),
    ),
  )
})

it.effect('recovers input queued for a retired coordinator if the runtime restarts before its wake', () =>
  onTestClock(
    Effect.gen(function* () {
      const file = join(mkdtempSync(join(tmpdir(), 'althar-idle-recovery-')), 'profile.sqlite')
      const saved = yield* Effect.gen(function* () {
        const projects = yield* Projects
        const coordinator = yield* Coordinator
        const sessions = yield* Sessions
        const sql = yield* SqlClient.SqlClient
        const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
        const threadId = yield* coordinator.thread(project.projectId)
        yield* coordinator.say({
          envelope: yield* Runtime.envelope('thread.send', {}),
          threadId,
          body: 'Hello',
          disposition: 'after_current',
        })
        const first = Option.getOrThrow(
          yield* until(sessions.running(threadId), (one) => Option.isSome(one) && one.value.turnEndedAt !== null),
        )
        yield* TestClock.adjust(Duration.seconds(25))
        yield* until(sessions.running(threadId), Option.isNone)
        const input = yield* sessions.send({
          envelope: yield* Runtime.envelope('thread.send', {}),
          threadId,
          body: 'Waiting across restart',
          sender: { kind: 'window' },
        })
        const [queued] = yield* sql<{ state: string }>`SELECT state FROM user_inputs WHERE id = ${input.inputId}`
        assert.strictEqual(queued?.state, 'queued')
        yield* sql`VACUUM INTO ${file}`
        return { threadId, inputId: input.inputId, accountId: first.accountId }
      }).pipe(Effect.provide(runtime(':memory:', {}, { idle: { coordinator: Duration.seconds(10) } })))
      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const sessions = yield* Sessions
        yield* until(
          sql<{ state: string }>`SELECT state FROM user_inputs WHERE id = ${saved.inputId}`,
          (rows) => rows[0]?.state === 'delivered',
        )
        assert.strictEqual(Option.getOrThrow(yield* sessions.running(saved.threadId)).accountId, saved.accountId)
      }).pipe(Effect.provide(runtime(file)))
    }),
  ),
)

it.effect('recovers input after a restart during an idle coordinator’s close', () => {
  let entered!: () => void
  let release!: () => void
  let sessionToClose: string | undefined
  const closing = new Promise<void>((resolve) => (entered = resolve))
  const closed = new Promise<void>((resolve) => (release = resolve))
  return onTestClock(
    Effect.gen(function* () {
      const file = join(mkdtempSync(join(tmpdir(), 'althar-idle-closing-')), 'profile.sqlite')
      const saved = yield* Effect.gen(function* () {
        const projects = yield* Projects
        const coordinator = yield* Coordinator
        const sessions = yield* Sessions
        const sql = yield* SqlClient.SqlClient
        const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
        const threadId = yield* coordinator.thread(project.projectId)
        yield* coordinator.say({
          envelope: yield* Runtime.envelope('thread.send', {}),
          threadId,
          body: 'Hello',
          disposition: 'after_current',
        })
        const first = Option.getOrThrow(
          yield* until(sessions.running(threadId), (one) => Option.isSome(one) && one.value.turnEndedAt !== null),
        )
        const [provider] = yield* sql<{
          externalSessionId: string
        }>`SELECT external_session_id FROM provider_sessions WHERE id = ${first.sessionId}`
        sessionToClose = provider!.externalSessionId
        const advance = yield* Effect.forkChild(TestClock.adjust(Duration.seconds(25)))
        yield* Effect.promise(() => closing)
        const input = yield* sessions.send({
          envelope: yield* Runtime.envelope('thread.send', {}),
          threadId,
          body: 'Accepted during close',
          sender: { kind: 'window' },
        })
        const [intent] = yield* sql<{ reason: string }>`SELECT json_extract(payload, '$.reason') AS reason FROM record_events
          WHERE aggregate_id = ${first.sessionId} AND type = 'provider_session.stop_requested' ORDER BY sequence DESC LIMIT 1`
        assert.strictEqual(intent?.reason, 'idle')
        yield* sql`VACUUM INTO ${file}`
        release()
        yield* Fiber.join(advance)
        return { threadId, inputId: input.inputId, accountId: first.accountId }
      }).pipe(
        Effect.ensuring(Effect.sync(() => release())),
        Effect.provide(
          runtime(
            ':memory:',
            {
              beforeClose: async (sessionId) => {
                if (sessionId === sessionToClose) {
                  entered()
                  await closed
                }
              },
            },
            { idle: { coordinator: Duration.seconds(10) } },
          ),
        ),
      )
      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const sessions = yield* Sessions
        yield* until(
          sql<{ state: string }>`SELECT state FROM user_inputs WHERE id = ${saved.inputId}`,
          (rows) => rows[0]?.state === 'delivered',
        )
        assert.strictEqual(Option.getOrThrow(yield* sessions.running(saved.threadId)).accountId, saved.accountId)
      }).pipe(Effect.provide(runtime(file)))
    }),
  )
})

it.effect('keeps a coordinator with a turn and queued input, then delivers that input', () => {
  let waiting = false
  return onTestClock(
    Effect.gen(function* () {
      const projects = yield* Projects
      const coordinator = yield* Coordinator
      const sessions = yield* Sessions
      const sql = yield* SqlClient.SqlClient
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      const threadId = yield* coordinator.thread(project.projectId)
      yield* coordinator.say({
        envelope: yield* Runtime.envelope('thread.send', {}),
        threadId,
        body: 'Hello',
        disposition: 'after_current',
      })
      const first = Option.getOrThrow(
        yield* until(sessions.running(threadId), (one) => Option.isSome(one) && one.value.turnEndedAt !== null),
      )
      waiting = true
      yield* coordinator.say({ envelope: yield* Runtime.envelope('thread.send', {}), threadId, body: 'Work', disposition: 'after_current' })
      yield* until(sessions.running(threadId), (one) => Option.isSome(one) && one.value.turnRunning)
      yield* coordinator.say({ envelope: yield* Runtime.envelope('thread.send', {}), threadId, body: 'Next', disposition: 'after_current' })
      yield* TestClock.adjust(Duration.seconds(25))
      const running = Option.getOrThrow(yield* sessions.running(threadId))
      assert.strictEqual(running.sessionId, first.sessionId)
      assert.isTrue(running.turnRunning)
      const queued = sql<{ state: string }>`SELECT state FROM user_inputs WHERE thread_id = ${threadId} AND body = 'Next'`
      assert.strictEqual((yield* queued)[0]?.state, 'queued')
      waiting = false
      yield* until(queued, (rows) => rows[0]?.state === 'delivered')
    }).pipe(
      Effect.provide(
        runtime(':memory:', { connection: () => (waiting ? 'waits' : undefined) }, { idle: { coordinator: Duration.seconds(10) } }),
      ),
    ),
  )
})

it.effect('keeps a coordinator whose tool is still open between turns', () => {
  const tools: Array<{ id: string; cwd: string; live: () => boolean; tool: (state: 'in_progress' | 'completed') => Promise<void> }> = []
  return onTestClock(
    Effect.gen(function* () {
      const projects = yield* Projects
      const coordinator = yield* Coordinator
      const sessions = yield* Sessions
      const sql = yield* SqlClient.SqlClient
      const path = repository()
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path })
      const threadId = yield* coordinator.thread(project.projectId)
      yield* coordinator.say({
        envelope: yield* Runtime.envelope('thread.send', {}),
        threadId,
        body: 'Hello',
        disposition: 'after_current',
      })
      const first = Option.getOrThrow(
        yield* until(sessions.running(threadId), (one) => Option.isSome(one) && one.value.turnEndedAt !== null),
      )
      const [session] = yield* sql<{
        externalSessionId: string
      }>`SELECT external_session_id FROM provider_sessions WHERE id = ${first.sessionId}`
      const tool = tools.find((one) => one.id === session!.externalSessionId && one.cwd.endsWith('.coordinator') && one.live())!.tool
      yield* Effect.promise(() => tool('in_progress'))
      yield* until(sessions.busy(threadId), Boolean)
      yield* TestClock.adjust(Duration.seconds(25))
      assert.strictEqual(Option.getOrThrow(yield* sessions.running(threadId)).sessionId, first.sessionId)
      yield* Effect.promise(() => tool('completed'))
      yield* until(sessions.busy(threadId), (busy) => !busy)
      yield* TestClock.adjust(Duration.seconds(20))
      yield* until(sessions.running(threadId), Option.isNone)
    }).pipe(
      Effect.provide(
        runtime(
          ':memory:',
          {},
          {
            each: { 'claude-code': { sessionControls: (controls) => void tools.push(controls) } },
            idle: { coordinator: Duration.seconds(10), quiet: Duration.zero },
          },
        ),
      ),
    ),
  )
})

it.effect.each(['process', 'process-temp'])('closes a %s coordinator and its unreported child on retirement', (agentId) => {
  const folder = mkdtempSync(join(tmpdir(), 'althar-idle-tree-'))
  const file = join(folder, 'child')
  let child = 0
  const alive = (pid: number) => {
    try {
      process.kill(pid, 0)
      // An exited Linux child can remain as a zombie until its new parent reaps it.
      if (process.platform === 'linux' && readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ').at(-1)?.startsWith('Z')) return false
      return true
    } catch {
      return false
    }
  }
  return onTestClock(
    Effect.gen(function* () {
      const projects = yield* Projects
      const coordinator = yield* Coordinator
      const sessions = yield* Sessions
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      const threadId = yield* coordinator.thread(project.projectId)
      yield* sessions.start({ threadId, agentId })
      yield* coordinator.say({
        envelope: yield* Runtime.envelope('thread.send', {}),
        threadId,
        body: `[test-child:${file}]`,
        disposition: 'after_current',
      })
      const running = Option.getOrThrow(
        yield* until(sessions.running(threadId), (one) => Option.isSome(one) && one.value.turnEndedAt !== null),
      )
      const root = running.pid!
      yield* until(
        Effect.sync(() => existsSync(file)),
        Boolean,
      )
      child = Number(readFileSync(file, 'utf8'))
      assert.isTrue(root > 0 && child > 0 && alive(root) && alive(child))
      yield* TestClock.adjust(Duration.seconds(25))
      yield* until(sessions.running(threadId), Option.isNone)
      yield* until(
        Effect.sync(() => alive(root) || alive(child)),
        (any) => !any,
      )
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          try {
            if (child > 0 && alive(child)) process.kill(child, 'SIGKILL')
          } catch {
            // It may exit between the probe and the cleanup signal.
          }
          removeTreeSync(folder)
        }),
      ),
      Effect.provide(runtime(':memory:', {}, { idle: { coordinator: Duration.seconds(10) } })),
    ),
  )
})
