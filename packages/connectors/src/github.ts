import { Effect, Schema } from 'effect'

import { type AdapterOptions, authorizationOf } from './credential'
import { ConnectorFailed } from './errors'
import { makeHttp } from './http'
import type {
  Account,
  Activity,
  ChangeRequest,
  Check,
  CheckState,
  CodeHost,
  Comment,
  Issue,
  Person,
  Repository,
  Review,
  Tracker,
  Verdict,
} from './model'

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
  head: Schema.Struct({ ref: Schema.String, sha: Schema.String }),
  base: Schema.Struct({ ref: Schema.String }),
  user: Schema.optional(Schema.NullOr(User)),
  additions: Schema.optional(Schema.Number),
  deletions: Schema.optional(Schema.Number),
  changed_files: Schema.optional(Schema.Number),
  updated_at: Schema.String,
})
type PullAnswer = typeof PullAnswer.Type

const CheckRuns = Schema.Struct({
  check_runs: Schema.Array(
    Schema.Struct({
      id: Schema.Number,
      name: Schema.String,
      status: Schema.String,
      conclusion: Schema.optional(Schema.NullOr(Schema.String)),
      html_url: Schema.optional(Schema.NullOr(Schema.String)),
      details_url: Schema.optional(Schema.NullOr(Schema.String)),
      output: Schema.optional(Schema.Struct({ title: Schema.optional(Schema.NullOr(Schema.String)) })),
      app: Schema.optional(Schema.NullOr(Schema.Struct({ slug: Schema.optional(Schema.String) }))),
    }),
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
})

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

/** `owner/repo#12`: the ref GitHub's issues go by. */
const issueRef = /^([^/\s]+)\/([^#\s]+)#(\d+)$/

export const makeGitHub = (options: AdapterOptions): CodeHost & Tracker => {
  const product = 'github' as const
  const api = options.apiUrl.replace(/\/+$/, '')
  const graphqlUrl = api.endsWith('/api/v3') ? `${api.slice(0, -'/v3'.length)}/graphql` : `${api}/graphql`
  const http = makeHttp({
    product,
    fetch: options.fetch,
    authorization: Effect.map(options.credential, authorizationOf),
    headers: { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' },
  })
  const repo = (repository: Repository | ReadonlyArray<string>) =>
    `${api}/repos/${('path' in repository ? repository.path : repository).map(encodeURIComponent).join('/')}`

  const account: Effect.Effect<Account, ConnectorFailed> = Effect.map(http.json(User, 'GET', `${api}/user`), (user) => ({
    id: String(user.id),
    login: user.login,
    name: user.name ?? null,
  }))

  const findChange = (repository: Repository, source: string) =>
    Effect.map(
      http.json(
        Schema.Array(PullAnswer),
        'GET',
        `${repo(repository)}/pulls?state=open&head=${encodeURIComponent(`${repository.path[0]}:${source}`)}`,
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

  return {
    product,
    words: { noun: 'pull request', short: 'PR', prefix: '#' },
    capabilities: { drafts: true, checkLogs: true, threads: true, links: false },
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
          head: change.source,
          base: change.target,
          draft: change.draft,
        })
        .pipe(
          Effect.map(changeOf),
          // One already open from the branch is the one: adopted, not duplicated.
          Effect.catchIf(
            (error) => error.reason === 'rejected' && /already exists/i.test(error.message),
            (error) =>
              Effect.flatMap(findChange(repository, change.source), (found) =>
                found === null ? Effect.fail(error) : Effect.succeed(found),
              ),
          ),
        ),
    change: (repository, number) => Effect.map(http.cached(PullAnswer, `${repo(repository)}/pulls/${number}`), changeOf),
    markReady: (repository, change) =>
      http
        .graphql(
          Schema.Unknown,
          graphqlUrl,
          'mutation($id: ID!) { markPullRequestReadyForReview(input: { pullRequestId: $id }) { pullRequest { id } } }',
          { id: change.id },
        )
        .pipe(Effect.andThen(Effect.map(http.json(PullAnswer, 'GET', `${repo(repository)}/pulls/${change.number}`), changeOf))),
    merge: (repository, change) =>
      http
        .json(Schema.Unknown, 'PUT', `${repo(repository)}/pulls/${change.number}/merge`, {
          merge_method: repository.merges[0] ?? 'merge',
          // Only the head Charrette last saw: a push since then isn't merged unseen.
          ...(change.headSha === null ? {} : { sha: change.headSha }),
        })
        .pipe(Effect.andThen(Effect.map(http.json(PullAnswer, 'GET', `${repo(repository)}/pulls/${change.number}`), changeOf))),
    checks: (repository, sha) =>
      Effect.gen(function* () {
        const runs = yield* http.cached(CheckRuns, `${repo(repository)}/commits/${sha}/check-runs?per_page=100`)
        const statuses = yield* http.cached(CombinedStatus, `${repo(repository)}/commits/${sha}/status`)
        const fromRuns: ReadonlyArray<Check> = runs.check_runs.map((run) => ({
          id: `run:${run.id}:${run.app?.slug ?? ''}`,
          name: run.name,
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
    checkLog: (repository, check) => {
      // Only GitHub Actions keeps logs Charrette can read: a check run's id is its job's.
      const match = /^run:(\d+):github-actions$/.exec(check.id)
      if (match === null) return Effect.succeed(null)
      return http.text(`${repo(repository)}/actions/jobs/${match[1]}/logs`).pipe(
        Effect.map(tail),
        Effect.catchIf(
          (error) => error.reason === 'not_found' || error.reason === 'forbidden',
          () => Effect.succeed(null),
        ),
      )
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
  }
}
