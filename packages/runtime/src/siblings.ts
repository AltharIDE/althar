import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

/**
 * The project's other tasks made from the same message of the person's as this one: tasks with the same words as their request,
 * both created within one turn of the project's coordinator, however long it ran. The same words in another turn are another
 * message. `heard` is whether the task's lead has had its opening brief, and so needs telling of a sibling made since.
 */
export const siblingsOf = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<{ taskId: string; slug: string; title: string; threadId: string; state: string; heard: number }>`
      SELECT o.id AS task_id, o.slug, o.title, o.state, h.id AS thread_id,
        EXISTS (SELECT 1 FROM turn_deliveries t WHERE t.thread_id = h.id) AS heard
      FROM tasks k
      JOIN tasks o ON o.project_id = k.project_id AND o.id <> k.id AND o.request = k.request
      JOIN threads h ON h.task_id = o.id AND h.kind = 'task'
      WHERE k.id = ${taskId} AND k.request IS NOT NULL AND EXISTS (
        SELECT 1 FROM turn_deliveries d JOIN threads c ON c.id = d.thread_id AND c.kind = 'coordinator'
        WHERE d.project_id = k.project_id AND d.requested_at <= min(k.created_at, o.created_at)
          AND coalesce(d.ended_at, '9999') >= max(k.created_at, o.created_at))
      ORDER BY o.created_at, o.rowid`
  })

/** What a lead is told of the tasks made from the same message as its own. */
export const alsoPlanned = (siblings: ReadonlyArray<{ readonly slug: string; readonly title: string }>, since = false) =>
  `Also planned from this message${since ? ', since you started' : ''}, by other tasks: ${siblings.map((task) => `${task.title} (${task.slug})`).join('; ')}. find_tasks shows how they stand; what they cover isn't yours, so don't draft an issue for it.`
