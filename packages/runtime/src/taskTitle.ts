import type { CommandEnvelope, ProjectId } from '@althar/domain'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { touchCard } from './cards'
import { NotFound, TaskRefused } from './errors'
import { change, fact } from './records'
import { indexTask } from './Search'

/** How long a task's title may be: it is read in a line, beside other things, on every screen. */
export const TITLE_LENGTH = 60

/*
 * A task's title written, with who wrote it: by the person's, the
 * coordinator's or a lead's word. Its slug, its branch and its worktree's
 * folder were made from the first title, and other things find them by it,
 * so they stay. Whether its pull request follows is the caller's: Tasks'
 * rename has it follow, and a lead's or the coordinator's edit of the pull
 * request comes here once the host took it.
 */
export const retitleTask = (input: { readonly envelope: CommandEnvelope; readonly taskId: string; readonly title: string }) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const title = input.title.trim()
    if (title === '') return yield* new TaskRefused({ taskId: input.taskId, why: 'no_title' })
    if (title.length > TITLE_LENGTH) return yield* new TaskRefused({ taskId: input.taskId, why: 'title_too_long' })
    const renamed = yield* sql.withTransaction(
      Effect.gen(function* () {
        const [task] = yield* sql<{ projectId: ProjectId; title: string }>`SELECT project_id, title FROM tasks WHERE id = ${input.taskId}`
        if (task === undefined) return yield* new NotFound({ kind: 'task', id: input.taskId })
        if (task.title === title) return false
        const revision = yield* change('tasks', input.taskId, { title })
        yield* fact({
          projectId: task.projectId,
          aggregateType: 'task',
          aggregateId: input.taskId,
          revision,
          type: 'task.renamed',
          payload: { title, was: task.title },
          actorId: input.envelope.actorId,
          commandId: input.envelope.commandId,
        })
        yield* indexTask(input.taskId)
        return true
      }),
    )
    if (renamed) yield* touchCard(input.taskId)
    return renamed
  })
