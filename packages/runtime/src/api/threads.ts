import { type ApiHandlers, ApiError, type GoalControl, goalCommand } from '@althar/contracts'
import type { Commands, Ledger } from '@althar/persistence-sqlite'
import { type Crypto, Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { controlGoal, goalLine, goalThread, readGoal } from '../threadGoals'
import { addItem } from '../threads'
import { Issues } from '../Issues'
import { Queries } from '../Queries'
import { clearView, showEarlier, undoClearView } from '../chatView'
import { Coordinator } from '../Coordinator'
import { Tasks } from '../Tasks'
import { Sessions } from '../Sessions'
import type { ApiKit } from './kit'

/**
 * A thread's items and what they hold: pages of items, one or several items, a command's output, a document.
 * Saying something to a thread, taking it back, its goal; clearing its view and showing what came earlier.
 */
export const threadsHandlers = ({ sender, api, envelope, keptFor, imagesSaid, filesFor, filesSaid, commentsFor, commentsSaid }: ApiKit) =>
  Effect.gen(function* () {
    const sessions = yield* Sessions
    const queries = yield* Queries
    const tasks = yield* Tasks
    const coordinator = yield* Coordinator
    const sql = yield* SqlClient.SqlClient
    // What writes a project's notes needs, as the services have it.
    const store = yield* Effect.context<SqlClient.SqlClient | Ledger | Commands | Crypto.Crypto>()
    const issues = yield* Issues
    const personSetsGoal = sender.kind === 'window' || sender.kind === 'paired_device'
    const setThreadGoal = (
      threadId: string,
      control: GoalControl,
      lead?: { readonly agentId: string; readonly model?: string | undefined; readonly effort?: string | undefined },
    ) =>
      Effect.gen(function* () {
        if (!personSetsGoal)
          return yield* new ApiError({ reason: 'Forbidden', message: 'Set goals from Althar’s window or a paired device.' })
        const choice =
          lead === undefined
            ? undefined
            : {
                agentId: lead.agentId,
                ...(lead.model === undefined ? {} : { model: lead.model }),
                ...(lead.effort === undefined ? {} : { effort: lead.effort }),
              }
        const result = yield* Effect.provideContext(controlGoal(threadId, control, choice), store)
        if (!result.changed) return result.goal
        // What changed is said in the thread, as Althar's line: the person sees it there, as the lead and anyone reading after do.
        yield* Effect.provideContext(
          addItem({ projectId: result.projectId, threadId }, 'notice', {
            source: 'runtime',
            severity: 'info',
            title: goalLine(control, result.before, result.goal),
          }),
          store,
        )
        if (result.stopping !== undefined) yield* sessions.cancelGoalRound(threadId, result.stopping)
        if (result.goal?.status === 'active') yield* sessions.kickGoal(threadId, result.goal.revision, choice)
        return result.goal
      })
    return {
      GetThread: ({ threadId, before, limit, fresh }) =>
        api(
          queries.thread(threadId, {
            ...(before === undefined ? {} : { before }),
            ...(limit === undefined ? {} : { limit }),
            ...(fresh === true ? { fresh } : {}),
          }),
        ),
      GetThreadItem: ({ threadId, itemId }) => api(queries.shown(threadId, itemId)),
      // What a burst of changes touched, in one call: each as GetThreadItem reads it, the ones the thread shows. One gone
      // since is left out on its own, as one it keeps for Althar is, rather than failing the rest.
      GetThreadItems: ({ threadId, itemIds }) =>
        api(
          Effect.map(
            Effect.forEach(new Set(itemIds), (itemId) =>
              queries.shown(threadId, itemId).pipe(Effect.catchTag('NotFound', () => Effect.succeed(null))),
            ),
            (found) => found.filter((item) => item !== null),
          ),
        ),
      ReadOutput: ({ threadId, itemId }) => api(queries.output(threadId, itemId)),
      ReadDocument: ({ threadId, path }) => api(queries.document(threadId, path)),
      ClearView: ({ commandId, threadId }) =>
        api(
          Effect.flatMap(envelope('thread.clear_view', { threadId }, commandId), (made) =>
            Effect.provideContext(clearView({ envelope: made, threadId }), store),
          ),
        ),
      ShowEarlier: ({ commandId, threadId, open }) =>
        api(
          Effect.flatMap(envelope('thread.show_earlier', { threadId, open }, commandId), (made) =>
            Effect.provideContext(showEarlier({ envelope: made, threadId, open }), store),
          ),
        ),
      UndoClearView: ({ commandId, threadId }) =>
        api(
          Effect.flatMap(envelope('thread.undo_clear_view', { threadId }, commandId), (made) =>
            Effect.provideContext(undoClearView({ envelope: made, threadId }), store),
          ),
        ),
      SetThreadGoal: ({ threadId, control, lead }) => api(setThreadGoal(threadId, control, lead)),
      Send: ({ commandId, threadId, body, disposition, images, files, dictated, comments, canvasComments }) =>
        api(
          sessions.accepting(
            threadId,
            Effect.gen(function* () {
              const goal = goalCommand(body)
              if (goal !== undefined) {
                const task = yield* goalThread(threadId)
                if (task !== undefined) {
                  if (!personSetsGoal)
                    return yield* new ApiError({ reason: 'Forbidden', message: 'Set goals from Althar’s window or a paired device.' })
                  if ([images, files, comments, canvasComments].some((parts) => (parts?.length ?? 0) > 0))
                    return yield* new ApiError({ reason: 'Invalid', message: 'Send attachments in a message alongside the goal.' })
                  if (goal.action !== 'show') yield* setThreadGoal(threadId, goal)
                  else {
                    const current = yield* readGoal(threadId)
                    yield* Effect.provideContext(
                      addItem({ projectId: task.projectId, threadId }, 'notice', {
                        source: 'runtime',
                        severity: 'info',
                        title: current === null ? 'Set an objective with /goal.' : `Goal · ${current.waiting ? 'waiting' : current.status}`,
                        ...(current === null ? {} : { description: current.objective }),
                      }),
                      store,
                    )
                  }
                  return
                }
              }
              // Its images and files are read, checked and kept first, outside the command's transaction: one that can't be sent refuses the message.
              const kept = images === undefined || images.length === 0 ? [] : yield* keptFor(threadId, images)
              const copied = yield* filesFor(threadId, files)
              // Its comments on the diff, each with the files as they are now, so a commit since can be told to change their lines.
              const commented = yield* commentsFor(threadId, comments)
              const message = {
                // The command says its images by their digests, never their bytes, and how many files and comments, never their paths.
                envelope: yield* envelope(
                  'thread.send',
                  {
                    threadId,
                    body,
                    disposition,
                    ...imagesSaid(kept),
                    ...filesSaid(copied),
                    ...commentsSaid(commented),
                    ...(dictated === true ? { dictated } : {}),
                    ...(canvasComments === undefined || canvasComments.length === 0 ? {} : { canvasComments }),
                  },
                  commandId,
                ),
                threadId,
                body,
                sender,
                disposition,
                ...(kept.length === 0 ? {} : { images: kept }),
                ...(copied.length === 0 ? {} : { files: copied }),
                ...(commented.length === 0 ? {} : { comments: commented }),
                ...(dictated === true ? { dictated } : {}),
                ...(canvasComments === undefined || canvasComments.length === 0 ? {} : { canvasComments }),
              }
              // What the person says to the coordinator starts it, if it isn't running.
              const [thread] = yield* sql<{ kind: string; taskId: string | null }>`SELECT kind, task_id FROM threads WHERE id = ${threadId}`
              if (thread?.kind === 'coordinator') yield* coordinator.say(message)
              else {
                // Written to again, a task kept for later is back: what its lead does next ends in Needs you.
                if (thread?.kind === 'task' && thread.taskId !== null) yield* tasks.bringBack(thread.taskId)
                yield* sessions.send(message)
              }
              // Links in what the person said unfurl on their message, without holding up the reply.
              yield* Effect.forkDetach(issues.unfurlInput(commandId))
            }),
          ),
        ),
      TakeBack: ({ commandId, itemId }) =>
        api(
          Effect.gen(function* () {
            yield* sessions.takeBack({ envelope: yield* envelope('thread.take_back', { itemId }, commandId), itemId })
          }),
        ),
    } satisfies Partial<ApiHandlers>
  })
