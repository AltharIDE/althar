import type { BlockerStanding, TaskCard } from '@althar/contracts'
import type { ActorId, ProjectId } from '@althar/domain'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { touchCard, touchTask } from './cards'
import { fact, timestamp } from './records'

/*
 * Tasks wait for their blockers (docs/decisions/scheduling.md): a task names
 * the tasks it waits for, and its plan starts by itself once they have all
 * merged. Plain blockers, by the person's word: no graph planned and run as a
 * whole. A plan counting down doesn't start on its own while any of them is
 * open, nor once one is abandoned, which waits on the person instead; the
 * person's own Start now still starts it. Each wait is kept in `task_waits`,
 * and said on the task's record (`task.waits_added`, `task.waits_removed`),
 * so its card and those it names are read again. One that merged is cleared
 * once and stays cleared (`cleared_at`, set as it is done), though it opens
 * again for follow-up work later.
 */

/**
 * Whether the plan's task waits for a task not merged yet: open, drafted, or
 * abandoned, and never cleared. SQL over a `task_plans` row, by its alias.
 */
export const blockedIn = (plan: string) =>
  `EXISTS (SELECT 1 FROM task_waits w JOIN tasks b ON b.id = w.on_task_id WHERE w.task_id = ${plan}.task_id AND w.cleared_at IS NULL AND b.state <> 'done')`

/** Whether the task hasn't started: no run made for it yet. SQL over a `tasks` row, by its alias. */
export const unstartedIn = (task: string) => `NOT EXISTS (SELECT 1 FROM runs r WHERE r.task_id = ${task}.id)`

interface Named {
  readonly id: string
  readonly slug: string
  readonly projectId: ProjectId
  readonly state: string
  readonly revision: number
}

const namedOf = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [task] = yield* sql<Named>`SELECT id, slug, project_id, state, revision FROM tasks WHERE id = ${taskId}`
    return task
  })

/** What waiting for a task came to: added, merged already (nothing to wait for), or refused, and why. */
export type WaitOutcome =
  | { readonly on: string; readonly added: true }
  | { readonly on: string; readonly added: false; readonly why: 'waits' | 'merged' }
  | { readonly on: string; readonly refused: string }

/**
 * Makes a task wait for others, each by id, in the order named. Refused: a
 * task of another project, itself, or one that waits for it already, however
 * far along (a cycle would never start). One merged already is nothing to
 * wait for.
 */
export const waitFor = (input: { readonly taskId: string; readonly on: ReadonlyArray<string>; readonly actorId: ActorId }) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const outcomes = yield* sql.withTransaction(
      Effect.gen(function* () {
        const task = yield* namedOf(input.taskId)
        if (task === undefined) return input.on.map((on): WaitOutcome => ({ on, refused: 'There is no such task.' }))
        const said: Array<WaitOutcome> = []
        for (const onId of input.on) {
          const on = yield* namedOf(onId)
          if (on === undefined || on.projectId !== task.projectId) {
            said.push({ on: onId, refused: 'It isn’t a task of this project.' })
            continue
          }
          if (on.id === task.id) {
            said.push({ on: on.slug, refused: 'A task can’t wait for itself.' })
            continue
          }
          if (on.state === 'done') {
            said.push({ on: on.slug, added: false, why: 'merged' })
            continue
          }
          // Whether what it would wait for waits for it, however far along.
          const [loop] = yield* sql<{ id: string }>`
            WITH RECURSIVE up(id) AS (
              SELECT on_task_id FROM task_waits WHERE task_id = ${on.id}
              UNION SELECT w.on_task_id FROM task_waits w JOIN up ON w.task_id = up.id
            )
            SELECT id FROM up WHERE id = ${task.id} LIMIT 1`
          if (loop !== undefined) {
            said.push({ on: on.slug, refused: `${on.slug} waits for ${task.slug} already, so neither would ever start.` })
            continue
          }
          const [had] = yield* sql<{ taskId: string }>`
            SELECT task_id FROM task_waits WHERE task_id = ${task.id} AND on_task_id = ${on.id}`
          if (had !== undefined) {
            said.push({ on: on.slug, added: false, why: 'waits' })
            continue
          }
          yield* sql`INSERT INTO task_waits ${sql.insert({ taskId: task.id, onTaskId: on.id, createdAt: yield* timestamp })}`
          yield* fact({
            projectId: task.projectId,
            aggregateType: 'task',
            aggregateId: task.id,
            revision: task.revision,
            type: 'task.waits_added',
            payload: { on: on.id },
            actorId: input.actorId,
          })
          said.push({ on: on.slug, added: true })
        }
        return said
      }),
    )
    if (outcomes.some((one) => 'added' in one && one.added)) yield* touched(input.taskId, yield* blockersOf(input.taskId))
    return outcomes
  })

/** Stops a task waiting for another. Whether it waited for it. */
export const stopWaiting = (input: { readonly taskId: string; readonly on: string; readonly actorId: ActorId }) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const removed = yield* sql.withTransaction(
      Effect.gen(function* () {
        const task = yield* namedOf(input.taskId)
        if (task === undefined) return false
        const gone = yield* sql<{ taskId: string }>`
          DELETE FROM task_waits WHERE task_id = ${task.id} AND on_task_id = ${input.on} RETURNING task_id`
        if (gone.length === 0) return false
        yield* fact({
          projectId: task.projectId,
          aggregateType: 'task',
          aggregateId: task.id,
          revision: task.revision,
          type: 'task.waits_removed',
          payload: { on: input.on },
          actorId: input.actorId,
        })
        return true
      }),
    )
    if (removed) yield* touched(input.taskId, [input.on])
    return removed
  })

/** The tasks it waits for, by id, in the order they were named. */
export const blockersOf = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{ onTaskId: string }>`
      SELECT on_task_id FROM task_waits WHERE task_id = ${taskId} ORDER BY created_at, rowid`
    return rows.map((row) => row.onTaskId)
  })

/** Its card and thread, and the cards of the tasks it names, read again. */
const touched = (taskId: string, others: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    yield* touchTask(taskId)
    yield* Effect.forEach(others, touchCard, { discard: true })
  })

/**
 * How a task another waits for stands, from its card (waits.ts): before its lead starts, under way (in review once its pull
 * request is open), stuck where it waits on the person or stopped, and in review once it is the person's to merge.
 */
export const blockerStands = (card: Pick<TaskCard, 'phase' | 'change'>): BlockerStanding => {
  switch (card.phase) {
    case 'drafting':
    case 'planned':
    case 'held':
      return 'planned'
    case 'running':
      return card.change?.state === 'open' ? 'review' : 'working'
    case 'waiting':
    case 'stopped':
      return 'stuck'
    case 'ready':
    case 'kept':
      return 'review'
    case 'settled':
      return 'merged'
  }
}
