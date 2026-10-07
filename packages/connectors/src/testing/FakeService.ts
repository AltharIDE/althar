import { Effect } from 'effect'

import { ConnectorFailed } from '../errors'
import type {
  Account,
  ChangeRequest,
  Check,
  CodeHost,
  Comment,
  Issue,
  Person,
  Product,
  Repository,
  Review,
  Tracker,
  Verdict,
} from '../model'

/*
 * A code host and tracker that lives in memory, for tests and the desktop's
 * end-to-end suite, as the fake agent stands in for real agents. It keeps
 * repositories, changes, comments, reviews, checks and issues, and lets a
 * test act as other people on it: comment, review, run checks, merge. Its
 * clock starts at a fixed time and moves a second per event, so cursors
 * behave as on a real service. Pushes go to whatever URL the test gives,
 * such as a bare repository on disk.
 */

export interface FakeServiceOptions {
  readonly product?: Product
  readonly account?: Account
  /** Where a push to a repository goes. Without it, a push target that fails. */
  readonly pushUrl?: (path: ReadonlyArray<string>) => string
}

/** The fake's controls: what a test does as other people on the service, and what it checks afterwards. */
export interface FakeControls {
  addRepository(path: ReadonlyArray<string>, defaultBranch?: string): Repository
  addIssue(issue: {
    readonly ref: string
    readonly key?: string
    readonly title: string
    readonly body?: string
    readonly assigned?: boolean
  }): Issue
  /**
   * Someone comments on a change: in its conversation, or on a line. The
   * account's own login is the account; anyone else can write to the
   * repository unless `member` says not, as a passer-by on a public one.
   */
  commentAs(
    number: number,
    author: string,
    body: string,
    options?: { readonly path?: string; readonly line?: number; readonly bot?: boolean; readonly member?: boolean },
  ): Comment
  reviewAs(number: number, author: string, verdict: Verdict, body?: string, options?: { readonly member?: boolean }): Review
  setChecks(number: number, checks: ReadonlyArray<Pick<Check, 'name' | 'state'> & { readonly log?: string }>): void
  /** Someone merges a change on the host itself. */
  mergeByHand(number: number): void
  close(number: number): void
  /** Someone marks a draft ready on the host itself. */
  readyByHand(number: number): void
  /** The next call to `method` fails with this: when to try again for a rate limit, and the HTTP status a host would give. */
  failNext(method: string, reason: ConnectorFailed['reason'], retryAt?: string, status?: number): void
  /** Every change opened, with every comment on it, Althar's included. */
  readonly changes: ReadonlyArray<ChangeRequest>
  commentsOn(number: number): ReadonlyArray<Comment>
  issueComments(ref: string): ReadonlyArray<string>
  linksOn(ref: string): ReadonlyArray<{ readonly url: string; readonly title: string }>
  /** Method names, in the order they were called. */
  readonly calls: ReadonlyArray<string>
}

export type FakeService = CodeHost & Tracker & FakeControls

const START = Date.parse('2026-10-01T09:00:00.000Z')

export const makeFakeService = (options: FakeServiceOptions = {}): FakeService => {
  const product = options.product ?? 'github'
  const account: Account = options.account ?? { id: '1', login: 'you', name: 'You' }
  const me: Person = { ...account, bot: false }
  let tick = 0
  const now = () => new Date(START + (tick += 1) * 1000).toISOString()
  const repositories = new Map<string, Repository>()
  const changes: Array<ChangeRequest> = []
  /** Each change's repository, by number. */
  const repositoryOf = new Map<number, string>()
  const comments = new Map<number, Array<Comment>>()
  const reviews = new Map<number, Array<Review>>()
  const checks = new Map<number, Array<Check>>()
  const logs = new Map<string, string | null>()
  const issues = new Map<string, Issue>()
  const assigned = new Set<string>()
  const issueComments = new Map<string, Array<string>>()
  const links = new Map<string, Array<{ readonly url: string; readonly title: string }>>()
  const failures = new Map<string, { readonly reason: ConnectorFailed['reason']; readonly retryAt?: string; readonly status?: number }>()
  const calls: Array<string> = []
  let ids = 0
  const nextId = () => String((ids += 1))

  /** Records a call, and fails it if a test asked. */
  const called = (method: string) =>
    Effect.suspend(() => {
      calls.push(method)
      const failure = failures.get(method)
      if (failure === undefined) return Effect.void
      failures.delete(method)
      return Effect.fail(
        new ConnectorFailed({
          product,
          reason: failure.reason,
          message: `The fake ${method} failed (${failure.reason})`,
          ...(failure.retryAt === undefined ? {} : { retryAt: failure.retryAt }),
          ...(failure.status === undefined ? {} : { status: failure.status }),
        }),
      )
    })
  const missing = (what: string) => new ConnectorFailed({ product, reason: 'not_found', message: `No ${what}` })
  const changeNumbered = (number: number) => {
    const change = changes.find((candidate) => candidate.number === number)
    if (change === undefined) throw new Error(`No change ${number}`)
    return change
  }
  const update = (number: number, set: Partial<ChangeRequest>) => {
    const index = changes.findIndex((candidate) => candidate.number === number)
    const change = changes[index]
    if (change === undefined) return
    changes[index] = { ...change, ...set, updatedAt: now() }
  }
  const person = (login: string, bot = false): Person => (login === me.login ? me : { id: `user-${login}`, login, name: login, bot })

  const service: FakeService = {
    product,
    words: product === 'gitlab' ? { noun: 'merge request', short: 'MR', prefix: '!' } : { noun: 'pull request', short: 'PR', prefix: '#' },
    capabilities: { drafts: true, checkLogs: true, threads: true, links: true },
    account: Effect.andThen(called('account'), Effect.succeed(account)),
    repository: (path) =>
      Effect.andThen(called('repository'), () => {
        const found = repositories.get(path.join('/'))
        return found === undefined ? Effect.fail(missing(`repository ${path.join('/')}`)) : Effect.succeed(found)
      }),
    findChange: (repository, source) =>
      Effect.andThen(called('findChange'), () => {
        const found = changes.find(
          (change) => repositoryOf.get(change.number) === repository.id && change.source === source && change.state === 'open',
        )
        return Effect.succeed(found ?? null)
      }),
    openChange: (repository, change) =>
      Effect.andThen(called('openChange'), () => {
        const open = changes.find(
          (candidate) =>
            repositoryOf.get(candidate.number) === repository.id && candidate.source === change.source && candidate.state === 'open',
        )
        if (open !== undefined) return Effect.succeed(open)
        const number = changes.length + 1
        const opened: ChangeRequest = {
          id: `change-${number}`,
          number,
          title: change.title,
          body: change.body,
          url: `${repository.webUrl}/pull/${number}`,
          state: 'open',
          draft: change.draft,
          source: change.source,
          target: change.target,
          headSha: `head-${number}`,
          author: me,
          additions: 12,
          deletions: 3,
          changedFiles: 2,
          updatedAt: now(),
        }
        changes.push(opened)
        repositoryOf.set(number, repository.id)
        return Effect.succeed(opened)
      }),
    change: (_repository, number) =>
      Effect.andThen(called('change'), () => {
        const found = changes.find((change) => change.number === number)
        return found === undefined ? Effect.fail(missing(`change ${number}`)) : Effect.succeed(found)
      }),
    markReady: (_repository, change) =>
      Effect.andThen(called('markReady'), () => {
        update(change.number, { draft: false })
        return Effect.succeed(changeNumbered(change.number))
      }),
    merge: (_repository, change) =>
      Effect.andThen(called('merge'), () => {
        const now = changeNumbered(change.number)
        // As GitHub: a draft, or a change already merged or closed, isn't merged; nor one whose head moved on.
        if (now.draft || now.state !== 'open')
          return Effect.fail(
            new ConnectorFailed({
              product,
              reason: 'rejected',
              message: now.draft ? 'Pull request is in draft state' : 'Pull request is not mergeable',
            }),
          )
        if (change.headSha !== now.headSha)
          return Effect.fail(new ConnectorFailed({ product, reason: 'rejected', status: 409, message: 'Head branch was modified' }))
        update(change.number, { state: 'merged' })
        return Effect.succeed(changeNumbered(change.number))
      }),
    checks: (_repository, sha) =>
      Effect.andThen(called('checks'), () => {
        const change =
          changes.find((candidate) => candidate.headSha === sha) ?? changes.find((candidate) => `head-${candidate.number}` === sha)
        return Effect.succeed(change === undefined ? [] : (checks.get(change.number) ?? []))
      }),
    checkLog: (_repository, check) =>
      Effect.andThen(called('checkLog'), () => {
        return Effect.succeed(logs.get(check.id) ?? null)
      }),
    activity: (_repository, number, cursor) =>
      Effect.andThen(called('activity'), () => {
        const after = <T extends { readonly at: string }>(items: ReadonlyArray<T>) =>
          items.filter((item) => cursor === null || item.at >= cursor)
        const said = after(comments.get(number) ?? [])
        const reviewed = after(reviews.get(number) ?? [])
        const latest = [...said, ...reviewed].reduce((max, item) => (item.at > max ? item.at : max), cursor ?? '')
        return Effect.succeed({ comments: said, reviews: reviewed, cursor: latest })
      }),
    reply: (_repository, number, reply) =>
      Effect.andThen(called('reply'), () => {
        const comment: Comment = {
          id: nextId(),
          author: me,
          member: true,
          body: reply.body,
          at: now(),
          url: null,
          threadId: reply.threadId,
          path: null,
          line: null,
        }
        comments.set(number, [...(comments.get(number) ?? []), comment])
        return Effect.succeed(comment)
      }),
    pushTarget: (repository) =>
      Effect.andThen(called('pushTarget'), () =>
        options.pushUrl === undefined
          ? Effect.fail(new ConnectorFailed({ product, reason: 'forbidden', message: 'The fake takes no pushes' }))
          : Effect.succeed({ url: options.pushUrl(repository.path), header: null }),
      ),
    issue: (ref) =>
      Effect.andThen(called('issue'), () => {
        // A key in any case, as Linear's adapter takes one.
        const found = issues.get(/^[A-Z][A-Z0-9]*-\d+$/i.test(ref) ? ref.toUpperCase() : ref)
        return found === undefined ? Effect.fail(missing(`issue ${ref}`)) : Effect.succeed(found)
      }),
    mine: (mineOptions = {}) =>
      Effect.andThen(called('mine'), () =>
        Effect.succeed(
          [...issues.values()]
            .filter(
              (issue) => assigned.has(issue.ref) && (mineOptions.container === undefined || issue.container === mineOptions.container),
            )
            .slice(0, mineOptions.limit ?? 50),
        ),
      ),
    comment: (issue, body) =>
      Effect.andThen(called('comment'), () => {
        issueComments.set(issue.ref, [...(issueComments.get(issue.ref) ?? []), body])
        return Effect.void
      }),
    link: (issue, link) =>
      Effect.andThen(called('link'), () => {
        links.set(issue.ref, [...(links.get(issue.ref) ?? []), link])
        return Effect.void
      }),

    addRepository: (path, defaultBranch = 'main') => {
      const repository: Repository = {
        id: `repo-${repositories.size + 1}`,
        path: [...path],
        defaultBranch,
        webUrl: `https://${product === 'gitlab' ? 'gitlab.com' : 'github.com'}/${path.join('/')}`,
        canPush: true,
        merges: ['squash', 'merge'],
      }
      repositories.set(path.join('/'), repository)
      return repository
    },
    addIssue: (input) => {
      const container = input.ref.includes('#') ? (input.ref.split('#')[0] ?? null) : (input.ref.split('-')[0] ?? null)
      const issue: Issue = {
        id: `issue-${nextId()}`,
        ref: input.ref,
        key: input.key ?? (input.ref.includes('#') ? `#${input.ref.split('#')[1]}` : input.ref),
        title: input.title,
        body: input.body ?? '',
        url: input.ref.includes('#')
          ? `https://github.com/${input.ref.replace('#', '/issues/')}`
          : `https://linear.app/fake/issue/${input.ref}/${input.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        status: { name: 'Todo', category: 'todo' },
        priority: input.ref.includes('#') ? null : { level: 'high', name: 'High' },
        assignees: input.assigned === false ? [] : [me],
        labels: [],
        container,
        updatedAt: now(),
      }
      issues.set(input.ref, issue)
      if (input.assigned !== false) assigned.add(input.ref)
      return issue
    },
    commentAs: (number, author, body, commentOptions = {}) => {
      const id = nextId()
      const comment: Comment = {
        id,
        author: person(author, commentOptions.bot === true),
        member: commentOptions.member ?? true,
        body,
        at: now(),
        url: `${changeNumbered(number).url}#comment-${id}`,
        threadId: commentOptions.path === undefined ? null : id,
        path: commentOptions.path ?? null,
        line: commentOptions.line ?? null,
      }
      comments.set(number, [...(comments.get(number) ?? []), comment])
      return comment
    },
    reviewAs: (number, author, verdict, body = '', reviewOptions = {}) => {
      const review: Review = {
        id: nextId(),
        author: person(author),
        member: reviewOptions.member ?? true,
        verdict,
        body,
        at: now(),
        url: null,
      }
      reviews.set(number, [...(reviews.get(number) ?? []), review])
      return review
    },
    setChecks: (number, list) => {
      update(number, { headSha: `head-${number}` })
      checks.set(
        number,
        list.map((check, index) => {
          const id = `check-${number}-${index}`
          logs.set(id, check.log ?? null)
          return { id, name: check.name, state: check.state, url: null, summary: null }
        }),
      )
    },
    mergeByHand: (number) => update(number, { state: 'merged' }),
    close: (number) => update(number, { state: 'closed' }),
    readyByHand: (number) => update(number, { draft: false }),
    failNext: (method, reason, retryAt, status) =>
      void failures.set(method, {
        reason,
        ...(retryAt === undefined ? {} : { retryAt }),
        ...(status === undefined ? {} : { status }),
      }),
    get changes() {
      return [...changes]
    },
    commentsOn: (number) => comments.get(number) ?? [],
    issueComments: (ref) => issueComments.get(ref) ?? [],
    linksOn: (ref) => links.get(ref) ?? [],
    calls,
  }
  return service
}
