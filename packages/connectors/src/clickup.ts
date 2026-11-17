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
})
type Task = typeof Task.Type

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

/** A task. */
export const issueOf = (task: Task): Issue => ({
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
] as const satisfies ReadonlyArray<IssueField>
type Unchanged = Exclude<IssueField, (typeof CHANGES)[number]>

/** Why a task hasn't each field ClickUp can't change here, in words an agent can pass on. */
const HASNT: Record<Unchanged, string> = {
  project: 'a ClickUp task’s project is its list',
  milestone: 'a ClickUp task has no milestone',
  cycle: 'Althar doesn’t reach ClickUp’s sprints yet',
  parent: 'Althar doesn’t reach a ClickUp task’s parent yet',
  estimate: 'Althar doesn’t reach a ClickUp task’s estimate yet',
  type: 'Althar doesn’t reach a ClickUp task’s type yet',
  components: 'a ClickUp task has no components',
}

const unchanged = (field: IssueField): field is Unchanged => field in HASNT

/** ClickUp files a task with its people, due day and status as well as its name, description, tags and priority. */
export const CLICKUP_TRACKING: TrackerCapabilities = {
  // By a comment on the task: ClickUp has no link to attach.
  links: true,
  starts: true,
  changes: CHANGES,
  creates: ['assignee', 'due', 'status'],
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
  const read = (ref: string) => Effect.map(readTask(ref), issueOf)

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
      if (field !== 'status' && field !== 'labels' && field !== 'assignee') return yield* refuse(field)
      return yield* choicesOn(yield* listOfTask(issue), field)
    })

  const choicesIn: Tracker['choicesIn'] = (container, field) =>
    Effect.gen(function* () {
      if (field !== 'status' && field !== 'labels' && field !== 'assignee') return yield* refuse(field)
      return yield* choicesOn(yield* listOf(container), field)
    })

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
      const due = wanted.due === undefined || wanted.due === null ? wanted.due : yield* dueAt(wanted.due)
      const status = wanted.close === true ? yield* closing(yield* listOfTask(issue)) : wanted.status?.id
      // Its name, description, status, priority, due day and people, in one edit.
      const edit = {
        ...(wanted.title === undefined ? {} : { name: wanted.title }),
        ...(wanted.description === undefined ? {} : { markdown_content: wanted.description }),
        ...(status === undefined ? {} : { status }),
        ...(wanted.priority === undefined ? {} : { priority: wanted.priority === 'none' ? null : NUMBERS[wanted.priority] }),
        ...(due === undefined ? {} : { due_date: due, due_date_time: false }),
        ...(add.length + rem.length === 0 ? {} : { assignees: { add, rem } }),
      }
      if (Object.keys(edit).length > 0) yield* call(Schema.Unknown, 'PUT', `${api}/task/${task}`, edit)
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
    Effect.map(
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
        found.flatMap((task) => (task === undefined || (container !== undefined && task.list.id !== container) ? [] : [issueOf(task)])),
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
          ? (yield* tasksAt(`/list/${yield* named(query.container, 'list')}/task`, query, me?.id)).map(issueOf)
          : (yield* Effect.forEach(
              yield* workspaces,
              (team) => Effect.flatMap(named(team.id, 'workspace'), (id) => tasksAt(`/team/${id}/task`, query, me?.id)),
              { concurrency: 2 },
            )).flatMap((tasks) => tasks.map(issueOf))
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
                          name: Schema.String,
                          hidden: Schema.optional(Schema.NullOr(Schema.Boolean)),
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
                  return [
                    ...lists.map((list) => ({ list, at: where })),
                    ...folders.flatMap((folder) =>
                      (folder.lists ?? []).map((list) => ({ list, at: folder.hidden === true ? where : [...where, folder.name] })),
                    ),
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
        const issues = (yield* Effect.forEach(yield* workspaces, (team) =>
          Effect.flatMap(named(team.id, 'workspace'), (id) => tasksAt(`/team/${id}/task`, { state: 'open' }, me.id)),
        )).flatMap((tasks) => tasks.map(issueOf))
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
        })
        // Filed: a failed read of it now is no reason to file it again, so it is as ClickUp answered the filing.
        const now = yield* Clock.currentTimeMillis
        return yield* read(task.id).pipe(
          Effect.orElseSucceed(() => {
            const issue = issueOf(task)
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
