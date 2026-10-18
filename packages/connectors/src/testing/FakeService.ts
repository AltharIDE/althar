import { Effect } from 'effect'

import { type Access, type AccessLine, line } from '../access'
import { ConnectorFailed } from '../errors'
import type {
  Account,
  ChangeList,
  ChangeRequest,
  ChangeState,
  ChangeToReview,
  Check,
  CodeHost,
  Comment,
  Container,
  Issue,
  ListedChange,
  NewReview,
  Person,
  Product,
  Repository,
  Review,
  Tracker,
  Verdict,
} from '../model'
import { leftAsItIs, noListing, noReviews, stillOpen, unstarted } from '../model'

/*
 * A code host and tracker that lives in memory, for tests and the desktop's
 * end-to-end suite, as the fake agent stands in for real agents. It keeps
 * repositories, changes, comments, reviews, checks and issues, and lets a
 * test act as other people on it: comment, review, run checks, merge. It
 * files issues where it can (its repositories, and containers a test adds),
 * and keeps every one it filed. Its
 * clock starts at a fixed time and moves a second per event, so cursors
 * behave as on a real service. Pushes go to whatever URL the test gives,
 * such as a bare repository on disk.
 */

export interface FakeServiceOptions {
  readonly product?: Product
  readonly account?: Account
  /** Where a push to a repository goes. Without it, a push target that fails. */
  readonly pushUrl?: (path: ReadonlyArray<string>) => string
  /** The commit a change's branch is at on the host, as the host reads it now; without it, a name of the fake's own. */
  readonly headOf?: (number: number) => string | null
  /** Whether a change conflicts with its target, as the host works it out now; without it, the host doesn't say. */
  readonly conflictsOf?: (number: number) => boolean | undefined
  /** The checks a change's commit has, by the commit, as a host runs them on each; without it, or where it says nothing, those `setChecks` gave. */
  readonly checksFor?: (number: number, sha: string) => ReadonlyArray<Pick<Check, 'name' | 'state'> & { readonly log?: string }> | undefined
  /** Whether it lists changes: true unless said, as every host Althar knows does. */
  readonly lists?: boolean
  /** A scope the connection lacks, which listing changes needs: listing is refused for it, as a host refuses a token without it. */
  readonly listLacks?: string
  /** How many of the newest it reads before narrowing them, as a host that narrows a page at a time stops: all unless said. */
  readonly listReads?: number
  /** Whether the host can run a check again; it can, unless a test says. A check run again is in `reruns`. */
  readonly reruns?: boolean
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
    /** Where its work stands: To do unless said. */
    readonly status?: Issue['status']
  }): Issue
  /**
   * A place issues can be filed, such as a Linear team (`{ id: 'team-1', key:
   * 'MER', name: 'Meridian' }`). Its repositories are such places already, by
   * their path. An issue filed in one is keyed by its key (MER-1), or else
   * numbered in it (`team-1#1`).
   */
  addContainer(container: { readonly id: string; readonly key?: string | null; readonly name: string }): Container
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
  /** Someone reopens a closed change on the host itself. */
  reopen(number: number): void
  /** Someone marks a draft ready on the host itself. */
  readyByHand(number: number): void
  /** The next call to `method` fails with this: when to try again for a rate limit, and the HTTP status a host would give. */
  failNext(method: string, reason: ConnectorFailed['reason'], retryAt?: string, status?: number): void
  /** Every change opened, with every comment on it, Althar's included. */
  readonly changes: ReadonlyArray<ChangeRequest>
  /** The ids of the checks Althar ran again, in order. */
  readonly reruns: ReadonlyArray<string>
  /** Every issue `create` filed, in order, as it was filed: labels and all, since the fake takes any label. */
  readonly created: ReadonlyArray<Issue>
  commentsOn(number: number): ReadonlyArray<Comment>
  issueComments(ref: string): ReadonlyArray<string>
  linksOn(ref: string): ReadonlyArray<{ readonly url: string; readonly title: string }>
  /** The fork a change came from, by its path; null for one from the repository's own branch. */
  forkOf(number: number): string | null
  /**
   * Someone opens a change on one of the fake's repositories, as Althar
   * reviews one it didn't open: its author one of the repository's people
   * unless `member` says not, from a fork where `fork` names one (an empty
   * path for a fork that is gone).
   */
  addPullRequest(input: {
    readonly path: ReadonlyArray<string>
    readonly title: string
    readonly author: string
    readonly body?: string
    readonly member?: boolean
    readonly fork?: ReadonlyArray<string>
    readonly source?: string
    readonly target?: string
    readonly headSha?: string
    readonly baseSha?: string
    readonly state?: ChangeState
    readonly additions?: number
    readonly deletions?: number
    readonly changedFiles?: number
    readonly draft?: boolean
    /** Whose review it asks for, by login. */
    readonly reviewers?: ReadonlyArray<string>
  }): ChangeRequest
  /** Every review posted, in order, with the change it is on. */
  readonly reviewsPosted: ReadonlyArray<{ readonly number: number; readonly id: string; readonly review: NewReview }>
  /** Every branch `deleteBranch` deleted, by the number of the change it was the branch of, in order. */
  readonly branchesDeleted: ReadonlyArray<number>
  /** Method names, in the order they were called. */
  readonly calls: ReadonlyArray<string>
}

/**
 * The fake, with what a connection to it can do: everything, on the
 * repositories it has. `failNext('access', …)` makes the next check stop at
 * its account: refused where the reason is `unauthorized`.
 */
export type FakeService = CodeHost & Tracker & FakeControls & { readonly access: Access }

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
  /** The fork each change came from, by number, by its path. */
  const forks = new Map<number, string>()
  /** Changes whose author isn't one of the repository's people, by number. */
  const outsiders = new Set<number>()
  /** Whose review each change asks for, by number, by login. */
  const asked = new Map<number, ReadonlyArray<string>>()
  /** Where each change's target branch is, by number, where a test says. */
  const bases = new Map<number, string>()
  const posted: Array<{ readonly number: number; readonly id: string; readonly review: NewReview }> = []
  const comments = new Map<number, Array<Comment>>()
  const reviews = new Map<number, Array<Review>>()
  const checks = new Map<number, Array<Check>>()
  const logs = new Map<string, string | null>()
  const reran: Array<string> = []
  const starting = new Set<string>()
  const issues = new Map<string, Issue>()
  const assigned = new Set<string>()
  const issueComments = new Map<string, Array<string>>()
  const links = new Map<string, Array<{ readonly url: string; readonly title: string }>>()
  const containers = new Map<string, Container>()
  const created: Array<Issue> = []
  const failures = new Map<string, { readonly reason: ConnectorFailed['reason']; readonly retryAt?: string; readonly status?: number }>()
  const calls: Array<string> = []
  const deleted: Array<number> = []
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
  /** Where issues can be filed: its repositories, by path, then the containers a test added. */
  const filable = (): ReadonlyArray<Container> => [
    ...[...repositories.values()].map((repository) => {
      const path = repository.path.join('/')
      return { id: path, key: path, name: path }
    }),
    ...containers.values(),
  ]

  const service: FakeService = {
    product,
    words: product === 'gitlab' ? { noun: 'merge request', short: 'MR', prefix: '!' } : { noun: 'pull request', short: 'PR', prefix: '#' },
    capabilities: { drafts: true, checkLogs: true, threads: true, reviews: product === 'github', links: true, starts: true },
    account: Effect.andThen(called('account'), Effect.succeed(account)),
    repository: (path) =>
      Effect.andThen(called('repository'), () => {
        // Found whatever the case, as GitHub and GitLab find them.
        const found = repositories.get(path.join('/').toLowerCase())
        return found === undefined ? Effect.fail(missing(`repository ${path.join('/')}`)) : Effect.succeed(found)
      }),
    findChange: (repository, source, from) =>
      Effect.andThen(called('findChange'), () => {
        const found = changes.find(
          (change) =>
            repositoryOf.get(change.number) === repository.id &&
            change.source === source &&
            forks.get(change.number) === from?.path.join('/') &&
            change.state === 'open',
        )
        return Effect.succeed(found ?? null)
      }),
    openChange: (repository, change) =>
      Effect.andThen(called('openChange'), () => {
        const open = changes.find(
          (candidate) =>
            repositoryOf.get(candidate.number) === repository.id &&
            candidate.source === change.source &&
            forks.get(candidate.number) === change.from?.path.join('/') &&
            candidate.state === 'open',
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
        if (change.from !== undefined) forks.set(number, change.from.path.join('/'))
        return Effect.succeed(opened)
      }),
    change: (_repository, number) =>
      Effect.andThen(called('change'), () => {
        const found = changes.find((change) => change.number === number)
        if (found === undefined) return Effect.fail(missing(`change ${number}`))
        const head = options.headOf?.(number) ?? null
        const conflicts = found.state === 'open' ? options.conflictsOf?.(number) : undefined
        return Effect.succeed({ ...found, ...(head === null ? {} : { headSha: head }), ...(conflicts === undefined ? {} : { conflicts }) })
      }),
    listChanges: (repository, query) =>
      Effect.andThen(called('listChanges'), () => {
        if (options.lists === false) return Effect.fail(noListing(product, service.words))
        if (options.listLacks !== undefined)
          return Effect.fail(
            new ConnectorFailed({
              product,
              reason: 'forbidden',
              status: 403,
              message: 'Resource not accessible by token',
              scope: options.listLacks,
            }),
          )
        const words = (query.text ?? '')
          .toLowerCase()
          .split(/\s+/)
          .filter((word) => word !== '')
        const newest = changes
          .filter((change) => repositoryOf.get(change.number) === repository.id && (query.state === 'all' || change.state === query.state))
          .toSorted((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : b.number - a.number))
        const read = newest.slice(0, options.listReads ?? newest.length)
        const found = read.filter(
          (change) =>
            (query.author === undefined || change.author?.login.toLowerCase() === query.author.toLowerCase()) &&
            words.every((word) => change.title.toLowerCase().includes(word)) &&
            (query.reviewRequested !== true || (asked.get(change.number) ?? []).includes(me.login)) &&
            (query.draft === undefined || change.draft === query.draft),
        )
        const listed = found.slice(0, query.limit).map((change): ListedChange => {
          // Each reviewer's latest verdict: a request for changes holds over an approval.
          const latest = new Map((reviews.get(change.number) ?? []).map((review) => [review.author.login, review.verdict]))
          const verdicts = [...latest.values()]
          const ran = checks.get(change.number) ?? []
          const fork = forks.get(change.number)
          return {
            ...change,
            body: '',
            forkOwner: fork === undefined || fork === '' ? null : (fork.split('/')[0] ?? null),
            reviewDecision: verdicts.includes('changes_requested')
              ? 'changes_requested'
              : verdicts.includes('approved')
                ? 'approved'
                : null,
            checks:
              ran.length === 0
                ? null
                : ran.some((check) => check.state === 'failed')
                  ? 'failed'
                  : ran.some((check) => check.state === 'queued' || check.state === 'running')
                    ? 'running'
                    : 'passed',
          }
        })
        return Effect.succeed({ changes: listed, more: found.length > listed.length || read.length < newest.length } satisfies ChangeList)
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
        if (change.headSha !== (options.headOf?.(change.number) ?? now.headSha))
          return Effect.fail(new ConnectorFailed({ product, reason: 'rejected', status: 409, message: 'Head branch was modified' }))
        update(change.number, { state: 'merged' })
        return Effect.succeed(changeNumbered(change.number))
      }),
    closeChange: (_repository, change) =>
      Effect.andThen(called('closeChange'), () => {
        // As GitHub: one merged or closed already stays as it is.
        if (changeNumbered(change.number).state === 'open') update(change.number, { state: 'closed' })
        return Effect.succeed(changeNumbered(change.number))
      }),
    deleteBranch: (_repository, change) =>
      Effect.andThen(called('deleteBranch'), () => {
        if (changeNumbered(change.number).state === 'open') return Effect.fail(stillOpen(product, service.words, change.number))
        if (!deleted.includes(change.number)) deleted.push(change.number)
        return Effect.void
      }),
    checks: (_repository, sha) =>
      Effect.andThen(called('checks'), () => {
        const change =
          changes.find((candidate) => candidate.headSha === sha || options.headOf?.(candidate.number) === sha) ??
          changes.find((candidate) => `head-${candidate.number}` === sha)
        const ran = change === undefined ? undefined : options.checksFor?.(change.number, sha)
        if (change === undefined || ran === undefined)
          return Effect.succeed(
            change === undefined
              ? []
              : (checks.get(change.number) ?? []).map((check) =>
                  starting.delete(check.id) ? { ...check, state: 'running' as const } : check,
                ),
          )
        return Effect.succeed(
          ran.map((check, index): Check => {
            const id = `check-${change.number}-${sha}-${index}`
            logs.set(id, check.log ?? null)
            // Run again, a check shows as running for a reading, as a host's does once it has started it again.
            const again = starting.delete(id)
            return { id, name: check.name, state: again ? 'running' : check.state, url: null, summary: null }
          }),
        )
      }),
    checkLog: (_repository, check) =>
      Effect.andThen(called('checkLog'), () => {
        return Effect.succeed(logs.get(check.id) ?? null)
      }),
    rerun: (_repository, check) =>
      Effect.andThen(called('rerun'), () => {
        if (options.reruns === false) return Effect.succeed(false)
        reran.push(check.id)
        starting.add(check.id)
        return Effect.succeed(true)
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
    changeToReview: (_repository, number) =>
      Effect.andThen(called('changeToReview'), () => {
        if (!service.capabilities.reviews) return Effect.fail(noReviews(product, service.words))
        const found = changes.find((change) => change.number === number)
        if (found === undefined) return Effect.fail(missing(`change ${number}`))
        const fork = forks.get(number)
        return Effect.succeed({
          ...found,
          member: !outsiders.has(number),
          fork: fork === undefined ? null : fork === '' ? [] : fork.split('/'),
          baseSha: bases.get(number) ?? null,
        } satisfies ChangeToReview)
      }),
    postReview: (_repository, number, review) =>
      Effect.andThen(called('postReview'), () => {
        if (!service.capabilities.reviews) return Effect.fail(noReviews(product, service.words))
        const found = changes.find((change) => change.number === number)
        if (found === undefined) return Effect.fail(missing(`change ${number}`))
        // As GitHub: a change merged or closed takes no review; nor a comment on a line it doesn't have.
        if (found.state !== 'open')
          return Effect.fail(new ConnectorFailed({ product, reason: 'rejected', status: 422, message: 'Pull request is closed' }))
        const id = nextId()
        posted.push({ number, id, review })
        return Effect.succeed({ id, url: `${found.url}#pullrequestreview-${id}` })
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
    // Into In Progress from where the tracker has it, as Linear's adapter moves one.
    start: (issue) =>
      Effect.andThen(called('start'), () => {
        const found = issues.get(issue.ref) ?? issue
        if (!unstarted(found.status.category)) return Effect.succeed(leftAsItIs(found))
        const status: Issue['status'] = { name: 'In Progress', category: 'started' }
        issues.set(found.ref, { ...found, status, updatedAt: now() })
        return Effect.succeed({ moved: true, status })
      }),
    containers: () => Effect.andThen(called('containers'), () => Effect.succeed(filable())),
    create: (id, draft) =>
      Effect.andThen(called('create'), () => {
        const container = filable().find((candidate) => candidate.id === id)
        if (container === undefined) return Effect.fail(missing(`container ${id}`))
        // A repository's issues are numbered `owner/repo#1`, a team's by its key (MER-1).
        const refOf = (number: number) =>
          repositories.has(id.toLowerCase()) || container.key === null ? `${id}#${number}` : `${container.key}-${number}`
        let number = 1
        while (issues.has(refOf(number))) number += 1
        const ref = refOf(number)
        const filed: Issue = {
          ...service.addIssue({ ref, title: draft.title, body: draft.body, assigned: false }),
          labels: [...draft.labels],
          container: container.name,
        }
        issues.set(ref, filed)
        created.push(filed)
        return Effect.succeed(filed)
      }),
    access: (input) =>
      called('access').pipe(
        Effect.map(() => {
          const unseen = input.repositories.filter((path) => !repositories.has(path.join('/').toLowerCase())).map((path) => path.join('/'))
          const host = product !== 'linear' && product !== 'jira_cloud' && product !== 'jira_dc' && product !== 'trello'
          const lines: ReadonlyArray<AccessLine> = [
            line('account', 'ok', { fact: account.login }),
            ...(input.repositories.length === 0
              ? []
              : [
                  unseen.length === 0
                    ? line('reach', 'ok', { fact: [...new Set(input.repositories.map((path) => path[0] ?? ''))].join(', ') })
                    : line('reach', 'no', { reason: { kind: 'unseen', names: unseen, url: null } }),
                ]),
            ...(host
              ? (['push', 'changes', 'checks', 'issues'] as const).map((need) => line(need, 'ok'))
              : (['read', 'comment', 'move'] as const).map((need) => line(need, 'ok'))),
          ]
          return { account, lines, expiresAt: null, scopes: null }
        }),
        Effect.catch((error) =>
          Effect.succeed({
            account: null,
            lines: [
              line('account', 'no', {
                reason: error.reason === 'unauthorized' ? { kind: 'refused' } : { kind: 'failed', message: error.message },
              }),
            ],
            expiresAt: null,
            scopes: null,
          }),
        ),
      ),

    addRepository: (path, defaultBranch = 'main') => {
      const repository: Repository = {
        id: `repo-${repositories.size + 1}`,
        path: [...path],
        defaultBranch,
        webUrl: `https://${product === 'gitlab' ? 'gitlab.com' : 'github.com'}/${path.join('/')}`,
        canPush: true,
        merges: ['squash', 'merge'],
      }
      repositories.set(path.join('/').toLowerCase(), repository)
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
        status: input.status ?? { name: 'Todo', category: 'todo' },
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
    addContainer: (input) => {
      const container: Container = { id: input.id, key: input.key ?? null, name: input.name }
      containers.set(container.id, container)
      return container
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
    reopen: (number) => update(number, { state: 'open' }),
    readyByHand: (number) => update(number, { draft: false }),
    failNext: (method, reason, retryAt, status) =>
      void failures.set(method, {
        reason,
        ...(retryAt === undefined ? {} : { retryAt }),
        ...(status === undefined ? {} : { status }),
      }),
    get reruns() {
      return reran
    },
    get changes() {
      return [...changes]
    },
    get created() {
      return [...created]
    },
    commentsOn: (number) => comments.get(number) ?? [],
    issueComments: (ref) => issueComments.get(ref) ?? [],
    linksOn: (ref) => links.get(ref) ?? [],
    forkOf: (number) => forks.get(number) ?? null,
    addPullRequest: (input) => {
      const repository = repositories.get(input.path.join('/').toLowerCase())
      if (repository === undefined) throw new Error(`No repository ${input.path.join('/')}`)
      const number = changes.length + 1
      const opened: ChangeRequest = {
        id: `change-${number}`,
        number,
        title: input.title,
        body: input.body ?? '',
        url: `${repository.webUrl}/pull/${number}`,
        state: input.state ?? 'open',
        draft: input.draft ?? false,
        source: input.source ?? `${input.author}/change-${number}`,
        target: input.target ?? repository.defaultBranch,
        headSha: input.headSha ?? `head-${number}`,
        author: person(input.author),
        additions: input.additions ?? 58,
        deletions: input.deletions ?? 20,
        changedFiles: input.changedFiles ?? 4,
        updatedAt: now(),
      }
      changes.push(opened)
      repositoryOf.set(number, repository.id)
      if (input.fork !== undefined) forks.set(number, input.fork.join('/'))
      if (input.member === false) outsiders.add(number)
      if (input.baseSha !== undefined) bases.set(number, input.baseSha)
      if (input.reviewers !== undefined) asked.set(number, input.reviewers)
      return opened
    },
    get reviewsPosted() {
      return [...posted]
    },
    get branchesDeleted() {
      return [...deleted]
    },
    calls,
  }
  return service
}
