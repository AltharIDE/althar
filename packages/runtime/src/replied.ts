import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

/*
 * A reply the person hasn't seen (a task is a conversation plus parts, "A
 * reply the person hasn't seen puts the task in Needs you until they open
 * it"): when the task's lead last answered, in a turn the person's words
 * began after its plan or one after it (as when it was told to carry on),
 * since they last had the task open and since it last settled, which the
 * person's Done, post or merge did with the answer before them. Read by the
 * card, which waits in Needs you for it, and by Done, which reads it.
 */
export const repliedAt = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [row] = yield* sql<{ at: string | null }>`
      SELECT max(d.ended_at) AS at FROM turn_deliveries d JOIN threads t ON t.id = d.thread_id JOIN tasks k ON k.id = t.task_id
      WHERE t.task_id = ${taskId} AND t.kind = 'task' AND d.state = 'completed' AND d.ended_at > coalesce(k.seen_at, '')
        AND d.ended_at > coalesce(k.settled_at, '')
        AND d.delivered_at >= (SELECT max(p.delivered_at) FROM turn_deliveries p WHERE p.thread_id = t.id AND p.heads IS NOT NULL)
        AND EXISTS (SELECT 1 FROM thread_items i WHERE i.delivery_id = d.id AND i.kind = 'agent_message')`
    return row?.at ?? undefined
  })
