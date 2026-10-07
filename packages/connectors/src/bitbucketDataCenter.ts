import { Effect, Schema } from 'effect'

import { type AdapterOptions, authorizationOf } from './credential'
import { ConnectorFailed } from './errors'
import { type Http, makeHttp } from './http'
import type {
  Account,
  Activity,
  ChangeRequest,
  Check,
  CheckState,
  CodeHost,
  Comment,
  MergeMethod,
  Person,
  Repository,
  Review,
  Verdict,
} from './model'

/*
 * Bitbucket Data Center, on a company's own server: a code host of pull
 * requests over its REST API (`/rest/api/latest`), signed in with an HTTP
 * access token. A repository is `PROJECT/repo`, or `~user/repo` for a
 * person's own. Its checks are the build statuses of the head; it keeps no
 * logs of its own. Comments come from the pull request's activities, each
 * top-level one with its replies, so every reply finds its thread.
 */

const UserAnswer = Schema.Struct({
  id: Schema.Number,
  name: Schema.String,
  displayName: Schema.optional(Schema.NullOr(Schema.String)),
  // A service account, such as a project's access token, is SERVICE.
  type: Schema.optional(Schema.String),
})
type UserAnswer = typeof UserAnswer.Type

const RepositoryAnswer = Schema.Struct({
  id: Schema.Number,
  slug: Schema.String,
  name: Schema.String,
  project: Schema.Struct({ key: Schema.String }),
  links: Schema.optional(Schema.Struct({ self: Schema.optional(Schema.Array(Schema.Struct({ href: Schema.String }))) })),
})

const Settings = Schema.Struct({
  mergeConfig: Schema.optional(
    Schema.Struct({
      strategies: Schema.optional(Schema.Array(Schema.Struct({ id: Schema.String, enabled: Schema.optional(Schema.Boolean) }))),
    }),
  ),
})

const RefAnswer = Schema.Struct({
  id: Schema.String,
  displayId: Schema.String,
  latestCommit: Schema.optional(Schema.NullOr(Schema.String)),
  repository: Schema.Struct({ slug: Schema.String, project: Schema.Struct({ key: Schema.String }) }),
})

const PullAnswer = Schema.Struct({
  id: Schema.Number,
  version: Schema.Number,
  title: Schema.String,
  description: Schema.optional(Schema.NullOr(Schema.String)),
  state: Schema.String,
  // Since 8.18.
  draft: Schema.optional(Schema.Boolean),
  fromRef: RefAnswer,
  toRef: RefAnswer,
  author: Schema.optional(Schema.NullOr(Schema.Struct({ user: UserAnswer }))),
  reviewers: Schema.optional(Schema.Array(Schema.Struct({ user: UserAnswer }))),
  links: Schema.optional(Schema.Struct({ self: Schema.optional(Schema.Array(Schema.Struct({ href: Schema.String }))) })),
  updatedDate: Schema.Number,
})
type PullAnswer = typeof PullAnswer.Type

const Mergeability = Schema.Struct({
  canMerge: Schema.Boolean,
  vetoes: Schema.optional(
    Schema.Array(Schema.Struct({ summaryMessage: Schema.optional(Schema.String), detailedMessage: Schema.optional(Schema.String) })),
  ),
})

const BuildAnswer = Schema.Struct({
  key: Schema.String,
  name: Schema.optional(Schema.NullOr(Schema.String)),
  state: Schema.String,
  url: Schema.optional(Schema.NullOr(Schema.String)),
  description: Schema.optional(Schema.NullOr(Schema.String)),
})

interface CommentAnswer {
  readonly id: number
  readonly text?: string | null | undefined
  readonly author: UserAnswer
  readonly updatedDate: number
  readonly pending?: boolean | undefined
  readonly comments?: ReadonlyArray<CommentAnswer> | undefined
}
const CommentAnswer: Schema.Codec<CommentAnswer, unknown> = Schema.Struct({
  id: Schema.Number,
  text: Schema.optional(Schema.NullOr(Schema.String)),
  author: UserAnswer,
  updatedDate: Schema.Number,
  // A comment of a review not yet finished, which only its author sees.
  pending: Schema.optional(Schema.Boolean),
  // Its replies, and theirs.
  comments: Schema.optional(Schema.Array(Schema.suspend((): Schema.Codec<CommentAnswer, unknown> => CommentAnswer))),
})

/** Where a comment sits: its thread, the top-level comment's id, and that comment's place in the diff. */
interface Thread {
  readonly id: string
  readonly path: string | null
  readonly line: number | null
}

const ActivityAnswer = Schema.Struct({
  id: Schema.Number,
  action: Schema.String,
  createdDate: Schema.Number,
  user: UserAnswer,
  commentAction: Schema.optional(Schema.String),
  comment: Schema.optional(CommentAnswer),
  commentAnchor: Schema.optional(
    Schema.NullOr(
      Schema.Struct({ path: Schema.optional(Schema.NullOr(Schema.String)), line: Schema.optional(Schema.NullOr(Schema.Number)) }),
    ),
  ),
})

const Page = <A>(item: Schema.Codec<A, unknown>) =>
  Schema.Struct({
    values: Schema.Array(item),
    isLastPage: Schema.optional(Schema.Boolean),
    nextPageStart: Schema.optional(Schema.NullOr(Schema.Number)),
  })

/** How many pages of a hundred activities, or build statuses, are read. */
const PAGES = 10

/** Data Center's strategies, in the order Althar prefers them, and the way each merges. */
const STRATEGIES: ReadonlyArray<readonly [string, MergeMethod]> = [
  ['squash', 'squash'],
  ['squash-ff-only', 'squash'],
  ['no-ff', 'merge'],
  // Fast-forward where it can, a merge commit where it can't.
  ['ff', 'merge'],
  ['rebase-no-ff', 'merge'],
  ['rebase-ff-only', 'rebase'],
  ['ff-only', 'rebase'],
]

/** How the repository lets pull requests be merged, in the order Althar prefers. */
export const mergesOf = (strategies: ReadonlyArray<string>): ReadonlyArray<MergeMethod> => [
  ...new Set(STRATEGIES.filter(([strategy]) => strategies.includes(strategy)).map(([, method]) => method)),
]

/** The strategy Althar merges with: the first it prefers that the repository allows. */
export const strategyOf = (strategies: ReadonlyArray<string>): string | undefined =>
  STRATEGIES.find(([strategy]) => strategies.includes(strategy))?.[0]

/** A build's state. */
export const buildState = (state: string): CheckState => {
  switch (state) {
    case 'SUCCESSFUL':
      return 'passed'
    case 'FAILED':
      return 'failed'
    case 'INPROGRESS':
      return 'running'
    case 'CANCELLED':
      return 'cancelled'
    default:
      return 'neutral'
  }
}

const personOf = (user: UserAnswer): Person => ({
  id: String(user.id),
  login: user.name,
  name: user.displayName ?? null,
  bot: user.type === 'SERVICE',
})

/** A time as the model keeps it: Data Center's are milliseconds. */
const iso = (at: number) => new Date(at).toISOString()

export const makeBitbucketDataCenter = (options: AdapterOptions): CodeHost => {
  const product = 'bitbucket_dc' as const
  const api = options.apiUrl.replace(/\/+$/, '')
  const web = options.webUrl.replace(/\/+$/, '')
  // Build statuses have their own API, beside the main one.
  const rest = api.replace(/\/api\/[^/]+$/, '')
  const raw = makeHttp({ product, fetch: options.fetch, authorization: Effect.map(options.credential, authorizationOf) })

  /** Who the token signs in as: Data Center has no endpoint for it, but says so in a header of every answer. */
  const whoami = Effect.flatMap(raw.headers(`${api}/application-properties`), (headers) => {
    const name = headers.get('x-ausername')
    return name === null
      ? Effect.fail(new ConnectorFailed({ product, reason: 'unauthorized', message: 'Bitbucket signed no one in with the token' }))
      : Effect.succeed({ name, id: headers.get('x-auserid') })
  })

  /** Data Center's 401 is also its word for an account that may not do something: only a token that signs no one in is unauthorized. */
  const allowed = <A>(effect: Effect.Effect<A, ConnectorFailed>) =>
    Effect.catchIf(
      effect,
      (error) => error.status === 401,
      (error) =>
        Effect.flatMap(whoami, () =>
          Effect.fail(new ConnectorFailed({ product, reason: 'forbidden', status: 401, message: error.message })),
        ),
    )
  const http: Pick<Http, 'json' | 'cached'> = {
    json: (schema, method, url, body) => allowed(raw.json(schema, method, url, body)),
    cached: (schema, url) => allowed(raw.cached(schema, url)),
  }

  const repo = (project: string, slug: string) => `${api}/projects/${encodeURIComponent(project)}/repos/${encodeURIComponent(slug)}`
  const base = (repository: Repository) => repo(repository.path[0] ?? '', repository.path[1] ?? '')
  const pull = (repository: Repository, number: number) => `${base(repository)}/pull-requests/${number}`

  /** Every page of a list, by `start`, within a bound. */
  const all = <A>(item: Schema.Codec<A, unknown>, url: string) =>
    Effect.gen(function* () {
      const found: Array<A> = []
      let start: number | null | undefined = 0
      for (let page = 0; page < PAGES && start != null; page += 1) {
        const answer: {
          readonly values: ReadonlyArray<A>
          readonly isLastPage?: boolean | undefined
          readonly nextPageStart?: number | null | undefined
        } = yield* http.cached(Page(item), `${url}?limit=100&start=${start}`)
        found.push(...answer.values)
        start = answer.isLastPage === false ? answer.nextPageStart : null
      }
      return found
    })

  const account: Effect.Effect<Account, ConnectorFailed> = Effect.gen(function* () {
    const me = yield* whoami
    // The name the header gives, found among the users for the rest; a service account may not be listed.
    const users = yield* http
      .json(Page(UserAnswer), 'GET', `${api}/users?filter=${encodeURIComponent(me.name)}&limit=100`)
      .pipe(Effect.orElseSucceed(() => ({ values: [] })))
    const user = users.values.find((found) => found.name.toLowerCase() === me.name.toLowerCase())
    return user === undefined
      ? { id: me.id ?? me.name, login: me.name, name: null }
      : { id: String(user.id), login: user.name, name: user.displayName ?? null }
  })

  const changeOf = (repository: Repository, answer: PullAnswer): ChangeRequest => ({
    // Numbers are only the repository's own, so the repository names it too.
    id: `${repository.id}:${answer.id}`,
    number: answer.id,
    title: answer.title,
    body: answer.description ?? '',
    url: answer.links?.self?.[0]?.href ?? `${repository.webUrl}/pull-requests/${answer.id}`,
    state: answer.state === 'MERGED' ? 'merged' : answer.state === 'OPEN' ? 'open' : 'closed',
    draft: answer.draft === true,
    source: answer.fromRef.displayId,
    target: answer.toRef.displayId,
    headSha: answer.fromRef.latestCommit ?? null,
    author: answer.author == null ? null : personOf(answer.author.user),
    // Data Center counts neither lines nor files on a pull request.
    additions: null,
    deletions: null,
    changedFiles: null,
    updatedAt: iso(answer.updatedDate),
  })

  /** Whether this repository is the one a ref is in. */
  const within = (repository: Repository, ref: typeof RefAnswer.Type) =>
    ref.repository.project.key.toLowerCase() === (repository.path[0] ?? '').toLowerCase() && ref.repository.slug === repository.path[1]

  const findChange = (repository: Repository, source: string) =>
    Effect.map(
      http.json(
        Page(PullAnswer),
        'GET',
        `${base(repository)}/pull-requests?at=${encodeURIComponent(`refs/heads/${source}`)}&direction=OUTGOING&state=OPEN`,
      ),
      (pulls) => {
        // Outgoing includes one from this branch to a fork's parent; only one into this repository counts.
        const found = pulls.values.find((answer) => answer.fromRef.id === `refs/heads/${source}` && within(repository, answer.toRef))
        return found === undefined ? null : changeOf(repository, found)
      },
    )

  /** Whether someone can write to the repository, as Data Center's search of its users by permission says. */
  const memberOf = (repository: Repository, user: UserAnswer) =>
    Effect.map(
      http.cached(
        Page(UserAnswer),
        `${api}/users?filter=${encodeURIComponent(user.name)}&permission=REPO_WRITE&permission.projectKey=${encodeURIComponent(repository.path[0] ?? '')}&permission.repositorySlug=${encodeURIComponent(repository.path[1] ?? '')}&limit=100`,
      ),
      (users) => users.values.some((found) => found.id === user.id),
    )

  const commentOf = (repository: Repository, number: number, comment: CommentAnswer, thread: Thread, member: boolean): Comment => ({
    id: String(comment.id),
    author: personOf(comment.author),
    member,
    body: comment.text ?? '',
    at: iso(comment.updatedDate),
    url: `${repository.webUrl}/pull-requests/${number}/overview?commentId=${comment.id}`,
    threadId: thread.id,
    path: thread.path,
    line: thread.line,
  })

  return {
    product,
    words: { noun: 'pull request', short: 'PR', prefix: '#' },
    capabilities: { drafts: true, checkLogs: false, threads: true },
    account,
    repository: (path) =>
      Effect.gen(function* () {
        // A link's `PROJECT/repo`, an SSH remote's `project/repo`, an HTTPS remote's `scm/project/repo`, perhaps under the server's own path.
        const [project = '', slug = ''] = path.slice(-2)
        const answer = yield* http.cached(RepositoryAnswer, repo(project, slug))
        const here = repo(answer.project.key, answer.slug)
        const branch = yield* http.cached(Schema.Struct({ displayId: Schema.String }), `${here}/default-branch`)
        // Whether the account can push: the repositories it may write to, by this one's name; no admin needed.
        const writable = yield* http.cached(
          Page(Schema.Struct({ id: Schema.Number })),
          `${api}/repos?projectkey=${encodeURIComponent(answer.project.key)}&name=${encodeURIComponent(answer.name)}&permission=REPO_WRITE&limit=100`,
        )
        const settings = yield* http.cached(Settings, `${here}/settings/pull-requests`)
        const enabled = (settings.mergeConfig?.strategies ?? [])
          .filter((strategy) => strategy.enabled !== false)
          .map((strategy) => strategy.id)
        return {
          id: String(answer.id),
          path: [answer.project.key, answer.slug],
          defaultBranch: branch.displayId,
          webUrl: answer.links?.self?.[0]?.href.replace(/\/browse\/?$/, '') ?? `${web}/projects/${answer.project.key}/repos/${answer.slug}`,
          canPush: writable.values.some((found) => found.id === answer.id),
          merges: mergesOf(enabled),
        }
      }),
    findChange,
    openChange: (repository, change) =>
      Effect.gen(function* () {
        // One already open from the branch is the one: adopted, not duplicated.
        const open = yield* findChange(repository, change.source)
        if (open !== null) return open
        const at = { slug: repository.path[1], project: { key: repository.path[0] } }
        return yield* http
          .json(PullAnswer, 'POST', `${base(repository)}/pull-requests`, {
            title: change.title,
            description: change.body,
            fromRef: { id: `refs/heads/${change.source}`, repository: at },
            toRef: { id: `refs/heads/${change.target}`, repository: at },
            // A server older than 8.18 opens it ready.
            draft: change.draft,
          })
          .pipe(
            Effect.map((answer) => changeOf(repository, answer)),
            // Opened by someone else meanwhile, Data Center's 409: theirs is the one.
            Effect.catchIf(
              (error) => error.reason === 'rejected',
              (error) =>
                Effect.flatMap(findChange(repository, change.source), (found) =>
                  found === null ? Effect.fail(error) : Effect.succeed(found),
                ),
            ),
          )
      }),
    change: (repository, number) => Effect.map(http.cached(PullAnswer, pull(repository, number)), (answer) => changeOf(repository, answer)),
    markReady: (repository, change) =>
      Effect.gen(function* () {
        const now = yield* http.json(PullAnswer, 'GET', pull(repository, change.number))
        if (now.draft !== true) return changeOf(repository, now)
        // At the version read, with what it has sent back, so nothing else changes: reviewers left out would be taken off.
        const ready = yield* http.json(PullAnswer, 'PUT', pull(repository, change.number), {
          version: now.version,
          title: now.title,
          description: now.description ?? '',
          reviewers: (now.reviewers ?? []).map((reviewer) => ({ user: { name: reviewer.user.name } })),
          draft: false,
        })
        return changeOf(repository, ready)
      }),
    merge: (repository, change) =>
      Effect.gen(function* () {
        const url = pull(repository, change.number)
        const now = yield* http.json(PullAnswer, 'GET', url)
        const head = now.fromRef.latestCommit ?? null
        // The head Althar last saw, or a 409 as GitHub's; the version read guards the moment between.
        if (change.headSha !== null && head !== null && head !== change.headSha)
          return yield* new ConnectorFailed({
            product,
            reason: 'rejected',
            status: 409,
            message: `The pull request moved on to ${head.slice(0, 12)} since ${change.headSha.slice(0, 12)} was seen`,
          })
        const settings = yield* http.cached(Settings, `${base(repository)}/settings/pull-requests`)
        const strategy = strategyOf((settings.mergeConfig?.strategies ?? []).filter((one) => one.enabled !== false).map((one) => one.id))
        const merged = yield* http
          .json(PullAnswer, 'POST', `${url}/merge?version=${now.version}`, strategy === undefined ? {} : { strategyId: strategy })
          .pipe(
            Effect.catchIf(
              (error) => error.status === 409,
              (error) =>
                Effect.gen(function* () {
                  // 409 is Data Center's word for a version out of date and for a merge it won't make: asking whether it can says which.
                  const can = yield* http.json(Mergeability, 'GET', `${url}/merge`)
                  if (can.canMerge) return yield* Effect.fail(error)
                  const why = (can.vetoes ?? []).flatMap((veto) => {
                    const words = veto.detailedMessage ?? veto.summaryMessage ?? ''
                    return words === '' ? [] : [words]
                  })
                  return yield* new ConnectorFailed({
                    product,
                    reason: 'rejected',
                    message: why.length > 0 ? why.join(' ') : error.message,
                  })
                }),
            ),
          )
        return changeOf(repository, merged)
      }),
    checks: (_repository, sha) =>
      Effect.map(all(BuildAnswer, `${rest}/build-status/latest/commits/${encodeURIComponent(sha)}`), (builds) =>
        builds.map((build): Check => ({
          id: `status:${build.key}`,
          name: build.name ?? build.key,
          state: buildState(build.state),
          url: build.url ?? null,
          summary: build.description != null && build.description !== '' ? build.description : null,
        })),
      ),
    // A build's log is the build server's, which Althar isn't signed in to.
    checkLog: () => Effect.succeed(null),
    activity: (repository, number, cursor) =>
      Effect.gen(function* () {
        const activities = yield* all(ActivityAnswer, `${pull(repository, number)}/activities`)
        // Each top-level comment's activity holds it as it is now, with every reply: one thread, at its place in the diff.
        const said: Array<{ readonly comment: CommentAnswer; readonly thread: Thread }> = []
        const walk = (comment: CommentAnswer, thread: Thread) => {
          if (comment.pending !== true) said.push({ comment, thread })
          for (const reply of comment.comments ?? []) walk(reply, thread)
        }
        for (const activity of activities)
          if (activity.action === 'COMMENTED' && activity.commentAction === 'ADDED' && activity.comment !== undefined)
            walk(activity.comment, {
              id: String(activity.comment.id),
              path: activity.commentAnchor?.path ?? null,
              line: activity.commentAnchor?.line ?? null,
            })
        const fresh = said.filter(({ comment }) => cursor === null || iso(comment.updatedDate) >= cursor)
        const verdicts = activities.flatMap((activity) => {
          const verdict: Verdict | undefined =
            activity.action === 'APPROVED' ? 'approved' : activity.action === 'REVIEWED' ? 'changes_requested' : undefined
          return verdict === undefined || (cursor !== null && iso(activity.createdDate) < cursor) ? [] : [{ verdict, activity }]
        })
        // Asked once per author: whether they can write to the repository.
        const members = new Map<number, boolean>()
        for (const user of [...fresh.map(({ comment }) => comment.author), ...verdicts.map(({ activity }) => activity.user)])
          if (!members.has(user.id)) members.set(user.id, yield* memberOf(repository, user))
        const comments = fresh.map(({ comment, thread }) =>
          commentOf(repository, number, comment, thread, members.get(comment.author.id) === true),
        )
        const reviews = verdicts.map(({ verdict, activity }): Review => ({
          id: String(activity.id),
          author: personOf(activity.user),
          member: members.get(activity.user.id) === true,
          verdict,
          body: '',
          at: iso(activity.createdDate),
          url: `${repository.webUrl}/pull-requests/${number}/overview`,
        }))
        const at = [...comments.map((comment) => comment.at), ...reviews.map((review) => review.at)]
        const next = at.reduce((latest, one) => (one > latest ? one : latest), cursor ?? '')
        const byTime = <T extends { readonly at: string }>(items: ReadonlyArray<T>) => items.toSorted((a, b) => (a.at < b.at ? -1 : 1))
        return { comments: byTime(comments), reviews: byTime(reviews), cursor: next } satisfies Activity
      }),
    reply: (repository, number, reply) =>
      Effect.map(
        http.json(CommentAnswer, 'POST', `${pull(repository, number)}/comments`, {
          text: reply.body,
          ...(reply.threadId === null ? {} : { parent: { id: Number(reply.threadId) } }),
        }),
        // Althar's own reply: whether it counts as a member's doesn't matter, it is known by its receipt.
        (comment) => commentOf(repository, number, comment, { id: reply.threadId ?? String(comment.id), path: null, line: null }, true),
      ),
    pushTarget: (repository) =>
      Effect.map(options.credential, (credential) => ({
        url: `${web}/scm/${(repository.path[0] ?? '').toLowerCase()}/${repository.path[1] ?? ''}.git`,
        // Git takes an HTTP access token as the API does: a bearer header.
        header: `Authorization: ${authorizationOf(credential)}`,
      })),
  }
}
