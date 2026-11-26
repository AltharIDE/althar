import type { ApiHandlers } from '@althar/contracts'
import { Effect } from 'effect'

import { Queries } from '../Queries'
import { findTasks } from '../Search'
import { searchDocuments } from '../searchDocuments'
import { findDocuments } from '../finderIndex'
import { searchFiles } from '../searchFiles'
import { Sessions } from '../Sessions'
import type { ApiKit } from './kit'

/**
 * Finding and reading what work touched: searching tasks, documents and files, and the code a thread names.
 * A task's diff, its review findings and the line comments on it.
 */
export const searchHandlers = ({ api }: ApiKit) =>
  Effect.gen(function* () {
    const sessions = yield* Sessions
    const queries = yield* Queries
    return {
      GetSearchDocuments: ({ after, search }) =>
        api(
          Effect.gen(function* () {
            const working = new Set((yield* sessions.onTasks).flatMap((one) => (one.turnRunning ? [one.taskId] : [])))
            return yield* search === undefined ? searchDocuments(after, working) : findDocuments(search, working)
          }),
        ),
      GetSearchFiles: ({ threadId }) => api(Effect.flatMap(queries.codeRoots(threadId), searchFiles)),
      SearchTasks: ({ projectId, text, limit }) =>
        api(
          Effect.gen(function* () {
            const working = new Set((yield* sessions.onTasks).flatMap((session) => (session.turnRunning ? [session.taskId] : [])))
            const input = { text, ...(projectId === undefined ? {} : { projectId }), ...(limit === undefined ? {} : { limit }) }
            return { tasks: yield* findTasks(input, working) }
          }),
        ),
      FindCode: ({ threadId, messages }) => api(queries.findCode(threadId, messages)),
      ReadCode: ({ threadId, path, commit, line, image }) =>
        api(image === true ? queries.readCodeImage(threadId, path) : queries.readCode(threadId, path, commit, line)),
      GetFileDiff: ({ taskId, path, untouched }) => api(queries.fileDiff(taskId, path, untouched === true)),
      GetTaskFindings: ({ taskId, review }) => api(queries.findings(taskId, review)),
      GetLineComments: ({ taskId }) => api(queries.lineComments(taskId)),
    } satisfies Partial<ApiHandlers>
  })
