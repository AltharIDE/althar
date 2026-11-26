import type { ApiHandlers } from '@althar/contracts'
import type { ProjectId } from '@althar/domain'
import type { Ledger } from '@althar/persistence-sqlite'
import { type Crypto, Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { Agents } from '../Config'
import { modelNamer } from '../coordinatorNews'
import { teamChanges, teamLine } from '../teamWords'
import { addItem } from '../threads'
import type { Instance } from '../Instance'
import { Models } from '../Models'
import { Queries } from '../Queries'
import { TaskActions } from '../TaskActions'
import { Helpers } from '../Helpers'
import { Runs } from '../Runs'
import { Sessions } from '../Sessions'
import { stopWaiting } from '../waits'
import type { ApiKit } from './kit'

/**
 * The coordinator's own thread and the team on a task: its thread, forgetting its conversation, the cards it asks the person.
 * Who leads and reviews, helpers, a task waiting for another, and the branch a task works toward.
 */
export const coordinatorHandlers = ({ actorId, api, envelope }: ApiKit) =>
  Effect.gen(function* () {
    const sessions = yield* Sessions
    const queries = yield* Queries
    const models = yield* Models
    const helpers = yield* Helpers
    const runs = yield* Runs
    const sql = yield* SqlClient.SqlClient
    // What bringing a task's removed folder back needs (ADR-056).
    const folderStore = yield* Effect.context<SqlClient.SqlClient | Ledger | Instance | Crypto.Crypto>()
    const agents = yield* Agents
    const taskActions = yield* TaskActions
    return {
      AnswerTaskAsk: ({ itemId, yes }) => api(taskActions.answer(itemId, yes, actorId)),
      ForgetConversation: ({ commandId, threadId }) =>
        api(
          Effect.flatMap(envelope('thread.forget_conversation', { threadId }, commandId), (made) =>
            sessions.forget({ envelope: made, threadId }),
          ),
        ),
      GetCoordinator: ({ projectId, before, limit }) =>
        api(queries.coordinator(projectId, { ...(before === undefined ? {} : { before }), ...(limit === undefined ? {} : { limit }) })),
      // Its plan, waiting for nothing else now, starts as planned: the countdown hears the record change.
      StopWaiting: ({ taskId, on }) => api(Effect.asVoid(Effect.provideContext(stopWaiting({ taskId, on, actorId }), folderStore))),
      ChangeTeam: ({ taskId, steps }) =>
        api(
          Effect.gen(function* () {
            const changed = yield* runs.changeTeam({ taskId, steps, actorId: actorId })
            const named = yield* modelNamer.pipe(Effect.provideService(Agents, agents), Effect.provideService(Models, models))
            const [thread] = yield* sql<{ id: string; projectId: ProjectId }>`
                SELECT id, project_id FROM threads WHERE task_id = ${taskId} AND kind = 'task'`
            if (thread === undefined) return
            // Each change, said in the task's thread as the person made it.
            for (const line of teamChanges(changed, named))
              yield* Effect.provideContext(
                addItem({ projectId: thread.projectId, threadId: thread.id }, 'notice', {
                  source: 'runtime',
                  severity: 'info',
                  title: `You ${teamLine(line)}`,
                }),
                folderStore,
              )
          }),
        ),
      WorkToward: ({ taskId, toward }) => api(runs.workToward({ taskId, toward })),
      StopHelper: ({ taskId, helper }) => api(Effect.asVoid(helpers.stop({ taskId, helper, by: 'person' }))),
    } satisfies Partial<ApiHandlers>
  })
