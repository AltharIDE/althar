import { Clock, Effect, Schema } from 'effect'

import { type Access, type AccessInput, type AccessLine, type AccessNeed, type AccessReason, line } from './access'
import { type AdapterOptions, authorizationOf } from './credential'
import { ConnectorFailed } from './errors'
import { makeHttp, paged } from './http'
import type {
  Account,
  Activity,
  ChangeList,
  ChangeQuery,
  ChangeRequest,
  ChangeToReview,
  Check,
  CheckState,
  Choice,
  CodeHost,
  Comment,
  Container,
  Issue,
  IssueField,
  ListedChange,
  Person,
  Repository,
  Review,
  ReviewEvent,
  Tracker,
  Verdict,
} from './model'
import { branchPath, cantChange, lacking, leftAsItIs, stillOpen, unchangeable } from './model'
import {
  type Answer,
  answered,
  failedOf,
  limited,
  probe,
  type Reached,
  reachLine,
  readAs,
  refusalOf,
  seenOf,
  stopped,
  troubled,
  UNREADABLE,
  UNSAID,
} from './probe'

/*
 * GitHub, and GitHub Enterprise Server: a code host over its REST API (and
 * GraphQL for the two things REST can't do, marking a draft ready and
 * resolving a thread), and a tracker of its issues. An instance's API is at
 * `/api/v3`, its GraphQL at `/api/graphql`.
 */

const User = Schema.Struct({
  id: Schema.Number,
  login: Schema.String,
  name: Schema.optional(Schema.NullOr(Schema.String)),
  type: Schema.optional(Schema.String),
})
type User = typeof User.Type

const RepositoryAnswer = Schema.Struct({
  id: Schema.Number,
  full_name: Schema.String,
  default_branch: Schema.String,
  html_url: Schema.String,
  permissions: Schema.optional(Schema.Struct({ push: Schema.optional(Schema.Boolean) })),
  // Said only to someone who can push; anyone else can't merge anyway.
  allow_squash_merge: Schema.optional(Schema.Boolean),
  allow_merge_commit: Schema.optional(Schema.Boolean),
  allow_rebase_merge: Schema.optional(Schema.Boolean),
})

const PullAnswer = Schema.Struct({
  id: Schema.Number,
  node_id: Schema.String,
  number: Schema.Number,
  title: Schema.String,
  body: Schema.optional(Schema.NullOr(Schema.String)),
  html_url: Schema.String,
  state: Schema.String,
  draft: Schema.optional(Schema.Boolean),
  merged_at: Schema.optional(Schema.NullOr(Schema.String)),
  // The repository each side is on: a fork's, for a branch from one; null where the fork is gone.
  head: Schema.Struct({
    ref: Schema.String,
    sha: Schema.String,
    repo: Schema.optional(Schema.NullOr(Schema.Struct({ full_name: Schema.String }))),
  }),
  base: Schema.Struct({
    ref: Schema.String,
    sha: Schema.optional(Schema.String),
    repo: Schema.optional(Schema.NullOr(Schema.Struct({ full_name: Schema.String }))),
  }),
  user: Schema.optional(Schema.NullOr(User)),
  author_association: Schema.optional(Schema.String),
  additions: Schema.optional(Schema.Number),
  deletions: Schema.optional(Schema.Number),
  changed_files: Schema.optional(Schema.Number),
  // Worked out in the background: null until GitHub has, and said only when one pull request is read.
  mergeable: Schema.optional(Schema.NullOr(Schema.Boolean)),
  mergeable_state: Schema.optional(Schema.NullOr(Schema.String)),
  updated_at: Schema.String,
})
type PullAnswer = typeof PullAnswer.Type

const CheckRuns = Schema.Struct({
  check_runs: Schema.Array(
    Schema.Struct({
      id: Schema.Number,
      name: Schema.String,
      status: Schema.String,
      check_suite: Schema.optional(Schema.Struct({ id: Schema.Number })),
      started_at: Schema.optional(Schema.NullOr(Schema.String)),
      completed_at: Schema.optional(Schema.NullOr(Schema.String)),
      conclusion: Schema.optional(Schema.NullOr(Schema.String)),
      html_url: Schema.optional(Schema.NullOr(Schema.String)),
      details_url: Schema.optional(Schema.NullOr(Schema.String)),
      output: Schema.optional(Schema.Struct({ title: Schema.optional(Schema.NullOr(Schema.String)) })),
      app: Schema.optional(Schema.NullOr(Schema.Struct({ slug: Schema.optional(Schema.String) }))),
    }),
  ),
})

/** One check run, with what it reported beyond its title. */
const CheckRunAnswer = Schema.Struct({
  output: Schema.optional(
    Schema.Struct({ summary: Schema.optional(Schema.NullOr(Schema.String)), text: Schema.optional(Schema.NullOr(Schema.String)) }),
  ),
})

const CombinedStatus = Schema.Struct({
  statuses: Schema.Array(
    Schema.Struct({
      id: Schema.Number,
      context: Schema.String,
      state: Schema.String,
      target_url: Schema.optional(Schema.NullOr(Schema.String)),
      description: Schema.optional(Schema.NullOr(Schema.String)),
    }),
  ),
})

const CommentAnswer = Schema.Struct({
  id: Schema.Number,
  user: Schema.NullOr(User),
  author_association: Schema.optional(Schema.String),
  body: Schema.optional(Schema.NullOr(Schema.String)),
  updated_at: Schema.String,
  html_url: Schema.optional(Schema.NullOr(Schema.String)),
  path: Schema.optional(Schema.String),
  line: Schema.optional(Schema.NullOr(Schema.Number)),
  original_line: Schema.optional(Schema.NullOr(Schema.Number)),
  in_reply_to_id: Schema.optional(Schema.Number),
})
type CommentAnswer = typeof CommentAnswer.Type

const ReviewAnswer = Schema.Struct({
  id: Schema.Number,
  user: Schema.NullOr(User),
  author_association: Schema.optional(Schema.String),
  body: Schema.optional(Schema.NullOr(Schema.String)),
  state: Schema.String,
  submitted_at: Schema.optional(Schema.NullOr(Schema.String)),
  html_url: Schema.optional(Schema.NullOr(Schema.String)),
})

const IssueAnswer = Schema.Struct({
  id: Schema.Number,
  number: Schema.Number,
  title: Schema.String,
  body: Schema.optional(Schema.NullOr(Schema.String)),
  html_url: Schema.String,
  state: Schema.String,
  state_reason: Schema.optional(Schema.NullOr(Schema.String)),
  assignees: Schema.optional(Schema.NullOr(Schema.Array(User))),
  labels: Schema.optional(
    Schema.Array(Schema.Union([Schema.String, Schema.Struct({ name: Schema.optional(Schema.NullOr(Schema.String)) })])),
  ),
  pull_request: Schema.optional(Schema.Unknown),
  repository_url: Schema.optional(Schema.String),
  updated_at: Schema.String,
})
type IssueAnswer = typeof IssueAnswer.Type

/** Whether GitHub says an author can write to the repository: its owner, a member of its organisation, or a collaborator. */
const memberOf = (association: string | undefined) => association === 'OWNER' || association === 'MEMBER' || association === 'COLLABORATOR'

const personOf = (user: User | null | undefined): Person =>
  user == null
    ? { id: 'ghost', login: 'ghost', name: null, bot: false }
    : { id: String(user.id), login: user.login, name: user.name ?? null, bot: user.type === 'Bot' || user.login.endsWith('[bot]') }

/** The repository a pull request's branch is on, as `headRepository` says it; undefined where GitHub doesn't say. */
const headRepositoryOf = (pull: PullAnswer): ReadonlyArray<string> | null | undefined => {
  const head = pull.head.repo
  const base = pull.base.repo?.full_name.toLowerCase()
  return head === undefined ? undefined : head?.full_name.toLowerCase() === base ? null : head === null ? [] : head.full_name.split('/')
}

const changeOf = (pull: PullAnswer): ChangeRequest => ({
  id: pull.node_id,
  number: pull.number,
  title: pull.title,
  body: pull.body ?? '',
  url: pull.html_url,
  state: pull.merged_at != null ? 'merged' : pull.state === 'open' ? 'open' : 'closed',
  draft: pull.draft === true,
  source: pull.head.ref,
  target: pull.base.ref,
  headSha: pull.head.sha,
  author: pull.user == null ? null : personOf(pull.user),
  additions: pull.additions ?? null,
  deletions: pull.deletions ?? null,
  changedFiles: pull.changed_files ?? null,
  updatedAt: pull.updated_at,
  ...(headRepositoryOf(pull) === undefined ? {} : { headRepository: headRepositoryOf(pull) }),
  // Not mergeable, or `dirty`, is GitHub's way of saying the merge conflicts.
  ...(pull.mergeable === false || pull.mergeable_state === 'dirty'
    ? { conflicts: true }
    : pull.mergeable === true
      ? { conflicts: false }
      : {}),
})

/**
 * A pull request to review, whoever opened it: whether GitHub names its
 * author one of the repository's people, and the fork its branch is on (one
 * GitHub no longer has is a fork all the same, with no path).
 */
const toReviewOf = (pull: PullAnswer): ChangeToReview => ({
  ...changeOf(pull),
  member: memberOf(pull.author_association),
  fork: headRepositoryOf(pull) ?? null,
  baseSha: pull.base.sha ?? null,
})

/**
 * A pull request as GitHub's search lists it, over GraphQL: REST's list
 * says nothing of reviews or checks, and its search nothing of branches,
 * where this says all of them in one call.
 */
const ListedAnswer = Schema.Struct({
  id: Schema.String,
  number: Schema.Number,
  title: Schema.String,
  url: Schema.String,
  state: Schema.String,
  isDraft: Schema.Boolean,
  headRefName: Schema.String,
  baseRefName: Schema.String,
  headRefOid: Schema.optional(Schema.NullOr(Schema.String)),
  isCrossRepository: Schema.optional(Schema.Boolean),
  headRepositoryOwner: Schema.optional(Schema.NullOr(Schema.Struct({ login: Schema.String }))),
  author: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        __typename: Schema.optional(Schema.String),
        login: Schema.String,
        databaseId: Schema.optional(Schema.NullOr(Schema.Number)),
        name: Schema.optional(Schema.NullOr(Schema.String)),
      }),
    ),
  ),
  reviewDecision: Schema.optional(Schema.NullOr(Schema.String)),
  commits: Schema.optional(
    Schema.Struct({
      nodes: Schema.Array(
        Schema.NullOr(
          Schema.Struct({ commit: Schema.Struct({ statusCheckRollup: Schema.NullOr(Schema.Struct({ state: Schema.String })) }) }),
        ),
      ),
    }),
  ),
  updatedAt: Schema.String,
})
type ListedAnswer = typeof ListedAnswer.Type

const SearchAnswer = Schema.Struct({
  // An issue the search found has none of a pull request's fields: it is left out.
  search: Schema.Struct({ issueCount: Schema.Number, nodes: Schema.Array(Schema.Unknown) }),
})

const SEARCH = `query($q: String!, $n: Int!) {
  search(query: $q, type: ISSUE, first: $n) {
    issueCount
    nodes {
      ... on PullRequest {
        id number title url state isDraft headRefName baseRefName headRefOid updatedAt
        isCrossRepository headRepositoryOwner { login }
        author { __typename login ... on User { databaseId name } ... on Bot { databaseId } }
        reviewDecision
        commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
      }
    }
  }
}`

/** A login GitHub could give: letters, digits and hyphens; an app's ends in `[bot]`. */
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})(\[bot\])?$/

/**
 * What GitHub's search is asked for a repository's pull requests: newest
 * change first, narrowed as the query says. Each word of the text is
 * quoted, so none of it is read as a qualifier; an app is its author as
 * `app/name`. Undefined for an author no login could be.
 */
export const searchOf = (path: ReadonlyArray<string>, query: ChangeQuery): string | undefined => {
  const author = query.author?.trim().replace(/^@/, '')
  if (author !== undefined && author !== '' && !LOGIN.test(author)) return undefined
  const words = (query.text ?? '')
    .replaceAll('"', ' ')
    .split(/\s+/)
    .filter((word) => word !== '')
  return [
    `repo:${path.join('/')}`,
    'is:pr',
    { open: 'is:open', closed: 'is:closed is:unmerged', merged: 'is:merged', all: '' }[query.state],
    author === undefined || author === '' ? '' : `author:${author.endsWith('[bot]') ? `app/${author.slice(0, -'[bot]'.length)}` : author}`,
    query.reviewRequested === true ? 'review-requested:@me' : '',
    query.draft === undefined ? '' : `draft:${query.draft}`,
    query.updatedUntil === undefined ? '' : `updated:<=${query.updatedUntil.replace(/\.\d+Z$/, 'Z')}`,
    ...words.map((word) => `"${word}"`),
    words.length === 0 ? '' : 'in:title',
    'sort:updated-desc',
  ]
    .filter((word) => word !== '')
    .join(' ')
}

const listedOf = (pull: ListedAnswer): ListedChange => {
  const rollup = pull.commits?.nodes[0]?.commit.statusCheckRollup?.state
  const author = pull.author
  return {
    id: pull.id,
    number: pull.number,
    title: pull.title,
    // Never read from a list: what it says is read with the pull request, where it is marked as its author's.
    body: '',
    url: pull.url,
    state: pull.state === 'MERGED' ? 'merged' : pull.state === 'OPEN' ? 'open' : 'closed',
    draft: pull.isDraft,
    source: pull.headRefName,
    target: pull.baseRefName,
    headSha: pull.headRefOid ?? null,
    author:
      author == null
        ? null
        : author.__typename === 'Bot'
          ? { id: String(author.databaseId ?? author.login), login: `${author.login}[bot]`, name: null, bot: true }
          : { id: String(author.databaseId ?? author.login), login: author.login, name: author.name ?? null, bot: false },
    additions: null,
    deletions: null,
    changedFiles: null,
    updatedAt: pull.updatedAt,
    forkOwner: pull.isCrossRepository === true ? (pull.headRepositoryOwner?.login ?? null) : null,
    reviewDecision:
      pull.reviewDecision === 'APPROVED'
        ? 'approved'
        : pull.reviewDecision === 'CHANGES_REQUESTED'
          ? 'changes_requested'
          : pull.reviewDecision === 'REVIEW_REQUIRED'
            ? 'review_required'
            : null,
    checks:
      rollup === 'SUCCESS'
        ? 'passed'
        : rollup === 'FAILURE' || rollup === 'ERROR'
          ? 'failed'
          : rollup === 'PENDING' || rollup === 'EXPECTED'
            ? 'running'
            : null,
  }
}

/** What GitHub calls each verdict a review can post. */
const EVENTS: Readonly<Record<ReviewEvent, string>> = { approve: 'APPROVE', request_changes: 'REQUEST_CHANGES', comment: 'COMMENT' }

/** What GitHub answers a merge: whether it merged, and its commit. */
const MergeAnswer = Schema.Struct({ merged: Schema.optional(Schema.Boolean), sha: Schema.optional(Schema.NullOr(Schema.String)) })

/** Whether a pull request's target branch merges through a merge queue, whether it is in it, and why the queue last took it out. */
const QUEUE = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      isMergeQueueEnabled
      isInMergeQueue
      timelineItems(last: 1, itemTypes: [REMOVED_FROM_MERGE_QUEUE_EVENT]) { nodes { ... on RemovedFromMergeQueueEvent { reason } } }
    }
  }
}`

const QueueAnswer = Schema.Struct({
  repository: Schema.NullOr(
    Schema.Struct({
      pullRequest: Schema.NullOr(
        Schema.Struct({
          isMergeQueueEnabled: Schema.Boolean,
          isInMergeQueue: Schema.Boolean,
          timelineItems: Schema.Struct({
            nodes: Schema.Array(Schema.NullOr(Schema.Struct({ reason: Schema.optional(Schema.NullOr(Schema.String)) }))),
          }),
        }),
      ),
    }),
  ),
})

/** Puts a pull request in its merge queue, only at the head Althar last saw where it saw one. */
const ENQUEUE = `mutation($id: ID!, $head: GitObjectID) {
  enqueuePullRequest(input: { pullRequestId: $id, expectedHeadOid: $head }) { mergeQueueEntry { position } }
}`

/** Why GitHub's merge queue took a pull request out, in Althar's words: its checks there failed, it conflicted, someone took it out, or it merged. */
export const leftQueueOf = (reason: string | null | undefined): NonNullable<ChangeRequest['leftQueue']> | null => {
  switch (reason?.toLowerCase()) {
    case undefined:
    case '':
      return null
    case 'merged':
      return 'merged'
    case 'failed_checks':
      return 'checks'
    case 'merge_conflict':
      return 'conflict'
    case 'manual':
      return 'removed'
    default:
      return 'other'
  }
}

const PostedAnswer = Schema.Struct({ id: Schema.Number, html_url: Schema.optional(Schema.NullOr(Schema.String)) })

/** A check run's state from its status and conclusion. */
export const checkRunState = (status: string, conclusion: string | null | undefined): CheckState => {
  if (status !== 'completed') return status === 'in_progress' ? 'running' : 'queued'
  switch (conclusion) {
    case 'success':
      return 'passed'
    case 'skipped':
      return 'skipped'
    case 'cancelled':
      return 'cancelled'
    case 'neutral':
    case 'stale':
      return 'neutral'
    default:
      return 'failed'
  }
}

const statusState = (state: string): CheckState => (state === 'success' ? 'passed' : state === 'pending' ? 'running' : 'failed')

const verdictOf = (state: string): Verdict | undefined =>
  state === 'APPROVED' ? 'approved' : state === 'CHANGES_REQUESTED' ? 'changes_requested' : state === 'COMMENTED' ? 'commented' : undefined

/** How much of a failed check's log an agent reads: its end, where the failure is. */
const LOG_LINES = 150
const LOG_CHARACTERS = 12_000

export const tail = (log: string): string => {
  const lines = log.trimEnd().split('\n').slice(-LOG_LINES).join('\n')
  return lines.length > LOG_CHARACTERS ? lines.slice(-LOG_CHARACTERS) : lines
}

/** What every call to GitHub's API carries: its media type, and the version of the API it is written against. */
const HEADERS = { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' }

/** `owner/repo#12`: the ref GitHub's issues go by. */
const issueRef = /^([^/\s]+)\/([^#\s]+)#(\d+)$/

/** What GitHub changes of an issue: all but its priority, which GitHub's issues haven't (a project board's field is the board's own). */
const ISSUE_CHANGES: ReadonlyArray<IssueField> = ['status', 'close', 'assignee', 'labels', 'project', 'title']

/** An issue's statuses on GitHub: open, or closed as done or as not planned, by the state reason each closes with. */
const ISSUE_STATES: ReadonlyArray<Choice> = [
  { id: 'open', name: 'Open', also: ['reopened'] },
  { id: 'completed', name: 'Closed', also: ['done', 'completed'] },
  { id: 'not_planned', name: 'Closed as not planned', also: ['not planned', 'cancelled', 'canceled'] },
]

/** `owner/repo`: a repository, where an issue is filed. */
const repositoryRef = /^([^/\s]+)\/([^/#\s]+)$/

/** A repository the account is on, and whether an issue can be filed there. */
const Listed = Schema.Struct({
  full_name: Schema.String,
  has_issues: Schema.optional(Schema.Boolean),
  archived: Schema.optional(Schema.Boolean),
})

/**
 * How long a listing is kept: a GraphQL search is a POST, with no ETag to ask
 * "anything new?" by, so the same search again within a minute is answered
 * from memory, and a coordinator asking twice costs GitHub nothing more.
 */
export const LISTING_KEPT_MS = 60_000

/**
 * How long a branch found to have no merge queue is taken to have none: its
 * pull requests aren't asked about one meanwhile, so a repository without a
 * queue costs one GraphQL call an hour per branch, and one that turns its
 * queue on is heard within the hour. One with a queue is asked each turn.
 */
export const NO_QUEUE_KEPT_MS = 60 * 60_000

export const makeGitHub = (options: AdapterOptions): CodeHost & Tracker => {
  const product = 'github' as const
  const api = options.apiUrl.replace(/\/+$/, '')
  const graphqlUrl = api.endsWith('/api/v3') ? `${api.slice(0, -'/v3'.length)}/graphql` : `${api}/graphql`
  /** Listings by their search, with when each was asked. */
  const listings = new Map<string, { readonly at: number; readonly list: ChangeList }>()
  /** Whether each `owner/name branch` merges through a merge queue, as GitHub last said, and when. */
  const queues = new Map<string, { readonly at: number; readonly enabled: boolean }>()
  const http = makeHttp({
    product,
    fetch: options.fetch,
    authorization: Effect.map(options.credential, authorizationOf),
    headers: HEADERS,
  })
  const repo = (repository: Repository | ReadonlyArray<string>) =>
    `${api}/repos/${('path' in repository ? repository.path : repository).map(encodeURIComponent).join('/')}`

  const account: Effect.Effect<Account, ConnectorFailed> = Effect.map(http.json(User, 'GET', `${api}/user`), (user) => ({
    id: String(user.id),
    login: user.login,
    name: user.name ?? null,
  }))

  /** Where a pull request stands with its target branch's merge queue, as GraphQL alone says: asked only where that matters. */
  const queueOf = (repository: Repository, number: number, target: string) =>
    Effect.gen(function* () {
      const answer = yield* http.graphql(QueueAnswer, graphqlUrl, QUEUE, { owner: repository.path[0], name: repository.path[1], number })
      const pull = answer.repository?.pullRequest
      if (pull == null)
        return yield* new ConnectorFailed({
          product,
          reason: 'not_found',
          message: `No pull request #${number} in ${repository.path.join('/')}`,
        })
      queues.set(queueKey(repository, target), { at: yield* Clock.currentTimeMillis, enabled: pull.isMergeQueueEnabled })
      return pull
    })
  const queueKey = (repository: Repository, target: string) => `${repository.path.join('/')} ${target}`

  /** A branch as a pull request's head names it: with its owner, the fork's where it is on one. */
  const headOf = (repository: Repository, source: string, from?: Repository) => `${(from ?? repository).path[0]}:${source}`

  const findChange = (repository: Repository, source: string, from?: Repository) =>
    Effect.map(
      http.json(
        Schema.Array(PullAnswer),
        'GET',
        `${repo(repository)}/pulls?state=open&head=${encodeURIComponent(headOf(repository, source, from))}`,
      ),
      (pulls) => (pulls[0] === undefined ? null : changeOf(pulls[0])),
    )

  const commentOf = (comment: CommentAnswer, review: boolean): Comment => ({
    id: String(comment.id),
    author: personOf(comment.user),
    member: memberOf(comment.author_association),
    body: comment.body ?? '',
    at: comment.updated_at,
    url: comment.html_url ?? null,
    // A reply to a line's comment goes to the thread's first comment.
    threadId: review ? String(comment.in_reply_to_id ?? comment.id) : null,
    path: comment.path ?? null,
    line: comment.line ?? comment.original_line ?? null,
  })

  const issueOf = (issue: IssueAnswer, owner: string, name: string): Issue => ({
    id: String(issue.id),
    ref: `${owner}/${name}#${issue.number}`,
    key: `#${issue.number}`,
    title: issue.title,
    body: issue.body ?? '',
    url: issue.html_url,
    status:
      issue.state === 'open'
        ? { name: 'Open', category: 'todo' }
        : issue.state_reason === 'not_planned' || issue.state_reason === 'duplicate'
          ? { name: 'Closed as not planned', category: 'cancelled' }
          : { name: 'Closed', category: 'done' },
    priority: null,
    assignees: (issue.assignees ?? []).map(personOf),
    labels: (issue.labels ?? []).flatMap((label) => {
      const name = typeof label === 'string' ? label : label.name
      return name == null ? [] : [name]
    }),
    container: `${owner}/${name}`,
    updatedAt: issue.updated_at,
  })

  const parseRef = (ref: string) => {
    const match = issueRef.exec(ref)
    return match === null
      ? Effect.fail(new ConnectorFailed({ product, reason: 'not_found', message: `Not a GitHub issue: ${ref}` }))
      : Effect.succeed({ owner: match[1] ?? '', name: match[2] ?? '', number: Number(match[3]) })
  }

  /** Every page of a repository's list, a hundred at a time: a page short of a hundred is the last. */
  const everyPage = <A>(schema: Schema.Codec<A, unknown>, url: string) =>
    paged(1, (page) =>
      Effect.map(http.json(Schema.Array(schema), 'GET', `${url}${url.includes('?') ? '&' : '?'}per_page=100&page=${page}`), (items) => ({
        items,
        next: items.length < 100 ? undefined : page + 1,
      })),
    )

  const issueChoices: Tracker['choices'] = (issue, field) =>
    Effect.gen(function* () {
      const { owner, name } = yield* parseRef(issue.ref)
      const at = repo([owner, name])
      switch (field) {
        case 'status':
          return ISSUE_STATES
        case 'labels':
          return (yield* everyPage(Schema.Struct({ name: Schema.String }), `${at}/labels`)).map((label): Choice => ({
            id: label.name,
            name: label.name,
          }))
        // Those GitHub lets it be assigned to: the repository's people.
        case 'assignee':
          return (yield* everyPage(User, `${at}/assignees`)).map((user): Choice => ({
            id: user.login,
            name: user.name ?? user.login,
            also: [user.login],
          }))
        // A milestone, still open, is where GitHub groups an issue's work.
        case 'project':
          return (yield* everyPage(Schema.Struct({ number: Schema.Number, title: Schema.String }), `${at}/milestones?state=open`)).map(
            (milestone): Choice => ({ id: String(milestone.number), name: milestone.title }),
          )
      }
    })

  const changeIssue: Tracker['update'] = (issue, wanted) =>
    Effect.gen(function* () {
      const refused = unchangeable({ links: false, starts: false, changes: ISSUE_CHANGES }, wanted)
      if (refused !== undefined) return yield* cantChange(product, refused, 'GitHub’s issues have no priority')
      const { owner, name, number } = yield* parseRef(issue.ref)
      const at = `${repo([owner, name])}/issues/${number}`
      // Open, or closed with a reason: done, or not planned.
      const state = wanted.close === true && wanted.status === undefined ? 'completed' : wanted.status?.id
      const edit = {
        ...(wanted.title === undefined ? {} : { title: wanted.title }),
        ...(state === undefined ? {} : state === 'open' ? { state: 'open' } : { state: 'closed', state_reason: state }),
        ...(wanted.assignee === undefined ? {} : { assignees: wanted.assignee === null ? [] : [wanted.assignee.id] }),
        ...(wanted.project === undefined ? {} : { milestone: wanted.project === null ? null : Number(wanted.project.id) }),
      }
      if (Object.keys(edit).length > 0) yield* http.json(Schema.Unknown, 'PATCH', at, edit)
      const add = wanted.labels?.add ?? []
      if (add.length > 0) yield* http.json(Schema.Unknown, 'POST', `${at}/labels`, { labels: add.map((label) => label.name) })
      // One already off is nothing to take off.
      for (const label of wanted.labels?.remove ?? [])
        yield* http.json(Schema.Unknown, 'DELETE', `${at}/labels/${encodeURIComponent(label.name)}`).pipe(
          Effect.catchIf(
            (error) => error.reason === 'not_found',
            () => Effect.void,
          ),
        )
      return issueOf(yield* http.json(IssueAnswer, 'GET', at), owner, name)
    })

  return {
    product,
    words: { noun: 'pull request', short: 'PR', prefix: '#' },
    capabilities: { drafts: true, checkLogs: true, threads: true, reviews: true, links: false, starts: false, changes: ISSUE_CHANGES },
    account,
    repository: (path) =>
      Effect.map(http.json(RepositoryAnswer, 'GET', repo(path)), (answer) => ({
        id: String(answer.id),
        path: answer.full_name.split('/'),
        defaultBranch: answer.default_branch,
        webUrl: answer.html_url,
        canPush: answer.permissions?.push ?? false,
        merges: [
          ...(answer.allow_squash_merge === true ? (['squash'] as const) : []),
          ...(answer.allow_merge_commit !== false ? (['merge'] as const) : []),
          ...(answer.allow_rebase_merge === true ? (['rebase'] as const) : []),
        ],
      })),
    findChange,
    openChange: (repository, change) =>
      http
        .json(PullAnswer, 'POST', `${repo(repository)}/pulls`, {
          title: change.title,
          body: change.body,
          head: change.from === undefined ? change.source : headOf(repository, change.source, change.from),
          base: change.target,
          draft: change.draft,
        })
        .pipe(
          Effect.map(changeOf),
          // One already open from the branch is the one: adopted, not duplicated.
          Effect.catchIf(
            (error) => error.reason === 'rejected' && /already exists/i.test(error.message),
            (error) =>
              Effect.flatMap(findChange(repository, change.source, change.from), (found) =>
                found === null ? Effect.fail(error) : Effect.succeed(found),
              ),
          ),
        ),
    change: (repository, number, ask) =>
      Effect.gen(function* () {
        const change = changeOf(yield* http.cached(PullAnswer, `${repo(repository)}/pulls/${number}`))
        if (ask?.queue !== true || change.state !== 'open') return change
        // Its branch known to have no queue, it is in none: out of one it was in, retargeted, or since the queue was turned off.
        const outside: ChangeRequest = { ...change, queued: false, leftQueue: null }
        // Asked only where its branch has a queue, or may: one found without, a while ago, isn't asked again until it's due.
        const known = queues.get(queueKey(repository, change.target))
        if (known !== undefined && !known.enabled && (yield* Clock.currentTimeMillis) - known.at < NO_QUEUE_KEPT_MS) return outside
        const queue = yield* queueOf(repository, number, change.target).pipe(
          Effect.catch((error) =>
            known?.enabled === true
              ? Effect.fail(error)
              : // Where GitHub refuses the question itself, as a GitHub Enterprise without queues does, it isn't asked again for a
                // while. Failing otherwise (unreachable, rate limited), the next turn asks again. Either way the read stands
                // without, saying nothing of a queue: listening isn't stopped by a question it didn't need.
                error.reason === 'rejected' || error.reason === 'forbidden'
                ? Effect.map(Clock.currentTimeMillis, (at) => {
                    queues.set(queueKey(repository, change.target), { at, enabled: false })
                    return null
                  })
                : Effect.succeed(null),
          ),
        )
        if (queue === null) return change
        if (!queue.isMergeQueueEnabled) return outside
        return { ...change, queued: queue.isInMergeQueue, leftQueue: leftQueueOf(queue.timelineItems.nodes.at(-1)?.reason) }
      }),
    listChanges: (repository, query) =>
      Effect.gen(function* () {
        const q = searchOf(repository.path, query)
        if (q === undefined)
          return yield* Effect.fail(new ConnectorFailed({ product, reason: 'rejected', message: `Not a GitHub login: ${query.author}` }))
        const n = Math.min(Math.max(query.limit, 1), 100)
        const key = `${n} ${q}`
        const now = yield* Clock.currentTimeMillis
        const kept = listings.get(key)
        if (kept !== undefined && now - kept.at < LISTING_KEPT_MS) return kept.list
        const { search } = yield* http
          .graphql(SearchAnswer, graphqlUrl, SEARCH, { q, n })
          .pipe(Effect.mapError(lacking('repo (a fine-grained token’s Pull requests: Read)')))
        const changes = search.nodes.flatMap((node) => {
          const pull = Schema.decodeUnknownOption(ListedAnswer)(node)
          return pull._tag === 'Some' ? [listedOf(pull.value)] : []
        })
        const list: ChangeList = { changes, more: search.issueCount > changes.length }
        // A search asked a minute ago or more is asked again, so it goes, rather than stay for each cursor or query once asked.
        for (const [asked, listing] of listings) if (now - listing.at >= LISTING_KEPT_MS) listings.delete(asked)
        listings.set(key, { at: now, list })
        return list
      }),
    markReady: (repository, change) =>
      http
        .graphql(
          Schema.Unknown,
          graphqlUrl,
          'mutation($id: ID!) { markPullRequestReadyForReview(input: { pullRequestId: $id }) { pullRequest { id } } }',
          { id: change.id },
        )
        .pipe(Effect.andThen(Effect.map(http.json(PullAnswer, 'GET', `${repo(repository)}/pulls/${change.number}`), changeOf))),
    // Merged, as GitHub answers, it is: read back at once, it can still say open for a moment, and reading it takes as long again.
    merge: (repository, change) =>
      Effect.gen(function* () {
        const { conflicts: _, ...seen } = change
        const answer = yield* http
          .json(MergeAnswer, 'PUT', `${repo(repository)}/pulls/${change.number}/merge`, {
            merge_method: repository.merges[0] ?? 'merge',
            // Only the head Althar last saw: a push since then isn't merged unseen.
            ...(change.headSha === null ? {} : { sha: change.headSha }),
          })
          .pipe(
            // A branch that merges through a merge queue refuses a merge as one it can't make (405), in words that vary: asked,
            // GitHub says which, and the pull request goes in the queue, which merges it once the queue's checks pass.
            Effect.catchIf(
              (error) => error.status === 405,
              (refused) =>
                Effect.gen(function* () {
                  const queue = yield* queueOf(repository, change.number, change.target).pipe(Effect.mapError(() => refused))
                  if (!queue.isMergeQueueEnabled) return yield* Effect.fail(refused)
                  if (!queue.isInMergeQueue)
                    yield* http.graphql(Schema.Unknown, graphqlUrl, ENQUEUE, { id: change.id, head: change.headSha })
                  return null
                }),
            ),
          )
        if (answer === null)
          return { ...seen, state: 'open', queued: true, updatedAt: new Date(yield* Clock.currentTimeMillis).toISOString() } as const
        if (answer.merged === true)
          return { ...seen, state: 'merged', draft: false, updatedAt: new Date(yield* Clock.currentTimeMillis).toISOString() } as const
        return changeOf(yield* http.json(PullAnswer, 'GET', `${repo(repository)}/pulls/${change.number}`))
      }),
    closeChange: (repository, change) =>
      Effect.gen(function* () {
        const now = yield* http.json(PullAnswer, 'GET', `${repo(repository)}/pulls/${change.number}`)
        if (now.state !== 'open') return changeOf(now)
        return changeOf(yield* http.json(PullAnswer, 'PATCH', `${repo(repository)}/pulls/${change.number}`, { state: 'closed' }))
      }),
    deleteBranch: (repository, change) =>
      Effect.gen(function* () {
        const now = yield* http.json(PullAnswer, 'GET', `${repo(repository)}/pulls/${change.number}`)
        if (now.state === 'open') return yield* stillOpen(product, { noun: 'pull request', short: 'PR', prefix: '#' }, change.number)
        // Its branch is where its head is: a fork's, for one from a fork; a fork that is gone took it along.
        const on = now.head.repo?.full_name
        if (on == null) return
        const branch = branchPath(now.head.ref)
        yield* http.json(Schema.Unknown, 'DELETE', `${repo(on.split('/'))}/git/refs/heads/${branch}`).pipe(
          // GitHub answers 422 for a branch already gone, but for the default branch, a validation or throttling too: only one
          // GitHub then says isn't there is gone, and any other refusal is said.
          Effect.catchIf(
            (error) => error.status === 422,
            (refused) =>
              http.json(Schema.Unknown, 'GET', `${repo(on.split('/'))}/git/ref/heads/${branch}`).pipe(
                Effect.andThen(Effect.fail(refused)),
                Effect.catchIf(
                  (error) => error.reason === 'not_found',
                  () => Effect.void,
                ),
              ),
          ),
        )
      }),
    checks: (repository, sha) =>
      Effect.gen(function* () {
        // A fine-grained token is given no check runs, and GitHub refuses them: the commit's statuses are read alone.
        const runs = yield* http.cached(CheckRuns, `${repo(repository)}/commits/${encodeURIComponent(sha)}/check-runs?per_page=100`).pipe(
          Effect.catchIf(
            (error) => error.reason === 'forbidden',
            () => Effect.succeed<typeof CheckRuns.Type>({ check_runs: [] }),
          ),
        )
        const statuses = yield* http.cached(CombinedStatus, `${repo(repository)}/commits/${encodeURIComponent(sha)}/status`)
        const workflows = yield* runs.check_runs.some((run) => run.app?.slug === 'github-actions' && run.check_suite !== undefined)
          ? http
              .cached(
                Schema.Struct({
                  workflow_runs: Schema.Array(Schema.Struct({ check_suite_id: Schema.Number, name: Schema.NullOr(Schema.String) })),
                }),
                `${repo(repository)}/actions/runs?${/^[0-9a-f]{40,64}$/i.test(sha) ? 'head_sha' : 'branch'}=${encodeURIComponent(sha)}&per_page=100`,
              )
              .pipe(Effect.orElseSucceed(() => ({ workflow_runs: [] })))
          : Effect.succeed({ workflow_runs: [] })
        const fromRuns: ReadonlyArray<Check> = runs.check_runs.map((run) => ({
          id: `run:${run.id}:${run.app?.slug ?? ''}`,
          name: run.name,
          ...(run.started_at === undefined ? {} : { startedAt: run.started_at }),
          ...(run.completed_at === undefined ? {} : { completedAt: run.completed_at }),
          ...(run.check_suite === undefined
            ? {}
            : { workflow: workflows.workflow_runs.find((workflow) => workflow.check_suite_id === run.check_suite?.id)?.name ?? null }),
          state: checkRunState(run.status, run.conclusion),
          url: run.html_url ?? run.details_url ?? null,
          summary: run.output?.title ?? null,
        }))
        const fromStatuses: ReadonlyArray<Check> = statuses.statuses.map((status) => ({
          id: `status:${status.id}`,
          name: status.context,
          state: statusState(status.state),
          url: status.target_url ?? null,
          summary: status.description ?? null,
        }))
        return [...fromRuns, ...fromStatuses]
      }),
    checkLog: (repository, check, whole = false) => {
      // Only GitHub Actions keeps logs Althar can read: a check run's id is its job's. GitHub answers with a redirect to the log in
      // its storage, signed for a minute, which `text` follows without the token. Refused, or gone once kept long enough, it fails.
      const match = /^run:(\d+):github-actions$/.exec(check.id)
      if (match === null) return Effect.succeed(null)
      return http.text(`${repo(repository)}/actions/jobs/${match[1]}/logs`).pipe(Effect.map((log) => (whole ? log : tail(log))))
    },
    checkAnnotations: (repository, check) => {
      const match = /^run:(\d+):/.exec(check.id)
      if (match === null) return Effect.succeed([])
      return http
        .json(
          Schema.Array(Schema.Struct({ path: Schema.String, start_line: Schema.Number, message: Schema.String })),
          'GET',
          `${repo(repository)}/check-runs/${match[1]}/annotations?per_page=100`,
        )
        .pipe(Effect.map((rows) => rows.map((row) => ({ path: row.path, line: row.start_line, message: row.message }))))
    },
    checkArtifacts: (repository, check) =>
      Effect.gen(function* () {
        const match = /^run:(\d+):github-actions$/.exec(check.id)
        if (match === null) return []
        const job = yield* http.json(Schema.Struct({ run_id: Schema.Number }), 'GET', `${repo(repository)}/actions/jobs/${match[1]}`)
        const result = yield* http.json(
          Schema.Struct({
            artifacts: Schema.Array(
              Schema.Struct({ id: Schema.Number, name: Schema.String, size_in_bytes: Schema.Number, expired: Schema.Boolean }),
            ),
          }),
          'GET',
          `${repo(repository)}/actions/runs/${job.run_id}/artifacts?per_page=100`,
        )
        return result.artifacts
          .filter((row) => !row.expired)
          .map((row) => ({ id: String(row.id), name: row.name, size: row.size_in_bytes }))
      }),
    checkArtifact: (repository, id, maxBytes) =>
      http.bytes(`${repo(repository)}/actions/artifacts/${encodeURIComponent(id)}/zip`, maxBytes),
    checkReport: (repository, check) => {
      // A check run from another service (CodeQL, CircleCI's app) keeps its log there, but says what it found in its output.
      const match = /^run:(\d+):/.exec(check.id)
      if (match === null) return Effect.succeed(null)
      return Effect.map(http.json(CheckRunAnswer, 'GET', `${repo(repository)}/check-runs/${match[1]}`), (run) => {
        const said = [run.output?.summary, run.output?.text].filter((part) => part != null && part.trim() !== '').join('\n\n')
        return said === '' ? null : tail(said)
      })
    },
    rerun: (repository, check) => {
      // Only a GitHub Actions job runs again from here: its check run's id is the job's.
      const match = /^run:(\d+):github-actions$/.exec(check.id)
      if (match === null) return Effect.succeed(false)
      return http.json(Schema.Unknown, 'POST', `${repo(repository)}/actions/jobs/${match[1]}/rerun`).pipe(Effect.as(true))
    },
    activity: (repository, number, cursor) =>
      Effect.gen(function* () {
        const since = cursor === null ? '' : `&since=${encodeURIComponent(cursor)}`
        // Asked by ETag: a quiet pull request answers 304, which GitHub doesn't count against the rate limit.
        const conversation = yield* http.cached(
          Schema.Array(CommentAnswer),
          `${repo(repository)}/issues/${number}/comments?per_page=100${since}`,
        )
        const lines = yield* http.cached(Schema.Array(CommentAnswer), `${repo(repository)}/pulls/${number}/comments?per_page=100${since}`)
        const reviews = yield* http.cached(Schema.Array(ReviewAnswer), `${repo(repository)}/pulls/${number}/reviews?per_page=100`)
        const comments = [...conversation.map((comment) => commentOf(comment, false)), ...lines.map((comment) => commentOf(comment, true))]
        const reviewed = reviews.flatMap((review): ReadonlyArray<Review> => {
          const verdict = verdictOf(review.state)
          const at = review.submitted_at
          if (verdict === undefined || at == null || (cursor !== null && at < cursor)) return []
          // A "commented" review is its line comments, which come as comments; its own body only when it has one.
          if (verdict === 'commented' && (review.body ?? '') === '') return []
          return [
            {
              id: String(review.id),
              author: personOf(review.user),
              member: memberOf(review.author_association),
              verdict,
              body: review.body ?? '',
              at,
              url: review.html_url ?? null,
            },
          ]
        })
        const all = [...comments.map((comment) => comment.at), ...reviewed.map((review) => review.at)]
        const next = all.reduce((latest, at) => (at > latest ? at : latest), cursor ?? '')
        const byTime = <T extends { readonly at: string }>(items: ReadonlyArray<T>) => items.toSorted((a, b) => (a.at < b.at ? -1 : 1))
        return { comments: byTime(comments), reviews: byTime(reviewed), cursor: next } satisfies Activity
      }),
    reply: (repository, number, reply) =>
      reply.threadId === null
        ? Effect.map(http.json(CommentAnswer, 'POST', `${repo(repository)}/issues/${number}/comments`, { body: reply.body }), (comment) =>
            commentOf(comment, false),
          )
        : Effect.map(
            http.json(CommentAnswer, 'POST', `${repo(repository)}/pulls/${number}/comments/${reply.threadId}/replies`, {
              body: reply.body,
            }),
            (comment) => commentOf(comment, true),
          ),
    changeToReview: (repository, number) => Effect.map(http.json(PullAnswer, 'GET', `${repo(repository)}/pulls/${number}`), toReviewOf),
    postReview: (repository, number, review) =>
      Effect.map(
        http.json(PostedAnswer, 'POST', `${repo(repository)}/pulls/${number}/reviews`, {
          ...(review.commit === null ? {} : { commit_id: review.commit }),
          body: review.body,
          event: EVENTS[review.event],
          // On the change as it now reads: the right side of its diff.
          comments: review.comments.map((comment) => ({ path: comment.path, line: comment.line, side: 'RIGHT', body: comment.body })),
        }),
        (posted) => ({ id: String(posted.id), url: posted.html_url ?? null }),
      ),
    pushTarget: (repository) =>
      Effect.map(options.credential, (credential) => ({
        url: `${options.webUrl.replace(/\/+$/, '')}/${repository.path.join('/')}.git`,
        header: `Authorization: Basic ${Buffer.from(`x-access-token:${credential.token}`).toString('base64')}`,
      })),
    issue: (ref) =>
      Effect.gen(function* () {
        const { owner, name, number } = yield* parseRef(ref)
        const issue = yield* http.json(IssueAnswer, 'GET', `${repo([owner, name])}/issues/${number}`)
        return issueOf(issue, owner, name)
      }),
    mine: (options = {}) =>
      Effect.gen(function* () {
        const limit = options.limit ?? 50
        const me = yield* account
        const issues =
          options.container === undefined
            ? yield* http.json(Schema.Array(IssueAnswer), 'GET', `${api}/issues?filter=assigned&state=open&sort=updated&per_page=${limit}`)
            : yield* http.json(
                Schema.Array(IssueAnswer),
                'GET',
                `${repo(options.container.split('/'))}/issues?assignee=${encodeURIComponent(me.login)}&state=open&sort=updated&per_page=${limit}`,
              )
        return issues
          .filter((issue) => issue.pull_request === undefined)
          .map((issue) => {
            const [owner = '', name = ''] = options.container?.split('/') ?? issue.repository_url?.split('/').slice(-2) ?? []
            return issueOf(issue, owner, name)
          })
      }),
    comment: (issue, body) =>
      Effect.gen(function* () {
        const { owner, name, number } = yield* parseRef(issue.ref)
        yield* http.json(Schema.Unknown, 'POST', `${repo([owner, name])}/issues/${number}/comments`, { body })
      }),
    // GitHub's issues have no links: the pull request's mention of the issue links the two.
    link: () => Effect.void,
    // An issue is open or closed: a project board's Status is that board's own, so a started one is left as it is.
    start: (issue) => Effect.succeed(leftAsItIs(issue)),
    // The repositories the account is on, last pushed to first; one archived, or with its issues turned off, takes none.
    containers: () =>
      Effect.map(
        // A page short of a hundred is the last.
        paged(1, (page) =>
          Effect.map(http.json(Schema.Array(Listed), 'GET', `${api}/user/repos?per_page=100&sort=pushed&page=${page}`), (repositories) => ({
            items: repositories,
            next: repositories.length < 100 ? undefined : page + 1,
          })),
        ),
        (repositories) =>
          repositories
            .filter((repository) => repository.has_issues !== false && repository.archived !== true)
            .map((repository): Container => ({ id: repository.full_name, key: repository.full_name, name: repository.full_name })),
      ),
    create: (container, issue) =>
      Effect.gen(function* () {
        const match = repositoryRef.exec(container)
        if (match === null)
          return yield* new ConnectorFailed({ product, reason: 'not_found', message: `Not a GitHub repository: ${container}` })
        const [, owner = '', name = ''] = match
        // GitHub sets labels only for someone who can push, and drops them silently for anyone else; it makes those the repository lacks.
        const filed = yield* http.json(IssueAnswer, 'POST', `${repo([owner, name])}/issues`, {
          title: issue.title,
          body: issue.body,
          ...(issue.labels.length === 0 ? {} : { labels: issue.labels }),
        })
        return issueOf(filed, owner, name)
      }),
    choices: issueChoices,
    update: changeIssue,
  }
}

/*
 * What a GitHub connection can do. GitHub tells three kinds of token
 * apart by what it says of them: Althar's GitHub App signs in by the device
 * flow; a classic token, or an OAuth app's such as gh's, comes with its
 * scopes in a header; a fine-grained token comes with none, and its
 * permissions can't be read at all. Of those, only refusing a read shows:
 * pull requests, issues, statuses and Actions are each asked of a
 * repository it sees, and a write is said to be unknown.
 */

/** GitHub's page for a classic token, filled in: what it is for, and the scopes Althar uses, check runs included. */
export const classicTokenPage = (webUrl: string): string =>
  `${webUrl.replace(/\/+$/, '')}/settings/tokens/new?${new URLSearchParams({ description: 'Althar', scopes: 'repo,workflow' }).toString()}`

/** Where a person's tokens are listed: fine-grained ones on github.com; on a company's own server, which may predate them, classic ones. */
const tokensPage = (web: string) => (web === 'https://github.com' ? `${web}/settings/personal-access-tokens` : `${web}/settings/tokens`)

/** GitHub's time a token runs out (`2027-01-08 00:00:00 UTC`, `2023-03-08 13:28:54 +0100`) as an ISO time; null when it isn't one. */
export const expiryOf = (said: string | null): string | null => {
  const match = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) (UTC|[+-]\d{2}:?\d{2})$/.exec(said?.trim() ?? '')
  if (match === null) return null
  const [, date = '', time = '', zone = ''] = match
  const at = Date.parse(`${date}T${time}${zone === 'UTC' ? 'Z' : `${zone.slice(0, 3)}:${zone.slice(-2)}`}`)
  return Number.isNaN(at) ? null : new Date(at).toISOString()
}

/** A repository it sees: its owner as GitHub spells it, whether the account may push there (GitHub says so only to some), and its default branch. */
interface Found {
  readonly path: ReadonlyArray<string>
  readonly owner: string
  readonly push: boolean | undefined
  readonly branch: string
}

export const accessGitHub: Access = (input: AccessInput) =>
  Effect.gen(function* () {
    const api = input.apiUrl.replace(/\/+$/, '')
    const web = input.webUrl.replace(/\/+$/, '')
    const ask = (url: string) => probe(input, url, { headers: HEADERS })
    const repo = (path: ReadonlyArray<string>) => `${api}/repos/${path.map(encodeURIComponent).join('/')}`

    const me = yield* ask(`${api}/user`)
    if (!answered(me)) return stopped([line('account', 'no', { reason: refusalOf(me) })])
    const user = readAs(User, me)
    if (user === undefined) return stopped([line('account', 'no', { reason: UNREADABLE })])
    const said = me.headers.get('x-oauth-scopes')
    const scopes =
      said === null
        ? null
        : said
            .split(',')
            .map((scope) => scope.trim())
            .filter((scope) => scope !== '')
    const kind = input.auth === 'device_flow' ? 'app' : scopes === null ? 'fine' : 'classic'
    // Where a token is put right: a classic one in the list of classic tokens.
    const settings = kind === 'classic' ? `${web}/settings/tokens` : tokensPage(web)

    const reachOf = (path: ReadonlyArray<string>) =>
      Effect.map(ask(repo(path)), (answer): Reached<Found> => {
        const owner = path[0] ?? ''
        if (answered(answer)) {
          const found = readAs(RepositoryAnswer, answer)
          return found === undefined
            ? { path, missed: UNREADABLE }
            : {
                path,
                seen: { path, owner: found.full_name.split('/')[0] ?? owner, push: found.permissions?.push, branch: found.default_branch },
              }
        }
        if (answer.status === 404)
          return {
            path,
            missed:
              kind === 'app'
                ? {
                    kind: 'not_installed',
                    owner,
                    url: input.appSlug === undefined ? null : `${web}/apps/${input.appSlug}/installations/new`,
                  }
                : { kind: 'unseen', names: [path.join('/')], url: settings },
          }
        if (answer.status === 403 && !limited(answer)) {
          const sso = /^required; url=(\S+)/.exec(answer.headers.get('x-github-sso') ?? '')?.[1]
          if (sso !== undefined) return { path, missed: { kind: 'sso', owner, url: sso } }
          if (/OAuth App access restrictions/i.test(answer.message)) return { path, missed: { kind: 'restricted', owner } }
        }
        return { path, missed: failedOf(answer) }
      })

    /** A line a classic token's `repo` scope decides. */
    const byScope = (need: AccessNeed) =>
      scopes?.includes('repo') === true ? line(need, 'ok') : line(need, 'no', { reason: { kind: 'scope', scope: 'repo', url: settings } })

    /** Why a fine-grained token's read was refused, by the permission its page names; null where it wasn't. */
    const refusedFor = (answer: Answer, permission: string): AccessReason | null =>
      troubled(answer) ? failedOf(answer) : answer.status === 403 ? { kind: 'permission', permission, url: settings } : null

    /** A fine-grained token's line for a write, from a read of the same permission: no where it was refused, and unknown otherwise. */
    const writeOf = (need: AccessNeed, url: string, permission: string) =>
      Effect.map(ask(url), (answer) => {
        const reason = refusedFor(answer, permission)
        return reason === null ? line(need, 'unknown', { reason: UNSAID }) : line(need, 'no', { reason })
      })

    /** A fine-grained token's checks: check runs, which GitHub gives it none of, then the commit's statuses and Actions' runs. */
    const checksOf = (found: Found) =>
      Effect.gen(function* () {
        const head = `${repo(found.path)}/commits/${encodeURIComponent(found.branch)}`
        const runs = yield* ask(`${head}/check-runs?per_page=1`)
        if (troubled(runs)) return line('checks', 'no', { reason: failedOf(runs) })
        if (runs.status === 403) return line('checks', 'no', { reason: { kind: 'no_check_runs', url: classicTokenPage(web) } })
        const statuses = refusedFor(yield* ask(`${head}/status`), 'Commit statuses')
        if (statuses !== null) return line('checks', 'no', { reason: statuses })
        const actions = refusedFor(yield* ask(`${repo(found.path)}/actions/runs?per_page=1`), 'Actions')
        return actions === null ? line('checks', 'ok') : line('checks', 'no', { reason: actions })
      })

    const lines: Array<AccessLine> = [line('account', 'ok', { fact: user.login })]
    const reached = yield* Effect.forEach(input.repositories, reachOf, { concurrency: 4 })
    const seen = seenOf(reached)
    const owners = [...new Set(seen.map((found) => found.owner))].join(', ')
    if (reached.length > 0) lines.push(reachLine(reached, owners === '' ? null : owners))
    const [first] = seen

    // Where GitHub says the account itself may not push, no token of it may.
    if (seen.some((found) => found.push === false)) lines.push(line('push', 'no', { reason: { kind: 'role', role: null } }))
    else if (kind === 'classic') lines.push(byScope('push'))
    else lines.push(kind === 'app' ? line('push', 'ok') : line('push', 'unknown', { reason: UNSAID }))

    if (kind === 'classic') lines.push(byScope('changes'), byScope('checks'), byScope('issues'))
    else if (kind === 'app') lines.push(line('changes', 'ok'), line('checks', 'ok'), line('issues', 'ok'))
    else if (first === undefined)
      lines.push(...(['changes', 'checks', 'issues'] as const).map((need) => line(need, 'unknown', { reason: UNSAID })))
    else
      lines.push(
        yield* writeOf('changes', `${repo(first.path)}/pulls?per_page=1&state=all`, 'Pull requests'),
        yield* checksOf(first),
        yield* writeOf('issues', `${repo(first.path)}/issues?per_page=1`, 'Issues'),
      )

    return {
      account: { id: String(user.id), login: user.login, name: user.name ?? null },
      lines,
      expiresAt: expiryOf(me.headers.get('github-authentication-token-expiration')),
      scopes,
    }
  })
