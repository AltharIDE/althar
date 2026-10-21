import type { Effect } from 'effect'
import { Schema } from 'effect'

import { ConnectorFailed } from './errors'

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

/** Who a connection signs in as. */
export const Account = Schema.Struct({ id: Schema.String, login: Schema.String, name: Schema.NullOr(Schema.String) })
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
}

/** How git pushes to a repository: its URL, and the header that signs the push in. */
export interface PushTarget {
  readonly url: string
  /** An `http.extraHeader` value, or null when the URL needs none (a local remote, in tests). */
  readonly header: string | null
}

/** What a code host offers Althar (docs/architecture/06). */
export interface CodeHost {
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
  change(repository: Repository, number: number): Effect.Effect<ChangeRequest, ConnectorFailed>
  /**
   * The repository's changes, whoever opened them, newest change first,
   * narrowed as the query says, to its limit; and whether there are more.
   * Read-only. Refused as `forbidden`, with the `scope` it needs, where the
   * connection lacks one; as `rejected` (`noListing`) where the host can't.
   */
  listChanges(repository: Repository, query: ChangeQuery): Effect.Effect<ChangeList, ConnectorFailed>
  markReady(repository: Repository, change: ChangeRequest): Effect.Effect<ChangeRequest, ConnectorFailed>
  /**
   * Merges a change, because the person said to: never on an agent's word.
   * In the first way the repository allows; refused, as a draft or with
   * checks or reviews it still needs, with the host's own words.
   */
  merge(repository: Repository, change: ChangeRequest): Effect.Effect<ChangeRequest, ConnectorFailed>
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
  checks(repository: Repository, sha: string): Effect.Effect<ReadonlyArray<Check>, ConnectorFailed>
  /**
   * The end of a check's log, or with `whole` all of it. Null for a check the
   * host keeps no log of, such as one another CI service reported; one it
   * keeps but won't give (refused, expired, out of reach) fails, with why.
   */
  checkLog(repository: Repository, check: Check, whole?: boolean): Effect.Effect<string | null, ConnectorFailed>
  /**
   * What a check the host keeps no log of reported of itself, where it said
   * more than its summary: a GitHub check run's own summary and text. Null
   * where it said nothing more.
   */
  checkReport?(repository: Repository, check: Check): Effect.Effect<string | null, ConnectorFailed>
  /**
   * Runs a check again, as for one that may have failed by chance: true where
   * the host began it again, false where it can't run that check again.
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
}

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
})
export type Issue = typeof Issue.Type

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
 * `priority`); left out, or on a tracker without them, it has none.
 */
export interface NewIssue {
  readonly title: string
  readonly body: string
  readonly labels: ReadonlyArray<string>
  readonly priority?: Priority
}

/**
 * What of an issue Althar can change, where the tracker can: its status (any
 * of the tracker's own), closing it, its priority, who it is assigned to, its
 * labels, the project it is in (Linear's project, a GitHub or GitLab
 * milestone), and its title.
 */
export const IssueField = Schema.Literals(['status', 'close', 'priority', 'assignee', 'labels', 'project', 'title'])
export type IssueField = typeof IssueField.Type

/** The fields set to one of the tracker's own, which `Tracker.choices` lists. */
export type ChosenField = 'status' | 'labels' | 'assignee' | 'project'

/** Something a field can be set to, as the tracker lists it: its own id, its name, and other words it answers to (a login, an email). */
export interface Choice {
  readonly id: string
  readonly name: string
  readonly also?: ReadonlyArray<string>
}

/**
 * A change to an issue, by the tracker's own ids as `Tracker.choices` gave
 * them: each field left out stays as it is. `close` closes it as done, by
 * the tracker's own way (Linear's and Jira's done status, GitHub's and
 * GitLab's closed, Trello's archive). Null takes an assignee or a project
 * off. Labels are added and taken off; others stay.
 */
export interface IssueChange {
  readonly status?: Choice
  readonly close?: true
  readonly priority?: Priority
  readonly assignee?: Choice | null
  readonly labels?: { readonly add: ReadonlyArray<Choice>; readonly remove: ReadonlyArray<Choice> }
  readonly project?: Choice | null
  readonly title?: string
}

/** What a tracker can do beyond the model's floor. */
export interface TrackerCapabilities {
  /** A link can be attached to an issue, as a pull request's is. */
  readonly links: boolean
  /** An issue can be moved to the tracker's own "in progress": a Linear team's started state, a Jira transition into In Progress. */
  readonly starts: boolean
  /** What of an issue `update` can change here; what isn't listed, the tracker has no field for, or Althar can't reach it yet. */
  readonly changes: ReadonlyArray<IssueField>
}

/** A tracker's refusal of a change it can't make: said for the field, in words an agent can pass on. */
export const cantChange = (product: Product, field: IssueField, why: string): ConnectorFailed =>
  new ConnectorFailed({ product, reason: 'rejected', message: `Althar can’t change an issue’s ${field} here: ${why}` })

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
