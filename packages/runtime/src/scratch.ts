import type { ActorId, ProjectId } from '@althar/domain'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { touchTask } from './cards'
import { NotFound } from './errors'
import { change, fact } from './records'

/*
 * Chats and Scratch (a task is a conversation plus parts). A chat is a task
 * with a conversation and a copy of the default branch, and nothing else: no
 * plan to wait on, no countdown, no Checked by. It sits on Scratch
 * (`tasks.shelf`), off the board's lanes, listed by its latest exchange, and
 * never waits in Needs you for being finished; its questions and permission
 * requests still do. It moves to the board as soon as it takes a worktree or
 * an output (cards.ts), and the person can move any task either way.
 */

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
    yield* touchTask(taskId)
  })
