import type { ApiHandlers } from '@althar/contracts'
import type { ProjectId } from '@althar/domain'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { Changes } from '../Changes'
import { NotFound } from '../errors'
import { Instance } from '../Instance'
import { PullRequestScreenshots } from '../PullRequestScreenshots'
import { Policies, trustedBotsOf } from '../Policies'
import { botLogin } from '../reviewerBots'
import { Permissions } from '../Permissions'
import { applyRules } from '../rulesChange'
import { Reviews } from '../Reviews'
import { MergeReviews } from '../MergeReviews'
import { Runs } from '../Runs'
import type { ApiKit } from './kit'

/**
 * Reviews of a change: the drafts a lead posts, skipping or declining one, and what a review after a merge found.
 * Running code under review (Run it), and the bots a project trusts for review.
 */
export const reviewsHandlers = ({ actorId, api, envelope }: ApiKit) =>
  Effect.gen(function* () {
    const permissions = yield* Permissions
    const policies = yield* Policies
    const reviews = yield* Reviews
    const mergeReviews = yield* MergeReviews
    const runs = yield* Runs
    const instance = yield* Instance
    const sql = yield* SqlClient.SqlClient
    const pullRequests = yield* Changes
    const screenshots = yield* PullRequestScreenshots
    return {
      RunIt: ({ taskId, how }) => api(reviews.runIt({ taskId, ...(how === undefined ? {} : { how }) })),
      StopRunning: ({ taskId }) => api(reviews.stopRunning({ taskId, actorId: actorId })),
      ChangeReviewDraft: ({ draftId, verdict, summary, comments }) =>
        api(
          reviews.change(
            draftId,
            {
              ...(verdict === undefined ? {} : { verdict }),
              ...(summary === undefined ? {} : { summary }),
              ...(comments === undefined ? {} : { comments }),
            },
            actorId,
          ),
        ),
      PostReviewDraft: ({ draftId }) => api(Effect.asVoid(reviews.post(draftId, actorId))),
      DiscardReviewDraft: ({ draftId }) => api(reviews.discard(draftId, actorId)),
      TrustBot: ({ taskId, login }) =>
        api(
          Effect.gen(function* () {
            const [task] = yield* sql<{ projectId: string }>`SELECT project_id FROM tasks WHERE id = ${taskId}`
            if (task === undefined) return yield* new NotFound({ kind: 'task', id: taskId })
            const { rules } = yield* policies.current(task.projectId as ProjectId)
            const trusted = trustedBotsOf(rules)
            if (trusted.map(botLogin).includes(botLogin(login))) return
            yield* applyRules(task.projectId, { trustedBots: [...trusted, login] }, instance.personId).pipe(
              Effect.provideService(Policies, policies),
              Effect.provideService(Permissions, permissions),
              Effect.provideService(Changes, pullRequests),
              Effect.provideService(PullRequestScreenshots, screenshots),
            )
          }),
        ),
      SetReviewAfterMerge: ({ taskId, review }) => api(Effect.asVoid(runs.setReviewAfterMerge({ taskId, review, actorId: actorId }))),
      SkipReview: ({ commandId, taskId }) =>
        api(Effect.flatMap(envelope('task.skip_review', { taskId }, commandId), (said) => runs.skipReview({ envelope: said, taskId }))),
      DeclineReview: ({ taskId }) => api(runs.declineReview(taskId, actorId)),
      // Fix it: the findings go to the lead, and once its turn is over its fix ships as the next pull request.
      FixAfterMerge: ({ commandId, taskId, url }) =>
        api(
          Effect.gen(function* () {
            const sent = yield* mergeReviews.fix(taskId, url)
            const said = yield* envelope('task.ship', { taskId, afterMerge: url ?? null }, commandId)
            yield* Effect.forkDetach(
              Effect.andThen(mergeReviews.afterTurnOf(sent.threadId, sent.inputId), runs.ship({ envelope: said, taskId })).pipe(
                Effect.catchCause((cause) => Effect.logWarning('Could not ship a fix after a merge', cause)),
              ),
            )
          }),
        ),
      LeaveAfterMerge: ({ taskId, url }) => api(mergeReviews.leave(taskId, url)),
    } satisfies Partial<ApiHandlers>
  })
