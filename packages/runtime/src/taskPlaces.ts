import {
  ApiError,
  planUnfitWords,
  workerModelUnfit,
  workerModelWords,
  workerName,
  workerNameOf,
  workerPlanUnfit,
  workerUnfit,
  workerUnfitWords,
} from '@althar/contracts'
import type { ActorId, ProjectId } from '@althar/domain'
import { Effect, Option } from 'effect'
import { SqlClient } from 'effect/sql'

import { touchCard } from './cards'
import { RuntimeConfig } from './Config'
import { NotFound } from './errors'
import { change, fact } from './records'
import type { PlanStep } from './runRecords'
import type { Sessions } from './Sessions'
import { addItem } from './threads'
import { workerRequirementsOf } from './workerRequirements'

/*
 * Moving a task between the home and its workers, and between workers (ADR-103), from its ⋯ menu: between its lead's
 * turns, one under way ending first (the move is kept on its plan, and tried again as its lead finishes), with its work
 * coming along. On a worker, every turn's end brings the work home already, and the move brings it once more, so what
 * the worker had at the end is in the home's worktree; from there the next place gets it as any task's start does. Its
 * plan says where it runs now, and its lead's next turn starts afresh there, handed the work so far. Where the lead's
 * model isn't offered there, the person picks one that is, and the fresh session starts on it.
 */

/** Where a task runs: the home, or one of its workers by id (`wrk_…`). */
export type PlaceTo = string

export type TaskPlaced =
  | { readonly kind: 'placed'; readonly said: string }
  | { readonly kind: 'waits'; readonly why: string }
  | { readonly kind: 'same' }

export interface MovingTo {
  readonly to: PlaceTo
  readonly lead?: { readonly model?: string; readonly effort?: string }
  /** What the task says of it meanwhile. */
  readonly why?: string
}

interface PlanRow {
  readonly id: string
  readonly projectId: ProjectId
  readonly parameters: string
}

const invalid = (message: string) => new ApiError({ reason: 'Invalid', message })

/** The tasks whose move waits for their lead's turn to end, and where to. */
export const placesWaiting = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const rows = yield* sql<{ taskId: string; movingTo: string }>`
    SELECT p.task_id, json_extract(p.parameters, '$.movingTo') AS moving_to FROM task_plans p JOIN tasks k ON k.id = p.task_id
    WHERE p.state = 'accepted' AND json_extract(p.parameters, '$.movingTo') IS NOT NULL AND k.state = 'open'`
  return rows.flatMap((row) => {
    try {
      return [{ taskId: row.taskId, movingTo: JSON.parse(row.movingTo) as MovingTo }]
    } catch {
      return []
    }
  })
})

/** A task's move that waits for its lead's turn to end, where it has one: where to, and what it says meanwhile. */
export const placingOf = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [row] = yield* sql<{ movingTo: string | null }>`
      SELECT json_extract(parameters, '$.movingTo') AS moving_to FROM task_plans WHERE task_id = ${taskId} AND state = 'accepted'
      ORDER BY decided_at DESC, rowid DESC LIMIT 1`
    if (row?.movingTo == null) return undefined
    try {
      const moving = JSON.parse(row.movingTo) as MovingTo
      return { to: moving.to, why: moving.why ?? 'Moves once its lead’s turn ends.' }
    } catch {
      return undefined
    }
  })

export const makeTaskPlaces = ({ sessions }: { readonly sessions: Sessions['Service'] }) => {
  /** Rewrites the task's running run's and accepted plan's parameters, each said as a fact. */
  const rewrite = (taskId: string, update: (parameters: Record<string, unknown>) => Record<string, unknown>, actorId: ActorId) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const rows = yield* sql<{ table: 'runs' | 'task_plans'; id: string; projectId: ProjectId; parameters: string }>`
        SELECT 'runs' AS "table", id, project_id, parameters FROM runs WHERE task_id = ${taskId} AND state = 'running'
        UNION ALL
        SELECT 'task_plans' AS "table", id, project_id, parameters FROM task_plans WHERE task_id = ${taskId} AND state = 'accepted'`
      for (const row of rows) {
        const parameters = update(JSON.parse(row.parameters) as Record<string, unknown>)
        const revision = yield* change(row.table, row.id, { parameters: JSON.stringify(parameters) })
        yield* fact({
          projectId: row.projectId,
          aggregateType: row.table === 'runs' ? 'run' : 'task_plan',
          aggregateId: row.id,
          revision,
          type: row.table === 'runs' ? 'run.plan_changed' : 'task_plan.changed',
          payload: { workerId: parameters.workerId ?? null },
          actorId,
        })
      }
    })

  /**
   * Moves a task where the person asked: at once between its lead's turns, else once the one under way ends. Refused,
   * with words, where it can't go: a worker that isn't ready for it, or a lead whose model isn't offered there.
   */
  const place = (input: { readonly taskId: string; readonly to: PlaceTo; readonly lead?: MovingTo['lead']; readonly actorId: ActorId }) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const config = yield* RuntimeConfig
      const [task] = yield* sql<{ projectId: ProjectId; threadId: string; state: string }>`
        SELECT k.project_id, t.id AS thread_id, k.state FROM tasks k JOIN threads t ON t.task_id = k.id AND t.kind = 'task'
        WHERE k.id = ${input.taskId}`
      if (task === undefined) return yield* new NotFound({ kind: 'task', id: input.taskId })
      const [plan] = yield* sql<PlanRow>`
        SELECT id, project_id, parameters FROM task_plans WHERE task_id = ${input.taskId} AND state = 'accepted'
        ORDER BY decided_at DESC, rowid DESC LIMIT 1`
      if (task.state !== 'open' || plan === undefined)
        return yield* invalid('Only a task under way moves. Choose where one runs on its plan before it starts.')
      const parameters = JSON.parse(plan.parameters) as {
        readonly workerId?: string
        readonly steps: ReadonlyArray<PlanStep>
        readonly worksIn?: 'worktree' | 'checkout'
        readonly here?: boolean
        readonly reads?: boolean
        readonly movingTo?: MovingTo
      }
      const from: PlaceTo = parameters.workerId ?? 'home'
      const workers = config.workers?.list(task.projectId) ?? []
      const nameOf = (place: PlaceTo) =>
        place === 'home'
          ? 'this home'
          : (() => {
              const worker = workers.find((one) => one.workerId === place)
              return worker === undefined ? workerNameOf(place) : workerName(worker)
            })()
      // Back where it is: a move that waited is called off.
      if (from === input.to) {
        if (parameters.movingTo !== undefined)
          yield* sql.withTransaction(rewrite(input.taskId, ({ movingTo: _gone, ...rest }) => rest, input.actorId))
        return { kind: 'same' } as TaskPlaced
      }
      const steps =
        input.lead?.model === undefined
          ? parameters.steps
          : parameters.steps.map((step) => (step.key === 'implement' ? { ...step, model: input.lead?.model ?? step.model } : step))
      if (input.to !== 'home') {
        const requirements = yield* workerRequirementsOf(input.taskId, {
          homeOnly: parameters.here === true,
          readOnly: parameters.reads === true,
        })
        const kept = workerPlanUnfit(requirements, parameters.worksIn, steps)
        if (kept !== undefined) return yield* invalid(planUnfitWords(kept))
        const worker = workers.find((one) => one.workerId === input.to)
        const unfit = workerUnfit(worker, steps, requirements.repositoryCount)
        if (unfit !== undefined) return yield* invalid(workerUnfitWords(unfit, nameOf(input.to)))
        const model = workerModelUnfit(worker, steps)
        if (model !== undefined) return yield* invalid(workerModelWords(nameOf(input.to), model.model))
      }
      // Between its lead's turns: one under way ends first, and the move is tried again as it does.
      const lead = yield* sessions.running(task.threadId)
      if (Option.isSome(lead) && lead.value.turnRunning) {
        const why = `Moves to ${nameOf(input.to)} once its lead’s turn ends.`
        const movingTo: MovingTo = { to: input.to, why, ...(input.lead === undefined ? {} : { lead: input.lead }) }
        yield* sql.withTransaction(rewrite(input.taskId, (now) => ({ ...now, movingTo }), input.actorId))
        yield* touchCard(input.taskId)
        return { kind: 'waits', why } as TaskPlaced
      }
      // Its work comes along: from a worker, brought home once more, where every turn's end has brought it already.
      let behind = false
      if (from !== 'home') {
        const checkpoint = config.workers?.checkpointWorktree
        const folders = yield* sql<{ path: string }>`SELECT path FROM workspaces WHERE task_id = ${input.taskId} AND access = 'write'`
        for (const folder of folders) {
          const saved =
            checkpoint === undefined
              ? undefined
              : yield* Effect.exit(checkpoint({ workerId: from, projectId: task.projectId, worktree: folder.path }))
          if (saved === undefined || saved._tag === 'Failure') behind = true
        }
      }
      yield* sql.withTransaction(
        rewrite(
          input.taskId,
          ({ workerId: _was, movingTo: _done, ...rest }) => ({
            ...rest,
            steps: (rest.steps as ReadonlyArray<PlanStep> | undefined)?.map((step) =>
              step.key === 'implement' && input.lead !== undefined
                ? {
                    ...step,
                    ...(input.lead.model === undefined ? {} : { model: input.lead.model }),
                    ...(input.lead.effort === undefined ? {} : { effort: input.lead.effort }),
                  }
                : step,
            ),
            ...(input.to === 'home' ? {} : { workerId: input.to }),
          }),
          input.actorId,
        ),
      )
      // Its lead's next turn starts afresh where it runs now, on the model picked for there.
      yield* sessions.moved(task.threadId, input.lead)
      const said =
        `Moved to ${nameOf(input.to)}: its lead carries on there.` +
        (behind ? ` Its work came along as of its lead’s last turn on ${nameOf(from)}, which didn’t answer just now.` : '')
      yield* addItem({ projectId: task.projectId, threadId: task.threadId }, 'notice', {
        source: 'runtime',
        severity: behind ? 'warning' : 'info',
        title: said,
      })
      yield* touchCard(input.taskId)
      return { kind: 'placed', said } as TaskPlaced
    })

  return { place }
}
