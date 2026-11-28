import type { ProjectId } from '@althar/domain'
import { Duration, Effect, Option } from 'effect'
import { SqlClient } from 'effect/sql'

import { RESTART_GRACE } from './runRecords'
import { addItem } from './threads'

/** What carrying a lost lead on takes of the sessions: whether one is on the thread, and its last turn tried again. */
export interface LostLeadSessions {
  readonly running: (threadId: string) => Effect.Effect<Option.Option<unknown>>
  readonly tryAgain: (threadId: string) => Effect.Effect<boolean, unknown>
}

/** The notice's key for a lead started again outside a step: by its thread, as a step's is by its run and step. */
export const lostLeadKey = (threadId: string) => `lead:${threadId}`

/**
 * A task's lead whose agent went on its own in the middle of a turn, with no step of a plan under way (the person talking
 * to it after its plan, as a prototype's lead does): started again by itself, as a step's lead is (DEV-173) and as leads
 * are after Althar restarts. What the person said in that turn goes to it again (`tryAgain`), and its start waits for its
 * worker where one holds it still (Sessions.ts), as a lost run there is said to have stopped. Only a turn on the person's own
 * words: what Althar tells a lead, as a check to fix, carries on its own way. Not where it went between turns (no work was
 * lost), the task isn't open, another session is on the thread already, it asked the person
 * something, or it went soon after Althar last started it again so: then it needs the person, as its notice says.
 */
export const carryOnLost = (
  sessions: LostLeadSessions,
  asking: (threadId: string) => Effect.Effect<boolean, unknown, SqlClient.SqlClient>,
  threadId: string,
  sessionId: string,
) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [thread] = yield* sql<{ projectId: ProjectId }>`
      SELECT t.project_id FROM threads t JOIN tasks k ON k.id = t.task_id
      WHERE t.id = ${threadId} AND t.kind = 'task' AND k.state = 'open'`
    if (thread === undefined) return false
    // Only a turn it was in the middle of: its last turn, of this session, failed as its agent went.
    const [last] = yield* sql<{ id: string; sessionId: string | null; state: string; errorClass: string | null }>`
      SELECT id, provider_session_id AS session_id, state, error_class FROM turn_deliveries
      WHERE thread_id = ${threadId} ORDER BY requested_at DESC, rowid DESC LIMIT 1`
    if (last?.sessionId !== sessionId || last.state !== 'failed' || last.errorClass !== 'agent_exited') return false
    // A turn on the person's own words: what Althar told it (a check to fix, say) has its own way of carrying on.
    const [theirs] = yield* sql<{ id: string }>`
      SELECT i.id FROM turn_delivery_inputs di JOIN user_inputs i ON i.id = di.user_input_id
      JOIN actors a ON a.id = i.author_actor_id AND a.kind = 'person'
      WHERE di.delivery_id = ${last.id} LIMIT 1`
    if (theirs === undefined) return false
    if (Option.isSome(yield* sessions.running(threadId))) return false
    if (yield* asking(threadId)) return false
    const key = lostLeadKey(threadId)
    // Gone again soon after it was last started again so: nothing came in its thread a while after that line.
    const [carried] = yield* sql<{ createdAt: string }>`
      SELECT created_at FROM thread_items WHERE thread_id = ${threadId} AND kind = 'notice'
        AND json_extract(content, '$.startedAgain') = ${key}
      ORDER BY sequence DESC LIMIT 1`
    if (carried !== undefined) {
      const grace = new Date(Date.parse(carried.createdAt) + Duration.toMillis(RESTART_GRACE)).toISOString()
      const [later] = yield* sql<{ count: number }>`
        SELECT count(*) AS count FROM thread_items WHERE thread_id = ${threadId} AND created_at >= ${grace}`
      if (later?.count === 0) return false
    }
    yield* addItem({ projectId: thread.projectId, threadId }, 'notice', {
      source: 'runtime',
      severity: 'info',
      title: 'Started again after its agent stopped on its own.',
      startedAgain: key,
    })
    return yield* sessions.tryAgain(threadId)
  })
