import { Ids, newId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Coordinator } from '../src/Coordinator'
import { Instance } from '../src/Instance'
import { Plans } from '../src/Plans'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import { timestamp } from '../src/records'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { readGoal } from '../src/threadGoals'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, repository, runtime, until } from './support'

/** The coordinator's session, as a turn runs in it. */
const coordinatorOf = (projectId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const threadId = yield* (yield* Coordinator).thread(projectId)
    const sessionId = yield* newId(Ids.providerSession)
    yield* sql`INSERT INTO provider_sessions ${sql.insert({ id: sessionId, projectId, threadId, agentId: 'codex', state: 'active', startedAt: yield* timestamp })}`
    return { role: 'coordinator', projectId, threadId, taskId: null, sessionId } satisfies ToolAccess
  })

/** A turn of the coordinator's: the person's message from the window, or Althar's news. */
const turn = (access: ToolAccess, body: string, byPerson: boolean) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`UPDATE turn_deliveries SET state = 'completed', ended_at = ${yield* timestamp} WHERE thread_id = ${access.threadId} AND state = 'delivered'`
    const accepted = yield* (yield* Sessions).send({
      envelope: yield* Runtime.envelope('thread.send', {}),
      threadId: access.threadId,
      body,
      sender: byPerson ? { kind: 'window' } : { kind: 'internal' },
      origin: byPerson ? 'system' : 'news',
    })
    const turnId = yield* newId(Ids.turnDelivery)
    yield* sql`INSERT INTO turn_deliveries ${sql.insert({ id: turnId, projectId: access.projectId, threadId: access.threadId, providerSessionId: access.sessionId, controllerGeneration: 1, state: 'delivered', origin: byPerson ? 'person' : 'news', requestedAt: yield* timestamp, deliveredAt: yield* timestamp })}`
    yield* sql`INSERT INTO turn_delivery_inputs ${sql.insert({ projectId: access.projectId, deliveryId: turnId, userInputId: accepted.inputId, position: 1 })}`
  })

const noticesIn = (threadId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{ title: string }>`
      SELECT json_extract(content, '$.title') AS title FROM thread_items WHERE thread_id = ${threadId} AND kind = 'notice'`
    return rows.map((row) => row.title)
  })

/**
 * A goal said to the coordinator becomes a task's: it drafts the task, sets the goal on it, and plans it; the goal waits
 * for the plan, so the countdown and a hold still stand, and the task's thread says it was set.
 */
describe('a goal given to the coordinator', () => {
  it.live('is set on the task it drafts, on the person’s word, and waits for its plan', () =>
    Effect.gen(function* () {
      const project = yield* (yield* Projects).open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      const coordinator = yield* coordinatorOf(project.projectId)
      yield* turn(coordinator, 'Althar news: a check failed.', false)
      yield* callTool(coordinator, 'draft_task', {
        title: 'Migrate staging',
        description: 'Move staging to the new database. [lead:finish]',
      })

      // Not on the person's word: refused, and nothing is set.
      const refused = yield* callTool(coordinator, 'set_goal', { task: 'migrate-staging', objective: 'Staging runs on the new database' })
      assert.include(refused, 'person’s word')
      const sql = yield* SqlClient.SqlClient
      const [task] = yield* sql<{ threadId: string }>`
        SELECT t.id AS thread_id FROM tasks k JOIN threads t ON t.task_id = k.id AND t.kind = 'task' WHERE k.slug = 'migrate-staging'`
      assert.isNull(yield* readGoal(task!.threadId))

      yield* turn(coordinator, '/goal Staging runs on the new database', true)
      yield* callTool(coordinator, 'propose_plan', {
        task: 'migrate-staging',
        lead: { agent: 'claude-code', reason: 'A migration.' },
        review: null,
      })
      const said = yield* callTool(coordinator, 'set_goal', { task: 'migrate-staging', objective: 'Staging runs on the new database' })
      assert.include(said, 'waits for its plan')
      const goal = yield* readGoal(task!.threadId)
      assert.strictEqual(goal?.objective, 'Staging runs on the new database')
      assert.strictEqual(goal?.status, 'active')
      assert.isTrue(goal?.waiting)
      assert.include(yield* noticesIn(task!.threadId), 'The coordinator set the goal, as you asked: Staging runs on the new database')

      // Its plan started, the goal is its lead's to work toward.
      const [plan] = yield* sql<{ id: string }>`
        SELECT p.id FROM task_plans p JOIN tasks k ON k.id = p.task_id WHERE k.slug = 'migrate-staging' AND p.state = 'proposed'`
      yield* (yield* Plans).start(plan!.id, (yield* Instance).personId)
      const taken = yield* until(readGoal(task!.threadId), (now) => now?.waiting === false)
      assert.deepStrictEqual([taken?.status, taken?.detail], ['active', null])
    }).pipe(Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime())))),
  )
})
