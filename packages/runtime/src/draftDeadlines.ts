import { Clock, Duration, Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { touchTask } from './cards'
import { DRAFTING_MS } from './needsYou'

/*
 * A task the coordinator drafts stays off the board and the home until its
 * plan is proposed (needsYou.ts, Queries' drafting). If the plan never comes,
 * the moment a draft gets ends and it is the person's: it shows in Needs you.
 * A screen reads again only when the feed says something changed, so the
 * runtime wakes at that moment and touches the task, whether the coordinator's
 * turn is still open or the launch that scheduled it has since restarted.
 */

/** Whether the task is still a draft with no plan proposed or accepted. */
const stillDraft = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [draft] = yield* sql<{ one: number }>`
      SELECT 1 AS one FROM tasks k
      WHERE k.id = ${taskId} AND k.state = 'draft'
        AND NOT EXISTS (SELECT 1 FROM task_plans p WHERE p.task_id = k.id AND p.state IN ('proposed', 'accepted'))`
    return draft !== undefined
  })

/**
 * Tells every open board and home when a draft's moment is over if its plan
 * still hasn't come: it is the person's then, and only a change to the task
 * makes them read it again. A task already past its moment is touched at once.
 */
export const surfaceDraftAt = (taskId: string, draftingMs: number = DRAFTING_MS) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [draft] = yield* sql<{ createdAt: string }>`SELECT created_at AS "createdAt" FROM tasks WHERE id = ${taskId} AND state = 'draft'`
    if (draft === undefined) return
    // A moment past the cutoff, so a clock that reads the same millisecond still finds it over.
    const wait = Date.parse(draft.createdAt) + draftingMs + 50 - (yield* Clock.currentTimeMillis)
    if (wait > 0) yield* Effect.sleep(Duration.millis(wait))
    if (yield* stillDraft(taskId)) yield* touchTask(taskId)
  })

/**
 * Schedules the wake for every draft already waiting, as a launch finds them:
 * the one an earlier launch scheduled died with it. A draft made from now on
 * is armed as it is made, by the coordinator's draft_task. One whose moment
 * went by while the launch was down needs none: a board reads it as the
 * person's on its face, without a change to wake it.
 */
export const armDraftDeadlines = (draftingMs: number = DRAFTING_MS) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const lifetime = yield* Effect.scope
    const cutoff = new Date((yield* Clock.currentTimeMillis) - draftingMs - 50).toISOString()
    const drafts = yield* sql<{ id: string }>`
      SELECT k.id FROM tasks k
      WHERE k.state = 'draft' AND k.created_at > ${cutoff}
        AND NOT EXISTS (SELECT 1 FROM task_plans p WHERE p.task_id = k.id AND p.state IN ('proposed', 'accepted'))`
    for (const draft of drafts)
      yield* Effect.forkIn(
        surfaceDraftAt(draft.id, draftingMs).pipe(
          Effect.catchCause((cause) => Effect.logWarning('Could not surface a draft whose plan never came', cause)),
        ),
        lifetime,
      )
  })
