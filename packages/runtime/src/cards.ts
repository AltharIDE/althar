import type { ProjectId } from '@althar/domain'
import { Ledger } from '@althar/persistence-sqlite'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { change } from './records'
import { addItem } from './threads'

/*
 * Each task has one card in its project's coordinator thread
 * (docs/architecture/04, task events): its plan before it starts, then where
 * it stands. Althar posts it, never an agent. The card's item holds only
 * the task's id; what it shows is read from the task, its plan and its run,
 * so touching the item tells watching clients to read it again.
 */

/** The coordinator thread's card for a task, if it has one. */
const cardOf = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [card] = yield* sql<{ id: string; projectId: ProjectId; content: string }>`
      SELECT i.id, i.project_id, i.content FROM thread_items i JOIN threads t ON t.id = i.thread_id
      WHERE t.kind = 'coordinator' AND i.kind = 'task' AND json_extract(i.content, '$.taskId') = ${taskId}`
    return card
  })

/** Posts the task's card in its project's coordinator thread, unless it is there already. */
export const postCard = (projectId: ProjectId, taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    if ((yield* cardOf(taskId)) !== undefined) return yield* touchCard(taskId)
    const [thread] = yield* sql<{ id: string }>`SELECT id FROM threads WHERE project_id = ${projectId} AND kind = 'coordinator' LIMIT 1`
    if (thread !== undefined) yield* addItem({ projectId, threadId: thread.id }, 'task', { taskId })
  })

/** Tells watching clients the task's card changed, so they read it again. */
export const touchCard = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const ledger = yield* Ledger
    const card = yield* cardOf(taskId)
    if (card === undefined) return
    yield* sql.withTransaction(
      Effect.gen(function* () {
        // The item itself doesn't change; its revision moves on, so the feed says it did.
        const revision = yield* change('thread_items', card.id, { content: card.content })
        yield* ledger.notify({ projectId: card.projectId, aggregateType: 'thread_item', aggregateId: card.id, aggregateRevision: revision })
      }),
    )
  })
