import { assert, describe, it } from '@effect/vitest'
import { Deferred, Duration, Effect, Exit, Fiber, Option } from 'effect'
import { SqlClient } from 'effect/sql'

import { Busy } from '../src/Busy'
import { Sessions } from '../src/Sessions'
import * as Runtime from '../src/Runtime'
import { notices, runtime, task, turns, until } from './support'

const over = (row: { readonly state: string }) => row.state !== 'pending' && row.state !== 'delivered'
const say = (threadId: string, body: string, quiet = false, note = false) =>
  Effect.gen(function* () {
    const sessions = yield* Sessions
    return yield* sessions.send({
      envelope: yield* Runtime.envelope('thread.send', { threadId, body }),
      threadId,
      body,
      sender: { kind: 'window' },
      quiet,
      note,
    })
  })

for (const recovery of ['Try again', 'new message'] as const) {
  it.live(`${recovery} delivers retained person and quiet input exactly once after a transient failure`, () => {
    const service: { down: 'offline' | undefined } = { down: undefined }
    return Effect.gen(function* () {
      const sessions = yield* Sessions
      const busy = yield* Busy
      const sql = yield* SqlClient.SqlClient
      const { task: created } = yield* task()
      yield* sessions.start({ threadId: created.threadId, agentId: 'codex' })
      yield* until(turns(created.threadId), (rows) => rows.length === 1 && rows.every(over))
      const note = yield* say(created.threadId, 'The previous check needs attention.', true, true)
      service.down = 'offline'
      const question = yield* say(created.threadId, 'Check the refund path.')
      yield* until(turns(created.threadId), (rows) => rows.length === 2 && rows.every(over))
      assert.lengthOf((yield* busy.now).holders, 0)
      assert.lengthOf(
        (yield* notices(created.threadId)).filter((notice) => notice['severity'] === 'error'),
        1,
      )
      const states = yield* sql<{ id: string; state: string }>`
        SELECT id, state FROM user_inputs WHERE id IN (${note.inputId}, ${question.inputId}) ORDER BY sequence`
      assert.deepStrictEqual(
        states.map((one) => one.state),
        ['noted', 'queued'],
      )
      service.down = undefined
      if (recovery === 'Try again') assert.isTrue(yield* sessions.tryAgain(created.threadId))
      else yield* say(created.threadId, 'Keep the fix small.')
      const rows = yield* until(turns(created.threadId), (rows) => rows.length === 3 && rows.every(over))
      assert.strictEqual(rows[2]?.state, 'completed')
      for (const text of ['The previous check needs attention.', 'Check the refund path.'])
        assert.strictEqual((rows[2]?.prompt ?? '').split(text).length - 1, 1)
      assert.lengthOf(
        yield* sql`SELECT d.id FROM turn_delivery_inputs i JOIN turn_deliveries d ON d.id = i.delivery_id
        WHERE i.user_input_id = ${question.inputId} AND d.state = 'completed'`,
        1,
      )
    }).pipe(Effect.provide(runtime(':memory:', { connection: () => service.down })))
  })
}

describe('replacement ownership', () => {
  it.live('restores the outgoing session after replacement startup fails, delivering the waiting input once', () => {
    let rejectStartup: (reason: Error) => void = () => {}
    let holdStartup: Promise<void> | undefined
    return Effect.gen(function* () {
      const sessions = yield* Sessions
      const sql = yield* SqlClient.SqlClient
      const { task: created } = yield* task()
      yield* sessions.start({ threadId: created.threadId, agentId: 'codex' })
      yield* until(turns(created.threadId), (rows) => rows.length === 1 && rows.every(over))
      const original = Option.getOrThrow(yield* sessions.running(created.threadId)).sessionId
      const askedForPlace = yield* Deferred.make<void>()
      const givenPlace = yield* Deferred.make<void>()
      yield* sessions.gateTurns((_lead, work) =>
        Effect.gen(function* () {
          yield* Deferred.succeed(askedForPlace, undefined)
          yield* Deferred.await(givenPlace)
          yield* work(Effect.void)
          return true
        }),
      )
      const question = yield* say(created.threadId, 'Check the refund path.')
      yield* Deferred.await(askedForPlace)
      holdStartup = new Promise<void>((_resolve, reject) => {
        rejectStartup = reject
      })
      // It can fail before the transport reaches session/new; keep the rejected promise observed until it does.
      void holdStartup.catch(() => {})
      const switched = yield* Effect.forkChild(Effect.exit(sessions.switchAgent({ threadId: created.threadId, agentId: 'opencode' })))
      yield* until(
        sql`SELECT id FROM provider_sessions WHERE thread_id = ${created.threadId} AND agent_id = 'opencode'`,
        (rows) => rows.length === 1,
      )
      yield* Deferred.succeed(givenPlace, undefined)
      rejectStartup(new Error('Replacement failed to start'))
      assert.isTrue(Exit.isFailure(yield* Fiber.join(switched)))
      const rows = yield* until(turns(created.threadId), (rows) => rows.length === 2 && rows.every(over))
      assert.strictEqual(rows[1]?.providerSessionId, original)
      assert.strictEqual(rows[1]?.state, 'completed')
      assert.lengthOf(yield* sql`SELECT delivery_id FROM turn_delivery_inputs WHERE user_input_id = ${question.inputId}`, 1)
      assert.strictEqual(Option.getOrThrow(yield* sessions.running(created.threadId)).sessionId, original)
    }).pipe(Effect.provide(runtime(':memory:', {}, { each: { opencode: { beforeNewSession: () => holdStartup ?? Promise.resolve() } } })))
  })
})

describe('Stop after dispatch', () => {
  it.live('ends a pending turn cleanly when its preparation never releases before the stop grace', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const sql = yield* SqlClient.SqlClient
      const { task: created } = yield* task()
      yield* sessions.start({ threadId: created.threadId, agentId: 'codex' })
      yield* until(turns(created.threadId), (rows) => rows.length === 1 && rows.every(over))
      const prepared = yield* Deferred.make<void>()
      yield* sessions.gateTurns((_lead, work) => Effect.as(work(Effect.andThen(Deferred.succeed(prepared, undefined), Effect.never)), true))
      const input = yield* say(created.threadId, 'Never dispatch these words after Stop.')
      yield* Deferred.await(prepared)
      yield* sessions.stop(created.threadId)
      const rows = yield* turns(created.threadId)
      assert.deepStrictEqual(
        rows.slice(1).map((one) => [one.state, one.errorClass]),
        [['interrupted', null]],
      )
      const [waiting] = yield* sql<{ state: string }>`SELECT state FROM user_inputs WHERE id = ${input.inputId}`
      assert.strictEqual(waiting?.state, 'queued')
    }).pipe(Effect.provide(runtime(':memory:', {}, { stopGrace: Duration.zero }))),
  )

  it.live('interrupts the actual current prompt when Stop arrives as its request reaches the agent', () => {
    let stopAtRequest: (() => void) | undefined
    return Effect.gen(function* () {
      const sessions = yield* Sessions
      const { task: created } = yield* task()
      yield* sessions.start({ threadId: created.threadId, agentId: 'codex' })
      yield* until(turns(created.threadId), (rows) => rows.length === 1 && rows.every(over))
      const stopped = yield* Deferred.make<void>()
      stopAtRequest = () => {
        stopAtRequest = undefined
        // Forking at request receipt puts Stop between dispatch and the adapter's started callback.
        Effect.runFork(sessions.stop(created.threadId).pipe(Effect.ensuring(Deferred.succeed(stopped, undefined))))
      }
      yield* say(created.threadId, 'Keep thinking. [answers-after:5s]')
      yield* Deferred.await(stopped)
      const rows = yield* turns(created.threadId)
      assert.deepStrictEqual(
        rows.slice(1).map((one) => [one.state, one.errorClass]),
        [['interrupted', null]],
      )
      assert.isTrue(Option.isNone(yield* sessions.running(created.threadId)))
    }).pipe(Effect.provide(runtime(':memory:', { promptAsked: () => stopAtRequest?.() }, { stopGrace: Duration.seconds(30) })))
  })
})
