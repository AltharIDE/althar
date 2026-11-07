import { createHash } from 'node:crypto'

import { Clock, Effect, Schema } from 'effect'

import { type Access, type AccessLine, type AccessReason, line } from './access'
import { type AdapterOptions, authorizationOf } from './credential'
import { updateInCopy } from './branchUpdate'
import { ConnectorFailed } from './errors'
import { makeHttp, paged } from './http'
import { makeGitLabReleases } from './gitlabReleases'
import { pageOfCursor, tail } from './github'
import type {
  Account,
  Activity,
  ChangeList,
  ChangeRequest,
  Check,
  CheckState,
  Choice,
  ChosenField,
  CodeHost,
  Comment,
  Container,
  Issue,
  IssueChange,
  IssueComment,
  IssueField,
  IssuePage,
  IssueQuery,
  ListedChange,
  MergeMethod,
  Person,
  Repository,
  Review,
  Tracker,
  TrackerCapabilities,
  Verdict,
} from './model'
import {
  cantChange,
  cantFind,
  filtersOf,
  inIssueState,
  issueMatches,
  lacking,
  leftAsItIs,
  mergedForGood,
  noReviews,
  pageAt,
  stillOpen,
  unchangeable,
  unfindable,
} from './model'
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
  // Premium's: whether merge requests merge through a merge train. Absent on a tier without them.
  merge_trains_enabled: Schema.optional(Schema.NullOr(Schema.Boolean)),
  permissions: Schema.optional(Schema.NullOr(Schema.Struct({ project_access: Access, group_access: Access }))),
  // The project it was forked from: given only for a fork, and only where the account can see that project.
  forked_from_project: Schema.optional(Schema.NullOr(Schema.Struct({ path_with_namespace: Schema.String }))),
})

const Pipeline = Schema.Struct({
  id: Schema.Number,
  // A merge request from a fork runs its pipeline in the fork.
  project_id: Schema.optional(Schema.Number),
  sha: Schema.optional(Schema.String),
  source: Schema.optional(Schema.String),
})

/** A commit status: what GitLab's own CI posts for each job, and what a CI service outside it posts for the commit. */
const StatusAnswer = Schema.Struct({
  id: Schema.Number,
  name: Schema.String,
  status: Schema.String,
  target_url: Schema.optional(Schema.NullOr(Schema.String)),
  description: Schema.optional(Schema.NullOr(Schema.String)),
})
type StatusAnswer = typeof StatusAnswer.Type

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
  /** The project it goes into. */
  target_project_id: Schema.optional(Schema.Number),
  sha: Schema.optional(Schema.NullOr(Schema.String)),
  author: Schema.optional(Schema.NullOr(User)),
  // A string, and "1000+" past a thousand files; said only when one merge request is read.
  changes_count: Schema.optional(Schema.NullOr(Schema.String)),
  detailed_merge_status: Schema.optional(Schema.String),
  has_conflicts: Schema.optional(Schema.Boolean),
  // Auto-merge, a merge train's entry included: GitLab merges it once its pipeline passes.
  merge_when_pipeline_succeeds: Schema.optional(Schema.NullOr(Schema.Boolean)),
  head_pipeline: Schema.optional(Schema.NullOr(Pipeline)),
  updated_at: Schema.String,
})
type MergeAnswer = typeof MergeAnswer.Type

const VersionAnswer = Schema.Struct({ version: Schema.String })
const BranchAnswer = Schema.Struct({ commit: Schema.Struct({ id: Schema.String }) })

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

/** What GitLab says of a file it took for a project's notes: where it is, from the project's own page. */
const UploadAnswer = Schema.Struct({ url: Schema.String })

/** A file as a form sends it, the way GitLab's uploads take one: its bytes as `file`, with its name and type. */
const formWith = (picture: { readonly bytes: Uint8Array; readonly name: string; readonly mediaType: string }, boundary: string) => {
  // A name in quotes can't hold a quote or a line's end.
  const name = picture.name.replace(/["\r\n]/g, '-')
  const head = new TextEncoder().encode(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${picture.mediaType}\r\n\r\n`,
  )
  const foot = new TextEncoder().encode(`\r\n--${boundary}--\r\n`)
  const body = new Uint8Array(head.length + picture.bytes.length + foot.length)
  body.set(head, 0)
  body.set(picture.bytes, head.length)
  body.set(foot, head.length + picture.bytes.length)
  return body
}

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
  milestone: Schema.optional(Schema.NullOr(Schema.Struct({ id: Schema.Number, title: Schema.String }))),
  // GitLab's weight, on its paid tiers: null, or left out, on its free one.
  weight: Schema.optional(Schema.NullOr(Schema.Number)),
  due_date: Schema.optional(Schema.NullOr(Schema.String)),
  issue_type: Schema.optional(Schema.NullOr(Schema.String)),
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
  // A branch of the project's own; one from a fork's, `change` reads where it is.
  ...(request.source_project_id !== undefined && request.source_project_id === request.target_project_id ? { headRepository: null } : {}),
  ...(request.merge_when_pipeline_succeeds == null ? {} : { autoMerge: request.merge_when_pipeline_succeeds }),
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

/**
 * What a check is, for telling GitLab's own pipeline jobs from the same job
 * as a commit status: its name and where it points. GitLab's commit statuses
 * hold its pipeline's jobs as well as an outside CI's, so a job read from the
 * pipeline is dropped from the statuses.
 */
const checkKey = (name: string, url: string | null | undefined) => `${name}\u0000${url ?? ''}`

/** The checks a commit status posts: the newest status each name has, less those a pipeline job already says. */
const statusChecks = (statuses: ReadonlyArray<StatusAnswer>, pipeline: ReadonlySet<string>): ReadonlyArray<Check> => {
  const latest = new Map<string, StatusAnswer>()
  for (const status of statuses) {
    if (pipeline.has(checkKey(status.name, status.target_url))) continue
    const known = latest.get(status.name)
    if (known === undefined || known.id < status.id) latest.set(status.name, status)
  }
  return [...latest.values()].map((status) => ({
    id: `status:${status.id}`,
    name: status.name,
    state: jobState(status.status, false),
    url: status.target_url ?? null,
    summary: status.description ?? null,
  }))
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

/** What GitLab changes of an issue: all but those `NOT_CHANGED` says why not. */
const ISSUE_CHANGES: ReadonlyArray<IssueField> = [
  'status',
  'close',
  'assignee',
  'labels',
  'milestone',
  'estimate',
  'type',
  'due',
  'title',
  'description',
]

/** What GitLab sets as it files an issue, beside its title, body and labels; the rest Althar sets right after. */
const ISSUE_CREATES: ReadonlyArray<IssueField> = ['assignee', 'milestone', 'estimate', 'type', 'due']

/** Why GitLab's issues don't change what they don't, in words an agent can pass on. */
const NOT_CHANGED: Partial<Record<IssueField, string>> = {
  priority: 'GitLab’s issues have no priority (a board’s priority is a label each project names)',
  project: 'a GitLab issue’s project is where it lives: moving it to another is GitLab’s own Move, on the issue',
  parent: 'GitLab’s epics are a group’s, on its paid tiers: Althar can’t set one yet',
  cycle: 'GitLab’s iterations are a group’s, on its paid tiers: Althar can’t set one yet',
  components: 'GitLab’s issues have no components: a label says what part of the project one is about',
}

/** What GitLab does as a tracker: several people to an issue. */
export const GITLAB_TRACKING: TrackerCapabilities = {
  links: false,
  starts: false,
  changes: ISSUE_CHANGES,
  creates: ISSUE_CREATES,
  assignees: 'many',
  // Its issues list narrows by each it has. It has no priority or project of an issue's own, and its epics and iterations are paid tiers'.
  finds: {
    text: 'search',
    labels: 'search',
    status: 'search',
    milestone: 'search',
    assignee: 'search',
    updatedSince: 'search',
    keys: 'search',
  },
}
const TRACKING = GITLAB_TRACKING

/** An issue's statuses on GitLab: open or closed, by the event that takes it there. */
const ISSUE_STATES: ReadonlyArray<Choice> = [
  { id: 'reopen', name: 'Open', also: ['opened', 'reopened'] },
  { id: 'close', name: 'Closed', also: ['done'] },
]

/** GitLab's kinds of issue, by the name its API gives each; a test case is its Ultimate tier's. */
const ISSUE_TYPES: ReadonlyArray<Choice> = [
  { id: 'issue', name: 'Issue' },
  { id: 'incident', name: 'Incident' },
  { id: 'test_case', name: 'Test case' },
  { id: 'task', name: 'Task' },
]

/** A kind of issue by its plain name; one GitLab adds later by its own. */
const typeOf = (type: string): string => ISSUE_TYPES.find((one) => one.id === type)?.name ?? type

/** GitLab's two states, as its issues list asks for them, with the category each is read as and its status in `ISSUE_STATES`. */
const ISSUE_LISTED_STATES = [
  { state: 'opened', category: 'todo', status: 'reopen' },
  { state: 'closed', category: 'done', status: 'close' },
] as const

/** Two names alike, in any case. */
const same = (a: string | null | undefined, b: string) => a != null && a.trim().toLowerCase() === b.trim().toLowerCase()

/** Which of GitLab's states a query finds: those its state allows, of those its status names or categories pick. */
export const issueStatesOf = (query: Pick<IssueQuery, 'state' | 'status'>): ReadonlyArray<'opened' | 'closed'> =>
  ISSUE_LISTED_STATES.filter(({ category, status: id }) => {
    const choice = ISSUE_STATES.find((one) => one.id === id)
    const status = query.status
    return (
      inIssueState(query.state, category) &&
      (status === undefined ||
        status.names.length + status.categories.length === 0 ||
        status.categories.includes(category) ||
        status.names.some((name) => [choice?.name, ...(choice?.also ?? [])].some((one) => same(one, name))))
    )
  }).map(({ state }) => state)

/** The `group/project#12` a key or ref names, `#12` in the container's project; none where it names no GitLab issue. */
export const issueRefOf = (typed: string, container?: string): string | undefined => {
  const key = typed.trim()
  if (issueRef.test(key)) return key
  const number = /^#(\d+)$/.exec(key)?.[1]
  return number === undefined || container === undefined ? undefined : `${container}#${number}`
}

/** The numbers keys give in a project, as `#12` or its own `path#12`; none where one is in another, or is no GitLab issue. */
export const iidsIn = (keys: ReadonlyArray<string>, container: string | undefined): ReadonlyArray<number> | undefined => {
  if (container === undefined) return undefined
  const iids: Array<number> = []
  for (const key of keys) {
    const match = issueRef.exec(issueRefOf(key, container) ?? '')
    if (match === null || !same(match[1], container)) return undefined
    iids.push(Number(match[2]))
  }
  return iids
}

/** What a search names that GitLab's API alone says: the assignee's username, in the project; null where no one there goes by the name. */
export interface IssueParamsResolved {
  readonly assignee?: string | null
}

/**
 * What GitLab's issues list is asked: everywhere and anyone's, those the
 * account made, as GitLab's bound is those it made or those it is assigned,
 * never both at once (those it is assigned are `mine`); narrowed as the
 * query says, by what was `resolved` of it. Null where it can find none (no
 * state of GitLab's is asked for, or no one goes by the name), or where its
 * keys aren't all the project's: those are read one by one.
 */
export const issueParamsOf = (query: IssueQuery, resolved: IssueParamsResolved = {}): URLSearchParams | null => {
  const states = issueStatesOf(query)
  const iids = filtersOf(query).includes('keys') ? iidsIn(query.keys ?? [], query.container) : []
  const assignee =
    typeof query.assignee === 'string'
      ? resolved.assignee === undefined
        ? query.assignee.trim().replace(/^@/, '')
        : resolved.assignee
      : ''
  if (states.length === 0 || iids === undefined || assignee === null) return null
  const params = new URLSearchParams({
    scope: query.mine === true ? 'assigned_to_me' : query.container === undefined ? 'created_by_me' : 'all',
    state: states.length === 2 ? 'all' : (states[0] ?? 'all'),
  })
  if (query.text !== undefined && query.text.trim() !== '') params.set('search', query.text.trim())
  // GitLab finds those with every label it is given.
  if (query.labels !== undefined && query.labels.length > 0) params.set('labels', query.labels.map((label) => label.trim()).join(','))
  if (query.milestone !== undefined) params.set('milestone', query.milestone.trim())
  if (query.assignee === null) params.set('assignee_id', 'None')
  else if (assignee !== '') params.set('assignee_username', assignee)
  if (query.updatedSince !== undefined) params.set('updated_after', query.updatedSince.trim())
  for (const iid of iids) params.append('iids[]', String(iid))
  params.set('order_by', 'updated_at')
  params.set('sort', 'desc')
  params.set('per_page', String(Math.min(Math.max(Math.floor(query.limit), 1), 100)))
  const page = pageOfCursor(query.cursor)
  if (page > 1) params.set('page', String(page))
  return params
}

/** A page of nothing. */
const NOTHING: IssuePage = { issues: [], next: null }

/**
 * Who an issue is assigned to after a change, by GitLab's ids: those added
 * first, then those it had, less those taken off. GitLab's free tier keeps
 * only the first, so there the one added takes it, as on a tracker of one.
 */
const assigneesAfter = (had: ReadonlyArray<User>, change: NonNullable<IssueChange['assignee']>): ReadonlyArray<number> => {
  const off = new Set(change.remove.map((one) => Number(one.id)))
  return [...new Set([...change.add.map((one) => Number(one.id)), ...had.map((one) => one.id)])].filter((id) => !off.has(id))
}

/** `group/sub/project#12`: the ref GitLab's issues go by. */
const issueRef = /^(.+\/[^/#\s]+)#(\d+)$/

/** How many pages of a merge request's threads are read: a hundred threads each. */
const THREAD_PAGES = 10

/** How many merge requests' sizes are kept: more than are open at once, in any project Althar follows. */
const SIZES_KEPT = 1_000

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
  /** 401 is GitLab's word for an account that may not do something here, while its token still works: forbidden, where it does. */
  const mayNot = <A>(effect: Effect.Effect<A, ConnectorFailed>) =>
    Effect.catchIf(
      effect,
      (error) => error.status === 401,
      (error) =>
        Effect.flatMap(account, () =>
          Effect.fail(new ConnectorFailed({ product, reason: 'forbidden', status: 401, message: error.message })),
        ),
    )

  /**
   * Each merge request's size at the head it was counted at: counted again
   * only when the head moves. The ones read least lately go past
   * `SIZES_KEPT`, as merge requests are merged and closed.
   */
  const sizes = new Map<
    string,
    { readonly sha: string | null; readonly additions: number; readonly deletions: number; readonly files: number }
  >()
  const sizeOf = (repository: Repository, request: MergeAnswer) => {
    const key = `${repository.id}!${request.iid}`
    const known = sizes.get(key)
    if (known !== undefined && known.sha === (request.sha ?? null)) {
      sizes.delete(key)
      sizes.set(key, known)
      return Effect.succeed(known)
    }
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
          sizes.delete(key)
          sizes.set(key, size)
          for (const oldest of sizes.keys()) {
            if (sizes.size <= SIZES_KEPT) break
            sizes.delete(oldest)
          }
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
    milestone: issue.milestone == null ? null : { id: String(issue.milestone.id), name: issue.milestone.title },
    type: issue.issue_type == null ? null : typeOf(issue.issue_type),
    due: issue.due_date ?? null,
    estimate: issue.weight ?? null,
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

  /** Every page of a project's list, a hundred at a time: a page short of a hundred is the last. */
  const everyPage = <A>(schema: Schema.Codec<A, unknown>, url: string) =>
    paged(1, (page) =>
      Effect.map(http.json(Schema.Array(schema), 'GET', `${url}${url.includes('?') ? '&' : '?'}per_page=100&page=${page}`), (items) => ({
        items,
        next: items.length < 100 ? undefined : page + 1,
      })),
    )

  /** A project by the path a container names it by, its groups then its own name: refused, without asking, where it can't be one. */
  const projectIn = (container: string) =>
    /^[^/\s#]+(\/[^/\s#]+)+$/.test(container)
      ? Effect.succeed(container.split('/'))
      : Effect.fail(new ConnectorFailed({ product, reason: 'not_found', message: `Not a GitLab project: ${container}` }))

  /** GitLab's refusal of a field it doesn't change, in its own words where it has them. */
  const refusal = (field: IssueField, otherwise = 'GitLab’s issues haven’t one') =>
    cantChange(product, field, NOT_CHANGED[field] ?? otherwise)

  /** What a field of an issue in a project can be set to, by the project's path: the same for one filed there as for one still to be. */
  const choicesAt = (path: ReadonlyArray<string>, field: ChosenField, wanted?: string) =>
    Effect.gen(function* () {
      const at = project(path)
      switch (field) {
        case 'status':
          return ISSUE_STATES
        case 'labels':
          return (yield* everyPage(Schema.Struct({ name: Schema.String }), `${at}/labels`)).map((label): Choice => ({
            id: label.name,
            name: label.name,
          }))
        // The project's people, its groups' included, found by a name where one is given.
        case 'assignee': {
          const query = wanted === undefined || wanted.trim() === '' ? '' : `?query=${encodeURIComponent(wanted.trim())}`
          return (yield* everyPage(User, `${at}/members/all${query}`)).map((user): Choice => ({
            id: String(user.id),
            name: user.name ?? user.username,
            also: [user.username],
          }))
        }
        // A milestone, still active, is where GitLab groups an issue's work.
        case 'milestone':
          return (yield* everyPage(Schema.Struct({ id: Schema.Number, title: Schema.String }), `${at}/milestones?state=active`)).map(
            (milestone): Choice => ({ id: String(milestone.id), name: milestone.title }),
          )
        case 'type':
          return ISSUE_TYPES
        case 'project':
        case 'cycle':
        case 'components':
          return yield* refusal(field)
      }
    })

  const issueChoices: Tracker['choices'] = (issue, field, wanted) =>
    Effect.flatMap(parseRef(issue.ref), ({ path }) => choicesAt(path.split('/'), field, wanted))

  const changeIssue: Tracker['update'] = (issue, wanted) =>
    Effect.gen(function* () {
      const refused = unchangeable(TRACKING, wanted)
      if (refused !== undefined) return yield* refusal(refused)
      const { path, number } = yield* parseRef(issue.ref)
      const at = `${project(path.split('/'))}/issues/${number}`
      const event = wanted.close === true && wanted.status === undefined ? 'close' : wanted.status?.id
      // GitLab takes the whole list: worked out from who is on it now, not as Althar last read it, so no one else is taken off.
      const assignees =
        wanted.assignee == null
          ? wanted.assignee
          : assigneesAfter((yield* http.json(IssueAnswer, 'GET', at)).assignees ?? [], wanted.assignee)
      // Labels are added and taken off by name; 0 takes the assignees or the milestone off, and null a weight or a due day.
      const edit = {
        ...(wanted.title === undefined ? {} : { title: wanted.title }),
        ...(wanted.description === undefined ? {} : { description: wanted.description }),
        ...(event === undefined ? {} : { state_event: event }),
        ...(assignees === undefined ? {} : { assignee_ids: assignees === null || assignees.length === 0 ? [0] : assignees }),
        ...(wanted.milestone === undefined ? {} : { milestone_id: wanted.milestone === null ? 0 : Number(wanted.milestone.id) }),
        ...(wanted.estimate === undefined ? {} : { weight: wanted.estimate }),
        ...(wanted.type === undefined ? {} : { issue_type: wanted.type.id }),
        ...(wanted.due === undefined ? {} : { due_date: wanted.due }),
        ...(wanted.labels === undefined || wanted.labels.add.length === 0
          ? {}
          : { add_labels: wanted.labels.add.map((label) => label.name).join(',') }),
        ...(wanted.labels === undefined || wanted.labels.remove.length === 0
          ? {}
          : { remove_labels: wanted.labels.remove.map((label) => label.name).join(',') }),
      }
      return issueOf(
        Object.keys(edit).length === 0 ? yield* http.json(IssueAnswer, 'GET', at) : yield* http.json(IssueAnswer, 'PUT', at, edit),
        path,
      )
    })

  /** The fork a merge request's branch is on, by its path; none where it is gone, and undefined where it is the project's own. */
  const forkOf = (request: MergeAnswer) =>
    request.source_project_id === undefined || request.source_project_id === request.target_project_id
      ? Effect.succeed(undefined)
      : http.cached(ProjectAnswer, `${api}/projects/${request.source_project_id}`).pipe(
          Effect.map((answer) => answer.path_with_namespace.split('/')),
          Effect.catchIf(
            (error) => error.reason === 'not_found',
            () => Effect.succeed([]),
          ),
        )

  const pushTarget = (repository: Repository) =>
    Effect.map(options.credential, (credential) => ({
      url: `${web}/${repository.path.join('/')}.git`,
      // GitLab takes an OAuth token, or a personal one, as the password of the user `oauth2`.
      header: `Authorization: Basic ${Buffer.from(`oauth2:${credential.token}`).toString('base64')}`,
    }))

  /** Who an assignee is in a project, by username: the one of its people whose username or name it is; null where none is. */
  const assigneeIn = (path: ReadonlyArray<string>, typed: string) =>
    Effect.map(
      choicesAt(path, 'assignee', typed),
      (people) => people.find((person) => same(person.also?.[0], typed) || same(person.name, typed))?.also?.[0] ?? null,
    )

  /** Issues by number in projects other than the container, or with none: each read on its own, narrowed as the query says, and paged. */
  const findByKeys = (query: IssueQuery) =>
    Effect.gen(function* () {
      const refs = new Set<string>()
      for (const key of query.keys ?? []) {
        const ref = issueRefOf(key, query.container)
        if (ref === undefined)
          return yield* cantFind(
            product,
            /^#\d+$/.test(key.trim())
              ? `${key} is a number in a project: say which, or as group/project${key.trim()}`
              : `Not a GitLab issue: ${key}`,
          )
        refs.add(ref)
      }
      const me = query.mine === true ? yield* account : undefined
      const read = yield* Effect.forEach(
        [...refs],
        (ref) =>
          Effect.gen(function* () {
            const { path, number } = yield* parseRef(ref)
            return [issueOf(yield* http.json(IssueAnswer, 'GET', `${project(path.split('/'))}/issues/${number}`), path)]
          }).pipe(
            Effect.catchIf(
              (error) => error.reason === 'not_found',
              () => Effect.succeed([]),
            ),
          ),
        { concurrency: 4 },
      )
      return pageAt(
        read.flat().filter((issue) => issueMatches(issue, query, me)),
        query,
      )
    })

  const findIssues: Tracker['find'] = (query) =>
    Effect.gen(function* () {
      const refused = unfindable(TRACKING, query)
      if (refused.length > 0) return yield* cantFind(product, `GitLab’s issues have no ${refused.join(' or ')} to find them by`)
      const path = query.container === undefined ? undefined : yield* projectIn(query.container)
      if (filtersOf(query).includes('keys') && iidsIn(query.keys ?? [], query.container) === undefined) return yield* findByKeys(query)
      if (issueStatesOf(query).length === 0) return NOTHING
      const typed = typeof query.assignee === 'string' ? query.assignee.trim().replace(/^@/, '') : undefined
      const params = issueParamsOf(query, typed === undefined || path === undefined ? {} : { assignee: yield* assigneeIn(path, typed) })
      if (params === null) return NOTHING
      const issues = yield* http.json(
        Schema.Array(IssueAnswer),
        'GET',
        `${path === undefined ? api : project(path)}/issues?${params.toString()}`,
      )
      // A page short of what was asked is the last.
      return {
        issues: issues.map((found) => issueOf(found, query.container ?? containerOf(found))),
        next: issues.length < Number(params.get('per_page')) ? null : String(pageOfCursor(query.cursor) + 1),
      }
    })

  const issueComments: Tracker['comments'] = (issue, limit) =>
    Effect.gen(function* () {
      const { path, number } = yield* parseRef(issue.ref)
      // A page of the newest, a hundred: GitLab's own notes of what changed are among them, and are left out before the limit.
      const notes = yield* http.json(
        Schema.Array(NoteAnswer),
        'GET',
        `${project(path.split('/'))}/issues/${number}/notes?sort=desc&order_by=created_at&per_page=100`,
      )
      return notes
        .filter((note) => !note.system)
        .slice(0, Math.max(limit, 0))
        .toReversed()
        .map((note): IssueComment => ({ author: personOf(note.author), body: note.body, at: note.created_at }))
    })

  return {
    product,
    ...makeGitLabReleases({ http, project, mayNot }),
    words: { noun: 'merge request', short: 'MR', prefix: '!' },
    capabilities: {
      drafts: true,
      checkLogs: true,
      threads: true,
      reviews: false,
      pictures: true,
      reopen: true,
      rerun: true,
      ...TRACKING,
    },
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
        parent: answer.forked_from_project == null ? null : { path: answer.forked_from_project.path_with_namespace.split('/') },
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
        const fork = yield* forkOf(request)
        const change = fork === undefined ? changeOf(request) : { ...changeOf(request), headRepository: fork }
        return size === null ? change : { ...change, additions: size.additions, deletions: size.deletions, changedFiles: size.files }
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
    allowance: () => http.allowance(),
    markReady: (repository, change) =>
      Effect.gen(function* () {
        // Its title as it is now, not as Althar last read it: a rename on GitLab since stays.
        const now = yield* read(repository, change.number)
        if (!(now.draft ?? now.work_in_progress ?? false)) return changeOf(now)
        return changeOf(
          yield* http.json(MergeAnswer, 'PUT', `${project(repository)}/merge_requests/${change.number}`, { title: readyTitle(now.title) }),
        )
      }),
    merge: (repository, change, how) =>
      http
        .json(MergeAnswer, 'PUT', `${project(repository)}/merge_requests/${change.number}/merge`, {
          squash: (how?.method ?? repository.merges[0]) === 'squash',
          // Only the head Althar last saw: a push since then isn't merged unseen, and GitLab says 409.
          ...(change.headSha === null ? {} : { sha: change.headSha }),
          // Auto-merge: `auto_merge` on newer servers, "merge when pipeline succeeds" on older ones, which newer ones still take.
          ...(how?.auto === true ? { auto_merge: true, merge_when_pipeline_succeeds: true } : {}),
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
    // Read each time, as the project's settings and the server's version can change: a merge is rare, and two reads are cheap.
    mergeWays: (repository) =>
      Effect.gen(function* () {
        const settings = yield* http.cached(ProjectAnswer, project(repository))
        const version = yield* http.cached(VersionAnswer, `${api}/version`).pipe(
          Effect.map((answer) => answer.version),
          Effect.orElseSucceed(() => null),
        )
        return {
          queue: settings.merge_trains_enabled === true ? 'merge_train' : null,
          // Every tier merges once a pipeline passes, as long as GitLab has had pipelines.
          autoMerge: true,
          server: version === null ? null : `GitLab ${version}`,
        } as const
      }),
    // A merge train takes it at its head, and merges it once the train's pipeline for it passes.
    enqueue: (repository, change, how) =>
      Effect.gen(function* () {
        yield* mayNot(
          http.json(Schema.Unknown, 'POST', `${project(repository)}/merge_trains/merge_requests/${change.number}`, {
            ...(change.headSha === null ? {} : { sha: change.headSha }),
            squash: (how?.method ?? repository.merges[0]) === 'squash',
            auto_merge: true,
            when_pipeline_succeeds: true,
          }),
        )
        return { ...changeOf(yield* read(repository, change.number)), queued: true }
      }),
    // Cancelling auto-merge takes it off its merge train too.
    leaveQueue: (repository, change) =>
      Effect.gen(function* () {
        const now = yield* read(repository, change.number)
        if (now.state !== 'opened' || now.merge_when_pipeline_succeeds !== true) return changeOf(now)
        return changeOf(
          yield* mayNot(
            http.json(MergeAnswer, 'POST', `${project(repository)}/merge_requests/${change.number}/cancel_merge_when_pipeline_succeeds`),
          ),
        )
      }),
    branchHead: (repository, branch) =>
      Effect.map(
        http.json(BranchAnswer, 'GET', `${project(repository)}/repository/branches/${encodeURIComponent(branch)}`),
        (answer) => answer.commit.id,
      ),
    // The commit is in the branch where it is where the two meet.
    contains: (repository, change, sha) =>
      change.headSha === null
        ? Effect.succeed(false)
        : Effect.map(
            http.json(
              Schema.Struct({ id: Schema.String }),
              'GET',
              `${project(repository)}/repository/merge_base?refs[]=${encodeURIComponent(change.headSha)}&refs[]=${encodeURIComponent(sha)}`,
            ),
            (base) => base.id === sha,
          ),
    closeChange: (repository, change) =>
      Effect.gen(function* () {
        const now = yield* read(repository, change.number)
        if (now.state !== 'opened') return changeOf(now)
        return changeOf(
          yield* mayNot(http.json(MergeAnswer, 'PUT', `${project(repository)}/merge_requests/${change.number}`, { state_event: 'close' })),
        )
      }),
    reopenChange: (repository, change) =>
      Effect.gen(function* () {
        const now = yield* read(repository, change.number)
        if (now.state === 'opened') return changeOf(now)
        if (now.state === 'merged') return yield* mergedForGood(product, { noun: 'merge request', short: 'MR', prefix: '!' }, change.number)
        return changeOf(
          yield* mayNot(http.json(MergeAnswer, 'PUT', `${project(repository)}/merge_requests/${change.number}`, { state_event: 'reopen' })),
        )
      }),
    // GitLab says draft with the title's prefix: a draft keeps it, as it is now, else the new title would mark it ready.
    editChange: (repository, change, edit) =>
      Effect.gen(function* () {
        const now = edit.title === undefined ? null : yield* read(repository, change.number)
        const draft = now !== null && (now.draft ?? now.work_in_progress ?? false)
        const title = edit.title === undefined ? undefined : draft ? `Draft: ${readyTitle(edit.title)}` : readyTitle(edit.title)
        return changeOf(
          yield* mayNot(
            http.json(MergeAnswer, 'PUT', `${project(repository)}/merge_requests/${change.number}`, {
              ...(title === undefined ? {} : { title }),
              ...(edit.body === undefined ? {} : { description: edit.body }),
            }),
          ),
        )
      }),
    deleteBranch: (repository, change) =>
      Effect.gen(function* () {
        const now = yield* read(repository, change.number)
        if (now.state === 'opened') return yield* stillOpen(product, { noun: 'merge request', short: 'MR', prefix: '!' }, change.number)
        // Its branch is in the project it came from: a fork's, for one from a fork.
        const on = now.source_project_id === undefined ? project(repository) : `${api}/projects/${now.source_project_id}`
        yield* mayNot(http.json(Schema.Unknown, 'DELETE', `${on}/repository/branches/${encodeURIComponent(now.source_branch)}`)).pipe(
          Effect.catchIf(
            (error) => error.status === 404,
            () => Effect.void,
          ),
        )
      }),
    updateBranch: (repository, change, ask) =>
      updateInCopy({
        product,
        words: { noun: 'merge request', short: 'MR', prefix: '!' },
        repository,
        change,
        expectedHead: ask.expectedHead,
        read: Effect.gen(function* () {
          const request = yield* read(repository, change.number)
          const fork = yield* forkOf(request)
          return fork === undefined ? changeOf(request) : { ...changeOf(request), headRepository: fork }
        }),
        fork: (path) => Effect.succeed({ ...repository, path }),
        pushTarget,
        ...(options.merge === undefined ? {} : { merge: options.merge }),
      }),
    checks: (repository, sha) =>
      Effect.gen(function* () {
        // Commit statuses: GitLab's own CI posts one for each job, and a CI service outside it posts its own. Both are read here,
        // and a job that is also in the pipeline below is read once.
        const statuses = yield* paged(1, (page) =>
          Effect.map(
            http.cached(
              Schema.Array(StatusAnswer),
              `${project(repository)}/repository/commits/${encodeURIComponent(sha)}/statuses?per_page=100&page=${page}`,
            ),
            (rows) => ({ items: rows, next: rows.length < 100 ? undefined : page + 1 }),
          ),
        ).pipe(
          // A commit the project doesn't hold, as one on a fork is, has no statuses there: its checks are its pipeline's.
          Effect.catchIf(
            (error) => error.reason === 'not_found',
            () => Effect.succeed<ReadonlyArray<StatusAnswer>>([]),
          ),
        )
        const pipelines = yield* http.cached(Schema.Array(Pipeline), `${project(repository)}/pipelines?sha=${sha}&per_page=20`)
        // The newest of GitLab's own pipelines; one an outside CI made has no jobs to read.
        let pipeline: typeof Pipeline.Type | null | undefined = pipelines.find((found) => found.source !== 'external')
        if (pipeline === undefined) {
          // A merged results pipeline runs on a merge commit, not on the head: the head's merge request says which.
          const requests = yield* http.cached(Schema.Array(MergeAnswer), `${project(repository)}/repository/commits/${sha}/merge_requests`)
          const open = requests.find((request) => request.state === 'opened' && request.sha === sha)
          pipeline = open === undefined ? null : (yield* read(repository, open.iid)).head_pipeline
        }
        if (pipeline == null) return [...statusChecks(statuses, new Set())]
        const where = String(pipeline.project_id ?? repository.id)
        const jobs = yield* http.cached(Schema.Array(JobAnswer), `${api}/projects/${where}/pipelines/${pipeline.id}/jobs?per_page=100`)
        // A child pipeline, or another project's, is started by a trigger job that the jobs leave out: its result is one check.
        const bridges = yield* http.cached(
          Schema.Array(BridgeAnswer),
          `${api}/projects/${where}/pipelines/${pipeline.id}/bridges?per_page=100`,
        )
        // Each job's commit status is dropped from the statuses, by the job's name and its page, or its downstream pipeline's.
        const inPipeline = new Set<string>()
        for (const job of jobs) inPipeline.add(checkKey(job.name, job.web_url))
        for (const bridge of bridges) {
          inPipeline.add(checkKey(bridge.name, bridge.web_url))
          inPipeline.add(checkKey(bridge.name, bridge.downstream_pipeline?.web_url))
        }
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
          ...statusChecks(statuses, inPipeline),
        ]
      }),
    checkLog: (repository, check, whole = false) => {
      const match = /^job:(\d+):(\d+)$/.exec(check.id)
      if (match === null) return Effect.succeed(null)
      // An archived trace may be sent from object storage, by a redirect `text` follows without the token. Refused or gone, it fails.
      return http.text(`${api}/projects/${match[1]}/jobs/${match[2]}/trace`).pipe(Effect.map((log) => (whole ? log : tail(log))))
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
    uploadPicture: (repository, picture) =>
      Effect.gen(function* () {
        const boundary = `althar-${createHash('sha256').update(picture.bytes).digest('hex').slice(0, 24)}`
        const answer = yield* http.upload(
          UploadAnswer,
          `${project(repository)}/uploads`,
          formWith(picture, boundary),
          `multipart/form-data; boundary=${boundary}`,
        )
        // From the project's own page, which serves it to those who can see the project: never an address elsewhere.
        if (!answer.url.startsWith('/uploads/'))
          return yield* new ConnectorFailed({
            product,
            reason: 'invalid_response',
            message: `GitLab gave the picture an address elsewhere: ${answer.url}`,
          })
        return `${web}/${repository.path.join('/')}${answer.url}`
      }),
    editComment: (repository, number, commentId, body) =>
      Effect.map(
        http.json(NoteAnswer, 'PUT', `${project(repository)}/merge_requests/${number}/notes/${encodeURIComponent(commentId)}`, { body }),
        (note) => commentOf(repository, number, note, null, true),
      ),
    // Reviews of a change Althar didn't open are GitHub's alone, for now.
    changeToReview: () => Effect.fail(noReviews(product, { noun: 'merge request', short: 'MR', prefix: '!' })),
    postReview: () => Effect.fail(noReviews(product, { noun: 'merge request', short: 'MR', prefix: '!' })),
    pushTarget,
    issue: (ref) =>
      Effect.gen(function* () {
        const { path, number } = yield* parseRef(ref)
        const issue = yield* http.json(IssueAnswer, 'GET', `${project(path.split('/'))}/issues/${number}`)
        return issueOf(issue, path)
      }),
    mine: (options = {}) =>
      Effect.map(
        findIssues({
          ...(options.container === undefined ? {} : { container: options.container }),
          state: 'open',
          mine: true,
          limit: options.limit ?? 50,
        }),
        (page) => page.issues,
      ),
    find: findIssues,
    comments: issueComments,
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
      Effect.gen(function* () {
        const path = yield* projectIn(container)
        const fields = issue.fields ?? {}
        const refused = unchangeable({ ...TRACKING, changes: ISSUE_CREATES }, fields)
        if (refused !== undefined)
          return yield* refusal(refused, 'GitLab files an issue without it: Althar sets it once the issue is filed')
        // A new issue has no one on it to keep: those added are all it has.
        const assignees = fields.assignee == null ? [] : assigneesAfter([], fields.assignee)
        // GitLab makes a project label for any it lacks, so every label is sent as it is.
        const filed = yield* http.json(IssueAnswer, 'POST', `${project(path)}/issues`, {
          title: issue.title,
          description: issue.body,
          ...(issue.labels.length === 0 ? {} : { labels: issue.labels.join(',') }),
          ...(assignees.length === 0 ? {} : { assignee_ids: assignees }),
          ...(fields.milestone == null ? {} : { milestone_id: Number(fields.milestone.id) }),
          ...(fields.estimate == null ? {} : { weight: fields.estimate }),
          ...(fields.type === undefined ? {} : { issue_type: fields.type.id }),
          ...(fields.due == null ? {} : { due_date: fields.due }),
        })
        return issueOf(filed, container)
      }),
    choices: issueChoices,
    choicesIn: (container, field, wanted) => Effect.flatMap(projectIn(container), (path) => choicesAt(path, field, wanted)),
    update: changeIssue,
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
