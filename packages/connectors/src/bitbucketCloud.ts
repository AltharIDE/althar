import { Effect, Schema } from 'effect'

import { type AdapterOptions, authorizationOf } from './credential'
import { ConnectorFailed } from './errors'
import { tail } from './github'
import { makeHttp } from './http'
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
 * Bitbucket Cloud: a code host of pull requests over its REST API
 * (`api.bitbucket.org/2.0`), signed in with an Atlassian API token and the
 * account's email. A repository is `workspace/repo`. Its checks are the
 * head's commit statuses, Pipelines' among them, whose steps keep logs.
 * Every comment can be replied to, so each starts a thread. Bitbucket has
 * no issues here: Jira is a tracker of its own.
 */

const User = Schema.Struct({
  uuid: Schema.optional(Schema.String),
  display_name: Schema.optional(Schema.NullOr(Schema.String)),
  // An app's user, such as a bot, has none.
  nickname: Schema.optional(Schema.NullOr(Schema.String)),
  type: Schema.optional(Schema.String),
})
type User = typeof User.Type

const RepositoryAnswer = Schema.Struct({
  uuid: Schema.String,
  full_name: Schema.String,
  name: Schema.String,
  // An empty repository has no main branch yet.
  mainbranch: Schema.optional(Schema.NullOr(Schema.Struct({ name: Schema.String }))),
  links: Schema.Struct({ html: Schema.Struct({ href: Schema.String }) }),
})

const Permissions = Schema.Struct({
  values: Schema.Array(Schema.Struct({ permission: Schema.String, repository: Schema.Struct({ full_name: Schema.String }) })),
})

const Strategies = Schema.Struct({ merge_strategies: Schema.optional(Schema.Array(Schema.String)) })

const PullAnswer = Schema.Struct({
  id: Schema.Number,
  title: Schema.String,
  description: Schema.optional(Schema.NullOr(Schema.String)),
  state: Schema.String,
  draft: Schema.optional(Schema.Boolean),
  source: Schema.Struct({
    branch: Schema.Struct({ name: Schema.String }),
    // The head, by its first twelve characters, which git and Bitbucket both take.
    commit: Schema.optional(Schema.NullOr(Schema.Struct({ hash: Schema.String }))),
  }),
  destination: Schema.Struct({ branch: Schema.Struct({ name: Schema.String }) }),
  author: Schema.optional(Schema.NullOr(User)),
  reviewers: Schema.optional(Schema.Array(User)),
  close_source_branch: Schema.optional(Schema.Boolean),
  links: Schema.Struct({ html: Schema.Struct({ href: Schema.String }) }),
  updated_on: Schema.String,
})
type PullAnswer = typeof PullAnswer.Type

const Statuses = Schema.Struct({
  values: Schema.Array(
    Schema.Struct({
      key: Schema.String,
      name: Schema.optional(Schema.NullOr(Schema.String)),
      state: Schema.String,
      url: Schema.optional(Schema.NullOr(Schema.String)),
      description: Schema.optional(Schema.NullOr(Schema.String)),
    }),
  ),
})

const Steps = Schema.Struct({
  values: Schema.Array(
    Schema.Struct({
      uuid: Schema.String,
      state: Schema.optional(
        Schema.NullOr(Schema.Struct({ result: Schema.optional(Schema.NullOr(Schema.Struct({ name: Schema.String }))) })),
      ),
    }),
  ),
})

const CommentAnswer = Schema.Struct({
  id: Schema.Number,
  content: Schema.Struct({ raw: Schema.optional(Schema.NullOr(Schema.String)) }),
  user: Schema.optional(Schema.NullOr(User)),
  updated_on: Schema.String,
  deleted: Schema.optional(Schema.Boolean),
  // A comment of a review not yet published, which only its author sees.
  pending: Schema.optional(Schema.Boolean),
  parent: Schema.optional(Schema.NullOr(Schema.Struct({ id: Schema.Number }))),
  inline: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        path: Schema.String,
        to: Schema.optional(Schema.NullOr(Schema.Number)),
        from: Schema.optional(Schema.NullOr(Schema.Number)),
      }),
    ),
  ),
  links: Schema.optional(Schema.Struct({ html: Schema.optional(Schema.Struct({ href: Schema.String })) })),
})
type CommentAnswer = typeof CommentAnswer.Type

const Said = Schema.Struct({ date: Schema.String, user: Schema.optional(Schema.NullOr(User)) })

/** An entry of a pull request's activity: an update, a comment, an approval or changes requested, newest first. */
const ActivityAnswer = Schema.Struct({
  approval: Schema.optional(Said),
  changes_requested: Schema.optional(Said),
  update: Schema.optional(Schema.Struct({ date: Schema.String })),
  comment: Schema.optional(Schema.Struct({ created_on: Schema.String })),
})
type ActivityAnswer = typeof ActivityAnswer.Type

const Page = <A>(item: Schema.Codec<A, unknown>) =>
  Schema.Struct({ values: Schema.Array(item), next: Schema.optional(Schema.NullOr(Schema.String)) })

/** How many pages of a hundred comments, or fifty entries of activity, are read. */
const PAGES = 10

/** Bitbucket's strategies, in the order Althar prefers them, and the way each merges. */
const STRATEGIES: ReadonlyArray<readonly [string, MergeMethod]> = [
  ['squash', 'squash'],
  ['squash_fast_forward', 'squash'],
  ['merge_commit', 'merge'],
  // Rebased, then a merge commit: still a merge commit on the target.
  ['rebase_merge', 'merge'],
  ['rebase_fast_forward', 'rebase'],
  ['fast_forward', 'rebase'],
]

/** How a branch lets pull requests into it be merged, in the order Althar prefers. */
export const mergesOf = (strategies: ReadonlyArray<string>): ReadonlyArray<MergeMethod> => [
  ...new Set(STRATEGIES.filter(([strategy]) => strategies.includes(strategy)).map(([, method]) => method)),
]

/** The strategy Althar merges with: the first it prefers that the branch allows. */
export const strategyOf = (strategies: ReadonlyArray<string>): string | undefined =>
  STRATEGIES.find(([strategy]) => strategies.includes(strategy))?.[0]

/** A commit status's state; anything Bitbucket adds later is neither a pass nor a failure. */
export const statusState = (state: string): CheckState => {
  switch (state) {
    case 'SUCCESSFUL':
      return 'passed'
    case 'FAILED':
      return 'failed'
    case 'INPROGRESS':
      return 'running'
    case 'STOPPED':
      return 'cancelled'
    default:
      return 'neutral'
  }
}

/** A time as the model keeps it: Bitbucket's carry microseconds and an offset. */
export const iso = (at: string): string => new Date(at.replace(/(\.\d{3})\d+/, '$1')).toISOString()

/** Whether two names for a commit are one: Bitbucket gives twelve characters, git forty. */
const sameCommit = (a: string, b: string) => a.startsWith(b) || b.startsWith(a)

/** A string in Bitbucket's query language. */
const quoted = (text: string) => `"${text.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`

const personOf = (user: User | null | undefined): Person =>
  user == null
    ? { id: 'ghost', login: 'ghost', name: null, bot: false }
    : {
        id: user.uuid ?? 'ghost',
        login: user.nickname ?? user.display_name ?? user.uuid ?? 'ghost',
        name: user.display_name ?? null,
        bot: user.type === 'app_user',
      }

const changeOf = (repository: Repository, pull: PullAnswer): ChangeRequest => ({
  // Numbers are only the repository's own, so the repository names it too.
  id: `${repository.id}:${pull.id}`,
  number: pull.id,
  title: pull.title,
  body: pull.description ?? '',
  url: pull.links.html.href,
  // Declined, or superseded by another, is closed.
  state: pull.state === 'MERGED' ? 'merged' : pull.state === 'OPEN' ? 'open' : 'closed',
  draft: pull.draft === true,
  source: pull.source.branch.name,
  target: pull.destination.branch.name,
  headSha: pull.source.commit?.hash ?? null,
  author: pull.author == null ? null : personOf(pull.author),
  // Bitbucket counts lines only file by file, in the diff's stat.
  additions: null,
  deletions: null,
  changedFiles: null,
  updatedAt: iso(pull.updated_on),
})

/** Where a commit status points at a Pipelines run of this repository: its build number. */
const pipelineOf = (repository: Repository, url: string | null | undefined) => {
  const home = repository.webUrl.replace(/\/+$/, '').toLowerCase()
  if (url == null || !url.toLowerCase().startsWith(`${home}/`)) return undefined
  return /^\/(?:pipelines\/results|addon\/pipelines\/home#!\/results)\/(\d+)/.exec(url.slice(home.length))?.[1]
}

export const makeBitbucketCloud = (options: AdapterOptions): CodeHost => {
  const product = 'bitbucket_cloud' as const
  const api = options.apiUrl.replace(/\/+$/, '')
  const web = options.webUrl.replace(/\/+$/, '')
  const http = makeHttp({ product, fetch: options.fetch, authorization: Effect.map(options.credential, authorizationOf) })
  const repo = (path: ReadonlyArray<string>) => `${api}/repositories/${path.map(encodeURIComponent).join('/')}`
  const pull = (repository: Repository, number: number) => `${repo(repository.path)}/pullrequests/${number}`
  const branchOf = (repository: Repository | ReadonlyArray<string>, name: string) =>
    `${repo('path' in repository ? repository.path : repository)}/refs/branches/${name.split('/').map(encodeURIComponent).join('/')}`

  const account: Effect.Effect<Account, ConnectorFailed> = Effect.map(http.json(User, 'GET', `${api}/user`), (user) => {
    const { id, login, name } = personOf(user)
    return { id, login, name }
  })

  /** Every page of a list, by its `next`, within a bound. */
  const all = <A>(item: Schema.Codec<A, unknown>, first: string) =>
    Effect.gen(function* () {
      const found: Array<A> = []
      let url: string | null | undefined = first
      for (let page = 0; page < PAGES && url != null; page += 1) {
        const answer: { readonly values: ReadonlyArray<A>; readonly next?: string | null | undefined } = yield* http.cached(Page(item), url)
        found.push(...answer.values)
        url = answer.next
      }
      return found
    })

  const findChange = (repository: Repository, source: string) =>
    Effect.map(
      http.json(
        Page(PullAnswer),
        'GET',
        `${repo(repository.path)}/pullrequests?q=${encodeURIComponent(
          // A fork's branch of the same name isn't this repository's.
          `source.branch.name = ${quoted(source)} AND source.repository.full_name = ${quoted(repository.path.join('/'))} AND state = "OPEN"`,
        )}`,
      ),
      (pulls) => (pulls.values[0] === undefined ? null : changeOf(repository, pulls.values[0])),
    )

  /**
   * Whether someone is one of the repository's people: a member of its
   * workspace. Bitbucket tells only an admin who can write to a repository,
   * so membership, which only a group or a grant gives, stands in for it.
   */
  const memberOf = (repository: Repository, uuid: string) =>
    http
      .cached(Schema.Unknown, `${api}/workspaces/${encodeURIComponent(repository.path[0] ?? '')}/members/${encodeURIComponent(uuid)}`)
      .pipe(
        Effect.as(true),
        Effect.catchIf(
          (error) => error.reason === 'not_found',
          () => Effect.succeed(false),
        ),
      )

  const commentOf = (comment: CommentAnswer, threadId: string, member: boolean): Comment => ({
    id: String(comment.id),
    author: personOf(comment.user),
    member,
    body: comment.content.raw ?? '',
    at: iso(comment.updated_on),
    url: comment.links?.html?.href ?? null,
    threadId,
    path: comment.inline?.path ?? null,
    line: comment.inline?.to ?? comment.inline?.from ?? null,
  })

  /** Verdicts since a cursor, from the activity, which is newest first: read until it is older. */
  const verdicts = (repository: Repository, number: number, cursor: string | null) =>
    Effect.gen(function* () {
      const found: Array<{ readonly verdict: Verdict; readonly said: typeof Said.Type }> = []
      let url: string | null | undefined = `${pull(repository, number)}/activity?pagelen=50`
      for (let page = 0; page < PAGES && url != null; page += 1) {
        const answer: { readonly values: ReadonlyArray<ActivityAnswer>; readonly next?: string | null | undefined } = yield* http.cached(
          Page(ActivityAnswer),
          url,
        )
        for (const entry of answer.values) {
          if (entry.approval !== undefined) found.push({ verdict: 'approved', said: entry.approval })
          if (entry.changes_requested !== undefined) found.push({ verdict: 'changes_requested', said: entry.changes_requested })
        }
        const last = answer.values.at(-1)
        const oldest = last?.approval?.date ?? last?.changes_requested?.date ?? last?.update?.date ?? last?.comment?.created_on
        url = cursor !== null && oldest !== undefined && iso(oldest) < cursor ? null : answer.next
      }
      return found.filter(({ said }) => cursor === null || iso(said.date) >= cursor)
    })

  return {
    product,
    words: { noun: 'pull request', short: 'PR', prefix: '#' },
    capabilities: { drafts: true, checkLogs: true, threads: true },
    account,
    repository: (path) =>
      Effect.gen(function* () {
        const answer = yield* http.cached(RepositoryAnswer, repo(path.slice(0, 2)))
        const workspace = answer.full_name.split('/')[0] ?? ''
        // The account's own permission: asked by the repository's name, which Bitbucket can search by, and matched by its full one.
        const permissions = yield* http.cached(
          Permissions,
          `${api}/user/workspaces/${encodeURIComponent(workspace)}/permissions/repositories?q=${encodeURIComponent(`repository.name = ${quoted(answer.name)}`)}`,
        )
        const permission = permissions.values.find((found) => found.repository.full_name === answer.full_name)?.permission
        const main = answer.mainbranch?.name ?? 'main'
        const strategies =
          answer.mainbranch == null
            ? []
            : ((yield* http.cached(Strategies, branchOf(answer.full_name.split('/'), main))).merge_strategies ?? [])
        return {
          id: answer.uuid,
          path: answer.full_name.split('/'),
          defaultBranch: main,
          webUrl: answer.links.html.href,
          canPush: permission === 'write' || permission === 'admin',
          merges: mergesOf(strategies),
        }
      }),
    findChange,
    openChange: (repository, change) =>
      Effect.gen(function* () {
        // One already open from the branch is the one: adopted, not duplicated, nor written over.
        const open = yield* findChange(repository, change.source)
        if (open !== null) return open
        return yield* http
          .json(PullAnswer, 'POST', `${repo(repository.path)}/pullrequests`, {
            title: change.title,
            description: change.body,
            source: { branch: { name: change.source } },
            destination: { branch: { name: change.target } },
            draft: change.draft,
          })
          .pipe(
            Effect.map((pull) => changeOf(repository, pull)),
            // Opened by someone else meanwhile: theirs is the one.
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
        // What it has is sent back with it, so nothing else changes: reviewers left out would be taken off.
        const ready = yield* http.json(PullAnswer, 'PUT', pull(repository, change.number), {
          title: now.title,
          description: now.description ?? '',
          reviewers: (now.reviewers ?? []).flatMap((reviewer) => (reviewer.uuid === undefined ? [] : [{ uuid: reviewer.uuid }])),
          ...(now.close_source_branch === undefined ? {} : { close_source_branch: now.close_source_branch }),
          draft: false,
        })
        return changeOf(repository, ready)
      }),
    merge: (repository, change) =>
      Effect.gen(function* () {
        const now = yield* http.json(PullAnswer, 'GET', pull(repository, change.number))
        const head = now.source.commit?.hash ?? null
        // Bitbucket merges whatever the branch holds, so the head Althar last saw is checked first; a push since is a 409, as GitHub's.
        if (change.headSha !== null && head !== null && !sameCommit(head, change.headSha))
          return yield* new ConnectorFailed({
            product,
            reason: 'rejected',
            status: 409,
            message: `The pull request moved on to ${head} since ${change.headSha.slice(0, 12)} was seen`,
          })
        const strategy = strategyOf(
          (yield* http.cached(Strategies, branchOf(repository, now.destination.branch.name))).merge_strategies ?? [],
        )
        // Refused, Bitbucket says why: a merge check, a conflict, a draft. One that takes long answers 202 and lands later.
        yield* http.json(
          Schema.Unknown,
          'POST',
          `${pull(repository, change.number)}/merge`,
          strategy === undefined ? {} : { merge_strategy: strategy },
        )
        return changeOf(repository, yield* http.json(PullAnswer, 'GET', pull(repository, change.number)))
      }),
    checks: (repository, sha) =>
      Effect.map(http.cached(Statuses, `${repo(repository.path)}/commit/${encodeURIComponent(sha)}/statuses?pagelen=100`), (statuses) =>
        statuses.values.map((status): Check => {
          const build = pipelineOf(repository, status.url)
          return {
            // A Pipelines run by its build number, where its steps' logs are.
            id: build === undefined ? `status:${status.key}` : `pipeline:${build}`,
            name: status.name ?? status.key,
            state: statusState(status.state),
            url: status.url ?? null,
            summary: status.description != null && status.description !== '' ? status.description : null,
          }
        }),
      ),
    checkLog: (repository, check) => {
      const match = /^pipeline:(\d+)$/.exec(check.id)
      if (match === null) return Effect.succeed(null)
      const run = `${repo(repository.path)}/pipelines/${match[1]}`
      return Effect.gen(function* () {
        const steps = yield* http.json(Steps, 'GET', `${run}/steps?pagelen=100`)
        const failed = steps.values.find((step) => step.state?.result?.name === 'FAILED' || step.state?.result?.name === 'ERROR')
        if (failed === undefined) return null
        // A finished step's log has moved to storage elsewhere; Bitbucket redirects there.
        return tail(yield* http.text(`${run}/steps/${encodeURIComponent(failed.uuid)}/log`))
      }).pipe(
        Effect.catchIf(
          (error) => error.reason === 'not_found' || error.reason === 'forbidden',
          () => Effect.succeed(null),
        ),
      )
    },
    activity: (repository, number, cursor) =>
      Effect.gen(function* () {
        // Read whole, to find each reply's thread; by ETag, so a quiet pull request costs little.
        const every = (yield* all(CommentAnswer, `${pull(repository, number)}/comments?pagelen=100`)).filter(
          (comment) => comment.deleted !== true && comment.pending !== true,
        )
        const parents = new Map(every.map((comment) => [comment.id, comment.parent?.id]))
        const rootOf = (id: number) => {
          let at = id
          for (let parent = parents.get(at); parent != null && parents.has(parent); parent = parents.get(at)) at = parent
          return at
        }
        const fresh = every.filter((comment) => cursor === null || iso(comment.updated_on) >= cursor)
        const said = yield* verdicts(repository, number, cursor)
        // Asked once per author: whether they can write to the repository.
        const members = new Map<string, boolean>()
        for (const user of [...fresh.map((comment) => comment.user), ...said.map(({ said }) => said.user)])
          if (user?.uuid !== undefined && !members.has(user.uuid)) members.set(user.uuid, yield* memberOf(repository, user.uuid))
        const member = (user: User | null | undefined) => members.get(user?.uuid ?? '') === true
        const comments = fresh.map((comment) => commentOf(comment, String(rootOf(comment.id)), member(comment.user)))
        const reviews = said.map(({ verdict, said }): Review => ({
          id: `${verdict}:${said.user?.uuid ?? 'ghost'}:${said.date}`,
          author: personOf(said.user),
          member: member(said.user),
          verdict,
          body: '',
          at: iso(said.date),
          url: `${repository.webUrl}/pull-requests/${number}`,
        }))
        const at = [...comments.map((comment) => comment.at), ...reviews.map((review) => review.at)]
        const next = at.reduce((latest, one) => (one > latest ? one : latest), cursor ?? '')
        const byTime = <T extends { readonly at: string }>(items: ReadonlyArray<T>) => items.toSorted((a, b) => (a.at < b.at ? -1 : 1))
        return { comments: byTime(comments), reviews: byTime(reviews), cursor: next } satisfies Activity
      }),
    reply: (repository, number, reply) =>
      Effect.map(
        http.json(CommentAnswer, 'POST', `${pull(repository, number)}/comments`, {
          content: { raw: reply.body },
          ...(reply.threadId === null ? {} : { parent: { id: Number(reply.threadId) } }),
        }),
        // Althar's own reply: whether it counts as a member's doesn't matter, it is known by its receipt.
        (comment) => commentOf(comment, reply.threadId ?? String(comment.id), true),
      ),
    pushTarget: (repository) =>
      Effect.map(options.credential, (credential) => ({
        url: `${web}/${repository.path.join('/')}.git`,
        // An API token signs git in as Bitbucket's own user for it; an access token, or OAuth's, as `x-token-auth`.
        header: `Authorization: Basic ${Buffer.from(
          `${credential.kind === 'basic' ? 'x-bitbucket-api-token-auth' : 'x-token-auth'}:${credential.token}`,
        ).toString('base64')}`,
      })),
  }
}
