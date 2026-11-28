import type { ApiHandlers } from '@althar/contracts'
import type { ProjectId } from '@althar/domain'
import type { Ledger } from '@althar/persistence-sqlite'
import { type Crypto, Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { Changes } from '../Changes'
import type { Instance } from '../Instance'
import { Issues } from '../Issues'
import { Permissions } from '../Permissions'
import { Projects } from '../Projects'
import { Queries } from '../Queries'
import { Busy } from '../Busy'
import { Setups } from '../Setups'
import { TaskActions } from '../TaskActions'
import { shelve } from '../scratch'
import { FastLane } from '../fastLane'
import { Plans } from '../Plans'
import { Runs } from '../Runs'
import { Tasks } from '../Tasks'
import { upNextMove } from '../upNextMoves'
import { issuesOf, requestOf, type ApiKit } from './kit'

/**
 * A task as a whole: listing and making them, the board and its pages, and its lifecycle (stop, resume, abandon, done, reopen, rename, shelve).
 * Where it stands in line and where it works (Up next, start anyway, worktree or Local), and its shape.
 */
export const tasksHandlers = ({ actorId, api, envelope, issueFor }: ApiKit) =>
  Effect.gen(function* () {
    const projects = yield* Projects
    const permissions = yield* Permissions
    const queries = yield* Queries
    const plans = yield* Plans
    const fastLane = yield* FastLane
    const runs = yield* Runs
    const tasks = yield* Tasks
    const sql = yield* SqlClient.SqlClient
    // What bringing a task's removed folder back needs (ADR-056).
    const folderStore = yield* Effect.context<SqlClient.SqlClient | Ledger | Instance | Crypto.Crypto>()
    const setups = yield* Setups
    const issues = yield* Issues
    const pullRequests = yield* Changes
    const busy = yield* Busy
    const taskActions = yield* TaskActions
    return {
      ListTasks: ({ projectId }) => api(queries.tasks(projectId)),
      CreateTask: ({ commandId, projectId, title, description, issue: named, issues: others, repositories }) =>
        api(
          Effect.gen(function* () {
            const all = issuesOf(named, others)
            const issue = all[0]
            const from = yield* issueFor(projectId, issue)
            // Each is read before the task is made, so one no tracker has makes no task.
            yield* Effect.forEach(all.slice(1), (one) => issues.read(one, projectId), { concurrency: 4, discard: true })
            const created = yield* projects.createTask({
              envelope: yield* envelope('task.create', { projectId, title, description, issue }, commandId),
              projectId,
              title,
              ...(description === undefined ? {} : { description }),
              ...(from === undefined ? {} : { issueKey: from.key }),
              ...(repositories === undefined ? {} : { repositories }),
              ...requestOf(title, description, issue),
            })
            for (const one of all) yield* issues.attach({ projectId: projectId as ProjectId, taskId: created.taskId, issue: one })
            return yield* queries.task(created.taskId)
          }),
        ),
      GetBoard: ({ projectId, cached }) => api(queries.board(projectId, cached)),
      GetOlderSettled: ({ projectId, before, taskId }) =>
        api(Effect.map(queries.olderSettled(projectId, before, taskId), (tasks) => ({ tasks }))),
      // The person opened a task: when, kept. It moves nothing: a finished task waits for them to settle it.
      SeeTask: ({ taskId }) => api(tasks.see({ taskId })),
      SettledWithOnePress: ({ taskId, attentionId, action }) =>
        api(tasks.pressed({ ...(taskId === undefined ? {} : { taskId }), ...(attentionId === undefined ? {} : { attentionId }), action })),
      // One that no longer waits up next, started or held meanwhile, moves nowhere: the board shows the line as it is.
      MoveInLine: ({ taskId, to }) => api(Effect.asVoid(upNextMove(busy, plans, sql)(taskId, to, actorId))),
      LineOldestFirst: ({ projectId }) => api(busy.oldestFirst(projectId)),
      StartAnyway: ({ taskId }) => api(busy.startNow(taskId)),
      MakeItAFullTask: ({ taskId }) => api(fastLane.makeFullTask(taskId)),
      SetTaskAllowEverything: ({ commandId, taskId, allowEverything }) =>
        api(
          Effect.flatMap(envelope('task.set_allow_everything', { taskId, allowEverything }, commandId), (said) =>
            permissions.allowEverything({ envelope: said, taskId, on: allowEverything }),
          ),
        ),
      StopTask: ({ commandId, taskId }) =>
        api(
          Effect.flatMap(envelope('task.stop', { taskId }, commandId), (said) =>
            Effect.andThen(tasks.stop({ envelope: said, taskId }), pullRequests.leadStopped({ taskId })),
          ),
        ),
      ResumeTask: ({ commandId, taskId, agentId, model, effort }) =>
        api(
          Effect.flatMap(envelope('task.resume', { taskId, agentId }, commandId), (said) =>
            tasks.resume({
              envelope: said,
              taskId,
              // The agent the person picked, else its last lead.
              ...(agentId === undefined ? {} : { lead: { agentId, model: model ?? null, effort: effort ?? null } }),
            }),
          ),
        ),
      AbandonTask: ({ commandId, taskId }) =>
        api(Effect.flatMap(envelope('task.abandon', { taskId }, commandId), (said) => tasks.abandon({ envelope: said, taskId }))),
      MarkTaskDone: ({ commandId, taskId }) =>
        api(
          Effect.asVoid(
            // The person's own press: an aside settles as it stands, as its pill's × says (Tasks.markDone's `clear`).
            Effect.flatMap(envelope('task.mark_done', { taskId }, commandId), (said) =>
              tasks.markDone({ envelope: said, taskId, clear: true }),
            ),
          ),
        ),
      KeepTaskForLater: ({ commandId, taskId }) =>
        api(Effect.asVoid(Effect.flatMap(envelope('task.keep', { taskId }, commandId), (said) => tasks.keep({ envelope: said, taskId })))),
      RenameTask: ({ commandId, taskId, title }) =>
        api(
          Effect.flatMap(envelope('task.rename', { taskId, title }, commandId), (said) =>
            Effect.asVoid(tasks.rename({ envelope: said, taskId, title })),
          ),
        ),
      ReopenTask: ({ commandId, taskId }) =>
        api(Effect.flatMap(envelope('task.reopen', { taskId }, commandId), (said) => tasks.reopen({ envelope: said, taskId }))),
      MoveTask: ({ commandId, taskId, to, change, consent }) =>
        api(
          Effect.flatMap(envelope('task.move', { taskId, to }, commandId), (said) =>
            runs.move({
              envelope: said,
              taskId,
              to,
              ...(change === undefined ? {} : { change }),
              ...(consent === undefined ? {} : { consent }),
            }),
          ),
        ),
      ShelveTask: ({ commandId, taskId, shelf }) =>
        api(
          Effect.flatMap(envelope('task.shelve', { taskId, shelf }, commandId), (said) =>
            Effect.provideContext(shelve(taskId, shelf, said.actorId), folderStore).pipe(
              // An aside made a task is work now: its copy, never set up as an aside, is set up behind, before its next turn.
              Effect.andThen(shelf === null ? setups.begin(taskId) : Effect.void),
            ),
          ),
        ),
      MoveTaskTo: ({ commandId, taskId, to, lead, fromLastTurn }) =>
        api(
          Effect.flatMap(envelope('task.place', { taskId, to }, commandId), (said) =>
            runs.place({
              envelope: said,
              taskId,
              to,
              ...(lead === undefined
                ? {}
                : {
                    lead: {
                      ...(lead.model === undefined ? {} : { model: lead.model }),
                      ...(lead.effort === undefined ? {} : { effort: lead.effort }),
                    },
                  }),
              ...(fromLastTurn === true ? { fromLastTurn: true } : {}),
            }),
          ),
        ),
      DropMove: ({ commandId, taskId }) =>
        api(Effect.flatMap(envelope('task.drop_move', { taskId }, commandId), (said) => runs.dropMove({ envelope: said, taskId }))),
      ShapeTask: ({ taskId, preset }) => api(taskActions.shape(taskId, preset, actorId)),
    } satisfies Partial<ApiHandlers>
  })
