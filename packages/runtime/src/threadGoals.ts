import { ApiError, GOAL_LENGTH, type GoalControl, type ThreadGoal, nextGoal } from '@althar/contracts'
import type { ProjectId } from '@althar/domain'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { touchTask } from './cards'
import type { ToolAccess } from './ToolServer'
import { ToolRefused } from './toolErrors'

export interface GoalLead {
  readonly agentId: string
  readonly model?: string
  readonly effort?: string
}

type GoalRow = Omit<ThreadGoal, 'waiting' | 'status'> & {
  readonly status: ThreadGoal['status'] | 'cleared'
  readonly launchAgent: string | null
  readonly launchModel: string | null
  readonly launchEffort: string | null
  readonly available: number
}

const goalRow = (threadId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [row] = yield* sql<GoalRow>`
      SELECT g.*, g.generation AS revision,
        (k.state IN ('draft', 'open') AND k.kept_at IS NULL AND p.archived_at IS NULL
          -- A plan not started yet, counting down or held: the goal waits for it, and its lead takes it up once it starts.
          AND NOT EXISTS (SELECT 1 FROM task_plans tp WHERE tp.task_id = k.id AND tp.state = 'proposed')
          AND NOT EXISTS (SELECT 1 FROM attention_requests a WHERE a.task_id = k.id AND a.state = 'open')
          AND NOT EXISTS (SELECT 1 FROM helpers h WHERE h.task_id = k.id AND h.state = 'working')
          AND NOT EXISTS (
            SELECT 1 FROM runs r JOIN workflow_executions e ON e.run_id = r.id
            JOIN nodes n ON n.execution_id = e.id JOIN node_attempts a ON a.node_id = n.id
            WHERE r.task_id = k.id AND r.state = 'running' AND a.state IN ('admitted', 'running', 'held', 'waiting_attention')
              AND (a.state IN ('held', 'waiting_attention') OR n.node_key NOT IN ('implement', 'settle')))
          AND NOT EXISTS (
            SELECT 1 FROM runs r WHERE r.id = (
              SELECT latest.id FROM runs latest WHERE latest.task_id = k.id ORDER BY latest.created_at DESC, latest.rowid DESC LIMIT 1
            ) AND r.state = 'suspended')
        ) AS available
      FROM thread_goals g JOIN threads t ON t.id = g.thread_id
      JOIN tasks k ON k.id = t.task_id JOIN projects p ON p.id = k.project_id
      WHERE g.thread_id = ${threadId}`
    return row
  })

const view = (row: GoalRow | undefined): ThreadGoal | null =>
  row === undefined || row.status === 'cleared'
    ? null
    : {
        revision: row.revision,
        objective: row.objective,
        status: row.status,
        rounds: row.rounds,
        roundLimit: row.roundLimit,
        progress: row.progress,
        detail: row.detail,
        waiting: row.status === 'active' && row.available !== 1,
      }

export const readGoal = (threadId: string) => Effect.map(goalRow(threadId), view)

export const runnableGoal = (threadId: string) =>
  Effect.map(goalRow(threadId), (row) => (row?.status === 'active' && row.available === 1 ? view(row) : null))

/** A goal accepted just before shutdown may have no provider session yet. */
export const goalLaunchChoice = (threadId: string) =>
  Effect.map(goalRow(threadId), (row): GoalLead | undefined => {
    if (row?.launchAgent == null) return undefined
    return {
      agentId: row.launchAgent,
      ...(row.launchModel === null ? {} : { model: row.launchModel }),
      ...(row.launchEffort === null ? {} : { effort: row.launchEffort }),
    }
  })

export const goalThread = (threadId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return (yield* sql<{ id: string; projectId: ProjectId; state: string }>`
      SELECT k.id, k.project_id, k.state
      FROM threads t JOIN tasks k ON k.id = t.task_id JOIN projects p ON p.id = k.project_id
      WHERE t.id = ${threadId} AND t.kind = 'task' AND p.archived_at IS NULL`)[0]
  })

export const controlGoal = (threadId: string, control: GoalControl, lead?: GoalLead) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        const task = yield* goalThread(threadId)
        if (task === undefined) return yield* new ApiError({ reason: 'Invalid', message: 'Goals belong to task conversations.' })
        const row = yield* goalRow(threadId)
        const current = view(row)
        if (control.action === 'set' || control.action === 'edit') {
          const length = control.objective.trim().length
          if (length === 0 || length > GOAL_LENGTH)
            return yield* new ApiError({
              reason: 'Invalid',
              message: `Enter a goal between 1 and ${GOAL_LENGTH.toLocaleString('en')} characters.`,
            })
        }
        const next = nextGoal(current, control)
        if (next === current)
          return { goal: current, before: current, changed: false, taskId: task.id, projectId: task.projectId, stopping: undefined }
        const stopping = yield* goalRoundInProgress(threadId)
        if (next?.status === 'active' && (task.state === 'abandoned' || task.state === 'done'))
          return yield* new ApiError({ reason: 'Invalid', message: 'Start a goal on an open task.' })
        const revision = (row?.revision ?? 0) + 1
        const launchAgent = next === null ? null : (lead?.agentId ?? row?.launchAgent ?? null)
        const launchModel = launchAgent === null ? null : lead === undefined ? (row?.launchModel ?? null) : (lead.model ?? null)
        const launchEffort = launchAgent === null ? null : lead === undefined ? (row?.launchEffort ?? null) : (lead.effort ?? null)
        yield* sql`
          INSERT INTO thread_goals (thread_id, generation, objective, status, rounds, round_limit, launch_agent, launch_model, launch_effort, progress, detail)
          VALUES (${threadId}, ${revision}, ${next?.objective ?? ''}, ${next?.status ?? 'cleared'},
            ${next?.rounds ?? 0}, ${next?.roundLimit ?? row?.roundLimit ?? 1},
            ${launchAgent}, ${launchModel}, ${launchEffort},
            ${next?.progress ?? null}, ${next?.detail ?? null})
          ON CONFLICT(thread_id) DO UPDATE SET generation = excluded.generation, objective = excluded.objective,
            status = excluded.status, rounds = excluded.rounds, round_limit = excluded.round_limit,
            launch_agent = excluded.launch_agent, launch_model = excluded.launch_model, launch_effort = excluded.launch_effort,
            progress = excluded.progress, detail = excluded.detail`
        yield* touchTask(task.id)
        return { goal: yield* readGoal(threadId), before: current, changed: true, taskId: task.id, projectId: task.projectId, stopping }
      }),
    )
  })

/** What the person did to the goal, as Althar's line in the thread says it: the goal is the thread's, not said to the lead. */
export const goalLine = (control: GoalControl, before: ThreadGoal | null, after: ThreadGoal | null): string => {
  switch (control.action) {
    case 'set':
      return before === null
        ? `You set a goal: ${after?.objective ?? control.objective.trim()}`
        : `You replaced the goal: ${after?.objective ?? control.objective.trim()}`
    case 'edit':
      return `You changed the goal: ${after?.objective ?? control.objective.trim()}`
    case 'pause':
      return 'You paused the goal.'
    case 'resume':
      return 'You resumed the goal.'
    case 'clear':
      return 'You cleared the goal.'
  }
}

/** Stop invalidates both work waiting for dispatch and the running turn's permission to report a result. */
export const pauseGoal = (threadId: string, detail: string | null = null) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [changed] = yield* sql<{ taskId: string }>`
      UPDATE thread_goals SET status = 'paused', generation = generation + 1, detail = ${detail}
      WHERE thread_id = ${threadId} AND status = 'active'
      RETURNING (SELECT task_id FROM threads WHERE id = thread_id) AS task_id`
    if (changed !== undefined) yield* touchTask(changed.taskId)
  })

export const pauseTaskGoal = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [thread] = yield* sql<{ id: string }>`SELECT id FROM threads WHERE task_id = ${taskId} AND kind = 'task'`
    if (thread !== undefined) yield* pauseGoal(thread.id)
  })

export const goalRoundInProgress = (threadId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [turn] = yield* sql<{ id: string }>`
      SELECT id FROM turn_deliveries WHERE thread_id = ${threadId} AND goal_round = 1 AND state IN ('pending', 'delivered')`
    return turn?.id
  })

export const startGoalRound = (threadId: string, goal: ThreadGoal, automatic: boolean) =>
  Effect.gen(function* () {
    if ((yield* runnableGoal(threadId))?.revision !== goal.revision) return false
    if (!automatic) return true
    const sql = yield* SqlClient.SqlClient
    const [changed] = yield* sql<{ taskId: string }>`
      UPDATE thread_goals SET rounds = rounds + 1
      WHERE thread_id = ${threadId} AND generation = ${goal.revision} AND status = 'active' AND rounds < round_limit
      RETURNING (SELECT task_id FROM threads WHERE id = thread_id) AS task_id`
    if (changed === undefined) return false
    yield* touchTask(changed.taskId)
    return true
  })

export const endGoalRound = (threadId: string, revision: number, failure: string | null) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [changed] = yield* sql<{ taskId: string }>`
      UPDATE thread_goals SET status = CASE WHEN ${failure} IS NULL THEN 'limited' ELSE 'blocked' END,
        detail = ${failure}
      WHERE thread_id = ${threadId} AND generation = ${revision} AND status = 'active'
        AND (${failure} IS NOT NULL OR rounds >= round_limit)
      RETURNING (SELECT task_id FROM threads WHERE id = thread_id) AS task_id`
    if (changed !== undefined) yield* touchTask(changed.taskId)
  })

/** Workflow steps have their own recovery. A stand-alone goal needs a visible way to restart its lead. */
export const blockGoalAfterDisconnect = (threadId: string, sessionId: string) =>
  Effect.gen(function* () {
    const goal = yield* runnableGoal(threadId)
    if (goal === null) return
    const sql = yield* SqlClient.SqlClient
    const [last] = yield* sql<{ id: string }>`
      SELECT s.id FROM provider_sessions s JOIN threads t ON t.id = s.thread_id
      WHERE t.id = ${threadId}
        AND NOT EXISTS (SELECT 1 FROM runs r WHERE r.task_id = t.task_id AND r.state = 'running')
      ORDER BY s.started_at DESC, s.rowid DESC LIMIT 1`
    if (last?.id === sessionId) yield* endGoalRound(threadId, goal.revision, 'The lead disconnected. Resume the goal to try again.')
  })

/** Only the live turn that received the current objective may report on it. */
export const reportGoal = (access: ToolAccess, input: unknown) =>
  Effect.gen(function* () {
    const report =
      typeof input === 'object' && input !== null && 'status' in input && 'detail' in input && 'turn' in input ? input : undefined
    const status = report?.status
    const detail = typeof report?.detail === 'string' ? report.detail.trim() : ''
    if ((status !== 'progress' && status !== 'complete' && status !== 'blocked') || detail.length === 0 || detail.length > GOAL_LENGTH)
      return yield* new ToolRefused({ message: 'Give a progress update, completion evidence, or a blocker in a short report.' })
    if (typeof report?.turn !== 'string' || report.turn !== access.turnId)
      return yield* new ToolRefused({ message: 'This turn no longer holds the active goal.' })
    const sql = yield* SqlClient.SqlClient
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        const [changed] = yield* sql<{ taskId: string }>`
          UPDATE thread_goals
          SET status = CASE WHEN ${status} = 'progress' THEN 'active' ELSE ${status} END,
            progress = CASE WHEN ${status} = 'progress' THEN ${detail} ELSE progress END,
            detail = CASE WHEN ${status} = 'progress' THEN detail ELSE ${detail} END
          WHERE thread_id = ${access.threadId} AND status = 'active'
            AND EXISTS (SELECT 1 FROM turn_deliveries d WHERE d.id = ${access.turnId ?? null}
              AND d.thread_id = thread_goals.thread_id AND d.provider_session_id = ${access.sessionId}
              AND d.state = 'delivered' AND d.goal_revision = thread_goals.generation)
          RETURNING (SELECT task_id FROM threads WHERE id = thread_id) AS task_id`
        if (changed === undefined) return yield* new ToolRefused({ message: 'This turn no longer holds the active goal.' })
        yield* touchTask(changed.taskId)
        if (status === 'progress') return 'Goal progress recorded.'
        if (status === 'complete') return 'Goal completion and evidence recorded.'
        return 'Goal blocker recorded. Further goal turns are on hold.'
      }),
    )
  })

export const goalBrief = (goal: ThreadGoal, automatic: boolean, turnId: string) =>
  [
    `The person set an Althar goal. Objective: ${JSON.stringify(goal.objective)}`,
    automatic
      ? 'Continue from the current work and evidence. Check what has already been done before taking another action.'
      : 'Prioritize the person’s latest message and keep this goal in view.',
    ...(goal.progress === null ? [] : [`Last progress report: ${JSON.stringify(goal.progress)}`]),
    `Use report_goal with turn ${turnId}. Save a short progress checkpoint when it will help the next turn. Report complete with evidence when the objective is met, or blocked with the reason you cannot proceed.`,
    'Use wait_for_person for a decision or wait_for for an external change where available. A goal report does not finish a workflow step. Continue to use finish_step where the step requires it.',
  ].join('\n')
