import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Option } from 'effect'
import { SqlClient } from 'effect/sql'

import { NoSession } from '../src/errors'
import { Sessions } from '../src/Sessions'
import { runtime, task, turns, until } from './support'

/*
 * A thread with no agent on it, as what asks of its session finds it: before
 * any agent started, or after the last one stopped. And the agent last on a
 * thread started again as it was.
 */

describe('a thread with no agent on it', () => {
  it.live('has nothing to wake, stop, ask or wait for, and nothing at work', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const { task: created } = yield* task('Nobody yet')
      const threadId = created.threadId
      yield* sessions.wake(threadId)
      assert.instanceOf(yield* Effect.flip(sessions.interrupt(threadId)), NoSession)
      assert.instanceOf(yield* Effect.flip(sessions.setEffort({ threadId, effort: 'high' })), NoSession)
      assert.instanceOf(
        yield* Effect.flip(
          sessions.askPermission(threadId, {
            sessionId: 'none',
            toolCallId: 'call-1',
            title: 'Run make deploy',
            kind: 'execute',
            paths: [],
            options: [],
          }),
        ),
        NoSession,
      )
      assert.isFalse(yield* sessions.busy(threadId))
      assert.strictEqual(yield* sessions.untilIdle(threadId, Duration.seconds(1)), 'gone')
      assert.isTrue(Option.isNone(yield* sessions.running(threadId)))
      // With no agent ever on it, there is none to start again.
      assert.isFalse(yield* sessions.startLast(threadId))
      assert.isTrue(Option.isNone(yield* sessions.running(threadId)))
    }).pipe(Effect.provide(runtime())),
  )

  it.live('starts the agent last on it again, on the model and effort it had', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const sessions = yield* Sessions
      const { task: created } = yield* task('Again')
      const threadId = created.threadId
      yield* sessions.start({ threadId, agentId: 'codex', model: 'large', effort: 'high' })
      yield* until(turns(threadId), (rows) => rows[0]?.state === 'completed')
      yield* sessions.stop(threadId)
      assert.isTrue(Option.isNone(yield* sessions.running(threadId)))
      assert.isTrue(yield* sessions.startLast(threadId))
      const started = yield* until(
        sql<{ agentId: string; model: string | null; effort: string | null; state: string }>`
          SELECT agent_id, model, effort, state FROM provider_sessions WHERE thread_id = ${threadId} ORDER BY started_at, rowid`,
        (rows) => rows.length === 2 && rows[1]?.state === 'active',
      )
      assert.deepStrictEqual(
        started.map((row) => [row.agentId, row.model, row.effort]),
        [
          ['codex', 'large', 'high'],
          ['codex', 'large', 'high'],
        ],
      )
      assert.strictEqual(Option.getOrUndefined(yield* sessions.running(threadId))?.agentId, 'codex')
    }).pipe(Effect.provide(runtime())),
  )
})
