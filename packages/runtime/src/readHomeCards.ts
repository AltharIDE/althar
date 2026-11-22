import { Database } from '@althar/persistence-sqlite'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { issueCardsWaiting } from './kinds'

/** Works out a large home's cards in order, letting other runtime calls run between cards. */
export const readHomeCards = <A, B, E, R>(rows: ReadonlyArray<A>, size: number, read: (row: A) => Effect.Effect<B, E, R>) =>
  Effect.forEach(rows, (row) => Effect.andThen(Effect.yieldNow, read(row)), {
    concurrency: size,
  })

/** Check the small board history window before working out any settled cards. */
export const homeTaskRows = (projectId: string, deviceId: string, settledShown: number, cached = false) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    // Keep the preflight in step with the done-task branches of Queries.standingFor. Live sessions
    // and a pull request opening are checked by the caller, since their state is in the runtime.
    const read = sql<{
      id: string
      projectId: string
      state: string
      createdAt: string
      settledAt: string | null
      candidate: number
      view: string | null
    }>`
      SELECT found.*, ${cached ? sql`v.view` : sql`NULL`} AS view FROM (
      SELECT id, project_id, state, created_at, settled_at, 1 AS candidate
        FROM tasks WHERE project_id = ${projectId} AND state IN ('open', 'draft')
      UNION ALL
      SELECT k.id, k.project_id, k.state, k.created_at, k.settled_at,
        -- A settled task only returns to Home for work, a call, a review, a reply or changes to ship.
        -- These are necessary signals, leaving the shared card logic to decide whether it actually returns.
        k.settled_at IS NULL
        OR EXISTS (SELECT 1 FROM workspaces w WHERE w.task_id = k.id AND w.device_id = ${deviceId} AND (
          w.held_at IS NOT NULL OR (w.access = 'write' AND w.state = 'ready' AND
            EXISTS (SELECT 1 FROM external_links l WHERE l.task_id = k.id AND l.kind = 'change'))))
        OR EXISTS (SELECT 1 FROM task_plans p WHERE p.task_id = k.id AND p.state = 'proposed')
        OR EXISTS (SELECT 1 FROM attention_requests a WHERE a.task_id = k.id AND (
          a.state = 'open' OR (a.kind = 'question' AND a.state = 'answered' AND json_extract(a.payload, '$.waitsForPlace') IS NOT NULL)))
        OR ${sql.unsafe(issueCardsWaiting('k'))} > 0
        OR EXISTS (SELECT 1 FROM merge_reviews m WHERE m.task_id = k.id AND m.state IN ('found', 'fixing'))
        OR EXISTS (SELECT 1 FROM conflict_resolutions c WHERE c.task_id = k.id AND c.state = 'resolving')
        OR EXISTS (SELECT 1 FROM runs r JOIN workflow_executions e ON e.run_id = r.id
          JOIN nodes n ON n.execution_id = e.id JOIN node_attempts a ON a.node_id = n.id
          WHERE r.task_id = k.id AND (a.state = 'admitted' OR (a.state = 'held' AND a.hold_reason = 'machine_busy')))
        OR EXISTS (SELECT 1 FROM threads h WHERE h.task_id = k.id AND (
          h.waits_for_place IS NOT NULL
          OR EXISTS (SELECT 1 FROM provider_sessions s WHERE s.thread_id = h.id AND s.state = 'starting')
          OR (h.kind = 'task' AND EXISTS (SELECT 1 FROM turn_deliveries d WHERE d.thread_id = h.id
            AND d.state = 'completed' AND d.delivered_at > k.settled_at))))
        AS candidate
      FROM (
        SELECT id, project_id, state, created_at, settled_at FROM tasks WHERE project_id = ${projectId}
          AND state IN ('done', 'abandoned') ORDER BY settled_at DESC, id DESC LIMIT ${settledShown}
      ) k WHERE k.state = 'done') found
      ${cached ? sql`LEFT JOIN board_card_views v ON v.task_id = found.id` : sql``}`
    return yield* cached ? (yield* Database.ReadLane).read(read) : read
  })
