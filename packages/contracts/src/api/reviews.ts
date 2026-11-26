import { Schema } from 'effect'
import { RpcGroup } from 'effect/rpc'
import { ClientAuthority, command } from './rpc'
import { ReviewVerdict } from './shared'

/**
 * Reviews of a change: the drafts a lead posts, skipping or declining one, and what a review after a merge found.
 * Running code under review (Run it), and the bots a project trusts for review.
 */
export const ReviewsApi = RpcGroup.make(
  /**
   * Changes a review the lead drafted, before it is posted: the verdict it
   * posts with, its summary, and which of its comments are kept, or what
   * each says. What isn't given stays as it is.
   */
  command(
    'ChangeReviewDraft',
    {
      draftId: Schema.String,
      verdict: Schema.optional(ReviewVerdict),
      summary: Schema.optional(Schema.String),
      comments: Schema.optional(
        Schema.Array(Schema.Struct({ id: Schema.String, kept: Schema.optional(Schema.Boolean), body: Schema.optional(Schema.String) })),
      ),
    },
    Schema.Void,
  ),
  /** Posts a review the lead drafted, with its verdict and the comments kept; or one that wasn't posted, again. Its card says how it went. */
  command('PostReviewDraft', { draftId: Schema.String }, Schema.Void),
  /** Discards a review the lead drafted: nothing is posted. */
  command('DiscardReviewDraft', { draftId: Schema.String }, Schema.Void),
  /**
   * "Run it" on the pull request a review task reviews, as the person said (a task is a conversation plus parts): the team's
   * code is trusted fully; an outside author's runs as `how` says, else as their setting answers, else they are asked
   * (`asks`). What it did, in words.
   */
  command(
    'RunIt',
    { taskId: Schema.String, how: Schema.optional(Schema.Literals(['safe', 'full'])) },
    Schema.Union([
      Schema.Struct({ kind: Schema.Literal('ran'), trust: Schema.Literals(['safe', 'full']), said: Schema.String }),
      Schema.Struct({ kind: Schema.Literal('asks') }),
    ]),
  ),
  /**
   * Stop running it (a task is a conversation plus parts, "Access moving back"): what its lead started of the pull request
   * stops, its copy is read only again, and its lead starts afresh as a reader. What it did, in words.
   */
  command('StopRunning', { taskId: Schema.String }, Schema.String),
  /**
   * Trusts a bot in a task's project (code-hosts § Review and triage bots), from the thread where it spoke: its leads hear its comments and reviews from
   * then on, as findings framed as data. A new revision of the project's rules, the person's, its other trusted bots kept.
   */
  command('TrustBot', { taskId: Schema.String, login: Schema.String }, Schema.Void),
  /** Skips the review of the task's run under way: a review under way stops, and work whose lead is done is ready (ADR-034). */
  command('SkipReview', { taskId: Schema.String }, Schema.Void),
  /** Turns down the review a change was offered as its work turned real: it isn't offered again. */
  command('DeclineReview', { taskId: Schema.String }, Schema.Void),
  /**
   * One small change's own word on its review after the merge, over its project's rule (`afterMergeReview`), until it merges:
   * `review`, reviewed after it merges though the rule says none; `none`, not reviewed after it; null, as the rule says. Its
   * card reads what holds (`SmallChangeContent.afterMerge`).
   */
  command('SetReviewAfterMerge', { taskId: Schema.String, review: Schema.NullOr(Schema.Literals(['review', 'none'])) }, Schema.Void),
  /**
   * Fix it, on what a review after a merge found (a task is a conversation
   * plus parts, "After merge, in the same task"): the findings go to the
   * task's lead as the person's word, and once its turn is over its fix
   * ships as a new pull request after the merged one. `url` names the merged
   * pull request where the task has several waiting; the latest otherwise.
   */
  command('FixAfterMerge', { taskId: Schema.String, url: Schema.optional(Schema.String) }, Schema.Void),
  /** Leave it, on what a review after a merge found: the findings close, and stay in the thread. */
  command('LeaveAfterMerge', { taskId: Schema.String, url: Schema.optional(Schema.String) }, Schema.Void),
).middleware(ClientAuthority)
