import { Clock, Effect, Schema } from 'effect'

import { type Access, type AccessLine, type AccessNeed, line } from './access'
import { type AdapterOptions, authorizationOf } from './credential'
import { ConnectorFailed } from './errors'
import { makeHttp, paged } from './http'
import { AdfNode, adfOf, markdownOfAdf, markdownOfWiki, wikiOf } from './jiraText'
import {
  cantChange,
  type Account,
  type Choice,
  type Container,
  type Issue,
  type IssueChange,
  type IssueComment,
  type IssueField,
  type IssueQuery,
  leftAsItIs,
  oneAssignee,
  type Person,
  type Priority,
  type StatusCategory,
  type Tracker,
  type TrackerCapabilities,
  unchangeable,
  unstarted,
} from './model'
import { type Answer, answered, failedOf, probe, readAs, refusalOf, serverLine, stopped, UNREADABLE } from './probe'

/*
 * Jira, a tracker: Jira Cloud over version 3 of its REST API, and Jira Data
 * Center over version 2. An issue goes by its key, PROJ-123. The two
 * editions differ in three ways: who someone is (Cloud's account id, Data
 * Center's user name), how text is written (Cloud's Atlassian Document
 * Format, Data Center's wiki markup; see jiraText.ts), and where a search
 * goes (Cloud removed `/search` in 2025 for `/search/jql`; Data Center keeps
 * it). Cloud signs in with the account's email and an API token, Data Center
 * with a personal access token as a bearer.
 */

type Edition = 'jira_cloud' | 'jira_dc'

/** The fields an issue is read with. */
const FIELDS =
  'summary,description,status,priority,assignee,labels,project,updated,resolution,fixVersions,components,parent,issuetype,duedate'

/** Someone on Jira Cloud, by account id; on Data Center, by user name and key. */
const User = Schema.Union([
  Schema.Struct({
    accountId: Schema.String,
    displayName: Schema.optional(Schema.String),
    emailAddress: Schema.optional(Schema.String),
    accountType: Schema.optional(Schema.String),
  }),
  Schema.Struct({ name: Schema.String, key: Schema.optional(Schema.String), displayName: Schema.optional(Schema.String) }),
])
type User = typeof User.Type

/** Text as each edition writes it: ADF on Cloud, wiki markup on Data Center. */
const Text = Schema.Union([Schema.String, AdfNode])

/** One of a project's versions or components, by its id and name. */
const Named = Schema.Struct({ id: Schema.String, name: Schema.String })

const IssueAnswer = Schema.Struct({
  id: Schema.String,
  key: Schema.String,
  fields: Schema.Struct({
    summary: Schema.String,
    description: Schema.optional(Schema.NullOr(Text)),
    status: Schema.Struct({ name: Schema.String, statusCategory: Schema.optional(Schema.Struct({ key: Schema.String })) }),
    priority: Schema.optional(Schema.NullOr(Schema.Struct({ name: Schema.String }))),
    assignee: Schema.optional(Schema.NullOr(User)),
    labels: Schema.optional(Schema.Array(Schema.String)),
    project: Schema.optional(Schema.Struct({ key: Schema.String, name: Schema.String })),
    updated: Schema.String,
    resolution: Schema.optional(Schema.NullOr(Schema.Struct({ name: Schema.String }))),
    fixVersions: Schema.optional(Schema.NullOr(Schema.Array(Named))),
    components: Schema.optional(Schema.NullOr(Schema.Array(Schema.Struct({ name: Schema.String })))),
    parent: Schema.optional(
      Schema.NullOr(
        Schema.Struct({ key: Schema.String, fields: Schema.optional(Schema.Struct({ summary: Schema.optional(Schema.String) })) }),
      ),
    ),
    issuetype: Schema.optional(Schema.NullOr(Schema.Struct({ name: Schema.String }))),
    duedate: Schema.optional(Schema.NullOr(Schema.String)),
  }),
})
type IssueAnswer = typeof IssueAnswer.Type

/** Resolutions that close an issue without its work done: Won't Do, Duplicate, Cannot Reproduce and their kind. */
const UNDONE =
  /\b(won['’]?t|duplicate|invalid|incomplete|cannot reproduce|can['’]?t reproduce|not an? (bug|problem|issue)|works (for me|as designed|as intended)|declined|rejected|abandoned|obsolete|out of date|auto closed|later|cancell?ed)\b/i

/**
 * A status's category, as every tracker's statuses fall into: Jira's three
 * (`new`, `indeterminate`, `done`), with a backlog or triage told by the
 * status's name, and a done issue resolved as not done cancelled.
 */
export const categoryOf = (category: string | undefined, status: string, resolution: string | null): StatusCategory => {
  switch (category) {
    case 'indeterminate':
      return 'started'
    case 'done':
      return resolution !== null && UNDONE.test(resolution) ? 'cancelled' : 'done'
    default:
      return /triage/i.test(status) ? 'triage' : /backlog/i.test(status) ? 'backlog' : 'todo'
  }
}

/** Jira's priorities by name: today's five, the five before them, and the P0 to P4 some sites use. */
const LEVELS: ReadonlyMap<string, Priority> = new Map([
  ['highest', 'urgent'],
  ['blocker', 'urgent'],
  ['urgent', 'urgent'],
  ['p0', 'urgent'],
  ['high', 'high'],
  ['critical', 'high'],
  ['p1', 'high'],
  ['medium', 'medium'],
  ['major', 'medium'],
  ['normal', 'medium'],
  ['p2', 'medium'],
  ['low', 'low'],
  ['lowest', 'low'],
  ['minor', 'low'],
  ['trivial', 'low'],
  ['p3', 'low'],
  ['p4', 'low'],
  ['none', 'none'],
  ['not a priority', 'none'],
])

/** A priority's level by its name; a name of a site's own sits in the middle. */
export const levelOf = (name: string): Priority => LEVELS.get(name.trim().toLowerCase()) ?? 'medium'

/** Jira's time (`2026-10-01T09:00:00.000+0200`) as the model's, in UTC, so it sorts with other trackers'. */
const isoOf = (at: string) => {
  const parsed = Date.parse(at.replace(/([+-]\d\d)(\d\d)$/, '$1:$2'))
  return Number.isNaN(parsed) ? at : new Date(parsed).toISOString()
}

const personOf = (user: User): Person =>
  'accountId' in user
    ? { id: user.accountId, login: user.displayName ?? user.accountId, name: user.displayName ?? null, bot: user.accountType === 'app' }
    : { id: user.key ?? user.name, login: user.name, name: user.displayName ?? null, bot: false }

/** An address without its trailing slashes, in one pass: a pattern for them is slow on a long run of slashes not at the end. */
export const withoutTrailingSlashes = (address: string): string => {
  let end = address.length
  while (end > 0 && address[end - 1] === '/') end -= 1
  return address.slice(0, end)
}

/**
 * A Jira Cloud site's address: its origin alone. A site has no path of its
 * own, so a board's address pasted for it (`/jira/software/projects/PAY/
 * boards/3`) is the same site. Data Center's servers do live under paths.
 */
export const siteOf = (webUrl: string): string => {
  try {
    return new URL(webUrl).origin
  } catch {
    return withoutTrailingSlashes(webUrl)
  }
}

/** Who the credential signs in as: on Cloud by account id, and by email where Jira says it; on Data Center by user name. */
const accountOf = (user: User): Account =>
  'accountId' in user
    ? { id: user.accountId, login: user.emailAddress ?? user.displayName ?? user.accountId, name: user.displayName ?? null }
    : { id: user.key ?? user.name, login: user.name, name: user.displayName ?? null }

const Project = Schema.Struct({ id: Schema.String, key: Schema.String, name: Schema.String })

/** A project's issue types, as each edition lists them: Cloud's under `issueTypes`, Data Center's under `values`, a page at a time. */
const IssueType = Schema.Struct({ id: Schema.String, name: Schema.String, subtask: Schema.optional(Schema.Boolean) })
const IssueTypes = Schema.Struct({ issueTypes: Schema.optional(Schema.Array(IssueType)), values: Schema.optional(Schema.Array(IssueType)) })

/** The transitions an issue's workflow offers it now, each into a status and its category. */
const Transitions = Schema.Struct({
  transitions: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      isAvailable: Schema.optional(Schema.Boolean),
      to: Schema.Struct({ name: Schema.String, statusCategory: Schema.optional(Schema.Struct({ key: Schema.String })) }),
    }),
  ),
})

/** A project's statuses, by each of its issue types. */
const ProjectStatuses = Schema.Array(Schema.Struct({ statuses: Schema.Array(Schema.Struct({ name: Schema.String })) }))

/** One of a project's versions: those released or archived are no fix version for new work. */
const Version = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  released: Schema.optional(Schema.Boolean),
  archived: Schema.optional(Schema.Boolean),
})

/** A page of an issue's comments, each its author, its body as the edition writes it, and when it was written. */
const Comments = Schema.Struct({
  comments: Schema.Array(
    Schema.Struct({ author: Schema.optional(Schema.NullOr(User)), body: Schema.optional(Schema.NullOr(Text)), created: Schema.String }),
  ),
})

/** The type an issue Althar files is: a Task where the project has one, or else its first that isn't a sub-task, which needs a parent. */
const issueTypeOf = (types: typeof IssueTypes.Type) => {
  const all = types.issueTypes ?? types.values ?? []
  return all.find((type) => type.subtask !== true && /^task$/i.test(type.name)) ?? all.find((type) => type.subtask !== true)
}

/** Why Jira, or Althar on it, can't change a field it has no way to here. */
const CANT: Partial<Record<IssueField, string>> = {
  project: 'Jira moves an issue to another project only by its own Move',
  cycle: 'Jira’s sprints belong to its boards: Althar can’t set one yet',
  estimate: 'Jira’s story points are a field each site names: Althar can’t set them yet',
}

/**
 * What Jira changes of an issue, and what of it an issue is filed with: all
 * but its project, sprint and story points; its status only after, as its
 * workflow moves it. An issue has one assignee.
 */
const CAPABILITIES: TrackerCapabilities = {
  links: true,
  starts: true,
  changes: [
    'status',
    'close',
    'priority',
    'assignee',
    'labels',
    'milestone',
    'parent',
    'type',
    'components',
    'due',
    'title',
    'description',
  ],
  creates: ['assignee', 'milestone', 'parent', 'type', 'components', 'due'],
  assignees: 'one',
}

/** The refusal of a field Jira can't change here, in words an agent can pass on. */
const refusalFor = (product: Edition, field: IssueField) => cantChange(product, field, CANT[field] ?? 'Jira has no such field')

/**
 * Who an issue of one assignee has after a change: the one added, in place
 * of whoever had it; none where it takes everyone off, or takes off the one
 * who has it; undefined where it leaves it as it is, taking off someone who
 * hasn't it. A Data Center choice is by user name, which a person is by
 * login.
 */
const assignedAfter = (issue: Issue, change: IssueChange['assignee']): Choice | null | undefined => {
  if (change === undefined) return undefined
  const one = oneAssignee(change)
  if (change === null || one !== null) return one
  const now = issue.assignees[0]
  return now !== undefined && change.remove.some((who) => who.id === now.id || who.id === now.login) ? null : undefined
}

/** One of a site's priorities. */
const PriorityAnswer = Schema.Struct({ id: Schema.String, name: Schema.String })

/** The names a level goes by first, before any other a site's own priority of that level has: Jira's own five. */
const NAMED: Readonly<Record<Priority, string>> = { urgent: 'highest', high: 'high', medium: 'medium', low: 'low', none: 'none' }

/** A site's priority for a level: the one named as Jira names it, or else its first of that level. */
export const priorityFor = (priorities: ReadonlyArray<typeof PriorityAnswer.Type>, level: Priority) =>
  priorities.find((one) => one.name.trim().toLowerCase() === NAMED[level]) ?? priorities.find((one) => levelOf(one.name) === level)

/** A label as Jira can hold it: one word, so its spaces become hyphens. */
export const jiraLabelOf = (label: string): string => label.trim().replace(/\s+/g, '-')

/** How many projects a page of Cloud's project search holds: its most. */
const PROJECTS_PAGE = 100

/** Two names alike, in any case. */
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** Names once each, in any case, as first given. */
const once = (names: ReadonlyArray<string>) => {
  const seen = new Set<string>()
  return names.filter((name) => {
    const key = name.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** A JQL string, quoted. */
const quoted = (text: string) => `"${text.replace(/["\\]/g, '\\$&')}"`

/** The project an issue is in, by its key: PROJ-123 is in PROJ. Jira's project keys have no hyphen. */
const projectOf = (issue: Issue) => issue.ref.slice(0, Math.max(0, issue.ref.lastIndexOf('-')))

/**
 * A search's JQL, as a query narrows it: by project, by where its work
 * stands, to the account's, by words. Cloud refuses a search that narrows
 * nothing, so one that doesn't asks for every issue in a project.
 */
const jqlFor = (query: IssueQuery): string => {
  const text = query.text?.trim() ?? ''
  const clauses = [
    ...(query.container === undefined ? [] : [`project = ${quoted(query.container)}`]),
    ...(query.state === 'open' ? ['statusCategory != Done'] : query.state === 'closed' ? ['statusCategory = Done'] : []),
    ...(query.mine === true ? ['assignee = currentUser()'] : []),
    ...(text === '' ? [] : [`text ~ ${quoted(text)}`]),
  ]
  return `${clauses.length === 0 ? 'project IS NOT EMPTY' : clauses.join(' AND ')} ORDER BY updated DESC`
}

const makeJira = (product: Edition, options: AdapterOptions): Tracker => {
  const cloud = product === 'jira_cloud'
  const site = cloud ? siteOf(options.webUrl) : withoutTrailingSlashes(options.webUrl)
  const api = withoutTrailingSlashes(options.apiUrl)
  // Where its API is: the site, or, for a site on its own domain, its atlassian.net address, which its gateway id is asked of.
  const apiSite = cloud ? siteOf(api) : site
  const http = makeHttp({ product, fetch: options.fetch, authorization: Effect.map(options.credential, authorizationOf) })

  /*
   * An API token with scopes works only through Atlassian's gateway,
   * api.atlassian.com/ex/jira/<cloud id>, never at the site's own address,
   * and nothing in the token says which kind it is. So a call the site
   * refuses as unauthorized is asked there once. The gateway is kept when it
   * takes the token: it answers, or judges the request (not found, or not
   * allowed). A failure that says nothing of the token (unreachable, too many
   * calls) leaves the site to be tried first again next time. Data Center
   * has no gateway.
   */
  let root = api
  const gateway = Effect.map(
    http.json(Schema.Struct({ cloudId: Schema.String }), 'GET', `${apiSite}/_edge/tenant_info`),
    ({ cloudId }) => `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3`,
  )
  const keep = (other: string) =>
    Effect.sync(() => {
      root = other
    })
  const call = <A>(request: (root: string) => Effect.Effect<A, ConnectorFailed>): Effect.Effect<A, ConnectorFailed> =>
    Effect.suspend(() =>
      !cloud || root !== api
        ? request(root)
        : request(api).pipe(
            Effect.catchIf(
              (error) => error.reason === 'unauthorized',
              (refused) =>
                gateway.pipe(
                  // No gateway to ask: the site's own answer stands.
                  Effect.mapError(() => refused),
                  Effect.flatMap((other) =>
                    request(other).pipe(
                      Effect.tap(() => keep(other)),
                      Effect.tapError((error) =>
                        error.reason === 'not_found' || error.reason === 'forbidden' ? keep(other) : Effect.void,
                      ),
                      // Refused there too: so does the site's.
                      Effect.mapError((error) => (error.reason === 'unauthorized' ? refused : error)),
                    ),
                  ),
                ),
            ),
          ),
    )

  /** Text as Markdown, from either edition's. */
  const markdownOf = (text: typeof Text.Type | null | undefined) => {
    const given = text ?? ''
    return typeof given === 'string' ? markdownOfWiki(given) : markdownOfAdf(given)
  }

  /** Markdown as the edition writes text. */
  const textOf = (markdown: string) => (cloud ? adfOf(markdown) : wikiOf(markdown))

  const issueOf = (answer: IssueAnswer): Issue => {
    const { fields } = answer
    const version = fields.fixVersions?.[0]
    return {
      id: answer.id,
      ref: answer.key,
      key: answer.key,
      title: fields.summary,
      body: markdownOf(fields.description),
      url: `${site}/browse/${answer.key}`,
      status: {
        name: fields.status.name,
        category: categoryOf(fields.status.statusCategory?.key, fields.status.name, fields.resolution?.name ?? null),
      },
      priority: fields.priority == null ? null : { level: levelOf(fields.priority.name), name: fields.priority.name },
      assignees: fields.assignee == null ? [] : [personOf(fields.assignee)],
      labels: fields.labels ?? [],
      container: fields.project?.name ?? null,
      updatedAt: isoOf(fields.updated),
      // Its first fix version is its milestone: Jira lets an issue have several.
      milestone: version === undefined ? null : { id: version.id, name: version.name },
      parent: fields.parent == null ? null : { key: fields.parent.key, title: fields.parent.fields?.summary ?? fields.parent.key },
      type: fields.issuetype?.name ?? null,
      due: fields.duedate ?? null,
      components: (fields.components ?? []).map((component) => component.name),
    }
  }

  const issuePath = (key: string) => `/issue/${encodeURIComponent(key)}`
  const projectPath = (key: string) => `/project/${encodeURIComponent(key)}`

  const account: Effect.Effect<Account, ConnectorFailed> = Effect.map(
    call((root) => http.json(User, 'GET', `${root}/myself`)),
    accountOf,
  )

  // A key as typed (proj-123) is the key: Jira's keys are upper case.
  const read = (ref: string) =>
    Effect.map(
      call((root) => http.json(IssueAnswer, 'GET', `${root}${issuePath(ref.trim().toUpperCase())}?fields=${FIELDS}`)),
      issueOf,
    )

  /** Issues a search's JQL finds, to a limit, by each edition's search. */
  const search = (jql: string, limit: number) => {
    const query = `jql=${encodeURIComponent(jql)}&maxResults=${limit}&fields=${FIELDS}`
    return Effect.map(
      call((root) =>
        http.json(Schema.Struct({ issues: Schema.Array(IssueAnswer) }), 'GET', `${root}/${cloud ? 'search/jql' : 'search'}?${query}`),
      ),
      ({ issues }) => issues.map(issueOf),
    )
  }

  /** The site's priorities, as it lists them. */
  const priorities = call((root) => http.json(Schema.Array(PriorityAnswer), 'GET', `${root}/priority`))

  /** The types of issue a project files, as it lists them. */
  const typesIn = (project: string) =>
    call((root) => http.json(IssueTypes, 'GET', `${root}/issue/createmeta/${encodeURIComponent(project)}/issuetypes`))

  /** The transitions its workflow offers an issue now, those it marks unavailable left out. */
  const transitionsOf = (issue: Issue) =>
    Effect.map(
      call((root) => http.json(Transitions, 'GET', `${root}${issuePath(issue.ref)}/transitions`)),
      ({ transitions }) => transitions.filter((each) => each.isAvailable !== false),
    )

  /** Those an issue can be assigned to that a name finds, where `where` is an issue (`issueKey=`) or a project (`project=`). */
  const assignable = (where: string, wanted: string | undefined) => {
    const query =
      wanted === undefined || wanted.trim() === '' ? '' : `&${cloud ? 'query' : 'username'}=${encodeURIComponent(wanted.trim())}`
    return Effect.map(
      call((root) => http.json(Schema.Array(User), 'GET', `${root}/user/assignable/search?${where}&maxResults=50${query}`)),
      (users) =>
        users.map((user): Choice => {
          const person = personOf(user)
          const email = 'accountId' in user ? user.emailAddress : undefined
          return {
            id: 'accountId' in user ? user.accountId : user.name,
            name: person.name ?? person.login,
            also: [person.login, ...(email === undefined ? [] : [email])],
          }
        }),
    )
  }

  /** Jira makes any label it is given: the one wanted, as Jira can hold it, and those given. */
  const labelsWith = (labels: ReadonlyArray<string>, wanted: string | undefined) => {
    const asked = wanted === undefined ? '' : jiraLabelOf(wanted)
    return [...new Set([...labels, ...(asked === '' ? [] : [asked])])].map((label): Choice => ({ id: label, name: label }))
  }

  const choicesIn: Tracker['choicesIn'] = (project, field, wanted) => {
    const at = projectPath(project)
    switch (field) {
      // Any its issues of any type can be in, once each.
      case 'status':
        return Effect.map(
          call((root) => http.json(ProjectStatuses, 'GET', `${root}${at}/statuses`)),
          (types) => once(types.flatMap((type) => type.statuses.map((status) => status.name))).map((name): Choice => ({ id: name, name })),
        )
      case 'labels':
        return Effect.succeed(labelsWith([], wanted))
      case 'assignee':
        return assignable(`project=${encodeURIComponent(project)}`, wanted)
      // Its fix versions still to come: those released or archived are done with.
      case 'milestone':
        return Effect.map(
          call((root) => http.json(Schema.Array(Version), 'GET', `${root}${at}/versions`)),
          (versions) =>
            versions
              .filter((version) => version.released !== true && version.archived !== true)
              .map((version): Choice => ({ id: version.id, name: version.name })),
        )
      case 'components':
        return Effect.map(
          call((root) => http.json(Schema.Array(Named), 'GET', `${root}${at}/components`)),
          (components) => components.map((component): Choice => ({ id: component.id, name: component.name })),
        )
      // Sub-tasks are left out: one needs a parent to be filed under, and an issue becomes one only by Jira's own Move.
      case 'type':
        return Effect.map(typesIn(project), (types) =>
          (types.issueTypes ?? types.values ?? [])
            .filter((type) => type.subtask !== true)
            .map((type): Choice => ({ id: type.id, name: type.name })),
        )
      case 'project':
      case 'cycle':
        return Effect.fail(refusalFor(product, field))
    }
  }

  const choices: Tracker['choices'] = (issue, field, wanted) => {
    switch (field) {
      // Where its workflow lets it go from where it is, by the status each transition goes into; and where it is.
      case 'status':
        return Effect.map(transitionsOf(issue), (transitions) =>
          once([issue.status.name, ...transitions.map((each) => each.to.name)]).map((name): Choice => ({ id: name, name })),
        )
      case 'labels':
        return Effect.succeed(labelsWith(issue.labels, wanted))
      // Jira finds people by a name rather than listing them: those the issue can be assigned to.
      case 'assignee':
        return assignable(`issueKey=${encodeURIComponent(issue.ref)}`, wanted)
      // As its project's, by its key.
      default:
        return choicesIn(projectOf(issue), field, wanted)
    }
  }

  /** Someone, by Cloud's account id or Data Center's user name. */
  const userOf = (id: string | null) => (cloud ? { accountId: id } : { name: id })

  const changeIssue: Tracker['update'] = (issue, wanted) =>
    Effect.gen(function* () {
      const refused = unchangeable(CAPABILITIES, wanted)
      if (refused !== undefined) return yield* refusalFor(product, refused)
      const path = issuePath(issue.ref)
      if (wanted.priority === 'none')
        return yield* new ConnectorFailed({ product, reason: 'rejected', message: 'A Jira issue always has a priority: name one' })
      const priority = wanted.priority === undefined ? undefined : priorityFor(yield* priorities, wanted.priority)
      if (wanted.priority !== undefined && priority === undefined)
        return yield* new ConnectorFailed({ product, reason: 'rejected', message: `This site has no ${wanted.priority} priority` })
      // Jira's edit fails taking the parent off one that has none, so one read as having none is left as it is.
      const parent = wanted.parent === undefined || (wanted.parent === null && issue.parent === null) ? undefined : wanted.parent
      // Its fields are set, and its labels and fix version added and taken off, in one edit: null clears a field, none of its versions its milestone.
      const fields = {
        ...(wanted.title === undefined ? {} : { summary: wanted.title }),
        ...(priority === undefined ? {} : { priority: { id: priority.id } }),
        ...(wanted.description === undefined ? {} : { description: wanted.description.trim() === '' ? null : textOf(wanted.description) }),
        ...(wanted.due === undefined ? {} : { duedate: wanted.due }),
        ...(wanted.milestone === null ? { fixVersions: [] } : {}),
        ...(wanted.components === undefined ? {} : { components: wanted.components.map((component) => ({ id: component.id })) }),
        ...(parent === undefined ? {} : { parent: parent === null ? null : { key: parent.key } }),
        ...(wanted.type === undefined ? {} : { issuetype: { id: wanted.type.id } }),
      }
      const labels = [
        ...(wanted.labels?.add ?? []).map((label) => ({ add: label.id })),
        ...(wanted.labels?.remove ?? []).map((label) => ({ remove: label.id })),
      ]
      // A fix version is added beside those the issue has: an issue may be in several releases.
      const versions = wanted.milestone == null ? [] : [{ add: { id: wanted.milestone.id } }]
      const update = {
        ...(labels.length === 0 ? {} : { labels }),
        ...(versions.length === 0 ? {} : { fixVersions: versions }),
      }
      if (Object.keys(fields).length > 0 || Object.keys(update).length > 0)
        yield* call((root) =>
          http.json(Schema.Unknown, 'PUT', `${root}${path}`, {
            ...(Object.keys(fields).length === 0 ? {} : { fields }),
            ...(Object.keys(update).length === 0 ? {} : { update }),
          }),
        )
      // Its one assignee, in place of whoever had it; none takes them off.
      const assignee = assignedAfter(issue, wanted.assignee)
      if (assignee !== undefined)
        yield* call((root) => http.json(Schema.Unknown, 'PUT', `${root}${path}/assignee`, userOf(assignee?.id ?? null)))
      // A status, by the transition its workflow offers into it now; closed, by one into Done's category, Done itself first.
      if (wanted.status !== undefined || wanted.close === true) {
        const target = wanted.status?.name
        const there =
          target === undefined ? issue.status.category === 'done' || issue.status.category === 'cancelled' : same(issue.status.name, target)
        if (!there) {
          const transitions = yield* transitionsOf(issue)
          const into =
            target !== undefined
              ? transitions.find((each) => same(each.to.name, target))
              : (transitions.find((each) => each.to.statusCategory?.key === 'done' && /^done$/i.test(each.to.name)) ??
                transitions.find((each) => each.to.statusCategory?.key === 'done'))
          if (into === undefined)
            return yield* new ConnectorFailed({
              product,
              reason: 'rejected',
              message: `Its workflow has no way from ${issue.status.name} into ${target ?? 'Done'}`,
            })
          yield* call((root) => http.json(Schema.Unknown, 'POST', `${root}${path}/transitions`, { transition: { id: into.id } }))
        }
      }
      return yield* read(issue.ref)
    })

  return {
    product,
    capabilities: CAPABILITIES,
    account,
    issue: read,
    mine: (options = {}) =>
      search(
        [
          'assignee = currentUser() AND statusCategory != Done',
          ...(options.container === undefined ? [] : [`project = ${quoted(options.container)}`]),
        ].join(' AND ') + ' ORDER BY updated DESC',
        options.limit ?? 50,
      ),
    find: (query) => search(jqlFor(query), query.limit),
    // The latest first, as Jira pages them, so the latest are those within the limit; then oldest first.
    comments: (issue, limit) =>
      Effect.map(
        call((root) => http.json(Comments, 'GET', `${root}${issuePath(issue.ref)}/comment?orderBy=-created&maxResults=${limit}`)),
        ({ comments }) =>
          comments
            .map((comment): IssueComment => ({
              author: comment.author == null ? null : personOf(comment.author),
              body: markdownOf(comment.body),
              at: isoOf(comment.created),
            }))
            .reverse(),
      ),
    comment: (issue, body) =>
      Effect.asVoid(call((root) => http.json(Schema.Unknown, 'POST', `${root}${issuePath(issue.ref)}/comment`, { body: textOf(body) }))),
    // A remote link, by the link as its global id: linking the same pull request again changes the one link.
    link: (issue, link) =>
      Effect.asVoid(
        call((root) =>
          http.json(Schema.Unknown, 'POST', `${root}${issuePath(issue.ref)}/remotelink`, {
            globalId: link.url,
            object: { url: link.url, title: link.title },
          }),
        ),
      ),
    // By the first transition the workflow offers it into a status of In Progress's category, as Jira lists them.
    start: (issue) =>
      Effect.gen(function* () {
        if (!unstarted(issue.status.category)) return leftAsItIs(issue)
        const { transitions } = yield* call((root) => http.json(Transitions, 'GET', `${root}${issuePath(issue.ref)}/transitions`))
        const into = transitions.find((each) => each.isAvailable !== false && each.to.statusCategory?.key === 'indeterminate')
        if (into === undefined)
          return yield* new ConnectorFailed({ product, reason: 'rejected', message: 'Its workflow has no way into In Progress from here' })
        yield* call((root) =>
          http.json(Schema.Unknown, 'POST', `${root}${issuePath(issue.ref)}/transitions`, { transition: { id: into.id } }),
        )
        return { moved: true, status: { name: into.to.name, category: 'started' } }
      }),
    // A project, by its key, is where a Jira issue is filed: on Cloud, those with the latest issue first, a page at a time; Data Center lists them all at once.
    containers: () =>
      Effect.map(
        cloud
          ? paged(0, (startAt) =>
              Effect.map(
                call((root) =>
                  http.json(
                    Schema.Struct({ values: Schema.Array(Project), isLast: Schema.optional(Schema.Boolean) }),
                    'GET',
                    `${root}/project/search?maxResults=${PROJECTS_PAGE}&orderBy=-lastIssueUpdatedTime&startAt=${startAt}`,
                  ),
                ),
                ({ values, isLast }) => ({
                  items: values,
                  next: isLast === true || values.length < PROJECTS_PAGE ? undefined : startAt + values.length,
                }),
              ),
            )
          : call((root) => http.json(Schema.Array(Project), 'GET', `${root}/project`)),
        (projects) => projects.map((project): Container => ({ id: project.key, key: project.key, name: project.name })),
      ),
    create: (project, draft) =>
      Effect.gen(function* () {
        const given = draft.fields ?? {}
        // The type chosen, or else the one Althar files.
        const type = given.type ?? issueTypeOf(yield* typesIn(project))
        if (type === undefined)
          return yield* new ConnectorFailed({
            product,
            reason: 'rejected',
            message: `The project ${project} has no type of issue Althar can file: sub-tasks need a parent`,
          })
        const labels = [...new Set(draft.labels.map(jiraLabelOf).filter((label) => label !== ''))]
        // A priority by the site's own name for it; a site with none of that level files it at its default.
        const priority =
          draft.priority === undefined || draft.priority === 'none'
            ? undefined
            : priorityFor(yield* priorities.pipe(Effect.orElseSucceed(() => [])), draft.priority)
        // What else it is filed with, of what `creates` holds; none given leaves the project's default.
        const assignee = given.assignee === undefined ? null : oneAssignee(given.assignee)
        const fields = {
          project: { key: project },
          issuetype: { id: type.id },
          summary: draft.title,
          ...(draft.body === '' ? {} : { description: textOf(draft.body) }),
          ...(assignee === null ? {} : { assignee: userOf(assignee.id) }),
          ...(given.milestone == null ? {} : { fixVersions: [{ id: given.milestone.id }] }),
          ...(given.components === undefined || given.components.length === 0
            ? {}
            : { components: given.components.map((component) => ({ id: component.id })) }),
          ...(given.parent == null ? {} : { parent: { key: given.parent.key } }),
          ...(given.due == null ? {} : { duedate: given.due }),
        }
        // What was filed, with the labels it was filed with, and its priority where it was given one.
        const file = (sent: ReadonlyArray<string>, prioritised: boolean) =>
          Effect.map(
            call((root) =>
              http.json(Schema.Struct({ id: Schema.String, key: Schema.String }), 'POST', `${root}/issue`, {
                fields: {
                  ...fields,
                  ...(sent.length > 0 ? { labels: sent } : {}),
                  ...(prioritised && priority !== undefined ? { priority: { id: priority.id } } : {}),
                },
              }),
            ),
            (filed) => ({ ...filed, labels: sent }),
          )
        // Jira makes any label it is given, but a project whose screen has no labels refuses them, as one without priorities refuses
        // a priority: the issue is filed without what its screen refused.
        const filed = yield* file(labels, true).pipe(
          Effect.catchIf(
            (error) =>
              error.reason === 'rejected' &&
              ((labels.length > 0 && /\blabels\b/i.test(error.message)) || (priority !== undefined && /\bpriority\b/i.test(error.message))),
            (error) => file(/\blabels\b/i.test(error.message) ? [] : labels, !/\bpriority\b/i.test(error.message)),
          ),
        )
        // Filed: a failed read of it now is no reason to file it again, so it is what was sent.
        const now = yield* Clock.currentTimeMillis
        return yield* read(filed.key).pipe(
          Effect.orElseSucceed((): Issue => ({
            id: filed.id,
            ref: filed.key,
            key: filed.key,
            title: draft.title,
            body: draft.body,
            url: `${site}/browse/${filed.key}`,
            status: { name: 'To Do', category: 'todo' },
            priority: null,
            assignees: [],
            labels: filed.labels,
            container: project,
            updatedAt: new Date(now).toISOString(),
          })),
        )
      }),
    choices,
    choicesIn,
    update: changeIssue,
  }
}

/** Jira Cloud, at a site's address (`https://meridian.atlassian.net`, or its own domain, with its API at the atlassian.net one). */
export const makeJiraCloud = (options: AdapterOptions): Tracker => makeJira('jira_cloud', options)

/** Jira Data Center, at an instance's address. */
export const makeJiraDataCenter = (options: AdapterOptions): Tracker => makeJira('jira_dc', options)

/*
 * What a Jira connection can do: its site answers, who it signs in as, and
 * whether the account may browse projects, transition issues and comment
 * on them, in any project, as Jira's own permissions say. On Cloud, a token
 * the site refuses is asked through Atlassian's gateway, as the adapter asks.
 */

const Permitted = Schema.Struct({
  permissions: Schema.Record(Schema.String, Schema.Struct({ havePermission: Schema.Boolean })),
})

/** An account's email, which Data Center says too, and Cloud where the person's privacy allows. */
const Email = Schema.Struct({ emailAddress: Schema.optional(Schema.NullOr(Schema.String)) })

/** Cloud and Data Center alike, told apart by their API: version 3 on Cloud, version 2 on Data Center. */
export const accessJira: Access = (input) =>
  Effect.gen(function* () {
    const cloud = /\/rest\/api\/3\/?$/.test(input.apiUrl)
    const site = cloud ? siteOf(input.webUrl) : withoutTrailingSlashes(input.webUrl)
    const api = withoutTrailingSlashes(input.apiUrl)
    const apiSite = cloud ? siteOf(api) : site
    const ask = (url: string) => probe(input, url)

    const atSite = yield* ask(`${api}/myself`)
    const siteLine = serverLine('site', site, atSite)
    if (atSite.status === 0) return stopped([siteLine])
    // A token with scopes works only through the gateway, which the site's id names.
    const gateway = (): Effect.Effect<{ readonly root: string; readonly me: Answer }> =>
      Effect.gen(function* () {
        const tenant = yield* ask(`${apiSite}/_edge/tenant_info`)
        const cloudId = answered(tenant) ? readAs(Schema.Struct({ cloudId: Schema.String }), tenant)?.cloudId : undefined
        if (cloudId === undefined) return { root: api, me: atSite }
        const root = `https://api.atlassian.com/ex/jira/${encodeURIComponent(cloudId)}/rest/api/3`
        const there = yield* ask(`${root}/myself`)
        return answered(there) ? { root, me: there } : { root: api, me: atSite }
      })
    const { root, me } = cloud && atSite.status === 401 ? yield* gateway() : { root: api, me: atSite }
    if (!answered(me)) return stopped([siteLine, line('account', 'no', { reason: refusalOf(me) })])
    const user = readAs(User, me)
    if (user === undefined) return stopped([siteLine, line('account', 'no', { reason: UNREADABLE })])
    const account = accountOf(user)

    const permitted = yield* ask(`${root}/mypermissions?permissions=BROWSE_PROJECTS,TRANSITION_ISSUES,ADD_COMMENTS`)
    const said = answered(permitted) ? readAs(Permitted, permitted) : undefined
    const projects = yield* ask(cloud ? `${root}/project/search?maxResults=1` : `${root}/project`)
    // How many projects it sees, where that is cheap to ask: Cloud counts them, Data Center lists them.
    const count = !answered(projects)
      ? null
      : cloud
        ? (readAs(Schema.Struct({ total: Schema.Number }), projects)?.total ?? null)
        : (readAs(Schema.Array(Schema.Unknown), projects)?.length ?? null)
    const allowed = (need: AccessNeed, permission: string, more: { readonly count?: number | null } = {}): AccessLine =>
      said === undefined
        ? line(need, 'no', { reason: answered(permitted) ? UNREADABLE : failedOf(permitted) })
        : said.permissions[permission]?.havePermission === true
          ? line(need, 'ok', more)
          : line(need, 'no', { reason: { kind: 'role', role: null } })

    return {
      account,
      lines: [
        siteLine,
        line('account', 'ok', { fact: readAs(Email, me)?.emailAddress ?? user.displayName ?? account.login }),
        allowed('read', 'BROWSE_PROJECTS', { count }),
        allowed('comment', 'ADD_COMMENTS'),
        allowed('move', 'TRANSITION_ISSUES'),
      ],
      expiresAt: null,
      scopes: null,
    }
  })
