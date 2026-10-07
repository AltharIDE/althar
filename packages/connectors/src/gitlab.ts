import { Effect, Schema } from 'effect'

import { type AdapterOptions, authorizationOf } from './credential'
import { ConnectorFailed } from './errors'
import { makeHttp } from './http'
import { tail } from './github'
import type {
  Account,
  Activity,
  ChangeRequest,
  Check,
  CheckState,
  CodeHost,
  Comment,
  Issue,
  MergeMethod,
  Person,
  Repository,
  Review,
  Tracker,
  Verdict,
} from './model'

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
  sha: Schema.optional(Schema.NullOr(Schema.String)),
  author: Schema.optional(Schema.NullOr(User)),
  // A string, and "1000+" past a thousand files; said only when one merge request is read.
  changes_count: Schema.optional(Schema.NullOr(Schema.String)),
  detailed_merge_status: Schema.optional(Schema.String),
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
})

/** How the project merges, in the order Althar prefers: squashed, where its squash setting allows, then its own method. */
export const mergesOf = (method: string | null | undefined, squash: string | null | undefined): ReadonlyArray<MergeMethod> => {
  // Fast-forward only rebases the branch onto its target; a semi-linear merge still makes a merge commit.
  const own: MergeMethod = method === 'ff' ? 'rebase' : 'merge'
  if (squash === 'always') return ['squash']
  if (squash === 'never') return [own]
  return squash == null ? [own] : ['squash', own]
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
  need_rebase: 'The merge request must be rebased.',
  not_approved: 'Approval is required before merge.',
  not_open: 'The merge request must be open before merge.',
  requested_changes: 'The merge request has reviewers who have requested changes.',
}

/** The system notes that are a review's verdict. */
const verdictOf = (note: NoteAnswer): Verdict | undefined =>
  !note.system
    ? undefined
    : note.body === 'approved this merge request'
      ? 'approved'
      : note.body === 'requested changes'
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
  const project = (repository: Repository | ReadonlyArray<string>) =>
    `${api}/projects/${'path' in repository ? repository.id : encodeURIComponent(repository.join('/'))}`

  const account: Effect.Effect<Account, ConnectorFailed> = Effect.map(http.json(User, 'GET', `${api}/user`), (user) => ({
    id: String(user.id),
    login: user.username,
    name: user.name ?? null,
  }))

  const findChange = (repository: Repository, source: string) =>
    Effect.map(
      http.json(
        Schema.Array(MergeAnswer),
        'GET',
        `${project(repository)}/merge_requests?state=opened&source_branch=${encodeURIComponent(source)}`,
      ),
      (requests) => (requests[0] === undefined ? null : changeOf(requests[0])),
    )

  const read = (repository: Repository, number: number) => http.json(MergeAnswer, 'GET', `${project(repository)}/merge_requests/${number}`)

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
    capabilities: { drafts: true, checkLogs: true, threads: true, links: false },
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
        .json(MergeAnswer, 'POST', `${project(repository)}/merge_requests`, {
          source_branch: change.source,
          target_branch: change.target,
          title: change.draft ? `Draft: ${readyTitle(change.title)}` : change.title,
          description: change.body,
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
    change: (repository, number) => Effect.map(http.cached(MergeAnswer, `${project(repository)}/merge_requests/${number}`), changeOf),
    markReady: (repository, change) =>
      Effect.map(
        http.json(MergeAnswer, 'PUT', `${project(repository)}/merge_requests/${change.number}`, { title: readyTitle(change.title) }),
        changeOf,
      ),
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
        return jobs.map((job): Check => ({
          // The job's project and id: where its log is.
          id: `job:${where}:${job.id}`,
          name: job.name,
          state: jobState(job.status, job.allow_failure === true),
          url: job.web_url ?? null,
          summary: job.failure_reason ?? null,
        }))
      }),
    checkLog: (repository, check) => {
      const match = /^job:(\d+):(\d+)$/.exec(check.id)
      if (match === null) return Effect.succeed(null)
      return http.text(`${api}/projects/${match[1]}/jobs/${match[2]}/trace`).pipe(
        Effect.map(tail),
        Effect.catchIf(
          (error) => error.reason === 'not_found' || error.reason === 'forbidden',
          () => Effect.succeed(null),
        ),
      )
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
  }
}
