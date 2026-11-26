import type { ApiHandlers, Attachment } from '@althar/contracts'
import { Effect } from 'effect'

import { Changes } from '../Changes'
import { ChangeRefused } from '../errors'
import { PullRequestScreenshots } from '../PullRequestScreenshots'
import { Runs } from '../Runs'
import { Tasks } from '../Tasks'
import type { ApiKit } from './kit'

/**
 * A task's change on its way out: opening it, shipping, pushing, merging, and its pull request.
 * Conflicts with the default branch, its commits, and joining or dropping its changes.
 */
export const changesHandlers = ({ actorId, api, envelope }: ApiKit) =>
  Effect.gen(function* () {
    const runs = yield* Runs
    const tasks = yield* Tasks
    const pullRequests = yield* Changes
    const screenshots = yield* PullRequestScreenshots
    return {
      SetTaskResolveConflicts: ({ commandId, taskId, resolveConflicts }) =>
        api(
          Effect.flatMap(envelope('task.set_conflicts', { taskId, resolveConflicts }, commandId), (said) =>
            pullRequests.setResolveConflicts({ envelope: said, taskId, resolveConflicts }),
          ),
        ),
      // The person's Resolve now: asked of its lead whatever stood in the way (ADR-030).
      ResolveConflictsNow: ({ taskId }) => api(pullRequests.resolveNow({ taskId }, true)),
      LookForConflicts: ({ projectId }) => api(pullRequests.resolveNow({ projectId })),
      LeaveOutCommits: ({ commandId, taskId }) =>
        api(Effect.flatMap(envelope('task.leave_out', { taskId }, commandId), (said) => tasks.leaveOut({ envelope: said, taskId }))),
      JoinChanges: ({ taskId, change, into }) => api(pullRequests.joinChanges(taskId, change, into ?? null, actorId)),
      DropChange: ({ taskId, change }) => api(pullRequests.dropChange(taskId, change, actorId)),
      MarkReady: ({ taskId, url }) => api(pullRequests.markReady(taskId, url)),
      PostScreenshots: ({ taskId, url, leftOut }) => api(screenshots.post({ taskId, url, leftOut })),
      OpenChange: ({ taskId }) => api(runs.publish(taskId)),
      Ship: ({ commandId, taskId, change, route }) =>
        api(
          Effect.flatMap(envelope('task.ship', { taskId, change: change ?? null, route: route ?? null }, commandId), (said) =>
            runs.ship({
              envelope: said,
              taskId,
              ...(change === undefined ? {} : { change }),
              ...(route === undefined ? {} : { route }),
            }),
          ),
        ),
      RouteShip: ({ commandId, taskId, route }) =>
        api(
          Effect.flatMap(envelope('task.route_ship', { taskId, route }, commandId), (said) =>
            Effect.asVoid(runs.routeShip({ envelope: said, taskId, route })),
          ),
        ),
      Merge: ({ commandId, taskId, head, url, how, bypassQueue }) =>
        api(
          bypassQueue === true && how !== undefined
            ? Effect.fail(new ChangeRefused({ message: 'Ship the waiting commits before merging without the queue.' }))
            : how === undefined
              ? pullRequests.merge(taskId, head, url, bypassQueue)
              : Effect.flatMap(envelope('task.merge', { taskId, how }, commandId), (said) =>
                  runs.mergeWaiting({ envelope: said, taskId, how, ...(url === undefined ? {} : { url }) }),
                ),
        ),
      ClosePullRequest: ({ taskId, url, deleteBranch }) =>
        api(Effect.map(pullRequests.close(taskId, url, { deleteBranch }), ({ branch }) => ({ branch }))),
      MergeHere: ({ taskId, heads }) => api(Effect.asVoid(pullRequests.mergeHere(taskId, heads))),
      Push: ({ taskId, head, url }) => api(Effect.asVoid(pullRequests.push(taskId, head, url))),
      ReplacePullRequest: ({ taskId, head, replaces, url }) => api(Effect.asVoid(pullRequests.replace(taskId, head, replaces, url))),
      MergeNote: ({ taskId, url }) => api(Effect.map(pullRequests.mergeNote(taskId, url), ({ note }) => ({ note }))),
      PushHere: ({ taskId }) => api(Effect.asVoid(pullRequests.pushHere(taskId))),
      PushBranch: ({ taskId, heads }) => api(Effect.asVoid(pullRequests.pushBranch(taskId, heads))),
      RefreshTask: ({ taskId }) => pullRequests.refresh(taskId),
      StopListening: ({ taskId, url }) => api(pullRequests.stopListening(taskId, url)),
      AttachPullRequest: ({ taskId, pullRequest, start }) =>
        api(
          Effect.map(pullRequests.attach({ taskId, pullRequest, start: start === true, actorId: actorId }), (done): Attachment =>
            done.kind === 'start'
              ? { kind: 'start', name: done.name, source: done.source, started: false, kept: 0, own: done.own }
              : {
                  kind: 'attached',
                  name: `${done.change.words.short} ${done.change.words.prefix}${done.change.number}`,
                  source: done.change.source ?? '',
                  started: done.started,
                  kept: done.kept,
                  own: done.kept,
                },
          ),
        ),
    } satisfies Partial<ApiHandlers>
  })
