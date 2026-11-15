import type { ActorId, ProjectId } from '@althar/domain'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { leftAsides, touchTask } from './cards'
import { NotFound } from './errors'
import { change, fact } from './records'

/*
 * Asides (a task is a conversation plus parts). An aside is a chat: a task
 * with a conversation and a copy of the default branch, and nothing else: no
 * plan to wait on, no countdown, no Checked by. It sits on Scratch
 * (`tasks.shelf`), off the board's lanes, listed by its latest exchange, and
 * never waits in Needs you for being finished; its questions and permission
 * requests still do. It moves to the board as soon as it takes a worktree or
 * an output (cards.ts), and the person can move any task either way.
 */

/**
 * Whether a task is an aside: on Scratch. An aside never installs, builds or runs its repository's setup (docs/decisions/tasks.md,
 * "Asides"): its copy is read as it was made, and work that needs a build makes it a task.
 */
export const onScratch = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [task] = yield* sql<{ shelf: string | null }>`SELECT shelf FROM tasks WHERE id = ${taskId}`
    return task?.shelf === 'scratch'
  })

/** What an aside's lead is told where it asks for an install, a build or the project running. */
export const ASIDE_BUILDS =
  "This is an aside: its copy has nothing installed, and an aside never installs, upgrades dependencies, runs the project's setup or builds, so it answers fast. Answer from what you can read. Where the person's question needs an install, a build, tests run or the project running, tell them it becomes a task, which they make with Make it a task over the composer: its lead gets its worktree set up and runs it."

/** Puts a task on Scratch, or on the board with null, as the person or the coordinator says. */
export const shelve = (taskId: string, shelf: 'scratch' | null, actorId: ActorId) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [task] = yield* sql<{ projectId: ProjectId; shelf: string | null }>`SELECT project_id, shelf FROM tasks WHERE id = ${taskId}`
    if (task === undefined) return yield* new NotFound({ kind: 'task', id: taskId })
    if (task.shelf === shelf) return
    yield* sql.withTransaction(
      Effect.gen(function* () {
        const revision = yield* change('tasks', taskId, { shelf })
        yield* fact({
          projectId: task.projectId,
          aggregateType: 'task',
          aggregateId: taskId,
          revision,
          type: 'task.shelved',
          payload: { shelf },
          actorId,
        })
      }),
    )
    // Off Scratch, the coordinator's conversation says so where its asides sat.
    if (task.shelf === 'scratch' && shelf === null) yield* leftAsides(task.projectId, taskId)
    yield* touchTask(taskId)
  })
