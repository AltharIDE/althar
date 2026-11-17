import { Clock, Effect, Schema } from 'effect'

import { type Access, line } from './access'
import { type AdapterOptions, authorizationOf } from './credential'
import { ConnectorFailed } from './errors'
import { makeHttp, withoutTrailingSlashes } from './http'
import {
  cantChange,
  cantFind,
  type Account,
  type Choice,
  type Container,
  fieldsOf,
  type Issue,
  type IssueChange,
  type IssueComment,
  type IssueField,
  issueMatches,
  type IssueQuery,
  inIssueState,
  leftAsItIs,
  pageAt,
  type Person,
  type Priority,
  type StatusCategory,
  type Tracker,
  type TrackerCapabilities,
  unfindable,
  unstarted,
} from './model'
import { answered, failedOf, probe, readAs, refusalOf, stopped, UNREADABLE, UNSAID } from './probe'

/*
 * ClickUp, a tracker, over its REST API (v2). A workspace (the API's
 * "team") holds spaces, a space folders, and a folder lists; a task lives on
 * a list, and a list has its own statuses, each of a type: open, custom,
 * done or closed. A task goes by its id, and by its custom id (DEV-12) where
 * its workspace gives them, which is then its key. A personal token reaches
 * every workspace its person is in, and goes in the Authorization header as
 * it is. A description is read and written as Markdown; a comment is plain
 * text, so Markdown goes as it is written. A due date is a moment in
 * milliseconds, and a day here: a day set goes as noon UTC with no time of
 * day, and one read is its day in UTC. A pull request is linked to a task by
 * a comment, since ClickUp has no link to attach to one.
 */

/** ClickUp's ids for people are numbers; Althar keeps them as strings. */
const Id = Schema.Union([Schema.Number, Schema.String])
const idOf = (id: number | string): string => String(id)

const User = Schema.Struct({
  id: Id,
  username: Schema.optional(Schema.NullOr(Schema.String)),
  email: Schema.optional(Schema.NullOr(Schema.String)),
})
type User = typeof User.Type

const Status = Schema.Struct({ status: Schema.String, type: Schema.optional(Schema.NullOr(Schema.String)) })
type Status = typeof Status.Type

const Task = Schema.Struct({
  id: Schema.String,
  custom_id: Schema.optional(Schema.NullOr(Schema.String)),
  name: Schema.String,
  markdown_description: Schema.optional(Schema.NullOr(Schema.String)),
  text_content: Schema.optional(Schema.NullOr(Schema.String)),
  status: Status,
  date_created: Schema.optional(Schema.NullOr(Schema.String)),
  date_updated: Schema.optional(Schema.NullOr(Schema.String)),
  archived: Schema.optional(Schema.NullOr(Schema.Boolean)),
  assignees: Schema.optional(Schema.NullOr(Schema.Array(User))),
  tags: Schema.optional(Schema.NullOr(Schema.Array(Schema.Struct({ name: Schema.String })))),
  priority: Schema.optional(Schema.NullOr(Schema.Struct({ priority: Schema.optional(Schema.NullOr(Schema.String)) }))),
  due_date: Schema.optional(Schema.NullOr(Schema.String)),
  url: Schema.String,
  list: Schema.Struct({ id: Schema.String, name: Schema.optional(Schema.NullOr(Schema.String)) }),
  team_id: Schema.optional(Schema.NullOr(Schema.String)),
  /** The task it is a subtask of, by its id. */
  parent: Schema.optional(Schema.NullOr(Schema.String)),
  /** Its sprint points, where its space has them on. */
  points: Schema.optional(Schema.NullOr(Schema.Number)),
  /** Its task type, by the workspace's id for it; none (or 0) is ClickUp's own Task. */
  custom_item_id: Schema.optional(Schema.NullOr(Schema.Number)),
})
type Task = typeof Task.Type

/** A workspace's task types, beside ClickUp's own Task. */
const TaskTypes = Schema.Struct({ custom_items: Schema.Array(Schema.Struct({ id: Schema.Number, name: Schema.String })) })

/** ClickUp's own type, which a task without one of the workspace's is. */
const DEFAULT_TYPE = 'Task'
/** The choice that puts a task back to ClickUp's own type. */
const DEFAULT_TYPE_ID = 'task'

const Tasks = Schema.Struct({ tasks: Schema.Array(Task), last_page: Schema.optional(Schema.NullOr(Schema.Boolean)) })

const Workspaces = Schema.Struct({ teams: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String })) })

/** A list, with its statuses in their order and the space it is in. */
const ListOf = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  statuses: Schema.optional(Schema.NullOr(Schema.Array(Schema.Struct({ ...Status.fields })))),
  space: Schema.optional(Schema.NullOr(Schema.Struct({ id: Schema.String }))),
})

const NamedList = Schema.Struct({ id: Schema.String, name: Schema.String, archived: Schema.optional(Schema.NullOr(Schema.Boolean)) })

const Comment = Schema.Struct({
  id: Schema.String,
  comment_text: Schema.optional(Schema.NullOr(Schema.String)),
  user: Schema.optional(Schema.NullOr(User)),
  date: Schema.String,
})

/** ClickUp's own error: its words, and a code such as OAUTH_017. */
const ClickUpError = Schema.Struct({ ECODE: Schema.optional(Schema.String) })

/**
 * A status's category, by its type and then its name. Open is to do (or the
 * backlog, where its name says); done and closed are done; a custom status
 * is a step of the work under way, unless its name says otherwise. A name
 * that says cancelled is cancelled, whatever its type, since ClickUp has no
 * type for it.
 */
export const categoryOf = (status: Status): StatusCategory => {
  const name = status.status.toLowerCase()
  if (/\b(cancell?ed|won['’]?t do|dropped|rejected|abandoned)\b/.test(name)) return 'cancelled'
  switch (status.type) {
    case 'closed':
    case 'done':
      return 'done'
    case 'open':
      return /\b(backlog|icebox)\b/.test(name) ? 'backlog' : 'todo'
    default:
      if (/\b(backlog|icebox)\b/.test(name)) return 'backlog'
      if (/\b(to ?do|not started|open|new|ready)\b/.test(name)) return 'todo'
      if (/\b(triage)\b/.test(name)) return 'triage'
      return 'started'
  }
}

/** A status a task moves to as its work starts: a custom one named for work under way now, before one for review or what is blocked. */
const underWay = (status: Status): boolean => status.type === 'custom' && /\b(doing|in[ -]progress|working|started)\b/i.test(status.status)

/** ClickUp's priorities, 1 to 4, by Althar's levels. */
const LEVELS: Readonly<Record<string, Priority>> = { urgent: 'urgent', high: 'high', normal: 'medium', low: 'low' }
const NUMBERS: Readonly<Record<Exclude<Priority, 'none'>, number>> = { urgent: 1, high: 2, medium: 3, low: 4 }
const NAMES: Readonly<Record<Priority, string>> = { urgent: 'Urgent', high: 'High', medium: 'Normal', low: 'Low', none: 'No priority' }

const priorityOf = (said: Task['priority']): Issue['priority'] => {
  const level = said?.priority == null ? undefined : LEVELS[said.priority.toLowerCase()]
  return level === undefined ? null : { level, name: NAMES[level] }
}

const personOf = (user: User): Person => ({
  id: idOf(user.id),
  login: user.username ?? user.email ?? idOf(user.id),
  name: user.username ?? null,
  bot: false,
})

/** A moment ClickUp says in milliseconds, as ISO 8601. */
const momentOf = (ms: string | null | undefined): string | null => {
  const n = ms == null ? Number.NaN : Number(ms)
  return Number.isFinite(n) ? new Date(n).toISOString() : null
}

/** The day a task is due, in UTC; null where it has none. */
const dayOf = (due: string | null | undefined): string | null => momentOf(due)?.slice(0, 10) ?? null

/** What else is known of a task as it is read: its workspace's types by id, and other tasks by id, for its parent's key and title. */
export interface Known {
  readonly types?: ReadonlyMap<number, string>
  readonly parents?: ReadonlyMap<string, { readonly key: string; readonly title: string }>
}

/**
 * A task. Its type is said where its workspace's types were read; its parent
 * where the parent was read too; its estimate (sprint points) where its
 * space has them. What wasn't read is left out, not said to be none.
 */
export const issueOf = (task: Task, known: Known = {}): Issue => {
  const type =
    known.types === undefined
      ? undefined
      : // A workspace's task list doesn't say a task's type, so one read there has none to tell.
        task.custom_item_id === undefined
        ? undefined
        : task.custom_item_id === null || task.custom_item_id === 0
          ? DEFAULT_TYPE
          : known.types.get(task.custom_item_id)
  const parent = task.parent === undefined ? undefined : task.parent === null ? null : known.parents?.get(task.parent)
  return {
    ...base(task),
    ...(task.points === undefined ? {} : { estimate: task.points }),
    ...(type === undefined ? {} : { type }),
    ...(parent === undefined ? {} : { parent }),
  }
}

const base = (task: Task): Issue => ({
  id: task.id,
  ref: task.id,
  key: task.custom_id ?? task.id,
  title: task.name,
  body: task.markdown_description ?? task.text_content ?? '',
  url: task.url,
  status: { name: task.status.status, category: categoryOf(task.status) },
  priority: priorityOf(task.priority),
  assignees: (task.assignees ?? []).map(personOf),
  labels: (task.tags ?? []).map((tag) => tag.name),
  container: task.list.name ?? null,
  updatedAt: momentOf(task.date_updated) ?? momentOf(task.date_created) ?? new Date(0).toISOString(),
  due: dayOf(task.due_date),
})

/** What ClickUp changes of a task: its status, closing it, its priority, people, tags, due day, name and description. */
const CHANGES = [
  'status',
  'close',
  'priority',
  'assignee',
  'labels',
  'due',
  'title',
  'description',
  'parent',
  'estimate',
  'type',
] as const satisfies ReadonlyArray<IssueField>
type Unchanged = Exclude<IssueField, (typeof CHANGES)[number]>

/** Why a task hasn't each field ClickUp can't change here, in words an agent can pass on. */
const HASNT: Record<Unchanged, string> = {
  project: 'a ClickUp task’s project is its list',
  milestone: 'a ClickUp task has no milestone',
  cycle: 'ClickUp’s sprints are lists of their own: Althar can’t set one yet',
  components: 'a ClickUp task has no components',
}

const unchanged = (field: IssueField): field is Unchanged => field in HASNT

/**
 * ClickUp files a task with its people, due day, status and parent as well as
 * its name, description, tags and priority; its type and sprint points are set
 * right after. Its estimate is its sprint points.
 */
export const CLICKUP_TRACKING: TrackerCapabilities = {
  // By a comment on the task: ClickUp has no link to attach.
  links: true,
  starts: true,
  changes: CHANGES,
  creates: ['assignee', 'due', 'status', 'parent'],
  assignees: 'many',
  // Its task lists take tags, the account's own and a moment since; words, statuses, people and priorities Althar narrows by after. Tasks by key are read one by one.
  finds: {
    text: 'after',
    labels: 'search',
    status: 'after',
    assignee: 'after',
    priority: 'after',
    updatedSince: 'search',
    keys: 'search',
  },
}
const CAPABILITIES = CLICKUP_TRACKING

/** A page of tasks is a hundred; ten of them are read before the rest is left unread, and the log says so. */
const PAGE = 100
const PAGES = 10

/** How many of a task's latest comments are read for a pull request's link already there. */
const LINK_SEEN = 100

/** Whether a ref is a custom task id, DEV-12, rather than ClickUp's own. */
const customId = (ref: string): boolean => /^[A-Za-z][A-Za-z0-9]*-\d+$/.test(ref)

export const makeClickUp = (options: AdapterOptions): Tracker => {
  const product = 'clickup' as const
  const api = withoutTrailingSlashes(options.apiUrl)
  const http = makeHttp({ product, fetch: options.fetch, authorization: Effect.map(options.credential, authorizationOf) })
  const call = <A>(schema: Schema.Codec<A, unknown>, method: string, url: string, body?: unknown) => http.json(schema, method, url, body)

  const notFound = (what: string, id: string) =>
    new ConnectorFailed({ product, reason: 'not_found', message: `Not a ClickUp ${what}: ${id}` })

  /** ClickUp's ids are letters and digits: anything else isn't one, and isn't put in a URL. */
  const named = (id: string, what: string) => (/^[A-Za-z0-9]+$/.test(id) ? Effect.succeed(id) : Effect.fail(notFound(what, id)))
  /** A person's id, a number as ClickUp takes it. */
  const userId = (id: string) => (/^\d+$/.test(id) ? Effect.succeed(Number(id)) : Effect.fail(notFound('member', id)))

  const account: Effect.Effect<Account, ConnectorFailed> = Effect.map(
    call(Schema.Struct({ user: User }), 'GET', `${api}/user`),
    ({ user }) => ({
      id: idOf(user.id),
      login: user.username ?? user.email ?? idOf(user.id),
      name: user.username ?? null,
    }),
  )

  const workspaces = Effect.map(call(Workspaces, 'GET', `${api}/team`), ({ teams }) => teams)

  /** A day as ClickUp takes a due date: noon UTC, in milliseconds. */
  const dueAt = (day: string) => {
    const at = Date.parse(`${day}T12:00:00.000Z`)
    return /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(at) && dayOf(String(at)) === day
      ? Effect.succeed(at)
      : Effect.fail(new ConnectorFailed({ product, reason: 'rejected', message: `Not a day: ${day}` }))
  }

  /**
   * A task by its ref: ClickUp's id; a custom id with its workspace
   * (`<workspace>/DEV-12`, as a link carries it); or a custom id alone, asked
   * of each of the account's workspaces in turn.
   */
  const readTask = (ref: string): Effect.Effect<Task, ConnectorFailed> =>
    Effect.gen(function* () {
      const typed = ref.trim()
      const [first = '', second] = typed.split('/')
      const byId = (id: string, team?: string) =>
        call(
          Task,
          'GET',
          `${api}/task/${id}?include_markdown_description=true${team === undefined ? '' : `&custom_task_ids=true&team_id=${team}`}`,
        )
      if (second !== undefined) {
        if (!customId(second)) return yield* Effect.fail(notFound('task', typed))
        return yield* byId(encodeURIComponent(second), yield* named(first, 'workspace'))
      }
      if (!customId(typed)) return yield* byId(yield* named(typed, 'task'))
      for (const team of yield* workspaces) {
        const found = yield* Effect.catchIf(
          byId(encodeURIComponent(typed), yield* named(team.id, 'workspace')),
          (error) => error.reason === 'not_found' || error.reason === 'rejected',
          () => Effect.succeed(undefined),
        )
        if (found !== undefined) return found
      }
      return yield* Effect.fail(notFound('task', typed))
    })
  /** A workspace's task types by id, read at most every five minutes; none where they can't be read (a plan without them). */
  const typeCache = new Map<string, { readonly at: number; readonly types: ReadonlyMap<number, string> | undefined }>()
  const typesOf = (team: string) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis
      const kept = typeCache.get(team)
      if (kept !== undefined && now - kept.at < 5 * 60_000) return kept.types
      const types = yield* call(TaskTypes, 'GET', `${api}/team/${yield* named(team, 'workspace')}/custom_item`).pipe(
        Effect.map(
          ({ custom_items }): ReadonlyMap<number, string> | undefined => new Map(custom_items.map((item) => [item.id, item.name])),
        ),
        Effect.orElseSucceed(() => undefined),
      )
      typeCache.set(team, { at: now, types })
      return types
    })

  /** Tasks as issues, with their workspaces' types, and the parents among them. */
  const issuesOf = (tasks: ReadonlyArray<Task>) =>
    Effect.gen(function* () {
      const teams = [...new Set(tasks.flatMap((task) => (task.team_id == null ? [] : [task.team_id])))]
      const types = new Map(yield* Effect.forEach(teams, (team) => Effect.map(typesOf(team), (found) => [team, found] as const)))
      const parents = new Map(tasks.map((task) => [task.id, { key: task.custom_id ?? task.id, title: task.name }]))
      return tasks.map((task) => {
        const kept = task.team_id == null ? undefined : types.get(task.team_id)
        return issueOf(task, { ...(kept === undefined ? {} : { types: kept }), parents })
      })
    })

  /** A task as an issue, with its type and, where it is a subtask, its parent's key and title, read for it. */
  const read = (ref: string) =>
    Effect.gen(function* () {
      const task = yield* readTask(ref)
      const parent =
        task.parent == null
          ? undefined
          : yield* readTask(task.parent).pipe(
              Effect.map((found) => [task.parent ?? '', { key: found.custom_id ?? found.id, title: found.name }] as const),
              Effect.orElseSucceed(() => undefined),
            )
      const types = task.team_id == null ? undefined : yield* typesOf(task.team_id)
      return issueOf(task, { ...(types === undefined ? {} : { types }), ...(parent === undefined ? {} : { parents: new Map([parent]) }) })
    })

  /** The workspace a list is in: the only one, or the one whose spaces have the list's. */
  const teamOfList = (list: typeof ListOf.Type) =>
    Effect.gen(function* () {
      const teams = yield* workspaces
      if (teams.length === 1 && teams[0] !== undefined) return teams[0].id
      const space = list.space?.id
      for (const team of teams) {
        const { spaces } = yield* call(
          Schema.Struct({ spaces: Schema.Array(Schema.Struct({ id: Schema.String })) }),
          'GET',
          `${api}/team/${yield* named(team.id, 'workspace')}/space?archived=false`,
        )
        if (spaces.some((one) => one.id === space)) return team.id
      }
      return yield* Effect.fail(notFound('list’s workspace', list.id))
    })

  /** A workspace's task types as choices, ClickUp's own Task first. */
  const typeChoices = (team: string) =>
    Effect.gen(function* () {
      const types = yield* typesOf(team)
      return [
        { id: DEFAULT_TYPE_ID, name: DEFAULT_TYPE } satisfies Choice,
        ...[...(types ?? new Map<number, string>())].map(([id, name]): Choice => ({ id: String(id), name })),
      ]
    })

  /** A list, with its statuses and its space. */
  const listOf = (id: string) => Effect.flatMap(named(id, 'list'), (list) => call(ListOf, 'GET', `${api}/list/${list}`))

  /** The list a task is on. */
  const listOfTask = (issue: Issue) =>
    Effect.gen(function* () {
      const task = yield* named(issue.id, 'task')
      const { list } = yield* call(Schema.Struct({ list: Schema.Struct({ id: Schema.String }) }), 'GET', `${api}/task/${task}`)
      return yield* listOf(list.id)
    })

  /** A space's tags, by name. */
  const tagsOf = (space: string) =>
    Effect.flatMap(named(space, 'space'), (id) =>
      Effect.map(
        call(Schema.Struct({ tags: Schema.Array(Schema.Struct({ name: Schema.String })) }), 'GET', `${api}/space/${id}/tag`),
        ({ tags }) => tags.map((tag) => tag.name),
      ),
    )

  /** What a field of a task on a list can be set to: a list's statuses and people, its space's tags. */
  const choicesOn = (list: typeof ListOf.Type, field: 'status' | 'labels' | 'assignee') =>
    Effect.gen(function* () {
      switch (field) {
        // A status goes by its name, as ClickUp takes it.
        case 'status':
          return (list.statuses ?? []).map((status): Choice => ({ id: status.status, name: status.status }))
        case 'labels':
          return list.space == null ? [] : (yield* tagsOf(list.space.id)).map((name): Choice => ({ id: name, name }))
        case 'assignee':
          return (yield* call(Schema.Struct({ members: Schema.Array(User) }), 'GET', `${api}/list/${list.id}/member`)).members.map(
            (user): Choice => ({
              id: idOf(user.id),
              name: user.username ?? user.email ?? idOf(user.id),
              also: [user.username, user.email].filter((said): said is string => typeof said === 'string' && said !== ''),
            }),
          )
      }
    })

  const refuse = (field: IssueField) =>
    unchanged(field)
      ? cantChange(product, field, HASNT[field])
      : new ConnectorFailed({ product, reason: 'rejected', message: `ClickUp has no choices to list for a task’s ${field}` })

  const choices: Tracker['choices'] = (issue, field) =>
    Effect.gen(function* () {
      if (field === 'type') {
        const { team_id } = yield* call(
          Schema.Struct({ team_id: Schema.optional(Schema.NullOr(Schema.String)) }),
          'GET',
          `${api}/task/${yield* named(issue.id, 'task')}`,
        )
        return team_id == null ? yield* Effect.fail(notFound('task’s workspace', issue.id)) : yield* typeChoices(team_id)
      }
      if (field !== 'status' && field !== 'labels' && field !== 'assignee') return yield* refuse(field)
      return yield* choicesOn(yield* listOfTask(issue), field)
    })

  const choicesIn: Tracker['choicesIn'] = (container, field) =>
    Effect.gen(function* () {
      if (field === 'type') return yield* typeChoices(yield* teamOfList(yield* listOf(container)))
      if (field !== 'status' && field !== 'labels' && field !== 'assignee') return yield* refuse(field)
      return yield* choicesOn(yield* listOf(container), field)
    })

  /** A type's choice as ClickUp takes it: 0 for its own Task, as its docs say, else the workspace's id for it. */
  const typeId = (choice: Choice) =>
    choice.id === DEFAULT_TYPE_ID
      ? Effect.succeed(0)
      : /^\d+$/.test(choice.id)
        ? Effect.succeed(Number(choice.id))
        : Effect.fail(notFound('task type', choice.id))

  /** A parent as ClickUp takes it, by its id: never the task itself. */
  const parentId = (task: string, parent: NonNullable<IssueChange['parent']>) =>
    Effect.flatMap(named(parent.id, 'task'), (id) =>
      id === task
        ? Effect.fail(new ConnectorFailed({ product, reason: 'rejected', message: 'A task can’t be its own subtask' }))
        : Effect.succeed(id),
    )

  /** The status a task closes into: its list's closed one, else its last done one. */
  const closing = (list: typeof ListOf.Type) => {
    const statuses = list.statuses ?? []
    const into = statuses.find((status) => status.type === 'closed') ?? statuses.findLast((status) => status.type === 'done')
    return into === undefined
      ? Effect.fail(new ConnectorFailed({ product, reason: 'rejected', message: 'Its list has no closed or done status' }))
      : Effect.succeed(into.status)
  }

  const changeIssue: Tracker['update'] = (issue, wanted) =>
    Effect.gen(function* () {
      const refused = fieldsOf(wanted).find(unchanged)
      if (refused !== undefined) return yield* cantChange(product, refused, HASNT[refused])
      const task = yield* named(issue.id, 'task')
      const add = yield* Effect.forEach(wanted.assignee?.add ?? [], (person) => userId(person.id))
      const rem = yield* Effect.forEach(wanted.assignee === null ? issue.assignees : (wanted.assignee?.remove ?? []), (person) =>
        userId(person.id),
      )
      // ClickUp's docs say a subtask can't be made a task again by taking its parent off.
      if (wanted.parent === null) return yield* cantChange(product, 'parent', 'ClickUp can’t turn a subtask back into a task of its own')
      const due = wanted.due === undefined || wanted.due === null ? wanted.due : yield* dueAt(wanted.due)
      const status = wanted.close === true ? yield* closing(yield* listOfTask(issue)) : wanted.status?.id
      const parent = wanted.parent === undefined ? undefined : yield* parentId(task, wanted.parent)
      const type = wanted.type === undefined ? undefined : yield* typeId(wanted.type)
      // Its name, description, status, priority, due day, people, parent and type, in one edit; its points in their own, below.
      const edit = {
        ...(wanted.title === undefined ? {} : { name: wanted.title }),
        ...(wanted.description === undefined ? {} : { markdown_content: wanted.description }),
        ...(status === undefined ? {} : { status }),
        ...(wanted.priority === undefined ? {} : { priority: wanted.priority === 'none' ? null : NUMBERS[wanted.priority] }),
        ...(due === undefined ? {} : { due_date: due, due_date_time: false }),
        ...(add.length + rem.length === 0 ? {} : { assignees: { add, rem } }),
        ...(parent === undefined ? {} : { parent }),
        ...(type === undefined ? {} : { custom_item_id: type }),
      }
      if (Object.keys(edit).length > 0) yield* call(Schema.Unknown, 'PUT', `${api}/task/${task}`, edit)
      // Sprint points on their own, so a refusal says what it was about: a value off the workspace's scale, or a space with them off.
      if (wanted.estimate !== undefined)
        yield* call(Schema.Unknown, 'PUT', `${api}/task/${task}`, { points: wanted.estimate }).pipe(
          Effect.mapError((error) =>
            error.reason === 'rejected'
              ? new ConnectorFailed({
                  product,
                  reason: 'rejected',
                  message: `ClickUp didn’t take ${String(wanted.estimate)} sprint points (${error.message}): its workspace’s Sprint Points scale may not have it, or its space has Sprint Points off`,
                  ...(error.status === undefined ? {} : { status: error.status }),
                })
              : error,
          ),
        )
      // A tag is added and taken off by its name, leaving the others.
      for (const label of wanted.labels?.add ?? [])
        if (!issue.labels.some((had) => had.toLowerCase() === label.name.toLowerCase()))
          yield* call(Schema.Unknown, 'POST', `${api}/task/${task}/tag/${encodeURIComponent(label.id)}`)
      for (const label of wanted.labels?.remove ?? [])
        if (issue.labels.some((had) => had.toLowerCase() === label.name.toLowerCase()))
          yield* call(Schema.Unknown, 'DELETE', `${api}/task/${task}/tag/${encodeURIComponent(label.id)}`)
      return yield* read(task)
    })

  /**
   * The tasks a list of ClickUp's gives, a page of a hundred at a time, newest
   * change first: a list's, or a workspace's. What it narrows by itself is
   * asked of it; the rest is Althar's, after.
   */
  const tasksAt = (path: string, query: Pick<IssueQuery, 'state' | 'labels' | 'updatedSince'>, me: string | undefined) =>
    Effect.gen(function* () {
      const since = query.updatedSince === undefined ? Number.NaN : Date.parse(query.updatedSince)
      const filters = [
        'order_by=updated',
        'subtasks=true',
        'include_markdown_description=true',
        `include_closed=${query.state !== 'open'}`,
        ...(me === undefined ? [] : [`assignees[]=${encodeURIComponent(me)}`]),
        ...(query.labels ?? []).filter((label) => label.trim() !== '').map((label) => `tags[]=${encodeURIComponent(label.trim())}`),
        ...(Number.isNaN(since) ? [] : [`date_updated_gt=${since - 1}`]),
      ].join('&')
      const tasks: Array<Task> = []
      for (let page = 0; page < PAGES; page++) {
        const answer = yield* call(Tasks, 'GET', `${api}${path}?page=${page}&${filters}`)
        tasks.push(...answer.tasks)
        if (answer.last_page === true || answer.tasks.length < PAGE) return tasks
      }
      yield* Effect.logWarning(`ClickUp: read ${PAGES} pages of ${path}, and left the rest unread`)
      return tasks
    })

  /** The tasks keys name, each read by its key, on a list where one is asked: a key no task has is left out. */
  const keyedTasks = (keys: ReadonlyArray<string>, container: string | undefined) =>
    Effect.flatMap(
      Effect.forEach(
        [...new Set(keys.map((key) => key.trim()).filter((key) => key !== ''))],
        (key) =>
          Effect.catchIf(
            readTask(key),
            (error) => error.reason === 'not_found',
            () => Effect.succeed(undefined),
          ),
        { concurrency: 4 },
      ),
      (found) =>
        issuesOf(found.flatMap((task) => (task === undefined || (container !== undefined && task.list.id !== container) ? [] : [task]))),
    )

  /**
   * Tasks by key; else a list's; else every workspace's the account is in.
   * Tags, the account's own and a moment since are asked of ClickUp; what it
   * can't narrow by, Althar does (`issueMatches`), and pages through them by
   * offset.
   */
  const find: Tracker['find'] = (query) =>
    Effect.gen(function* () {
      const refused = unfindable(CAPABILITIES, query)
      if (refused.length > 0) return yield* cantFind(product, `Althar can’t find ClickUp tasks by ${refused.join(' or ')}`)
      const me = query.mine === true ? yield* account : undefined
      const keyed = (query.keys ?? []).length > 0
      const issues = keyed
        ? yield* keyedTasks(query.keys ?? [], query.container)
        : query.container !== undefined
          ? yield* issuesOf(yield* tasksAt(`/list/${yield* named(query.container, 'list')}/task`, query, me?.id))
          : yield* issuesOf(
              (yield* Effect.forEach(
                yield* workspaces,
                (team) => Effect.flatMap(named(team.id, 'workspace'), (id) => tasksAt(`/team/${id}/task`, query, me?.id)),
                { concurrency: 2 },
              )).flat(),
            )
      const byId = new Map(issues.map((issue) => [issue.id, issue]))
      return pageAt(
        [...byId.values()].filter((issue) => issueMatches(issue, query, me)),
        query,
      )
    })

  /** A task's comments, newest first, to a bound: ClickUp gives them a page at a time, each from the oldest of the one before. */
  const latestComments = (issue: Issue, limit: number) =>
    Effect.gen(function* () {
      const task = yield* named(issue.id, 'task')
      const comments: Array<typeof Comment.Type> = []
      let from = ''
      while (comments.length < limit) {
        const { comments: page } = yield* call(
          Schema.Struct({ comments: Schema.Array(Comment) }),
          'GET',
          `${api}/task/${task}/comment${from}`,
        )
        comments.push(...page)
        const oldest = page.at(-1)
        if (page.length === 0 || oldest === undefined || page.length < 25) break
        from = `?start=${encodeURIComponent(oldest.date)}&start_id=${encodeURIComponent(oldest.id)}`
      }
      return comments.slice(0, limit)
    })

  /** Every list on the account's workspaces, by space and folder: those archived left out. */
  const containers: Tracker['containers'] = () =>
    Effect.gen(function* () {
      const teams = yield* workspaces
      const joined = (parts: ReadonlyArray<string>) => parts.filter((part) => part !== '').join(' / ')
      const perTeam = yield* Effect.forEach(
        teams,
        (team) =>
          Effect.gen(function* () {
            const { spaces } = yield* call(
              Schema.Struct({ spaces: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String })) }),
              'GET',
              `${api}/team/${yield* named(team.id, 'workspace')}/space?archived=false`,
            )
            const perSpace = yield* Effect.forEach(
              spaces,
              (space) =>
                Effect.gen(function* () {
                  const id = yield* named(space.id, 'space')
                  const { folders } = yield* call(
                    Schema.Struct({
                      folders: Schema.Array(
                        Schema.Struct({
                          id: Schema.optional(Schema.String),
                          name: Schema.String,
                          hidden: Schema.optional(Schema.NullOr(Schema.Boolean)),
                          // A subfolder comes in the same list as the folders, with the one it is in.
                          parent_folder: Schema.optional(Schema.NullOr(Schema.String)),
                          lists: Schema.optional(Schema.NullOr(Schema.Array(NamedList))),
                        }),
                      ),
                    }),
                    'GET',
                    `${api}/space/${id}/folder?archived=false`,
                  )
                  const { lists } = yield* call(
                    Schema.Struct({ lists: Schema.Array(NamedList) }),
                    'GET',
                    `${api}/space/${id}/list?archived=false`,
                  )
                  const where = teams.length > 1 ? [team.name, space.name] : [space.name]
                  // A folder's path from its space: its parents' names, outermost first, a hidden one's left out; a loop stops where it began.
                  const byId = new Map(folders.flatMap((folder) => (folder.id === undefined ? [] : [[folder.id, folder] as const])))
                  const pathOf = (folder: (typeof folders)[number]): ReadonlyArray<string> => {
                    const names: Array<string> = []
                    const seen = new Set<string>()
                    for (let at: (typeof folders)[number] | undefined = folder; at !== undefined;) {
                      if (at.id !== undefined) {
                        if (seen.has(at.id)) break
                        seen.add(at.id)
                      }
                      if (at.hidden !== true) names.unshift(at.name)
                      at = at.parent_folder == null ? undefined : byId.get(at.parent_folder)
                    }
                    return names
                  }
                  return [
                    ...lists.map((list) => ({ list, at: where })),
                    ...folders.flatMap((folder) => (folder.lists ?? []).map((list) => ({ list, at: [...where, ...pathOf(folder)] }))),
                  ]
                    .filter(({ list }) => list.archived !== true)
                    .map(({ list, at }): Container => ({ id: list.id, key: null, name: joined([...at, list.name]) }))
                }),
              { concurrency: 4 },
            )
            return perSpace.flat()
          }),
        { concurrency: 2 },
      )
      return perTeam.flat()
    })

  return {
    product,
    capabilities: CAPABILITIES,
    account,
    issue: read,
    // The tasks assigned to the account, not done or cancelled, on its workspaces; on a list of that name where one is given.
    mine: (options = {}) =>
      Effect.gen(function* () {
        const me = yield* account
        const issues = yield* issuesOf(
          (yield* Effect.forEach(yield* workspaces, (team) =>
            Effect.flatMap(named(team.id, 'workspace'), (id) => tasksAt(`/team/${id}/task`, { state: 'open' }, me.id)),
          )).flat(),
        )
        return pageAt(
          issues.filter(
            (issue) =>
              inIssueState('open', issue.status.category) && (options.container === undefined || issue.container === options.container),
          ),
          { limit: options.limit ?? 50 },
        ).issues
      }),
    find,
    comments: (issue, limit) =>
      Effect.gen(function* () {
        if (limit < 1) return []
        return (yield* latestComments(issue, limit)).toReversed().map((comment): IssueComment => ({
          author: comment.user == null ? null : personOf(comment.user),
          body: comment.comment_text ?? '',
          at: momentOf(comment.date) ?? comment.date,
        }))
      }),
    comment: (issue, body) =>
      Effect.flatMap(named(issue.id, 'task'), (task) =>
        Effect.asVoid(call(Schema.Unknown, 'POST', `${api}/task/${task}/comment`, { comment_text: body, notify_all: false })),
      ),
    // A comment with the link, since ClickUp has none to attach: one already among its latest comments is left as it is.
    link: (issue, link) =>
      Effect.gen(function* () {
        const task = yield* named(issue.id, 'task')
        const seen = yield* latestComments(issue, LINK_SEEN)
        if (seen.some((comment) => (comment.comment_text ?? '').includes(link.url))) return
        yield* call(Schema.Unknown, 'POST', `${api}/task/${task}/comment`, {
          comment_text: link.title === '' ? link.url : `${link.title}\n${link.url}`,
          notify_all: false,
        })
      }),
    // One still to do moves to its list's first custom status named for work under way, else its first custom status of all.
    start: (issue) =>
      Effect.gen(function* () {
        if (!unstarted(issue.status.category)) return leftAsItIs(issue)
        const task = yield* named(issue.id, 'task')
        const list = yield* listOfTask(issue)
        const statuses = list.statuses ?? []
        const into = statuses.find(underWay) ?? statuses.find((status) => status.type === 'custom' && categoryOf(status) === 'started')
        if (into === undefined)
          return yield* new ConnectorFailed({ product, reason: 'rejected', message: 'Its list has no status for work in progress' })
        yield* call(Schema.Unknown, 'PUT', `${api}/task/${task}`, { status: into.status })
        return { moved: true, status: { name: into.status, category: categoryOf(into) } }
      }),
    containers,
    create: (container, draft) =>
      Effect.gen(function* () {
        const list = yield* named(container, 'list')
        const fields = draft.fields ?? {}
        const refused = fieldsOf(fields).find((field) => !CAPABILITIES.creates.includes(field))
        if (refused !== undefined)
          return yield* unchanged(refused)
            ? cantChange(product, refused, HASNT[refused])
            : new ConnectorFailed({ product, reason: 'rejected', message: `ClickUp files a task without its ${refused}: it is set after` })
        const assignees = yield* Effect.forEach(fields.assignee?.add ?? [], (person) => userId(person.id))
        const due = fields.due == null ? undefined : yield* dueAt(fields.due)
        // A subtask is filed with its parent, on its parent's list: ClickUp's docs say the parent must be on the list it is filed on.
        const parent = fields.parent == null ? undefined : yield* named(fields.parent.id, 'task')
        if (parent !== undefined) {
          const { list: on } = yield* call(
            Schema.Struct({ list: Schema.Struct({ id: Schema.String, name: Schema.optional(Schema.NullOr(Schema.String)) }) }),
            'GET',
            `${api}/task/${parent}`,
          )
          if (on.id !== list)
            return yield* new ConnectorFailed({
              product,
              reason: 'rejected',
              message: `A ClickUp subtask is filed on its parent’s list${on.name == null ? '' : `, ${on.name}`}: file it there`,
            })
        }
        // A tag is its space's: only those the space has are put on, read only when some are asked for.
        const wanted = draft.labels.map((label) => label.trim()).filter((label) => label !== '')
        const tags =
          wanted.length === 0
            ? []
            : yield* Effect.gen(function* () {
                const space = (yield* listOf(list)).space
                const had = space == null ? [] : yield* tagsOf(space.id)
                return wanted.flatMap((label) => had.filter((name) => name.toLowerCase() === label.toLowerCase()).slice(0, 1))
              })
        const task = yield* call(Task, 'POST', `${api}/list/${list}/task`, {
          name: draft.title,
          markdown_content: draft.body,
          ...(tags.length === 0 ? {} : { tags }),
          ...(draft.priority === undefined || draft.priority === 'none' ? {} : { priority: NUMBERS[draft.priority] }),
          ...(assignees.length === 0 ? {} : { assignees }),
          ...(due === undefined ? {} : { due_date: due, due_date_time: false }),
          ...(fields.status === undefined ? {} : { status: fields.status.id }),
          ...(parent === undefined ? {} : { parent }),
        })
        // Filed: a failed read of it now is no reason to file it again, so it is as ClickUp answered the filing.
        const now = yield* Clock.currentTimeMillis
        return yield* read(task.id).pipe(
          Effect.orElseSucceed(() => {
            const issue = base(task)
            return {
              ...issue,
              body: issue.body === '' ? draft.body : issue.body,
              updatedAt: momentOf(task.date_updated) ?? new Date(now).toISOString(),
            }
          }),
        )
      }),
    choices,
    choicesIn,
    update: changeIssue,
  }
}

/*
 * What a ClickUp connection can do. A personal token acts as its person,
 * with whatever they may do in each workspace, and ClickUp doesn't say what
 * that is: reading is asked, commenting and moving tasks are unsaid.
 */
export const accessClickUp: Access = (input) =>
  Effect.gen(function* () {
    const api = withoutTrailingSlashes(input.apiUrl)
    const me = yield* probe(input, `${api}/user`)
    if (!answered(me)) {
      const said = readAs(ClickUpError, me)
      const refused = me.status === 401 || (said?.ECODE ?? '').startsWith('OAUTH_')
      return stopped([line('account', 'no', { reason: refused ? { kind: 'refused' } : failedOf(me) })])
    }
    const user = readAs(Schema.Struct({ user: User }), me)?.user
    if (user === undefined) return stopped([line('account', 'no', { reason: UNREADABLE })])
    const teams = yield* probe(input, `${api}/team`)
    const listed = answered(teams) ? readAs(Workspaces, teams) : undefined
    const login = user.username ?? user.email ?? idOf(user.id)
    return {
      account: { id: idOf(user.id), login, name: user.username ?? null },
      lines: [
        line('account', 'ok', { fact: login }),
        listed === undefined
          ? line('read', 'no', { reason: answered(teams) ? UNREADABLE : refusalOf(teams) })
          : line('read', 'ok', { count: listed.teams.length }),
        line('comment', 'unknown', { reason: UNSAID }),
        line('move', 'unknown', { reason: UNSAID }),
      ],
      expiresAt: null,
      scopes: null,
    }
  })
