import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { taskEventWaitKinds } from './errandWaits'
import { latestOf } from './pullRequestStanding'

interface Wait {
  readonly kind: string
  readonly target: string
}

export const taskForWait = (projectId: string, target: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [task] = yield* sql<{ id: string; slug: string; state: string }>`
      SELECT id, slug, state FROM tasks WHERE project_id = ${projectId} AND (id = ${target} OR slug = ${target})`
    return task
  })

const pullRequests = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{ snapshot: string; checksPassed: number }>`
      SELECT l.snapshot,
        CASE
          WHEN json_extract(l.snapshot, '$.checks.sha') = json_extract(l.snapshot, '$.headSha')
            THEN json_extract(l.snapshot, '$.checks.outcome') = 'passed'
          WHEN json_extract(l.snapshot, '$.state') = 'merged' THEN (
            SELECT json_extract(o.payload, '$.outcome') = 'passed' FROM observations o
            WHERE o.subject_type = 'external_link' AND o.subject_id = l.id AND o.kind = 'checks'
              AND json_extract(o.payload, '$.sha') = json_extract(l.snapshot, '$.headSha')
            ORDER BY o.rowid DESC LIMIT 1
          )
          ELSE 0
        END AS checks_passed
      FROM external_links l WHERE l.task_id = ${taskId} AND l.kind = 'change'
      ORDER BY l.created_at, l.rowid`
    return latestOf(
      rows.flatMap(({ snapshot, checksPassed }) => {
        const pull = JSON.parse(snapshot) as { state?: string; repository?: ReadonlyArray<string> }
        return pull.state === undefined || !Array.isArray(pull.repository)
          ? []
          : [{ state: pull.state, repository: pull.repository, checksPassed: checksPassed === 1 }]
      }),
    )
  })

const stepReported = (taskId: string, kind: 'lead' | 'review') =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [report] = yield* sql`
      SELECT 1 FROM threads t JOIN thread_items i ON i.thread_id = t.id
      WHERE t.task_id = ${taskId} AND t.kind = 'task' AND i.kind = 'step_result'
        AND i.undone_at IS NULL AND ${
          kind === 'lead'
            ? sql`json_extract(i.content, '$.step') IN ('implement', 'settle')`
            : sql`json_extract(i.content, '$.step') = 'review'
              AND (json_extract(i.content, '$.verdict') = 'pass' OR json_array_length(i.content, '$.findings') = 0)`
        }
      LIMIT 1`
    return report !== undefined
  })

const taskStepFinished = (taskId: string, kind: 'lead' | 'review') =>
  Effect.gen(function* () {
    if (yield* stepReported(taskId, kind)) return true
    const sql = yield* SqlClient.SqlClient
    const [finished] = yield* sql`
      SELECT 1 FROM runs r JOIN workflow_executions e ON e.run_id = r.id
      JOIN nodes n ON n.execution_id = e.id JOIN node_attempts a ON a.node_id = n.id
      WHERE r.task_id = ${taskId} AND a.state = 'succeeded' AND ${
        kind === 'lead'
          ? sql`n.node_key IN ('implement', 'settle')`
          : sql`(
          (n.node_key = 'review' AND (json_extract(a.output, '$.verdict') = 'pass' OR json_extract(a.output, '$.findings') = 0))
          OR (n.node_key = 'settle' AND (json_extract(a.output, '$.tiny') IS NOT NULL OR json_extract(a.output, '$.unreviewed') = 1))
        )`
      }
      ${kind === 'review' ? sql`UNION ALL SELECT 1 FROM merge_reviews WHERE task_id = ${taskId} AND state = 'clear'` : sql``}
      LIMIT 1`
    return finished !== undefined
  })

export const unreachableTaskWait = 'An errand step can no longer be reached.'

/** Read task results from the store, including results recorded before an errand was kept. */
export const taskWaitStatus = (projectId: string, waits: ReadonlyArray<Wait>) =>
  Effect.gen(function* () {
    let waiting = false
    for (const wait of waits) {
      if (!taskEventWaitKinds.includes(wait.kind)) continue
      const task = yield* taskForWait(projectId, wait.target)
      if (task === undefined) return { state: 'unreachable', reason: `There is no task “${wait.target}” in this project.` } as const

      const checks = wait.kind === 'checks_passed'
      const pulls = checks ? yield* pullRequests(task.id) : []
      const met = checks
        ? pulls.length > 0 && pulls.every((pull) => pull.state !== 'closed' && pull.checksPassed)
        : yield* taskStepFinished(task.id, wait.kind === 'lead_done' ? 'lead' : 'review')
      if (met) continue

      const changes = checks ? pulls : yield* pullRequests(task.id)
      const ended =
        task.state === 'abandoned'
          ? 'was discarded'
          : changes.length > 0 && changes.every((pull) => pull.state === 'merged')
            ? 'merged'
            : task.state === 'done'
              ? 'was settled'
              : null
      if (ended !== null) {
        const result =
          wait.kind === 'lead_done' ? 'a finished lead step' : wait.kind === 'review_settled' ? 'a settled review' : 'passing checks'
        return { state: 'unreachable', reason: `Task “${task.slug}” ${ended} without a record of ${result}.` } as const
      }
      waiting = true
    }
    return { state: waiting ? 'waiting' : 'ready' } as const
  })
