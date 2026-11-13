import type { ActorId } from '@althar/domain'
import { Effect } from 'effect'
import type { SqlClient } from 'effect/sql'

import type { Busy } from './Busy'
import type { Plans } from './Plans'
import type { Sessions } from './Sessions'

/*
 * The person moves a row of Up next (ADR-065): its board's drag, its menu, a
 * task's Move to front, the coordinator's move_to_front. Every row there is
 * one Althar orders for a place among the agents at work: what continues and
 * the line are one order, either going anywhere in it (Busy's `move`); a plan
 * waiting to start, on its countdown, held, or come due and not started yet,
 * starts when it is moved, at the place it was put, as its row's Start would
 * have started it at the line's end.
 */

/** What became of a move: the row moved, its plan started where it was put, or it isn't one Up next orders. */
export type UpNextMove = 'moved' | 'started' | 'none'

export const upNextMove =
  (busy: Busy['Service'], plans: Plans['Service'], sql: SqlClient.SqlClient) =>
  (taskId: string, to: number, actorId: ActorId): Effect.Effect<UpNextMove, unknown> =>
    Effect.gen(function* () {
      if (yield* busy.move(taskId, to)) return 'moved' as const
      const [plan] = yield* sql<{ id: string }>`
        SELECT id FROM task_plans WHERE task_id = ${taskId} AND state = 'proposed' ORDER BY proposed_at DESC LIMIT 1`
      if (plan === undefined) return 'none' as const
      // Put first, so its first step stands there as soon as it waits for a place; one that doesn't start leaves no place behind.
      yield* busy.move(taskId, to, true)
      const started = yield* plans
        .start(plan.id, actorId)
        .pipe(Effect.tapCause(() => sql`UPDATE tasks SET line_at = NULL WHERE id = ${taskId}`.pipe(Effect.ignore)))
      if (started === 'waiting') return 'started' as const
      // Started at once, a place free, or not at all: it waits nowhere, so where it was put goes.
      yield* sql`UPDATE tasks SET line_at = NULL WHERE id = ${taskId} AND line_at IS NOT NULL`
      return started === null ? ('none' as const) : ('started' as const)
    })

/**
 * Lets go of the turns Althar asked of a task's lead or reviewer that wait for a place among the agents at work: the task
 * leaves Up next, and what each would have said is noted, for its agent to read with its next turn. How many threads let go.
 */
export const cancelWaitingTurn =
  (busy: Busy['Service'], sessions: Sessions['Service'], sql: SqlClient.SqlClient) =>
  (taskId: string): Effect.Effect<number, unknown> =>
    Effect.gen(function* () {
      const waiting = yield* sql<{ id: string }>`
        SELECT id FROM threads WHERE task_id = ${taskId} AND waits_for_place IS NOT NULL AND coalesce(node_key, '') NOT LIKE 'helper:%'`
      // Noted first, so nothing that waits asks for a place again before it is let go.
      for (const thread of waiting) yield* sessions.noteQueued(thread.id)
      return (yield* busy.letGo(taskId)).length
    })
