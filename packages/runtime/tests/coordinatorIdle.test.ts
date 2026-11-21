import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, it } from '@effect/vitest'
import { removeTreeSync } from '@althar/testing'
import { Deferred, Duration, Effect, Fiber, Option } from 'effect'
import { TestClock } from 'effect/testing'
import { SqlClient } from 'effect/sql'

import { Coordinator } from '../src/Coordinator'
import { Projects } from '../src/Projects'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { onTestClock, repository, runtime, until } from './support'

it.effect('retires an idle coordinator and wakes it for news with its account and queued input', () =>
  onTestClock(
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
      yield* TestClock.adjust(Duration.seconds(5))
      assert.strictEqual(Option.getOrThrow(yield* sessions.running(threadId)).sessionId, first.sessionId)
      yield* TestClock.adjust(Duration.seconds(20))
      yield* until(sessions.running(threadId), Option.isNone)
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
      assert.strictEqual(next.accountId, first.accountId)
      const inputs = sql<{ state: string }>`SELECT state FROM user_inputs WHERE thread_id = ${threadId} AND body = ${news}`
      yield* until(inputs, (rows) => rows[0]?.state === 'delivered')
      const [turn] = yield* sql<{ prompt: string }>`SELECT prompt FROM turn_deliveries WHERE provider_session_id = ${next.sessionId}`
      assert.include(turn!.prompt, 'Hello')
      assert.include(turn!.prompt, news)
    }).pipe(Effect.provide(runtime(':memory:', {}, { idle: { coordinator: Duration.seconds(10) } }))),
  ),
)

it.effect('delivers an input accepted while the old coordinator is closing', () => {
  let entered!: () => void
  let release!: () => void
  let armed = false
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
      armed = true
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
            beforeClose: async () => {
              if (armed) {
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

it.effect('wakes queued input accepted after retirement starts but before the provider closes', () => {
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
      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(advance)
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
