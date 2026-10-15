import { Clock, Effect, Schema } from 'effect'

import { type Access, type AccessLine, type AccessReason, line } from './access'
import { type AdapterOptions, authorizationOf } from './credential'
import { ConnectorFailed } from './errors'
import { makeHttp, paged } from './http'
import { tail } from './github'
import type {
  Account,
  Activity,
  ChangeList,
  ChangeRequest,
  Check,
  CheckState,
  CodeHost,
  Comment,
  Container,
  Issue,
  ListedChange,
  MergeMethod,
  Person,
  Repository,
  Review,
  Tracker,
  Verdict,
} from './model'
import { lacking, leftAsItIs, noReviews } from './model'
import { answered, failedOf, probe, type Reached, reachLine, readAs, refusalOf, seenOf, serverLine, stopped, UNREADABLE } from './probe'

/*
 * GitLab, on gitlab.com or a company's own server: a code host of merge
 * requests over its REST API (`/api/v4`), and a tracker of its issues. A
 * project goes by its id once it is found, so a renamed or moved project
 * keeps working; its path may have any number of groups. GitLab has no
 * draft flag to set: a title that starts "Draft:" makes one, and taking the
 * prefix off marks it ready.
 */

const User = Schema.Struct({
  id: Schema.Number,
  username: Schema.String,
  name: Schema.optional(Schema.NullOr(Schema.String)),
  bot: Schema.optional(Schema.Boolean),
})
type User = typeof User.Type

const Access = Schema.optional(Schema.NullOr(Schema.Struct({ access_level: Schema.Number })))

const ProjectAnswer = Schema.Struct({
  id: Schema.Number,
  path_with_namespace: Schema.String,
  // An empty project has no default branch yet.
  default_branch: Schema.optional(Schema.NullOr(Schema.String)),
  web_url: Schema.String,
  // Said only to someone who can see the project's settings.
  merge_method: Schema.optional(Schema.NullOr(Schema.String)),
  squash_option: Schema.optional(Schema.NullOr(Schema.String)),
  permissions: Schema.optional(Schema.NullOr(Schema.Struct({ project_access: Access, group_access: Access }))),
})

const Pipeline = Schema.Struct({
  id: Schema.Number,
  // A merge request from a fork runs its pipeline in the fork.
  project_id: Schema.optional(Schema.Number),
  sha: Schema.optional(Schema.String),
  source: Schema.optional(Schema.String),
})

const MergeAnswer = Schema.Struct({
  id: Schema.Number,
  iid: Schema.Number,
  title: Schema.String,
  description: Schema.optional(Schema.NullOr(Schema.String)),
  web_url: Schema.String,
  state: Schema.String,
  draft: Schema.optional(Schema.Boolean),
  work_in_progress: Schema.optional(Schema.Boolean),
  source_branch: Schema.String,
  target_branch: Schema.String,
  /** The project the branch is on: a fork's, for a merge request from one. */
  source_project_id: Schema.optional(Schema.Number),
  sha: Schema.optional(Schema.NullOr(Schema.String)),
  author: Schema.optional(Schema.NullOr(User)),
  // A string, and "1000+" past a thousand files; said only when one merge request is read.
  changes_count: Schema.optional(Schema.NullOr(Schema.String)),
  detailed_merge_status: Schema.optional(Schema.String),
  has_conflicts: Schema.optional(Schema.Boolean),
  head_pipeline: Schema.optional(Schema.NullOr(Pipeline)),
  updated_at: Schema.String,
})
type MergeAnswer = typeof MergeAnswer.Type

const JobAnswer = Schema.Struct({
  id: Schema.Number,
  name: Schema.String,
  status: Schema.String,
  allow_failure: Schema.optional(Schema.Boolean),
  web_url: Schema.optional(Schema.NullOr(Schema.String)),
  failure_reason: Schema.optional(Schema.NullOr(Schema.String)),
})

const NoteAnswer = Schema.Struct({
  id: Schema.Number,
  body: Schema.String,
  author: User,
  created_at: Schema.String,
  updated_at: Schema.String,
  system: Schema.Boolean,
  position: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        new_path: Schema.optional(Schema.NullOr(Schema.String)),
        old_path: Schema.optional(Schema.NullOr(Schema.String)),
        new_line: Schema.optional(Schema.NullOr(Schema.Number)),
        old_line: Schema.optional(Schema.NullOr(Schema.Number)),
      }),
    ),
  ),
})
type NoteAnswer = typeof NoteAnswer.Type

/** A trigger job: it starts a child pipeline, or another project's, and its result is that pipeline's. */
const BridgeAnswer = Schema.Struct({
  id: Schema.Number,
  name: Schema.String,
  status: Schema.String,
  allow_failure: Schema.optional(Schema.Boolean),
  web_url: Schema.optional(Schema.NullOr(Schema.String)),
  downstream_pipeline: Schema.optional(
    Schema.NullOr(Schema.Struct({ status: Schema.String, web_url: Schema.optional(Schema.NullOr(Schema.String)) })),
  ),
})

/** A merge request's size, from GitLab's GraphQL, which REST doesn't give without the whole diff. */
const SizeAnswer = Schema.Struct({
  project: Schema.NullOr(
    Schema.Struct({
      mergeRequest: Schema.NullOr(
        Schema.Struct({
          diffStatsSummary: Schema.NullOr(Schema.Struct({ additions: Schema.Number, deletions: Schema.Number, fileCount: Schema.Number })),
        }),
      ),
    }),
  ),
})

const Discussion = Schema.Struct({ id: Schema.String, individual_note: Schema.Boolean, notes: Schema.Array(NoteAnswer) })

const IssueAnswer = Schema.Struct({
  id: Schema.Number,
  iid: Schema.Number,
  title: Schema.String,
  description: Schema.optional(Schema.NullOr(Schema.String)),
  web_url: Schema.String,
  state: Schema.String,
  assignees: Schema.optional(Schema.NullOr(Schema.Array(User))),
  labels: Schema.optional(Schema.Array(Schema.String)),
  references: Schema.optional(Schema.Struct({ full: Schema.String })),
  updated_at: Schema.String,
})
type IssueAnswer = typeof IssueAnswer.Type

/** GitLab's Developer role: the least that pushes a branch and merges, where the branch allows. */
const DEVELOPER = 30

const personOf = (user: User): Person => ({
  id: String(user.id),
  login: user.username,
  name: user.name ?? null,
  bot: user.bot === true,
})

/** The prefixes GitLab reads as a draft, at the start of a title. */
const DRAFT = /^\s*(?:\[draft\]|\(draft\)|draft:|draft\s+-)\s*/i

/** A title without its draft prefixes, as marking it ready leaves it. */
export const readyTitle = (title: string): string => {
  let rest = title
  while (DRAFT.test(rest)) rest = rest.replace(DRAFT, '')
  return rest
}

/** How many files a merge request changes; "1000+" counts as a thousand. */
const filesOf = (count: string | null | undefined): number | null => {
  const files = Number.parseInt(count ?? '', 10)
  return Number.isNaN(files) ? null : files
}

/** The merge statuses GitLab gives while it is still working out whether a merge request can merge. */
const CHECKING = new Set(['checking', 'unchecked', 'preparing', 'approvals_syncing'])

const changeOf = (request: MergeAnswer): ChangeRequest => ({
  id: String(request.id),
  number: request.iid,
  // The prefix is how GitLab says draft; the model says it with `draft`.
  title: readyTitle(request.title),
  body: request.description ?? '',
  url: request.web_url,
  // Locked is a merge under way: still open until it lands.
  state: request.state === 'merged' ? 'merged' : request.state === 'closed' ? 'closed' : 'open',
  draft: request.draft ?? request.work_in_progress ?? false,
  source: request.source_branch,
  target: request.target_branch,
  headSha: request.sha ?? null,
  author: request.author == null ? null : personOf(request.author),
  // GitLab counts files, not lines, unless the whole diff is read.
  additions: null,
  deletions: null,
  changedFiles: filesOf(request.changes_count),
  updatedAt: request.updated_at,
  // What its merge status says, once GitLab has worked it out; until then, `has_conflicts` may be from before the target moved.
  ...(request.detailed_merge_status === 'conflict'
    ? { conflicts: true }
    : request.detailed_merge_status === undefined || CHECKING.has(request.detailed_merge_status)
      ? {}
      : { conflicts: request.has_conflicts === true }),
})

/** GitLab's state for each a list can ask for. */
const LISTED_STATES = { open: 'opened', closed: 'closed', merged: 'merged', all: 'all' } as const

/**
 * A merge request as a list gives it. Its merge status says what still
 * holds it up, and so whether a reviewer asked for changes, an approval it
 * needs is missing, or its pipeline is still running; not an approval given,
 * nor a pipeline that failed, which a list doesn't say.
 */
const listedOf = (request: MergeAnswer): ListedChange => {
  const status = request.detailed_merge_status
  return {
    ...changeOf(request),
    // Never read from a list: what it says is read with the merge request.
    body: '',
    forkOwner: null,
    reviewDecision: status === 'requested_changes' ? 'changes_requested' : status === 'not_approved' ? 'review_required' : null,
    checks: status === 'ci_still_running' ? 'running' : null,
  }
}

/**
 * How the project merges, its own choice first: squashed where its squash
 * setting requires it or squashes by default, its own method otherwise, and
 * the other where a merge request may choose.
 */
export const mergesOf = (method: string | null | undefined, squash: string | null | undefined): ReadonlyArray<MergeMethod> => {
  // Fast-forward only rebases the branch onto its target; a semi-linear merge still makes a merge commit.
  const own: MergeMethod = method === 'ff' ? 'rebase' : 'merge'
  switch (squash) {
    case 'always':
      return ['squash']
    case 'default_on':
      return ['squash', own]
    case 'default_off':
      return [own, 'squash']
    // Never, or not said to this account.
    default:
      return [own]
  }
}

/** A job's state. A failure the pipeline allows doesn't hold the merge request up. */
export const jobState = (status: string, allowFailure: boolean): CheckState => {
  switch (status) {
    case 'success':
      return 'passed'
    case 'failed':
      return allowFailure ? 'neutral' : 'failed'
    case 'running':
      return 'running'
    case 'canceled':
    case 'canceling':
      return 'cancelled'
    // A manual job hasn't run, and won't until someone starts it.
    case 'skipped':
    case 'manual':
      return 'skipped'
    default:
      return 'queued'
  }
}

/** What GitLab says stops a merge, in its own words, from its documentation of `detailed_merge_status`. */
const NOT_MERGEABLE: Readonly<Record<string, string>> = {
  ci_must_pass: 'A CI/CD pipeline must succeed before merge.',
  ci_still_running: 'A CI/CD pipeline is still running.',
  conflict: 'Conflicts exist between the source and target branches.',
  discussions_not_resolved: 'All discussions must be resolved before merge.',
  draft_status: 'Can’t merge because the merge request is a draft.',
  merge_request_blocked: 'Blocked by another merge request.',
  need_rebase: 'The merge request must be rebased. Rebase it on GitLab, then accept it again.',
  not_approved: 'Approval is required before merge.',
  not_open: 'The merge request must be open before merge.',
  requested_changes: 'The merge request has reviewers who have requested changes.',
}

/**
 * The system notes that are a review's verdict, by how they start: "approved
 * this merge request" and "requested changes" today, read loosely, as
 * GitLab's wording has moved between versions. "unapproved" is no verdict.
 */
export const verdictOf = (note: NoteAnswer): Verdict | undefined =>
  !note.system
    ? undefined
    : /^approved\b/i.test(note.body)
      ? 'approved'
      : /^requested changes\b/i.test(note.body)
        ? 'changes_requested'
        : undefined

/** `group/sub/project#12`: the ref GitLab's issues go by. */
const issueRef = /^(.+\/[^/#\s]+)#(\d+)$/

/** How many pages of a merge request's threads are read: a hundred threads each. */
const THREAD_PAGES = 10

export const makeGitLab = (options: AdapterOptions): CodeHost & Tracker => {
  const product = 'gitlab' as const
  const api = options.apiUrl.replace(/\/+$/, '')
  const web = options.webUrl.replace(/\/+$/, '')
  const http = makeHttp({ product, fetch: options.fetch, authorization: Effect.map(options.credential, authorizationOf) })
  const graphqlUrl = `${api.replace(/\/v4$/, '')}/graphql`
  const project = (repository: Repository | ReadonlyArray<string>) =>
    `${api}/projects/${'path' in repository ? repository.id : encodeURIComponent(repository.join('/'))}`

  const account: Effect.Effect<Account, ConnectorFailed> = Effect.map(http.json(User, 'GET', `${api}/user`), (user) => ({
    id: String(user.id),
    login: user.username,
    name: user.name ?? null,
  }))

  const findChange = (repository: Repository, source: string, from?: Repository) =>
    Effect.map(
      http.json(
        Schema.Array(MergeAnswer),
        'GET',
        `${project(repository)}/merge_requests?state=opened&source_branch=${encodeURIComponent(source)}`,
      ),
      (requests) => {
        // A fork's branch of the same name isn't this one: the project it is on says whose it is.
        const on = (from ?? repository).id
        const found = requests.find((request) => request.source_project_id === undefined || String(request.source_project_id) === on)
        return found === undefined ? null : changeOf(found)
      },
    )

  const read = (repository: Repository, number: number) => http.json(MergeAnswer, 'GET', `${project(repository)}/merge_requests/${number}`)

  /** Each merge request's size at the head it was counted at: counted again only when the head moves. */
  const sizes = new Map<
    string,
    { readonly sha: string | null; readonly additions: number; readonly deletions: number; readonly files: number }
  >()
  const sizeOf = (repository: Repository, request: MergeAnswer) => {
    const key = `${repository.id}!${request.iid}`
    const known = sizes.get(key)
    if (known !== undefined && known.sha === (request.sha ?? null)) return Effect.succeed(known)
    return http
      .graphql(
        SizeAnswer,
        graphqlUrl,
        'query($path: ID!, $iid: String!) { project(fullPath: $path) { mergeRequest(iid: $iid) { diffStatsSummary { additions deletions fileCount } } } }',
        { path: repository.path.join('/'), iid: String(request.iid) },
      )
      .pipe(
        Effect.map((answer) => {
          const stats = answer.project?.mergeRequest?.diffStatsSummary
          if (stats == null) return null
          const size = { sha: request.sha ?? null, additions: stats.additions, deletions: stats.deletions, files: stats.fileCount }
          sizes.set(key, size)
          return size
        }),
        // A server too old to say, or a query it refuses: the size stays unknown, and the merge request reads as before.
        Effect.orElseSucceed(() => null),
      )
  }

  /** Whether someone can write to the project: a member, inherited or invited, with the Developer role or above. */
  const memberOf = (repository: Repository, user: User) =>
    http.cached(Schema.Struct({ access_level: Schema.Number }), `${project(repository)}/members/all/${user.id}`).pipe(
      Effect.map((member) => member.access_level >= DEVELOPER),
      Effect.catchIf(
        (error) => error.reason === 'not_found',
        () => Effect.succeed(false),
      ),
    )

  const commentOf = (repository: Repository, number: number, note: NoteAnswer, threadId: string | null, member: boolean): Comment => ({
    id: String(note.id),
    author: personOf(note.author),
    member,
    body: note.body,
    at: note.updated_at,
    url: `${repository.webUrl}/-/merge_requests/${number}#note_${note.id}`,
    threadId,
    path: note.position?.new_path ?? note.position?.old_path ?? null,
    line: note.position?.new_line ?? note.position?.old_line ?? null,
  })

  /** Every thread on a merge request, a hundred to a page, oldest first. */
  const threads = (repository: Repository, number: number) =>
    Effect.gen(function* () {
      const all: Array<typeof Discussion.Type> = []
      for (let page = 1; page <= THREAD_PAGES; page += 1) {
        const batch = yield* http.cached(
          Schema.Array(Discussion),
          `${project(repository)}/merge_requests/${number}/discussions?per_page=100&page=${page}`,
        )
        all.push(...batch)
        if (batch.length < 100) break
      }
      return all
    })

  const issueOf = (issue: IssueAnswer, container: string): Issue => ({
    id: String(issue.id),
    ref: `${container}#${issue.iid}`,
    key: `#${issue.iid}`,
    title: issue.title,
    body: issue.description ?? '',
    url: issue.web_url,
    status: issue.state === 'closed' ? { name: 'Closed', category: 'done' } : { name: 'Open', category: 'todo' },
    priority: null,
    assignees: (issue.assignees ?? []).map(personOf),
    labels: issue.labels ?? [],
    container,
    updatedAt: issue.updated_at,
  })

  /** The project an issue is in: from its full reference, or else its address. */
  const containerOf = (issue: IssueAnswer) =>
    issue.references?.full.replace(/#\d+$/, '') ?? issue.web_url.slice(web.length + 1).split('/-/')[0] ?? ''

  const parseRef = (ref: string) => {
    const match = issueRef.exec(ref)
    return match === null
      ? Effect.fail(new ConnectorFailed({ product, reason: 'not_found', message: `Not a GitLab issue: ${ref}` }))
      : Effect.succeed({ path: match[1] ?? '', number: Number(match[2]) })
  }

  return {
    product,
    words: { noun: 'merge request', short: 'MR', prefix: '!' },
    capabilities: { drafts: true, checkLogs: true, threads: true, reviews: false, links: false, starts: false },
    account,
    repository: (path) =>
      Effect.map(http.json(ProjectAnswer, 'GET', project(path)), (answer) => ({
        id: String(answer.id),
        path: answer.path_with_namespace.split('/'),
        defaultBranch: answer.default_branch ?? 'main',
        webUrl: answer.web_url,
        canPush:
          Math.max(answer.permissions?.project_access?.access_level ?? 0, answer.permissions?.group_access?.access_level ?? 0) >= DEVELOPER,
        merges: mergesOf(answer.merge_method, answer.squash_option),
      })),
    findChange,
    openChange: (repository, change) =>
      http
        // From a fork, the merge request is made on the fork, into the project it was forked from.
        .json(MergeAnswer, 'POST', `${project(change.from ?? repository)}/merge_requests`, {
          source_branch: change.source,
          target_branch: change.target,
          ...(change.from === undefined ? {} : { target_project_id: Number(repository.id) }),
          title: change.draft ? `Draft: ${readyTitle(change.title)}` : change.title,
          description: change.body,
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
    change: (repository, number) =>
      Effect.gen(function* () {
        const request = yield* http.cached(MergeAnswer, `${project(repository)}/merge_requests/${number}`)
        const size = yield* sizeOf(repository, request)
        return size === null
          ? changeOf(request)
          : { ...changeOf(request), additions: size.additions, deletions: size.deletions, changedFiles: size.files }
      }),
    listChanges: (repository, query) =>
      Effect.gen(function* () {
        const limit = Math.min(Math.max(query.limit, 1), 99)
        const params = new URLSearchParams({ state: LISTED_STATES[query.state], order_by: 'updated_at', sort: 'desc' })
        // One more than asked: whether there are more, without counting them all.
        params.set('per_page', String(limit + 1))
        if (query.author !== undefined && query.author.trim() !== '') params.set('author_username', query.author.trim().replace(/^@/, ''))
        if (query.text !== undefined && query.text.trim() !== '') {
          params.set('search', query.text.trim())
          params.set('in', 'title')
        }
        if (query.reviewRequested === true) params.set('reviewer_username', (yield* account).login)
        if (query.draft !== undefined) params.set('wip', query.draft ? 'yes' : 'no')
        const requests = yield* http.cached(Schema.Array(MergeAnswer), `${project(repository)}/merge_requests?${params.toString()}`)
        return { changes: requests.slice(0, limit).map(listedOf), more: requests.length > limit } satisfies ChangeList
      }).pipe(Effect.mapError(lacking('read_api'))),
    markReady: (repository, change) =>
      Effect.gen(function* () {
        // Its title as it is now, not as Althar last read it: a rename on GitLab since stays.
        const now = yield* read(repository, change.number)
        if (!(now.draft ?? now.work_in_progress ?? false)) return changeOf(now)
        return changeOf(
          yield* http.json(MergeAnswer, 'PUT', `${project(repository)}/merge_requests/${change.number}`, { title: readyTitle(now.title) }),
        )
      }),
    merge: (repository, change) =>
      http
        .json(MergeAnswer, 'PUT', `${project(repository)}/merge_requests/${change.number}/merge`, {
          squash: repository.merges[0] === 'squash',
          // Only the head Althar last saw: a push since then isn't merged unseen, and GitLab says 409.
          ...(change.headSha === null ? {} : { sha: change.headSha }),
        })
        .pipe(
          Effect.map(changeOf),
          Effect.catchIf(
            (error) => error.status === 405 || error.status === 401,
            (error) =>
              Effect.gen(function* () {
                // 401 is GitLab's word for an account that may not merge here, while its token still works.
                if (error.status === 401) {
                  yield* account
                  return yield* new ConnectorFailed({ product, reason: 'forbidden', status: 401, message: error.message })
                }
                // 405 says only that it can't merge; the merge request says why.
                const why = (yield* read(repository, change.number)).detailed_merge_status ?? ''
                return yield* new ConnectorFailed({
                  product,
                  reason: 'rejected',
                  status: 405,
                  message: NOT_MERGEABLE[why] ?? error.message,
                })
              }),
          ),
        ),
    checks: (repository, sha) =>
      Effect.gen(function* () {
        const pipelines = yield* http.cached(Schema.Array(Pipeline), `${project(repository)}/pipelines?sha=${sha}&per_page=20`)
        // The newest of GitLab's own pipelines; one an outside CI made has no jobs to read.
        let pipeline: typeof Pipeline.Type | null | undefined = pipelines.find((found) => found.source !== 'external')
        if (pipeline === undefined) {
          // A merged results pipeline runs on a merge commit, not on the head: the head's merge request says which.
          const requests = yield* http.cached(Schema.Array(MergeAnswer), `${project(repository)}/repository/commits/${sha}/merge_requests`)
          const open = requests.find((request) => request.state === 'opened' && request.sha === sha)
          pipeline = open === undefined ? null : (yield* read(repository, open.iid)).head_pipeline
        }
        if (pipeline == null) return []
        const where = String(pipeline.project_id ?? repository.id)
        const jobs = yield* http.cached(Schema.Array(JobAnswer), `${api}/projects/${where}/pipelines/${pipeline.id}/jobs?per_page=100`)
        // A child pipeline, or another project's, is started by a trigger job that the jobs leave out: its result is one check.
        const bridges = yield* http.cached(
          Schema.Array(BridgeAnswer),
          `${api}/projects/${where}/pipelines/${pipeline.id}/bridges?per_page=100`,
        )
        return [
          ...jobs.map((job): Check => ({
            // The job's project and id: where its log is.
            id: `job:${where}:${job.id}`,
            name: job.name,
            state: jobState(job.status, job.allow_failure === true),
            url: job.web_url ?? null,
            summary: job.failure_reason ?? null,
          })),
          ...bridges.map((bridge): Check => ({
            // No log of its own: the downstream pipeline's jobs have theirs.
            id: `bridge:${where}:${bridge.id}`,
            name: bridge.name,
            state: jobState(bridge.downstream_pipeline?.status ?? bridge.status, bridge.allow_failure === true),
            url: bridge.downstream_pipeline?.web_url ?? bridge.web_url ?? null,
            summary: null,
          })),
        ]
      }),
    checkLog: (repository, check, whole = false) => {
      const match = /^job:(\d+):(\d+)$/.exec(check.id)
      if (match === null) return Effect.succeed(null)
      return http.text(`${api}/projects/${match[1]}/jobs/${match[2]}/trace`).pipe(
        Effect.map((log) => (whole ? log : tail(log))),
        Effect.catchIf(
          (error) => error.reason === 'not_found' || error.reason === 'forbidden',
          () => Effect.succeed(null),
        ),
      )
    },
    rerun: (_repository, check) => {
      // A pipeline's job runs again as a new job, on the same commit.
      const match = /^job:(\d+):(\d+)$/.exec(check.id)
      if (match === null) return Effect.succeed(false)
      return http.json(Schema.Unknown, 'POST', `${api}/projects/${match[1]}/jobs/${match[2]}/retry`).pipe(Effect.as(true))
    },
    activity: (repository, number, cursor) =>
      Effect.gen(function* () {
        const found = yield* threads(repository, number)
        const notes = found.flatMap((thread) =>
          thread.notes
            .filter((note) => cursor === null || note.updated_at >= cursor)
            .map((note) => ({ note, threadId: thread.individual_note ? null : thread.id })),
        )
        // Asked once per author: whether they can write to the project.
        const members = new Map<number, boolean>()
        for (const { note } of notes)
          if ((!note.system || verdictOf(note) !== undefined) && !members.has(note.author.id))
            members.set(note.author.id, yield* memberOf(repository, note.author))
        const comments = notes
          .filter(({ note }) => !note.system)
          .map(({ note, threadId }) => commentOf(repository, number, note, threadId, members.get(note.author.id) === true))
        const reviews = notes.flatMap(({ note }): ReadonlyArray<Review> => {
          const verdict = verdictOf(note)
          return verdict === undefined
            ? []
            : [
                {
                  id: String(note.id),
                  author: personOf(note.author),
                  member: members.get(note.author.id) === true,
                  verdict,
                  body: '',
                  at: note.created_at,
                  url: `${repository.webUrl}/-/merge_requests/${number}#note_${note.id}`,
                },
              ]
        })
        const all = [...comments.map((comment) => comment.at), ...reviews.map((review) => review.at)]
        const next = all.reduce((latest, at) => (at > latest ? at : latest), cursor ?? '')
        const byTime = <T extends { readonly at: string }>(items: ReadonlyArray<T>) => items.toSorted((a, b) => (a.at < b.at ? -1 : 1))
        return { comments: byTime(comments), reviews: byTime(reviews), cursor: next } satisfies Activity
      }),
    reply: (repository, number, reply) =>
      Effect.map(
        http.json(
          NoteAnswer,
          'POST',
          reply.threadId === null
            ? `${project(repository)}/merge_requests/${number}/notes`
            : `${project(repository)}/merge_requests/${number}/discussions/${encodeURIComponent(reply.threadId)}/notes`,
          { body: reply.body },
        ),
        // Althar's own reply: whether it counts as a member's doesn't matter, it is known by its receipt.
        (note) => commentOf(repository, number, note, reply.threadId, true),
      ),
    // Reviews of a change Althar didn't open are GitHub's alone, for now.
    changeToReview: () => Effect.fail(noReviews(product, { noun: 'merge request', short: 'MR', prefix: '!' })),
    postReview: () => Effect.fail(noReviews(product, { noun: 'merge request', short: 'MR', prefix: '!' })),
    pushTarget: (repository) =>
      Effect.map(options.credential, (credential) => ({
        url: `${web}/${repository.path.join('/')}.git`,
        // GitLab takes an OAuth token, or a personal one, as the password of the user `oauth2`.
        header: `Authorization: Basic ${Buffer.from(`oauth2:${credential.token}`).toString('base64')}`,
      })),
    issue: (ref) =>
      Effect.gen(function* () {
        const { path, number } = yield* parseRef(ref)
        const issue = yield* http.json(IssueAnswer, 'GET', `${project(path.split('/'))}/issues/${number}`)
        return issueOf(issue, path)
      }),
    mine: (options = {}) =>
      Effect.gen(function* () {
        const query = `scope=assigned_to_me&state=opened&order_by=updated_at&sort=desc&per_page=${options.limit ?? 50}`
        const issues = yield* http.json(
          Schema.Array(IssueAnswer),
          'GET',
          options.container === undefined ? `${api}/issues?${query}` : `${project(options.container.split('/'))}/issues?${query}`,
        )
        return issues.map((issue) => issueOf(issue, options.container ?? containerOf(issue)))
      }),
    comment: (issue, body) =>
      Effect.gen(function* () {
        const { path, number } = yield* parseRef(issue.ref)
        yield* http.json(Schema.Unknown, 'POST', `${project(path.split('/'))}/issues/${number}/notes`, { body })
      }),
    // GitLab's issues link only to issues: the merge request's "Closes #12" links the two.
    link: () => Effect.void,
    // An issue is open or closed: a board's In progress is a label each project names as it likes, so a started one is left as it is.
    start: (issue) => Effect.succeed(leftAsItIs(issue)),
    // The projects the account is a member of, Guest or above (a Guest may open issues), not archived, with issues on; last active first.
    containers: () =>
      Effect.map(
        // A page short of a hundred is the last.
        paged(1, (page) =>
          Effect.map(
            http.json(
              Schema.Array(Schema.Struct({ path_with_namespace: Schema.String, issues_enabled: Schema.optional(Schema.Boolean) })),
              'GET',
              `${api}/projects?membership=true&min_access_level=10&archived=false&with_issues_enabled=true&order_by=last_activity_at&per_page=100&simple=true&page=${page}`,
            ),
            (projects) => ({ items: projects, next: projects.length < 100 ? undefined : page + 1 }),
          ),
        ),
        (projects) =>
          projects
            .filter((found) => found.issues_enabled !== false)
            .map((found): Container => ({
              id: found.path_with_namespace,
              key: found.path_with_namespace,
              name: found.path_with_namespace,
            })),
      ),
    create: (container, issue) =>
      /^[^/\s#]+(\/[^/\s#]+)+$/.test(container)
        ? Effect.map(
            // GitLab makes a project label for any it lacks, so every label is sent as it is.
            http.json(IssueAnswer, 'POST', `${project(container.split('/'))}/issues`, {
              title: issue.title,
              description: issue.body,
              ...(issue.labels.length === 0 ? {} : { labels: issue.labels.join(',') }),
            }),
            (filed) => issueOf(filed, container),
          )
        : Effect.fail(new ConnectorFailed({ product, reason: 'not_found', message: `Not a GitLab project: ${container}` })),
  }
}

/*
 * What a GitLab connection can do. A personal access token says its own
 * scopes and when it runs out; an OAuth token says them at the server's
 * token info. The account's role in each project is the project's to say,
 * and the least of them decides: a Developer pushes, opens and merges.
 */

const TokenSelf = Schema.Struct({ scopes: Schema.Array(Schema.String), expires_at: Schema.optional(Schema.NullOr(Schema.String)) })
const TokenInfo = Schema.Struct({ scope: Schema.Array(Schema.String), expires_in: Schema.optional(Schema.NullOr(Schema.Number)) })

/** GitLab's refusal of a token without the scope a call needs. */
const ScopeRefused = Schema.Struct({ error: Schema.Literal('insufficient_scope') })

/** GitLab's roles, by their access level. */
const ROLES: ReadonlyMap<number, string> = new Map([
  [0, 'No access'],
  [5, 'Minimal Access'],
  [10, 'Guest'],
  [15, 'Planner'],
  [20, 'Reporter'],
  [30, 'Developer'],
  [40, 'Maintainer'],
  [50, 'Owner'],
])

/** A role's name, by its access level; a level GitLab adds later by its number. */
export const roleOf = (level: number): string => ROLES.get(level) ?? `Level ${level}`

/** A personal access token's last day, as the moment it runs out: its start, in UTC. */
const dayOf = (day: string | null | undefined): string | null => {
  if (day == null) return null
  const at = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(day) ? `${day}T00:00:00Z` : day)
  return Number.isNaN(at) ? null : new Date(at).toISOString()
}

export const accessGitLab: Access = (input) =>
  Effect.gen(function* () {
    const api = input.apiUrl.replace(/\/+$/, '')
    const web = input.webUrl.replace(/\/+$/, '')
    const ask = (url: string) => probe(input, url)
    const scope = (name: string): AccessReason => ({ kind: 'scope', scope: name, url: `${web}/-/user_settings/personal_access_tokens` })
    const lines: Array<AccessLine> = []

    const me = yield* ask(`${api}/user`)
    // A company's own server: whether it answers at all comes first.
    if (!input.hosted) {
      lines.push(serverLine('server', web, me))
      if (me.status === 0) return stopped(lines)
    }
    if (!answered(me))
      return stopped([
        ...lines,
        line('account', 'no', { reason: me.status === 403 && readAs(ScopeRefused, me) !== undefined ? scope('read_user') : refusalOf(me) }),
      ])
    const user = readAs(User, me)
    if (user === undefined) return stopped([...lines, line('account', 'no', { reason: UNREADABLE })])
    lines.push(line('account', 'ok', { fact: user.username }))

    // A personal access token says its own scopes; an OAuth token, or one an older server won't say, at the token info.
    const own = yield* ask(`${api}/personal_access_tokens/self`)
    const self = answered(own) ? readAs(TokenSelf, own) : undefined
    const info = self === undefined ? yield* ask(`${web}/oauth/token/info`) : null
    const told = info !== null && answered(info) ? readAs(TokenInfo, info) : undefined
    const now = yield* Clock.currentTimeMillis
    const token =
      self !== undefined
        ? { scopes: self.scopes, expiresAt: dayOf(self.expires_at) }
        : told !== undefined
          ? { scopes: told.scope, expiresAt: told.expires_in == null ? null : new Date(now + told.expires_in * 1000).toISOString() }
          : { scopes: null, expiresAt: null }
    const { scopes } = token
    const lacks = (...any: ReadonlyArray<string>) => scopes !== null && !any.some((name) => scopes.includes(name))

    const reached = yield* Effect.forEach(
      input.repositories,
      (path) =>
        Effect.map(ask(`${api}/projects/${encodeURIComponent(path.join('/'))}`), (answer): Reached<number> => {
          if (answered(answer)) {
            const found = readAs(ProjectAnswer, answer)
            return found === undefined
              ? { path, missed: UNREADABLE }
              : {
                  path,
                  seen: Math.max(found.permissions?.project_access?.access_level ?? 0, found.permissions?.group_access?.access_level ?? 0),
                }
          }
          if (answer.status === 404) return { path, missed: { kind: 'unseen', names: [path.join('/')], url: null } }
          if (answer.status === 403 && readAs(ScopeRefused, answer) !== undefined) return { path, missed: scope('read_api') }
          return { path, missed: failedOf(answer) }
        }),
      { concurrency: 4 },
    )
    const levels = seenOf(reached)
    // The least role among the projects it sees decides for them all.
    const level = levels.length === 0 ? null : Math.min(...levels)
    if (reached.length > 0) lines.push(reachLine(reached, level === null ? null : roleOf(level)))
    const below: AccessReason | null = level !== null && level < DEVELOPER ? { kind: 'role', role: roleOf(level) } : null

    // Without its scopes, what the token may do isn't known: only the account's role can say no.
    // A missing scope is named as the one to make a token with: the least that does it.
    const given = (need: AccessLine['need'], named: string, ...any: ReadonlyArray<string>) =>
      scopes === null
        ? line(need, 'unknown', { reason: { kind: 'unreadable' } })
        : lacks(...any)
          ? line(need, 'no', { reason: scope(named) })
          : line(need, 'ok')
    lines.push(
      below !== null ? line('push', 'no', { reason: below }) : given('push', 'api', 'api', 'write_repository'),
      below !== null ? line('changes', 'no', { reason: below }) : given('changes', 'api', 'api'),
      given('checks', 'read_api', 'api', 'read_api'),
      given('issues', 'api', 'api'),
    )

    return { account: { id: String(user.id), login: user.username, name: user.name ?? null }, lines, ...token }
  })
