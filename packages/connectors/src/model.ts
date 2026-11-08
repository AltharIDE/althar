import type { Effect } from 'effect'
import { Schema } from 'effect'

import { ConnectorFailed } from './errors'
import type { Allowance } from './http'
import type { HostReleases } from './releases'

/*
 * The two models (docs/architecture/06, "Code hosts and trackers"): what
 * Althar knows of a code host and of a tracker, whichever product it is.
 * Each was laid against GitHub, GitLab, Bitbucket, Linear, Jira and Trello
 * before an adapter was written. What only some products have is a
 * capability, not a field everyone fills in. Text is Markdown; an adapter
 * converts where its product uses something else.
 */

/** Every product Althar has, or will have, an adapter for. Cloud and Data Center are separate products. */
export const Product = Schema.Literals(['github', 'gitlab', 'bitbucket_cloud', 'bitbucket_dc', 'linear', 'jira_cloud', 'jira_dc', 'trello'])
export type Product = typeof Product.Type

/** A service as a person connects it: a product's Cloud and Data Center editions are one service. */
export const Service = Schema.Literals(['github', 'gitlab', 'bitbucket', 'linear', 'jira', 'trello'])
export type Service = typeof Service.Type

/** Someone on the service: a person, or a bot such as CI. */
export const Person = Schema.Struct({
  id: Schema.String,
  login: Schema.String,
  name: Schema.NullOr(Schema.String),
  bot: Schema.Boolean,
})
export type Person = typeof Person.Type

/**
 * The one part of a service a sign-in reaches, where it reaches only one
 * (ADR-059): a Linear workspace. Its key is the one its links carry
 * (linear.app/<key>/issue/…); its name is what the person calls it.
 */
export const Workspace = Schema.Struct({ key: Schema.String, name: Schema.String })
export type Workspace = typeof Workspace.Type

/** Who a connection signs in as, and in which workspace, where a sign-in reaches only one. */
export const Account = Schema.Struct({
  id: Schema.String,
  login: Schema.String,
  name: Schema.NullOr(Schema.String),
  workspace: Schema.optional(Workspace),
})
export type Account = typeof Account.Type

// ---- Code hosts -----------------------------------------------------------

/** A repository on a code host: its path (owner and name, or GitLab's nested groups), and the host's own id. */
/** How a change can be merged: squashed to one commit, with a merge commit, or rebased. */
export const MergeMethod = Schema.Literals(['squash', 'merge', 'rebase'])
export type MergeMethod = typeof MergeMethod.Type

export const Repository = Schema.Struct({
  id: Schema.String,
  path: Schema.Array(Schema.String),
  defaultBranch: Schema.String,
  webUrl: Schema.String,
  canPush: Schema.Boolean,
  /** How the repository lets changes be merged, as its settings say, in the order Althar prefers them. */
  merges: Schema.Array(MergeMethod),
})
export type Repository = typeof Repository.Type

/** Where a change stands. A declined Bitbucket pull request is closed. */
export const ChangeState = Schema.Literals(['open', 'merged', 'closed'])
export type ChangeState = typeof ChangeState.Type

/** A pull request, or GitLab's merge request. */
export const ChangeRequest = Schema.Struct({
  id: Schema.String,
  number: Schema.Number,
  title: Schema.String,
  body: Schema.String,
  url: Schema.String,
  state: ChangeState,
  draft: Schema.Boolean,
  source: Schema.String,
  target: Schema.String,
  headSha: Schema.NullOr(Schema.String),
  author: Schema.NullOr(Person),
  additions: Schema.NullOr(Schema.Number),
  deletions: Schema.NullOr(Schema.Number),
  changedFiles: Schema.NullOr(Schema.Number),
  updatedAt: Schema.String,
  /**
   * Whether the host says it conflicts with its target branch, so it can't
   * merge until its branch is brought up to date. Absent where the host
   * hasn't worked it out yet, or doesn't say.
   */
  conflicts: Schema.optional(Schema.Boolean),
  /**
   * The repository its branch is on, where that isn't the one it goes into:
   * a fork's path, or none where the fork is gone. Null for a branch of the
   * repository's own; absent where the host doesn't say, as a list may not.
   */
  headRepository: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
  /**
   * Whether it is in its target branch's merge queue, which merges it once
   * the queue's own checks pass on that branch as it will be: true as a
   * merge put it there, and as the host says when asked (`change` with
   * `queue`). Absent where it wasn't asked, or the host has no queue.
   */
  queued: Schema.optional(Schema.Boolean),
  /**
   * Why the queue last took it out, as the host says when asked: its checks
   * there failed, it conflicted, someone took it out, or it merged (a read
   * can still say open for a moment after). Null where it never did.
   */
  leftQueue: Schema.optional(Schema.NullOr(Schema.Literals(['checks', 'conflict', 'removed', 'merged', 'other']))),
  /**
   * Whether the host is set to merge it by itself once its checks pass:
   * GitLab's auto-merge, a merge train's entry included, and Data Center's
   * (read with `queue`). Absent where the host doesn't say.
   */
  autoMerge: Schema.optional(Schema.Boolean),
})
export type ChangeRequest = typeof ChangeRequest.Type

export const CheckState = Schema.Literals(['queued', 'running', 'passed', 'failed', 'skipped', 'cancelled', 'neutral'])
export type CheckState = typeof CheckState.Type

/** One check on a change's head: a check run, a pipeline's job, a build status. */
export const Check = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  state: CheckState,
  url: Schema.NullOr(Schema.String),
  workflow: Schema.optional(Schema.NullOr(Schema.String)),
  startedAt: Schema.optional(Schema.NullOr(Schema.String)),
  completedAt: Schema.optional(Schema.NullOr(Schema.String)),
  /** What the check said about itself, when it says. */
  summary: Schema.NullOr(Schema.String),
})
export type Check = typeof Check.Type

export const Verdict = Schema.Literals(['approved', 'changes_requested', 'commented'])
export type Verdict = typeof Verdict.Type

/** Which changes to list: open ones unless `state` says; `all` is every state. */
export const ListedState = Schema.Literals(['open', 'closed', 'merged', 'all'])
export type ListedState = typeof ListedState.Type

/** What a list of changes is narrowed to. Each filter left out narrows nothing. */
export interface ChangeQuery {
  readonly state: ListedState
  /** Its author's login. */
  readonly author?: string
  /** Words in its title. */
  readonly text?: string
  /** Only those whose review is asked of the connected account (directly, or of a team it is in, where the host has teams). */
  readonly reviewRequested?: boolean
  /** Only drafts, or only those ready for review. */
  readonly draft?: boolean
  /**
   * Only those last updated at or before this time, to read on past the
   * last of a listing that had more: where the host can (GitHub). A host
   * that can't lists from the newest again.
   */
  readonly updatedUntil?: string
  /** How many at most, newest change first. */
  readonly limit: number
}

/** Where a change's reviews leave it, as the host sums them up: approved, changes asked for, or still waiting on a review it needs. */
export const ReviewDecision = Schema.Literals(['approved', 'changes_requested', 'review_required'])
export type ReviewDecision = typeof ReviewDecision.Type

/**
 * A change as a list gives it: what any change says, and, where the host
 * says so in the same answer, where its reviews leave it and how its head's
 * checks stand overall. Null where the host doesn't say, or nothing applies.
 */
export const ListedChange = Schema.Struct({
  ...ChangeRequest.fields,
  /** The owner of the fork its branch is on, where it isn't the repository's own; null for the repository's own branch, or where the host doesn't say. */
  forkOwner: Schema.NullOr(Schema.String),
  reviewDecision: Schema.NullOr(ReviewDecision),
  checks: Schema.NullOr(Schema.Literals(['passed', 'failed', 'running'])),
})
export type ListedChange = typeof ListedChange.Type

/**
 * Where one thing merging needs stands (DEV-204): met; unmet, for someone to
 * do something; waiting, on someone already asked or something under way; or
 * unknown, where the host doesn't say, never taken as met.
 */
export const NeedState = Schema.Literals(['met', 'unmet', 'waiting', 'unknown'])
export type NeedState = typeof NeedState.Type

/**
 * What a host requires of a change before it merges, beside its checks, a
 * conflict and a draft, which a change says already:
 *
 * - `approvals`: approving reviews, `have` of `need` (absent where the host
 *   doesn't say how many), `who` approved, or, waiting, who is asked;
 * - `code_owners`: a code owner's review, `who` it waits on;
 * - `changes_requested`: none outstanding, else `who` asked for them;
 * - `conversations`: every conversation resolved, `have` of `need` resolved;
 * - `up_to_date`: has what its target has, `have` commits behind where not;
 * - `signatures`: every commit signed, `have` not;
 * - `linear_history`: merged as squash or rebase, no merge commit;
 * - `merge_queue`: merges through its branch's queue, waiting once in it;
 * - `other`: something else holds it back, in the host's words (`said`),
 *   or, without them, a rule Althar can't read.
 */
export const HostNeedKind = Schema.Literals([
  'approvals',
  'code_owners',
  'changes_requested',
  'conversations',
  'up_to_date',
  'signatures',
  'linear_history',
  'merge_queue',
  'other',
])
export type HostNeedKind = typeof HostNeedKind.Type

export const HostNeed = Schema.Struct({
  kind: HostNeedKind,
  state: NeedState,
  have: Schema.optional(Schema.Number),
  need: Schema.optional(Schema.Number),
  who: Schema.optional(Schema.Array(Schema.String)),
  said: Schema.optional(Schema.String),
})
export type HostNeed = typeof HostNeed.Type

/**
 * What merging a change needs, as its host says now (DEV-204): which of its
 * checks must pass, by name, `all` of them, or null where the host can't
 * tell; and each of the rest, in order, one the branch doesn't require left
 * out. Read with `mergeRules`, where a host has it.
 */
export const MergeRules = Schema.Struct({
  requiredChecks: Schema.Union([Schema.Literal('all'), Schema.Array(Schema.String), Schema.Null]),
  needs: Schema.Array(HostNeed),
})
export type MergeRules = typeof MergeRules.Type

/** A list of changes, newest change first, and whether the host has more than it holds. */
export interface ChangeList {
  readonly changes: ReadonlyArray<ListedChange>
  readonly more: boolean
}

/** A review of a change, with its verdict. */
export const Review = Schema.Struct({
  id: Schema.String,
  author: Person,
  /** Its author can write to the repository: its owner, or one of its people. Anyone else can comment on a public one. */
  member: Schema.Boolean,
  verdict: Verdict,
  body: Schema.String,
  at: Schema.String,
  url: Schema.NullOr(Schema.String),
})
export type Review = typeof Review.Type

/** A comment on a change: in its conversation, or in a thread on a line of its diff. */
export const Comment = Schema.Struct({
  id: Schema.String,
  author: Person,
  /** Its author can write to the repository: its owner, or one of its people. Anyone else can comment on a public one. */
  member: Schema.Boolean,
  body: Schema.String,
  at: Schema.String,
  url: Schema.NullOr(Schema.String),
  /** The thread it is in, when the host has threads; a reply goes there. */
  threadId: Schema.NullOr(Schema.String),
  path: Schema.NullOr(Schema.String),
  line: Schema.NullOr(Schema.Number),
})
export type Comment = typeof Comment.Type

/**
 * A change to review: someone else's pull request, as Althar reads it before
 * it reviews one it didn't open. Beside what any change says: whether its
 * author is one of the repository's people, the fork its branch is on, and
 * where its target branch is.
 */
export const ChangeToReview = Schema.Struct({
  ...ChangeRequest.fields,
  /** Its author is one of the repository's people, as the host says: GitHub's owner, a member of its organisation, or a collaborator. */
  member: Schema.Boolean,
  /** The repository its branch is on, where that isn't the one it goes into: a fork's path, or none where the fork is gone. Null for a branch of the repository's own. */
  fork: Schema.NullOr(Schema.Array(Schema.String)),
  /** The commit its target branch is on, as the host says; null where it doesn't. */
  baseSha: Schema.NullOr(Schema.String),
})
export type ChangeToReview = typeof ChangeToReview.Type

/**
 * Whether a change comes from outside the repository's people: from a fork,
 * or by an author the host doesn't name one of them. What it brings is then
 * read with less trust: its words may try to steer whoever reads them.
 */
export const fromOutside = (change: Pick<ChangeToReview, 'member' | 'fork'>): boolean => !change.member || change.fork !== null

/** What a review says of a change as a whole: approve it, ask for changes, or only comment. */
export const ReviewEvent = Schema.Literals(['approve', 'request_changes', 'comment'])
export type ReviewEvent = typeof ReviewEvent.Type

/** A review to post: what it says of the change, its summary, the commit it was of, and its comments on the change's lines. */
export interface NewReview {
  readonly event: ReviewEvent
  /** Markdown. */
  readonly body: string
  /** The commit the review is of, as its reviewer read it; null for the change's head as the host has it now. */
  readonly commit: string | null
  /** Comments on lines of the change as it now reads (its new side), by path and line. */
  readonly comments: ReadonlyArray<{ readonly path: string; readonly line: number; readonly body: string }>
}

/** A review the host took: its id, and its link where the host gives one. */
export const PostedReview = Schema.Struct({ id: Schema.String, url: Schema.NullOr(Schema.String) })
export type PostedReview = typeof PostedReview.Type

/** What happened on a change since a cursor: comments and reviews, oldest first, and the cursor to ask from next. */
export interface Activity {
  readonly comments: ReadonlyArray<Comment>
  readonly reviews: ReadonlyArray<Review>
  readonly cursor: string
}

/** What a host calls a change, for words on screen: GitHub's "pull request #12", GitLab's "merge request !12". */
export interface ChangeWords {
  readonly noun: 'pull request' | 'merge request'
  readonly short: 'PR' | 'MR'
  readonly prefix: '#' | '!'
}

/**
 * How changes into a branch merge on its host, as the host says now (ADR-081,
 * "On every code host"): through the host's own queue or merge train, which
 * tests and merges them one after another; with auto-merge, which merges one
 * once its checks pass; or plainly, where Althar's own line stands in.
 */
export interface MergeWays {
  /** GitHub's or Bitbucket Cloud's merge queue on the branch, or GitLab's merge trains on the project; null where it has none. */
  readonly queue: 'merge_queue' | 'merge_train' | null
  /** The host merges a change itself once its checks pass, as Althar asks: GitLab's, and Data Center's from 8.15. */
  readonly autoMerge: boolean
  /** What the server said it is, where that decided the above: GitLab's version and tier, Data Center's version. */
  readonly server: string | null
}

/** How Althar merges a change: in a way the repository allows, or with auto-merge, which merges it once its checks pass. */
export interface MergeHow {
  readonly method?: MergeMethod
  /** Turn auto-merge on rather than merge now, where `mergeWays` says the host has it. */
  readonly auto?: boolean
}

/** What a host can do beyond the model's floor. */
export interface HostCapabilities {
  /** Changes can be opened as drafts and marked ready. */
  readonly drafts: boolean
  /** A failed check's log can be read. */
  readonly checkLogs: boolean
  /** Comments on lines sit in threads a reply can join. */
  readonly threads: boolean
  /**
   * A change Althar didn't open can be read for review, with whether its
   * author is one of the repository's people and the fork it comes from, and
   * a review posted on it with comments on its lines. Only GitHub's, for now.
   */
  readonly reviews: boolean
  /**
   * Pictures can go in a change's conversation: uploaded to the host, which
   * serves them to those who can see the repository, and a comment the
   * account wrote can be edited to show them again as they change. GitHub's,
   * not on Enterprise Server, which takes no such upload.
   */
  readonly pictures: boolean
  /**
   * A closed change can be opened again. Not on Bitbucket Cloud, where a
   * declined pull request is final: `reopenChange` is refused there.
   */
  readonly reopen: boolean
  /**
   * A failed check can be run again from here: Actions' jobs, GitLab's jobs,
   * Bitbucket Cloud's pipeline whole. Not on Bitbucket Data Center, whose
   * builds are another service's: `rerun` is refused there, with whose.
   */
  readonly rerun: boolean
}

/** A picture to upload: its bytes, its file's name, and its type, `image/png` and the like. */
export interface PictureUpload {
  readonly bytes: Uint8Array
  readonly name: string
  readonly mediaType: string
}

/** What `editChange` sets on a change: its title, its description, or both. */
export interface ChangeEdit {
  readonly title?: string
  readonly body?: string
}

/** How git pushes to a repository: its URL, and the header that signs the push in. */
export interface PushTarget {
  readonly url: string
  /** An `http.extraHeader` value, or null when the URL needs none (a local remote, in tests). */
  readonly header: string | null
}

/**
 * How bringing a change's branch up to date ended (ADR-081). Every ending but
 * a failure is an answer, so the caller can say it as it is:
 *
 * - `updated`: the target branch is merged into it. `head` is the branch's
 *   commit now; null where the host does the merge in the background
 *   (GitHub's) and hasn't moved the branch yet;
 * - `current`: it has everything the target has, so nothing was done;
 * - `conflict`: the merge would conflict and nothing was done. `files` are
 *   those that conflict, as far as the host or Althar's copy could tell;
 * - `moved`: the branch isn't at the head the caller read, because someone
 *   pushed meanwhile (`head`, where it could be read), so nothing was done;
 * - `no_access`: the account may not push to the branch, as one on an
 *   outside author's fork often isn't. Nothing was done; `reason` is the
 *   host's, or Althar's, words. The author can be asked to update it.
 */
export type BranchUpdate =
  | { readonly outcome: 'updated'; readonly head: string | null }
  | { readonly outcome: 'current' }
  | { readonly outcome: 'conflict'; readonly files: ReadonlyArray<string> }
  | { readonly outcome: 'moved'; readonly head: string | null }
  | { readonly outcome: 'no_access'; readonly reason: string }

/** What a code host offers Althar (docs/architecture/06); its releases are `HostReleases`'s (ADR-081). */
export interface CodeHost extends HostReleases {
  readonly product: Product
  readonly words: ChangeWords
  readonly capabilities: HostCapabilities
  readonly account: Effect.Effect<Account, ConnectorFailed>
  repository(path: ReadonlyArray<string>): Effect.Effect<Repository, ConnectorFailed>
  /**
   * The open change from a branch, if there is one: how a change opened some
   * other way is adopted. `from` is the fork the branch is on, for a change
   * into the repository it was forked from; without it, the branch is the
   * repository's own.
   */
  findChange(repository: Repository, source: string, from?: Repository): Effect.Effect<ChangeRequest | null, ConnectorFailed>
  /** Opens a change; one already open from the branch is returned instead of a second. From a fork's branch where `from` says. */
  openChange(
    repository: Repository,
    change: {
      readonly title: string
      readonly body: string
      readonly source: string
      readonly target: string
      readonly draft: boolean
      readonly from?: Repository
    },
  ): Effect.Effect<ChangeRequest, ConnectorFailed>
  /**
   * A change as the host has it now. With `queue`, whether an open one is in
   * its target branch's merge queue too, and why the queue last took it out,
   * however it got there: asked only where that branch has a queue, as the
   * host learns once a while per branch, so one without costs nothing more.
   * Absent where the branch has none, or the host couldn't say.
   */
  change(repository: Repository, number: number, ask?: { readonly queue?: boolean }): Effect.Effect<ChangeRequest, ConnectorFailed>
  /**
   * The repository's changes, whoever opened them, newest change first,
   * narrowed as the query says, to its limit; and whether there are more.
   * Read-only. Refused as `forbidden`, with the `scope` it needs, where the
   * connection lacks one; as `rejected` (`noListing`) where the host can't.
   */
  listChanges(repository: Repository, query: ChangeQuery): Effect.Effect<ChangeList, ConnectorFailed>
  /**
   * What merging an open change needs on the host now, each as it stands
   * (DEV-204): its approvals and from whom, changes asked for, conversations,
   * being up to date, signatures and the like, as far as the host says, and
   * which checks must pass. What the host can't tell is `unknown`. Read-only;
   * a few calls, the branch's rules kept a while.
   */
  mergeRules?(repository: Repository, change: ChangeRequest): Effect.Effect<MergeRules, ConnectorFailed>
  /**
   * The repository's open changes, for following them: each one's number,
   * head and whether it comes from a fork, without caring for the rest.
   * Asked conditionally where the host has ETags, so an unchanged list
   * costs nothing; a host without leaves it to `listChanges`. At most a
   * hundred, newest change first.
   */
  openChanges?(repository: Repository): Effect.Effect<ReadonlyArray<ListedChange>, ConnectorFailed>
  /** What the host has let this connection ask of it so far, and says of its allowance; absent where nothing measures it. */
  allowance?(): Allowance
  markReady(repository: Repository, change: ChangeRequest): Effect.Effect<ChangeRequest, ConnectorFailed>
  /**
   * Merges a change, because the person said to: never on an agent's own
   * initiative. In `how`'s method, else the first way the repository allows;
   * refused, as a draft or with checks or reviews it still needs, with the
   * host's own words. Where its target branch merges through a merge queue,
   * it goes in the queue instead, and comes back open and `queued`: the host
   * merges it later. With `how.auto`, auto-merge is turned on instead, and it
   * comes back open and `queued` too.
   */
  merge(repository: Repository, change: ChangeRequest, how?: MergeHow): Effect.Effect<ChangeRequest, ConnectorFailed>
  /** How changes into a branch merge on the host: its queue or train, auto-merge, or plainly. Read when asked; kept a while. */
  mergeWays(repository: Repository, target: string): Effect.Effect<MergeWays, ConnectorFailed>
  /**
   * Puts a change in its target's merge queue or merge train at its head
   * (`headSha`): a push since is refused. Comes back open and `queued`; the
   * host merges it later. Refused, as `rejected`, where `mergeWays` says none.
   * Bitbucket Cloud takes no head: its merge, on a branch with a queue in use,
   * puts it in instead, so the head is checked just before.
   */
  enqueue(repository: Repository, change: ChangeRequest, how?: MergeHow): Effect.Effect<ChangeRequest, ConnectorFailed>
  /**
   * Takes a change out of its target's merge queue or train, and turns its
   * auto-merge off, before it merges: it can be put back. One in neither is
   * left as it is. Refused, as `rejected`, where the host can't from here.
   */
  leaveQueue(repository: Repository, change: ChangeRequest): Effect.Effect<ChangeRequest, ConnectorFailed>
  /** The commit a branch is at on the host now. */
  branchHead(repository: Repository, branch: string): Effect.Effect<string, ConnectorFailed>
  /** Whether a change's branch has a commit in it already: up to date with its target where that is the target's head. */
  contains(repository: Repository, change: ChangeRequest, sha: string): Effect.Effect<boolean, ConnectorFailed>
  /**
   * Whether a change's head now is the merge `updateBranch` made from the
   * head `from`, a merge whose first parent is it: GitHub's update-branch
   * lands in the background, so the head it says may be null, or someone
   * else's push. Present on GitHub alone; the others know the commit they pushed.
   */
  madeFrom?(repository: Repository, change: ChangeRequest, from: string): Effect.Effect<boolean, ConnectorFailed>
  /**
   * Closes a change without merging it, because the person said to: never
   * on an agent's word. Read back as the host has it after; one already
   * closed or merged is left as it is. Refused, where the account may not,
   * with the host's own words.
   */
  closeChange(repository: Repository, change: ChangeRequest): Effect.Effect<ChangeRequest, ConnectorFailed>
  /**
   * Deletes a closed change's branch on the host, where the branch is (a
   * fork's, for one from a fork), because the person said to. Refused for a
   * change still open; a branch already gone is nothing to do.
   */
  deleteBranch(repository: Repository, change: ChangeRequest): Effect.Effect<void, ConnectorFailed>
  /**
   * Opens a closed change again, because the person said to or it can be
   * taken back in a step: read back as the host has it after; one open
   * already is left as it is, and a merged one can't be opened (refused).
   * Where the host has `capabilities.reopen`; refused elsewhere, as
   * `rejected`, in the host's words.
   */
  reopenChange(repository: Repository, change: ChangeRequest): Effect.Effect<ChangeRequest, ConnectorFailed>
  /**
   * Gives a change another title, description, or both: what isn't given
   * stays as the host has it, and nothing else of it changes (its reviewers,
   * whether it is a draft). Read back as the host has it after. Refused,
   * where the account may not, as on an upstream it can't push to, with the
   * host's own words.
   */
  editChange(repository: Repository, change: ChangeRequest, edit: ChangeEdit): Effect.Effect<ChangeRequest, ConnectorFailed>
  /**
   * Merges the change's target branch into its branch, so the branch has
   * what the target has since it was made (ADR-081). A merge commit, never a
   * rebase and never a forced push: GitHub does it with its own call; the
   * others merge in a copy of Althar's own and push it plainly. It goes only
   * if the branch is still at `expectedHead`, the commit the caller read, so
   * a push made meanwhile is never merged unseen or overwritten (`moved`).
   * A branch on a fork is updated where the account may push to it, else
   * `no_access`. A conflict is read, never settled (`conflict`). A change
   * that isn't open is refused, as `rejected`, in the host's words.
   */
  updateBranch(
    repository: Repository,
    change: ChangeRequest,
    ask: { readonly expectedHead: string },
  ): Effect.Effect<BranchUpdate, ConnectorFailed>
  checks(repository: Repository, sha: string): Effect.Effect<ReadonlyArray<Check>, ConnectorFailed>
  /**
   * The end of a check's log, or with `whole` all of it. Null for a check the
   * host keeps no log of, such as one another CI service reported; one it
   * keeps but won't give (refused, expired, out of reach) fails, with why.
   */
  checkLog(repository: Repository, check: Check, whole?: boolean): Effect.Effect<string | null, ConnectorFailed>
  checkAnnotations?(
    repository: Repository,
    check: Check,
  ): Effect.Effect<ReadonlyArray<{ path: string; line: number; message: string }>, ConnectorFailed>
  checkArtifacts?(
    repository: Repository,
    check: Check,
  ): Effect.Effect<ReadonlyArray<{ id: string; name: string; size: number }>, ConnectorFailed>
  checkArtifact?(repository: Repository, id: string, maxBytes: number): Effect.Effect<Uint8Array, ConnectorFailed>
  /**
   * What a check the host keeps no log of reported of itself, where it said
   * more than its summary: a GitHub check run's own summary and text. Null
   * where it said nothing more.
   */
  checkReport?(repository: Repository, check: Check): Effect.Effect<string | null, ConnectorFailed>
  /**
   * Runs a check again, as for one that may have failed by chance: true where
   * the host began it again, false where it can't run that check again.
   * Refused, as `rejected`, where the host has no `capabilities.rerun`, with
   * whose builds they are.
   */
  rerun(repository: Repository, check: Check): Effect.Effect<boolean, ConnectorFailed>
  /** Comments and reviews since a cursor (from the start without one). */
  activity(repository: Repository, number: number, cursor: string | null): Effect.Effect<Activity, ConnectorFailed>
  /** Replies on a change: in a comment's thread, or in its conversation. */
  reply(
    repository: Repository,
    number: number,
    reply: { readonly body: string; readonly threadId: string | null },
  ): Effect.Effect<Comment, ConnectorFailed>
  pushTarget(repository: Repository): Effect.Effect<PushTarget, ConnectorFailed>
  /**
   * A change to review, whoever opened it: what it is, whether its author is
   * one of the repository's people, and the fork it comes from. Where the
   * host has `capabilities.reviews`; refused elsewhere, as `rejected`.
   */
  changeToReview(repository: Repository, number: number): Effect.Effect<ChangeToReview, ConnectorFailed>
  /**
   * Posts a review of a change, because the person said to, or their own
   * setting does for their team's changes: never on an agent's word alone.
   * Where the host has `capabilities.reviews`; refused elsewhere, as
   * `rejected`. A comment on a line the change doesn't touch is refused by
   * the host, with its words.
   */
  postReview(repository: Repository, number: number, review: NewReview): Effect.Effect<PostedReview, ConnectorFailed>
  /**
   * Uploads a picture for the repository's conversations, and gives the
   * address a comment shows it by. Where the host has
   * `capabilities.pictures`; refused elsewhere, as `rejected`. The host keeps
   * it for good: nothing takes an upload back.
   */
  uploadPicture?(repository: Repository, picture: PictureUpload): Effect.Effect<string, ConnectorFailed>
  /**
   * Writes a comment in a change's conversation anew, one the account wrote,
   * and reads it back. `not_found` where it was deleted. Where the host has
   * `capabilities.pictures`.
   */
  editComment?(repository: Repository, number: number, commentId: string, body: string): Effect.Effect<Comment, ConnectorFailed>
}

/** A host's refusal of a picture, where it has no `capabilities.pictures`. */
export const noPictures = (product: Product): ConnectorFailed =>
  new ConnectorFailed({ product, reason: 'rejected', message: 'This host takes no pictures in its conversations' })

/** A host's refusal to open a declined change again, where it has no `capabilities.reopen`: said in its words for a change. */
export const noReopen = (product: Product, words: ChangeWords, number: number): ConnectorFailed =>
  new ConnectorFailed({
    product,
    reason: 'rejected',
    message: `${words.short} ${words.prefix}${number} was declined, and Bitbucket can’t open a declined ${words.noun} again. Make a new one from its branch.`,
  })

/** A change that can't be opened again because it was merged. */
export const mergedForGood = (product: Product, words: ChangeWords, number: number): ConnectorFailed =>
  new ConnectorFailed({
    product,
    reason: 'rejected',
    message: `${words.short} ${words.prefix}${number} is merged, so it can’t be opened again.`,
  })

/** A host's refusal to run a check again, where it has no `capabilities.rerun`: whose build it is, and where to run it. */
export const notOurBuild = (product: Product, check: { readonly name: string; readonly url: string | null }): ConnectorFailed =>
  new ConnectorFailed({
    product,
    reason: 'rejected',
    message: `${check.name} is built by another service (Jenkins, Bamboo or the like), not by Bitbucket Data Center, so only it can run it again.${check.url === null ? '' : ` Its page: ${check.url}`}`,
  })

/** A host's refusal of a review, where it has no `capabilities.reviews`: said in its words for a change. */
export const noReviews = (product: Product, words: ChangeWords): ConnectorFailed =>
  new ConnectorFailed({ product, reason: 'rejected', message: `Althar can’t review a ${words.noun} on this host yet.` })

/** A host's refusal to delete the branch of a change still open: deleting it would close the change, or orphan it. */
export const stillOpen = (product: Product, words: ChangeWords, number: number): ConnectorFailed =>
  new ConnectorFailed({
    product,
    reason: 'rejected',
    message: `${words.short} ${words.prefix}${number} is still open, so its branch stays.`,
  })

/** A host's refusal to bring up to date the branch of a change that is no longer open: it would be merged into for nothing. */
export const notOpen = (product: Product, words: ChangeWords, number: number, state: ChangeState): ConnectorFailed =>
  new ConnectorFailed({
    product,
    reason: 'rejected',
    message: `${words.short} ${words.prefix}${number} is ${state}, so its branch isn’t brought up to date.`,
  })

/** A branch as a URL's path takes it: each part encoded, its slashes kept. */
export const branchPath = (branch: string): string => branch.split('/').map(encodeURIComponent).join('/')

/** A host's refusal to list changes, or to narrow them as asked: said in its words for a change. */
export const noListing = (product: Product, words: ChangeWords, why?: string): ConnectorFailed =>
  new ConnectorFailed({ product, reason: 'rejected', message: why ?? `Althar can’t list ${words.noun}s on this host yet.` })

/**
 * A listing refused for a permission: `forbidden`, with the scope (or a
 * fine-grained token's permission) it needs and the host's own words. Any
 * other failure is left as it is.
 */
export const lacking = (scope: string) => (error: ConnectorFailed) =>
  error.reason === 'forbidden'
    ? new ConnectorFailed({
        product: error.product,
        reason: error.reason,
        message: error.message,
        ...(error.status === undefined ? {} : { status: error.status }),
        scope,
      })
    : error

// ---- Trackers -------------------------------------------------------------

/** Where an issue stands, in the tracker's words and as a category every tracker's statuses fall into. */
export const StatusCategory = Schema.Literals(['triage', 'backlog', 'todo', 'started', 'done', 'cancelled'])
export type StatusCategory = typeof StatusCategory.Type

export const Priority = Schema.Literals(['urgent', 'high', 'medium', 'low', 'none'])
export type Priority = typeof Priority.Type

/** An issue, card or work item. */
export const Issue = Schema.Struct({
  id: Schema.String,
  /** What `Tracker.issue` takes to read it again: the key, or `owner/repo#12` for a code host's issue. */
  ref: Schema.String,
  /** The tracker's key, as it shows it: MER-231, PROJ-123, `#12`. */
  key: Schema.String,
  title: Schema.String,
  body: Schema.String,
  url: Schema.String,
  status: Schema.Struct({ name: Schema.String, category: StatusCategory }),
  priority: Schema.NullOr(Schema.Struct({ level: Priority, name: Schema.String })),
  assignees: Schema.Array(Person),
  labels: Schema.Array(Schema.String),
  /** Where it lives, by the tracker's name for it: a team, a project, a board, a repository. */
  container: Schema.NullOr(Schema.String),
  updatedAt: Schema.String,
  /*
   * What else it is in or has, where the tracker has the field and says it
   * as it reads one: null where it has none; absent where the tracker hasn't
   * the field, or Althar doesn't read it there.
   */
  /** The project it is in, besides where it lives: Linear's project. */
  project: Schema.optional(Schema.NullOr(Schema.Struct({ id: Schema.String, name: Schema.String }))),
  /** Its milestone: Linear's project milestone, GitHub's and GitLab's milestone, Jira's fix version. */
  milestone: Schema.optional(Schema.NullOr(Schema.Struct({ id: Schema.String, name: Schema.String }))),
  /** Linear's cycle it is in. */
  cycle: Schema.optional(Schema.NullOr(Schema.String)),
  /** The issue it is part of: Linear's parent, Jira's parent or epic. Not read on GitHub, whose issue says nothing of its parent; Althar sets one there, but can't say it is so already. */
  parent: Schema.optional(Schema.NullOr(Schema.Struct({ key: Schema.String, title: Schema.String }))),
  /** Its kind: Jira's issue type, GitHub's issue type, GitLab's (issue, incident, task). */
  type: Schema.optional(Schema.NullOr(Schema.String)),
  /** When it is due, as a day (2026-11-30). */
  due: Schema.optional(Schema.NullOr(Schema.String)),
  /** Its estimate: Linear's points, GitLab's weight. */
  estimate: Schema.optional(Schema.NullOr(Schema.Number)),
  /** Jira's components it is in. */
  components: Schema.optional(Schema.Array(Schema.String)),
})
export type Issue = typeof Issue.Type

/** A comment on an issue: who wrote it, what it says, in Markdown, and when. */
export const IssueComment = Schema.Struct({ author: Schema.NullOr(Person), body: Schema.String, at: Schema.String })
export type IssueComment = typeof IssueComment.Type

/** Which issues a search finds by where their work stands: open (not done or cancelled), closed (done or cancelled), or all. */
export const IssueState = Schema.Literals(['open', 'closed', 'all'])
export type IssueState = typeof IssueState.Type

/**
 * What a search for issues is narrowed to. Each left out narrows nothing;
 * each given narrows further (and). Every filter means the same on every
 * tracker, as `issueMatches` reads it against an issue; each tracker says in
 * `capabilities.finds` which it can narrow by, and how. A filter it can't is
 * never sent to it: whoever asks says so instead (docs/architecture/06,
 * "Finding issues").
 */
export interface IssueQuery {
  /** Every word of it in its title or description, in any case. */
  readonly text?: string
  /**
   * Where it lives, by its `Container.id`. Without one, a code host (GitHub,
   * GitLab), which has no bound of its own, finds only those that involve
   * the account.
   */
  readonly container?: string
  readonly state: IssueState
  /** Only those assigned to the account. */
  readonly mine?: boolean
  /** Only those with every one of these labels, by name in any case. */
  readonly labels?: ReadonlyArray<string>
  /** Only those in one of these statuses, by the tracker's own name (In Review), or in a status of one of these categories. */
  readonly status?: { readonly names: ReadonlyArray<string>; readonly categories: ReadonlyArray<StatusCategory> }
  /** Only those in the project of this name: Linear's project, a GitHub project board. */
  readonly project?: string
  /** Only those in the milestone of this name: Linear's project milestone, GitHub's and GitLab's milestone, Jira's fix version. */
  readonly milestone?: string
  /** Only those in this cycle, by its name or number, or `current` for the one under way: Linear's cycle, Jira's sprint. */
  readonly cycle?: string
  /** Only those assigned to someone, by their name, login or email; null for those assigned to no one. */
  readonly assignee?: string | null
  /** Only those of one of these priorities; `none` is those without one. */
  readonly priority?: ReadonlyArray<Priority>
  /** Only those part of this issue, by its key or ref. */
  readonly parent?: string
  /** Only those changed at or after this moment or day, ISO 8601 (2026-11-01, or with a time). */
  readonly updatedSince?: string
  /** Only these, by key or ref as typed: DEV-12, `#12` (in the container) or `owner/repo#12`, a Trello card's short link. */
  readonly keys?: ReadonlyArray<string>
  /** Where the page before stopped, as its `next` said: the same query, read on from there. */
  readonly cursor?: string
  /** How many at most, newest change first. */
  readonly limit: number
}

/** What a search can be narrowed by beyond where issues live, whether they are open, and whether they are the account's. */
export const IssueFilter = Schema.Literals([
  'text',
  'labels',
  'status',
  'project',
  'milestone',
  'cycle',
  'assignee',
  'priority',
  'parent',
  'updatedSince',
  'keys',
])
export type IssueFilter = typeof IssueFilter.Type

/**
 * How a tracker narrows a search by a filter: by its own search (`search`),
 * or by Althar, reading what its search gives (`after`): a page can then
 * hold fewer than its limit, and the search reaches only as far as the
 * tracker's own does. A filter left out of `finds` it can't narrow by.
 */
export type FindBy = 'search' | 'after'

/** The filters a query narrows by, in the model's order. */
export const filtersOf = (query: IssueQuery): ReadonlyArray<IssueFilter> =>
  IssueFilter.literals.filter((filter) => {
    const given = query[filter]
    if (given === undefined) return false
    if (filter === 'text') return typeof given === 'string' && given.trim() !== ''
    if (filter === 'status') return query.status !== undefined && query.status.names.length + query.status.categories.length > 0
    return !Array.isArray(given) || given.length > 0
  })

/** A page of a search: its issues, newest change first, and the cursor to read on from, while there are more. */
export interface IssuePage {
  readonly issues: ReadonlyArray<Issue>
  readonly next: string | null
}

/** Two names alike, in any case, their spaces trimmed. */
const alike = (a: string | null | undefined, b: string) => a != null && a.trim().toLowerCase() === b.trim().toLowerCase()

/** Whether an issue is in the state a search asks for: open is neither done nor cancelled. */
export const inIssueState = (state: IssueState, category: StatusCategory): boolean =>
  state === 'all' || (state === 'closed') === (category === 'done' || category === 'cancelled')

/** Whether a key or ref names an issue: its key or ref, in any case; `#12` an `owner/repo#12`. */
export const namesIssue = (typed: string, issue: Pick<Issue, 'key' | 'ref'>): boolean =>
  alike(issue.key, typed) || alike(issue.ref, typed) || (typed.startsWith('#') && issue.ref.toLowerCase().endsWith(typed.toLowerCase()))

/**
 * Whether an issue is one a query finds, as every tracker's search means it:
 * what a tracker narrows by after its search (`after`), and what a fake
 * narrows by. `account` is who `mine` is. A cycle of `current` can't be
 * told here, and passes; a filter on a field the issue wasn't read with
 * (absent) doesn't. Where it lives (`container`) is the search's own to
 * narrow.
 */
export const issueMatches = (issue: Issue, query: Omit<IssueQuery, 'limit'>, account?: { readonly id: string }): boolean => {
  if (!inIssueState(query.state, issue.status.category)) return false
  if (query.mine === true && account !== undefined && !issue.assignees.some((person) => person.id === account.id)) return false
  const said = `${issue.title}\n${issue.body}`.toLowerCase()
  const words = (query.text ?? '')
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== '')
  if (!words.every((word) => said.includes(word))) return false
  if (query.labels !== undefined && !query.labels.every((label) => issue.labels.some((had) => alike(had, label)))) return false
  const status = query.status
  if (
    status !== undefined &&
    status.names.length + status.categories.length > 0 &&
    !status.names.some((name) => alike(issue.status.name, name)) &&
    !status.categories.includes(issue.status.category)
  )
    return false
  // A field the issue wasn't read with can't be said to match.
  if (query.project !== undefined && !alike(issue.project?.name, query.project)) return false
  if (query.milestone !== undefined && !alike(issue.milestone?.name, query.milestone)) return false
  if (
    query.cycle !== undefined &&
    !alike(query.cycle, 'current') &&
    !(alike(issue.cycle, query.cycle) || alike(issue.cycle, `Cycle ${query.cycle}`))
  )
    return false
  if (query.assignee === null && issue.assignees.length > 0) return false
  if (typeof query.assignee === 'string') {
    const typed = query.assignee.trim().replace(/^@/, '').toLowerCase()
    if (
      !issue.assignees.some(
        (person) => alike(person.login, typed) || alike(person.id, typed) || (person.name ?? '').toLowerCase().includes(typed),
      )
    )
      return false
  }
  if (query.priority !== undefined && query.priority.length > 0 && !query.priority.includes(issue.priority?.level ?? 'none')) return false
  if (query.parent !== undefined) {
    const parent = issue.parent
    if (parent == null || !(alike(parent.key, query.parent) || query.parent.toLowerCase().endsWith(parent.key.toLowerCase()))) return false
  }
  if (query.updatedSince !== undefined) {
    const since = Date.parse(query.updatedSince)
    if (!Number.isNaN(since) && Date.parse(issue.updatedAt) < since) return false
  }
  if (query.keys !== undefined && query.keys.length > 0 && !query.keys.some((key) => namesIssue(key, issue))) return false
  return true
}

/**
 * A page of issues a tracker found and narrowed itself, all at once: newest
 * change first, from the cursor's offset, to the limit. The cursor is the
 * offset of the next page.
 */
export const pageAt = (issues: ReadonlyArray<Issue>, query: Pick<IssueQuery, 'cursor' | 'limit'>): IssuePage => {
  const from = query.cursor === undefined ? 0 : Math.max(0, Number.parseInt(query.cursor, 10) || 0)
  const to = from + Math.max(1, query.limit)
  const sorted = issues.toSorted((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
  return { issues: sorted.slice(from, to), next: sorted.length > to ? String(to) : null }
}

/** A tracker's refusal of a search it can't make as asked: said in words an agent can pass on. */
export const cantFind = (product: Product, why: string): ConnectorFailed =>
  new ConnectorFailed({ product, reason: 'rejected', message: why })

/**
 * Where an issue can be filed, by the tracker's name for it: a Linear team,
 * a Jira project, a list on a Trello board, a repository.
 */
export const Container = Schema.Struct({
  /** What `Tracker.create` takes: the tracker's own id for it. */
  id: Schema.String,
  /** A short name a person may type for it, where the tracker has one: a team's or a project's key (MER, PAY), a repository's path. */
  key: Schema.NullOr(Schema.String),
  /** Its name, as the tracker shows it: Meridian, Payments, `Roadmap / To do`, `acme/api`. */
  name: Schema.String,
})
export type Container = typeof Container.Type

/**
 * An issue to file: its title, its body in Markdown, the labels to put on it,
 * and its priority, where the tracker has priorities (`changes` holds
 * `priority`); left out, or on a tracker without them, it has none. What
 * else it is filed with is `fields`, by the tracker's own ids as
 * `Tracker.choicesIn` gave them: only fields in `capabilities.creates`.
 */
export interface NewIssue {
  readonly title: string
  readonly body: string
  readonly labels: ReadonlyArray<string>
  readonly priority?: Priority
  readonly fields?: IssueChange
}

/**
 * What of an issue Althar can change, where the tracker can: its status (any
 * of the tracker's own), closing it, its priority, who it is assigned to, its
 * labels, the project it is in (Linear's project, a GitHub project board),
 * its milestone (Linear's project milestone, GitHub's and GitLab's
 * milestone, Jira's fix version), Linear's cycle, its parent issue, its
 * estimate (Linear's points, GitLab's weight), its type (Jira's issue type,
 * GitHub's issue type, GitLab's), Jira's components, when it is due, its
 * title and its description.
 */
export const IssueField = Schema.Literals([
  'status',
  'close',
  'priority',
  'assignee',
  'labels',
  'project',
  'milestone',
  'cycle',
  'parent',
  'estimate',
  'type',
  'components',
  'due',
  'title',
  'description',
])
export type IssueField = typeof IssueField.Type

/** The fields set to one of the tracker's own, which `Tracker.choices` and `Tracker.choicesIn` list. */
export type ChosenField = 'status' | 'labels' | 'assignee' | 'project' | 'milestone' | 'cycle' | 'type' | 'components'

/**
 * Something a field can be set to, as the tracker lists it: its own id, its
 * name, and other words it answers to (a login, an email, `current` for
 * Linear's cycle under way). `in` is the id of the choice it sits within,
 * where it does: a Linear milestone's project.
 */
export interface Choice {
  readonly id: string
  readonly name: string
  readonly also?: ReadonlyArray<string>
  readonly in?: string
}

/** An issue another is part of, as `Tracker.issue` read it: its id, its ref, and its key. */
export interface ParentIssue {
  readonly id: string
  readonly ref: string
  readonly key: string
}

/**
 * A change to an issue, by the tracker's own ids as `Tracker.choices` gave
 * them: each field left out stays as it is. `close` closes it as done, by
 * the tracker's own way (Linear's and Jira's done status, GitHub's and
 * GitLab's closed, Trello's archive). People are put on it and taken off;
 * others stay, but where an issue has one assignee (`capabilities.assignees`
 * is `one`), the one added is in place of whoever had it. Null takes every
 * assignee off, or a project, milestone, cycle, parent, estimate or due day.
 * Labels are added and taken off; others stay. Components are those it is
 * in after, in place of those it had. A due day is `2026-11-30`.
 */
export interface IssueChange {
  readonly status?: Choice
  readonly close?: true
  readonly priority?: Priority
  readonly assignee?: { readonly add: ReadonlyArray<Choice>; readonly remove: ReadonlyArray<Choice> } | null
  readonly labels?: { readonly add: ReadonlyArray<Choice>; readonly remove: ReadonlyArray<Choice> }
  readonly project?: Choice | null
  readonly milestone?: Choice | null
  readonly cycle?: Choice | null
  readonly parent?: ParentIssue | null
  readonly estimate?: number | null
  readonly type?: Choice
  readonly components?: ReadonlyArray<Choice>
  readonly due?: string | null
  readonly title?: string
  readonly description?: string
}

/** What a tracker can do beyond the model's floor. */
export interface TrackerCapabilities {
  /** A link can be attached to an issue, as a pull request's is. */
  readonly links: boolean
  /** An issue can be moved to the tracker's own "in progress": a Linear team's started state, a Jira transition into In Progress. */
  readonly starts: boolean
  /** What of an issue `update` can change here; what isn't listed, the tracker has no field for, or Althar can't reach it yet. */
  readonly changes: ReadonlyArray<IssueField>
  /**
   * What of `changes` `create` sets as it files an issue, beside its title,
   * body, labels and priority; the rest of what an issue is filed with is
   * set by `update` right after, as a Jira status by its workflow.
   */
  readonly creates: ReadonlyArray<IssueField>
  /** How many people an issue is assigned to: one (Linear, Jira), or several (GitHub, GitLab, Trello). */
  readonly assignees: 'one' | 'many'
  /** What `find` can narrow a search by, and how (`FindBy`); a filter left out it can't, and is never asked to. */
  readonly finds: Readonly<Partial<Record<IssueFilter, FindBy>>>
}

/** A tracker's refusal of a change it can't make: said for the field, in words an agent can pass on. */
export const cantChange = (product: Product, field: IssueField, why: string): ConnectorFailed =>
  new ConnectorFailed({ product, reason: 'rejected', message: `Althar can’t change an issue’s ${field} here: ${why}` })

/** What of a change `create` takes, and what is left for `update` right after: by `capabilities.creates`. */
export const splitForCreate = (
  capabilities: TrackerCapabilities,
  change: IssueChange,
): { readonly onCreate: IssueChange; readonly after: IssueChange } => {
  const onCreate: Record<string, unknown> = {}
  const after: Record<string, unknown> = {}
  for (const field of fieldsOf(change)) (capabilities.creates.includes(field) ? onCreate : after)[field] = change[field]
  return { onCreate: onCreate as IssueChange, after: after as IssueChange }
}

/** The one person a change puts on an issue that has one assignee: the last added; null where it takes them off. */
export const oneAssignee = (change: NonNullable<IssueChange['assignee']> | null): Choice | null =>
  change === null ? null : (change.add.at(-1) ?? null)

/** What `Tracker.start` did: moved the issue, or left it as it was; and the status it is in now. */
export interface Started {
  readonly moved: boolean
  readonly status: Issue['status']
}

/** Whether an issue's work hasn't started: what `Tracker.start` may move on, and nothing else. */
export const unstarted = (category: StatusCategory): boolean => category === 'triage' || category === 'backlog' || category === 'todo'

/** An issue left as it is, by a tracker that has no "in progress" to move it to, or as it is past one. */
export const leftAsItIs = (issue: Issue): Started => ({ moved: false, status: issue.status })

/** What a tracker offers Althar (docs/architecture/06). */
export interface Tracker {
  readonly product: Product
  readonly capabilities: TrackerCapabilities
  readonly account: Effect.Effect<Account, ConnectorFailed>
  /** An issue by its ref, as a link to it or `Issue.ref` gives it. */
  issue(ref: string): Effect.Effect<Issue, ConnectorFailed>
  /** Open issues assigned to the account, newest change first; within a container (a repository) when given. */
  mine(options?: { readonly container?: string; readonly limit?: number }): Effect.Effect<ReadonlyArray<Issue>, ConnectorFailed>
  /**
   * A page of the issues a query finds, whoever they are assigned to unless
   * it says, newest change first, to its limit; and the cursor to read on
   * from, while there are more. Only filters in `capabilities.finds` are
   * asked of it: one it can't take is refused, as `rejected`.
   */
  find(query: IssueQuery): Effect.Effect<IssuePage, ConnectorFailed>
  /** An issue's comments, oldest first: its latest, to a limit. */
  comments(issue: Issue, limit: number): Effect.Effect<ReadonlyArray<IssueComment>, ConnectorFailed>
  comment(issue: Issue, body: string): Effect.Effect<void, ConnectorFailed>
  /** Attaches a link to an issue, where the tracker has links. */
  link(issue: Issue, link: { readonly url: string; readonly title: string }): Effect.Effect<void, ConnectorFailed>
  /**
   * Moves an issue to the tracker's "in progress", where the tracker has one
   * (`capabilities.starts`), as its task starts. Only from triage, the
   * backlog or to do: one started, done or cancelled is left as it is, never
   * moved back. A tracker without one leaves every issue as it is.
   */
  start(issue: Issue): Effect.Effect<Started, ConnectorFailed>
  /** Where the account can file issues, most recently active first where the tracker says; page after page, to a bound. */
  containers(): Effect.Effect<ReadonlyArray<Container>, ConnectorFailed>
  /**
   * Files an issue in a container, by its `Container.id`, because the person
   * approved it: never on an agent's word. Labels the tracker can't take as
   * they are (it has none by that name, and makes none) are left off.
   * Once the tracker has taken the issue, create succeeds: a failed read
   * afterwards falls back to what is known. A failure before it, nothing
   * was filed.
   */
  create(container: string, issue: NewIssue): Effect.Effect<Issue, ConnectorFailed>
  /**
   * What an issue's field can be set to, as the tracker lists them for it:
   * its team's or board's statuses, its labels, the people it can be
   * assigned to, its projects or milestones. `wanted` narrows people to
   * those a name finds, where the tracker searches rather than lists them
   * (Jira); a tracker that makes any label it is given (Jira) offers the
   * one wanted, and the issue's own. Refused, as `rejected`, for a field
   * not in `capabilities.changes`.
   */
  choices(issue: Issue, field: ChosenField, wanted?: string): Effect.Effect<ReadonlyArray<Choice>, ConnectorFailed>
  /**
   * What a field of an issue filed in a container can be set to, by its
   * `Container.id`, as `choices` lists them for an issue there: before the
   * issue is filed. A status is any its container's issues can have. Refused,
   * as `rejected`, for a field not in `capabilities.changes`.
   */
  choicesIn(container: string, field: ChosenField, wanted?: string): Effect.Effect<ReadonlyArray<Choice>, ConnectorFailed>
  /**
   * Changes an issue as the person approved, or their own setting lets
   * through: never on an agent's word alone. The issue as the tracker has it
   * after. Doing it again changes nothing more, so a change whose answer was
   * lost can be made again. A field not in `capabilities.changes` is refused
   * before anything changes, as `rejected`.
   */
  update(issue: Issue, change: IssueChange): Effect.Effect<Issue, ConnectorFailed>
}

/** The fields a change touches, in the model's order. */
export const fieldsOf = (change: IssueChange): ReadonlyArray<IssueField> =>
  IssueField.literals.filter((field) => change[field] !== undefined)

/** A change's first field the tracker can't change, if any. */
export const unchangeable = (capabilities: TrackerCapabilities, change: IssueChange): IssueField | undefined =>
  fieldsOf(change).find((field) => !capabilities.changes.includes(field))

/** The filters a query narrows by that a tracker can't: never sent to it. */
export const unfindable = (capabilities: TrackerCapabilities, query: IssueQuery): ReadonlyArray<IssueFilter> =>
  filtersOf(query).filter((filter) => capabilities.finds[filter] === undefined)
