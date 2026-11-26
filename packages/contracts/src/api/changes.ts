import { Schema } from 'effect'
import { RpcGroup } from 'effect/rpc'
import { ClientAuthority, command } from './rpc'
import { ShipRoute } from './shared'

/**
 * What attaching a pull request to a task did (ADR-052): `attached`, the
 * task follows it now, its branch `started` from its head or not, `kept` of
 * its own commits on top; or `start`, where its branch isn't based on that
 * head, what starting from it would keep (`own`), for the person to say.
 */
export const Attachment = Schema.Struct({
  kind: Schema.Literals(['attached', 'start']),
  /** As the host says it: PR #185. */
  name: Schema.String,
  /** Its branch on its host, which the task's work goes to. */
  source: Schema.String,
  started: Schema.Boolean,
  kept: Schema.Number,
  own: Schema.Number,
})
export type Attachment = typeof Attachment.Type

/**
 * A task's change on its way out: opening it, shipping, pushing, merging, and its pull request.
 * Conflicts with the default branch, its commits, and joining or dropping its changes.
 */
export const ChangesApi = RpcGroup.make(
  /**
   * Whether a task's lead resolves a conflict with its default branch on its
   * own, otherwise than its project's rules say; null goes back to them.
   * Turned on, what already conflicts is resolved now, not at the next
   * conflict.
   */
  command('SetTaskResolveConflicts', { taskId: Schema.String, resolveConflicts: Schema.NullOr(Schema.Boolean) }, Schema.Void),
  /**
   * Resolve now: the task is merged with its default branch here, fetched
   * again, and what conflicts is asked of its lead, though the rules leave
   * it to the person, they stopped it, or its last round was handed back.
   * Done apart.
   */
  command('ResolveConflictsNow', { taskId: Schema.String }, Schema.Void),
  /** Each open task of the project looked at now for a conflict with its default branch, fetched again, under its rules. Done apart. */
  command('LookForConflicts', { projectId: Schema.String }, Schema.Void),
  /**
   * Leaves out the commits after a task's last pull request that are in none
   * yet (ADR-034): it settles without them, done where every pull request of
   * it merged; they stay on its branch, in its worktree. Nothing, where it
   * has none, or its lead is at work.
   */
  command('LeaveOutCommits', { taskId: Schema.String }, Schema.Void),
  /**
   * Keep them together: carries one change's commits onto another of the task's, before either ships, and its folder goes;
   * its branch stays (a task is a conversation plus parts). Into the task's first change unless `into` names one.
   */
  command('JoinChanges', { taskId: Schema.String, change: Schema.String, into: Schema.optional(Schema.String) }, Schema.Void),
  /** Drop it: a change's folder goes, after what it hadn't committed is; its branch, and any pull request, stay. */
  command('DropChange', { taskId: Schema.String, change: Schema.String }, Schema.Void),
  /** Marks the task's draft pull request ready for review. */
  command('MarkReady', { taskId: Schema.String, url: Schema.optional(Schema.String) }, Schema.Void),
  /**
   * Puts the task's screenshots, as its Outputs show them now, in one comment
   * on its pull request at `url`, or writes that comment anew (ADR-077):
   * without the views `leftOut` names, which stay out of it from then on,
   * whoever posts. Fails, saying why, where its host takes no pictures.
   */
  command('PostScreenshots', { taskId: Schema.String, url: Schema.String, leftOut: Schema.Array(Schema.String) }, Schema.Void),
  /**
   * Opens the pull request of a task whose work ended on its branch: a
   * draft, as the person said. A task whose last pull request merged or
   * closed opens its next, for the commits after it, on a new branch (ADR-034).
   */
  command('OpenChange', { taskId: Schema.String }, Schema.Void),
  /**
   * Ships what waits on the task's branch, as the person said (a task is a
   * conversation plus parts, "A tweak waits for Ship"): its review first,
   * where its plan has one before the work ships, over everything since the
   * last; then its commits go up. Refused while the task is at work, or
   * where nothing waits (`ShipRefused`).
   */
  // A change named ships alone, with what waits beneath it in its stack; none, every change waiting, the bottom of a stack first.
  // `route` is this Ship's, as the person chose it; without it, the task's own (`TaskView.shipRoute`).
  command('Ship', { taskId: Schema.String, change: Schema.optional(Schema.String), route: Schema.optional(ShipRoute) }, Schema.Void),
  /**
   * Changes the route of the task's Ship under way: how far it goes, where it
   * hasn't gone past that yet, and its review, which stops as Skip review
   * stops it where the route turns it off. Refused where no Ship is under way.
   */
  command('RouteShip', { taskId: Schema.String, route: ShipRoute }, Schema.Void),
  /**
   * Merges the task's pull request at the head the person saw, because they
   * said to; a draft is marked ready first. A pull request that moved on
   * since isn't merged. Agents never merge. With commits not shipped (a task
   * is a conversation plus parts), `how` says which of the two the person
   * pressed: `review`, Review and merge, one review of what waits, then it
   * goes up and merges; `now`, Merge now, up and merged at once, reviewed
   * after the merge where the task has a reviewer.
   */
  command(
    'Merge',
    {
      taskId: Schema.String,
      head: Schema.String,
      url: Schema.optional(Schema.String),
      how: Schema.optional(Schema.Literals(['review', 'now'])),
      /** Explicitly merge without the host's queue, using the viewer's bypass permission. */
      bypassQueue: Schema.optional(Schema.Boolean),
    },
    Schema.Void,
  ),
  /**
   * Merges a task without a pull request into each of its repositories'
   * default branches on this Mac, up to the commit the person saw in each:
   * all or none, and nothing pushed. Its task settles.
   */
  command(
    'MergeHere',
    { taskId: Schema.String, heads: Schema.Array(Schema.Struct({ repository: Schema.String, head: Schema.String })) },
    Schema.Void,
  ),
  /** Pushes the default branches a task merged into here to the remotes they follow, with the person's own git sign-in. */
  command('PushHere', { taskId: Schema.String }, Schema.Void),
  /**
   * Pushes a task's branch, in each repository without a pull request, to
   * that repository's remote, up to the commit the person saw in each, with
   * their own git sign-in: no connection needed, and nothing opened there.
   */
  command(
    'PushBranch',
    { taskId: Schema.String, heads: Schema.Array(Schema.Struct({ repository: Schema.String, head: Schema.String })) },
    Schema.Void,
  ),
  /** Pushes the task's branch to its open pull request, up to the commit the person saw. */
  command('Push', { taskId: Schema.String, head: Schema.String, url: Schema.optional(Schema.String) }, Schema.Void),
  /**
   * Replaces the commits on the task's pull request with its branch here, up
   * to the commit the person saw, once the branch was rewritten after it was
   * pushed: a force push they confirmed, only while the pull request is still
   * at `replaces`, the head they saw it at.
   */
  command(
    'ReplacePullRequest',
    { taskId: Schema.String, head: Schema.String, replaces: Schema.String, url: Schema.optional(Schema.String) },
    Schema.Void,
  ),
  /**
   * What to tell the lead so its branch takes the pull request's commits in
   * by merging, and a plain push works again: the pull request's head is
   * fetched to the task's worktree first.
   */
  command('MergeNote', { taskId: Schema.String, url: Schema.optional(Schema.String) }, Schema.Struct({ note: Schema.String })),
  /**
   * Closes the task's pull request at this address without merging it,
   * because the person said to; with `deleteBranch`, its branch on the host
   * goes too, once it is closed. What the host refused to close fails, and
   * it stays open. `branch` is what the host said to deleting the branch,
   * null where it went or wasn't asked to.
   */
  command(
    'ClosePullRequest',
    { taskId: Schema.String, url: Schema.String, deleteBranch: Schema.Boolean },
    Schema.Struct({ branch: Schema.NullOr(Schema.String) }),
  ),
  /** Asks the task's pull request for news now. */
  command('RefreshTask', { taskId: Schema.String }, Schema.Void),
  /** Stops listening to the task's pull request at this address: nothing said there after arrives, and the lead hears none of it. */
  command('StopListening', { taskId: Schema.String, url: Schema.String }, Schema.Void),
  /**
   * Attaches the task to an open pull request it didn't open, by its link or
   * number, and follows it from then on (ADR-052). Where the task's branch
   * isn't based on its head, nothing changes, and it answers `start`, with
   * how many commits of its own starting from the head keeps; `start` says
   * to start it there.
   */
  command('AttachPullRequest', { taskId: Schema.String, pullRequest: Schema.String, start: Schema.optional(Schema.Boolean) }, Attachment),
).middleware(ClientAuthority)
