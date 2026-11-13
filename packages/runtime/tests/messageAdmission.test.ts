import { assert, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Coordinator } from '../src/Coordinator'
import { Queries } from '../src/Queries'
import { Sessions } from '../src/Sessions'
import * as Runtime from '../src/Runtime'
import { runtime, task, turns, until } from './support'

it.live('reports claimed turns before turnRunning, for task and coordinator sends', () =>
  Effect.gen(function* () {
    const queries = yield* Queries
    const sessions = yield* Sessions
    const coordinator = yield* Coordinator
    const sql = yield* SqlClient.SqlClient
    const { project, task: created } = yield* task()
    const coordinatorId = yield* coordinator.thread(project.projectId)
    for (const threadId of [created.threadId, coordinatorId]) {
      yield* sessions.send({ envelope: yield* Runtime.envelope('input.send', {}), threadId, body: 'Hello' })
      yield* sessions.start({ threadId, agentId: 'codex' })
      yield* until(turns(threadId), (rows) => rows[0]?.state === 'completed')
      const read = threadId === created.threadId ? queries.thread(threadId) : queries.coordinator(project.projectId)
      assert.strictEqual((yield* read).session?.accepting, 'now')
      yield* sql`UPDATE provider_sessions SET state = 'starting' WHERE thread_id = ${threadId}`
      assert.strictEqual((yield* read).session?.accepting, 'queued')
      yield* sql`UPDATE provider_sessions SET state = 'active' WHERE thread_id = ${threadId}`
      // Reproduce the durable claim -> prompt preparation boundary with the live
      // session idle. Both pending (preparing) and delivered (including compaction)
      // must queue the next message regardless of the in-memory turnRunning flag.
      for (const state of ['pending', 'delivered']) {
        yield* sql`UPDATE turn_deliveries SET state = ${state} WHERE thread_id = ${threadId}`
        const snapshot = yield* read
        assert.isFalse(snapshot.session?.turnRunning)
        assert.strictEqual(snapshot.session?.accepting, 'queued')
      }
      yield* sql`UPDATE turn_deliveries SET state = 'completed' WHERE thread_id = ${threadId}`
      assert.strictEqual((yield* read).session?.accepting, 'now')
    }
  }).pipe(Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime())))),
)
