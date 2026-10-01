import type { Effect } from 'effect'
import { Schema } from 'effect'

import type { ConnectorFailed } from './errors'

/*
 * The two models (docs/architecture/06, "Code hosts and trackers"): what
 * Charrette knows of a code host and of a tracker, whichever product it is.
 * Each was laid against GitHub, GitLab, Bitbucket, Linear, Jira and Trello
 * before an adapter was written. What only some products have is a
 * capability, not a field everyone fills in. Text is Markdown; an adapter
 * converts where its product uses something else.
 */

/** Every product Charrette has, or will have, an adapter for. Cloud and Data Center are separate products. */
export const Product = Schema.Literals(['github', 'gitlab', 'bitbucket_cloud', 'bitbucket_dc', 'linear', 'jira_cloud', 'jira_dc', 'trello'])
export type Product = typeof Product.Type

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
export const Repository = Schema.Struct({
  id: Schema.String,
  path: Schema.Array(Schema.String),
  defaultBranch: Schema.String,
  webUrl: Schema.String,
  canPush: Schema.Boolean,
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

/** A review of a change, with its verdict. */
export const Review = Schema.Struct({
  id: Schema.String,
  author: Person,
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
  body: Schema.String,
  at: Schema.String,
  url: Schema.NullOr(Schema.String),
  /** The thread it is in, when the host has threads; a reply goes there. */
  threadId: Schema.NullOr(Schema.String),
  path: Schema.NullOr(Schema.String),
  line: Schema.NullOr(Schema.Number),
})
export type Comment = typeof Comment.Type

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
}

/** How git pushes to a repository: its URL, and the header that signs the push in. */
export interface PushTarget {
  readonly url: string
  /** An `http.extraHeader` value, or null when the URL needs none (a local remote, in tests). */
  readonly header: string | null
}

/** What a code host offers Charrette (docs/architecture/06). */
export interface CodeHost {
  readonly product: Product
  readonly words: ChangeWords
  readonly capabilities: HostCapabilities
  readonly account: Effect.Effect<Account, ConnectorFailed>
  repository(path: ReadonlyArray<string>): Effect.Effect<Repository, ConnectorFailed>
  /** The open change from a branch, if there is one: how a change opened some other way is adopted. */
  findChange(repository: Repository, source: string): Effect.Effect<ChangeRequest | null, ConnectorFailed>
  /** Opens a change; one already open from the branch is returned instead of a second. */
  openChange(
    repository: Repository,
    change: { readonly title: string; readonly body: string; readonly source: string; readonly target: string; readonly draft: boolean },
  ): Effect.Effect<ChangeRequest, ConnectorFailed>
  change(repository: Repository, number: number): Effect.Effect<ChangeRequest, ConnectorFailed>
  markReady(repository: Repository, change: ChangeRequest): Effect.Effect<ChangeRequest, ConnectorFailed>
  checks(repository: Repository, sha: string): Effect.Effect<ReadonlyArray<Check>, ConnectorFailed>
  /** The end of a check's log, when the host keeps one Charrette can read. */
  checkLog(repository: Repository, check: Check): Effect.Effect<string | null, ConnectorFailed>
  /** Comments and reviews since a cursor (from the start without one). */
  activity(repository: Repository, number: number, cursor: string | null): Effect.Effect<Activity, ConnectorFailed>
  /** Replies on a change: in a comment's thread, or in its conversation. */
  reply(
    repository: Repository,
    number: number,
    reply: { readonly body: string; readonly threadId: string | null },
  ): Effect.Effect<Comment, ConnectorFailed>
  pushTarget(repository: Repository): Effect.Effect<PushTarget, ConnectorFailed>
}

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

/** What a tracker can do beyond the model's floor. */
export interface TrackerCapabilities {
  /** A link can be attached to an issue, as a pull request's is. */
  readonly links: boolean
}

/** What a tracker offers Charrette (docs/architecture/06). */
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
}
