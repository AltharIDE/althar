import { Effect, Option, Schema } from 'effect'

import { type Access, type AccessReason, line } from './access'
import { type AdapterOptions, authorizationOf } from './credential'
import { ConnectorFailed } from './errors'
import { makeHttp, paged } from './http'
import {
  type Account,
  cantChange,
  type Choice,
  type ChosenField,
  type Container,
  type Issue,
  type IssueChange,
  type IssueComment,
  type IssueQuery,
  leftAsItIs,
  oneAssignee,
  type Priority,
  type StatusCategory,
  type Tracker,
  unstarted,
} from './model'
import { type Answer, answered, probe, readAs, refusalOf, stopped, UNREADABLE, UNSAID } from './probe'

/*
 * Linear, a tracker, over its GraphQL API. An issue goes by its identifier
 * (MER-231), which `issue(id:)` takes as well as its UUID. A personal API key
 * is sent as it is; an OAuth token as a bearer.
 */

const IssueFields = `
  fragment IssueFields on Issue {
    id identifier title description url priority priorityLabel updatedAt
    state { name type }
    assignee { id name displayName }
    labels { nodes { name } }
    team { key name }
    project { id name } projectMilestone { id name } cycle { number name } parent { identifier title } dueDate estimate
  }`

const LinearIssue = Schema.Struct({
  id: Schema.String,
  identifier: Schema.String,
  title: Schema.String,
  description: Schema.optional(Schema.NullOr(Schema.String)),
  url: Schema.String,
  priority: Schema.optional(Schema.NullOr(Schema.Number)),
  priorityLabel: Schema.optional(Schema.NullOr(Schema.String)),
  updatedAt: Schema.String,
  state: Schema.optional(Schema.NullOr(Schema.Struct({ name: Schema.String, type: Schema.String }))),
  assignee: Schema.optional(
    Schema.NullOr(Schema.Struct({ id: Schema.String, name: Schema.String, displayName: Schema.optional(Schema.String) })),
  ),
  labels: Schema.optional(Schema.Struct({ nodes: Schema.Array(Schema.Struct({ name: Schema.String })) })),
  team: Schema.optional(Schema.NullOr(Schema.Struct({ key: Schema.String, name: Schema.String }))),
  project: Schema.optional(Schema.NullOr(Schema.Struct({ id: Schema.String, name: Schema.String }))),
  projectMilestone: Schema.optional(Schema.NullOr(Schema.Struct({ id: Schema.String, name: Schema.String }))),
  cycle: Schema.optional(Schema.NullOr(Schema.Struct({ number: Schema.Number, name: Schema.optional(Schema.NullOr(Schema.String)) }))),
  parent: Schema.optional(Schema.NullOr(Schema.Struct({ identifier: Schema.String, title: Schema.String }))),
  dueDate: Schema.optional(Schema.NullOr(Schema.String)),
  estimate: Schema.optional(Schema.NullOr(Schema.Number)),
})
type LinearIssue = typeof LinearIssue.Type

/** Who a token signs in as, and the workspace it reaches: its name, and the key its links carry. */
const VIEWER = 'viewer { id name displayName } organization { name urlKey }'

const Viewer = Schema.Struct({
  viewer: Schema.Struct({ id: Schema.String, name: Schema.String, displayName: Schema.optional(Schema.String) }),
  organization: Schema.Struct({ name: Schema.String, urlKey: Schema.String }),
})

const accountOf = ({ viewer, organization }: typeof Viewer.Type): Account => ({
  id: viewer.id,
  login: viewer.displayName ?? viewer.name,
  name: viewer.name,
  workspace: { key: organization.urlKey, name: organization.name },
})

/** A state's type, as every tracker's statuses fall into. */
export const categoryOf = (type: string): StatusCategory => {
  switch (type) {
    case 'triage':
      return 'triage'
    case 'backlog':
      return 'backlog'
    case 'started':
      return 'started'
    case 'completed':
      return 'done'
    case 'canceled':
      return 'cancelled'
    default:
      return 'todo'
  }
}

const PRIORITIES: ReadonlyArray<Priority> = ['none', 'urgent', 'high', 'medium', 'low']

/** A level as Linear numbers it: 0 for none, 1 for urgent, down to 4 for low. */
const priorityNumber = (level: Priority) => Math.max(0, PRIORITIES.indexOf(level))

const issueOf = (issue: LinearIssue): Issue => {
  const level = PRIORITIES[issue.priority ?? 0] ?? 'none'
  return {
    id: issue.id,
    ref: issue.identifier,
    key: issue.identifier,
    title: issue.title,
    body: issue.description ?? '',
    url: issue.url,
    status: issue.state == null ? { name: 'Todo', category: 'todo' } : { name: issue.state.name, category: categoryOf(issue.state.type) },
    priority: { level, name: issue.priorityLabel ?? (level === 'none' ? 'No priority' : level) },
    assignees:
      issue.assignee == null
        ? []
        : [{ id: issue.assignee.id, login: issue.assignee.displayName ?? issue.assignee.name, name: issue.assignee.name, bot: false }],
    labels: issue.labels?.nodes.map((label) => label.name) ?? [],
    container: issue.team == null ? null : issue.team.name,
    updatedAt: issue.updatedAt,
    // Linear has no issue type or components: those are left absent, not none.
    project: issue.project == null ? null : { id: issue.project.id, name: issue.project.name },
    milestone: issue.projectMilestone == null ? null : { id: issue.projectMilestone.id, name: issue.projectMilestone.name },
    cycle: issue.cycle == null ? null : (issue.cycle.name ?? `Cycle ${issue.cycle.number}`),
    parent: issue.parent == null ? null : { key: issue.parent.identifier, title: issue.parent.title },
    due: issue.dueDate ?? null,
    estimate: issue.estimate ?? null,
  }
}

/** A comment as Linear gives one: its author is null where an integration wrote it. */
const LinearComment = Schema.Struct({
  body: Schema.String,
  createdAt: Schema.String,
  user: Schema.optional(
    Schema.NullOr(Schema.Struct({ id: Schema.String, name: Schema.String, displayName: Schema.optional(Schema.String) })),
  ),
})

const commentOf = (comment: typeof LinearComment.Type): IssueComment => ({
  author:
    comment.user == null
      ? null
      : { id: comment.user.id, login: comment.user.displayName ?? comment.user.name, name: comment.user.name, bot: false },
  body: comment.body,
  at: comment.createdAt,
})

/** The most Linear gives to a page: a search asking for more is held to it. */
const MOST = 250

/** A query as Linear's `IssueFilter` takes it: each narrowing left out is no filter. */
export const filterOf = (query: IssueQuery): Readonly<Record<string, unknown>> => {
  const text = query.text?.trim() ?? ''
  return {
    ...(query.container === undefined ? {} : { team: { id: { eq: query.container } } }),
    ...(query.state === 'all' ? {} : { state: { type: { [query.state === 'open' ? 'nin' : 'in']: ['completed', 'canceled'] } } }),
    ...(query.mine === true ? { assignee: { isMe: { eq: true } } } : {}),
    ...(text === '' ? {} : { or: [{ title: { containsIgnoreCase: text } }, { description: { containsIgnoreCase: text } }] }),
  }
}

const Success = Schema.Struct({ success: Schema.Boolean })

/** A page of a list, as Linear gives one: its nodes, and the cursor after them while there are more. */
const Connection = <A>(node: Schema.Codec<A, unknown>) =>
  Schema.Struct({
    nodes: Schema.Array(node),
    pageInfo: Schema.Struct({ hasNextPage: Schema.Boolean, endCursor: Schema.optional(Schema.NullOr(Schema.String)) }),
  })

const pageOf = <A>(connection: {
  readonly nodes: ReadonlyArray<A>
  readonly pageInfo: { readonly hasNextPage: boolean; readonly endCursor?: string | null | undefined }
}) => ({
  items: connection.nodes,
  next: connection.pageInfo.hasNextPage ? (connection.pageInfo.endCursor ?? undefined) : undefined,
})

const Team = Schema.Struct({ id: Schema.String, key: Schema.String, name: Schema.String })

/** A team's workflow state: its type, and where it sits on the board. */
const State = Schema.Struct({ id: Schema.String, name: Schema.String, type: Schema.String, position: Schema.Number })

/** A team's label or the workspace's, which any team's issue may take; a group only holds labels, and takes none itself. */
const Label = Schema.Struct({ id: Schema.String, name: Schema.String, isGroup: Schema.optional(Schema.Boolean) })

/** The labels a name each matches, in any case, as Linear's own picker matches them: a name it has no label for is left off. */
const labelIdsOf = (labels: ReadonlyArray<typeof Label.Type>, names: ReadonlyArray<string>) => {
  const byName = new Map<string, string>()
  for (const label of labels)
    if (label.isGroup !== true && !byName.has(label.name.toLowerCase())) byName.set(label.name.toLowerCase(), label.id)
  return [...new Set(names.flatMap((name) => byName.get(name.trim().toLowerCase()) ?? []))]
}

/** Someone on a team, who an issue can be assigned to. */
const Member = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  displayName: Schema.optional(Schema.String),
  email: Schema.optional(Schema.NullOr(Schema.String)),
  active: Schema.optional(Schema.Boolean),
})

const Project = Schema.Struct({ id: Schema.String, name: Schema.String })

/** A project with its milestones, which an issue can be put in only with it. */
const ProjectMilestones = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  projectMilestones: Schema.Struct({ nodes: Schema.Array(Project) }),
})

/** A team's cycle: its number, and its name where it has one. */
const Cycle = Schema.Struct({
  id: Schema.String,
  number: Schema.Number,
  name: Schema.optional(Schema.NullOr(Schema.String)),
  isActive: Schema.optional(Schema.Boolean),
  isNext: Schema.optional(Schema.Boolean),
})

/** One of a team's lists, as `items`: each asked for only when a change needs it. */
const Items = <A>(node: Schema.Codec<A, unknown>) => Schema.Struct({ items: Connection(node) })

/** Each of a team's lists Althar reads: which, how many to a page, narrowed how, and what of each. */
const LISTS = {
  states: { list: 'states', first: 100, filter: '', fields: 'id name type position' },
  members: { list: 'members', first: 250, filter: '', fields: 'id name displayName email active' },
  projects: { list: 'projects', first: 100, filter: '', fields: 'id name' },
  // Fewer to a page: Linear counts each project's milestones against a query's bound.
  milestones: { list: 'projects', first: 50, filter: '', fields: 'id name projectMilestones(first: 50) { nodes { id name } }' },
  // Those not past: the one under way, and those to come.
  cycles: { list: 'cycles', first: 100, filter: ', filter: { isPast: { eq: false } }', fields: 'id number name isActive isNext' },
} as const

/** Which team's lists to read: an issue's, by its id, or a team's own, before an issue is filed in it. */
type TeamOfIssue = { readonly issue: string } | { readonly team: string }

/** A key as Linear writes it, however it was typed: mer-231 is MER-231. Anything else goes as it is. */
const keyOf = (ref: string) => (/^[A-Z][A-Z0-9]*-\d+$/i.test(ref) ? ref.toUpperCase() : ref)

/** What Linear changes of an issue: every field it has. It has no issue type or components. */
const CHANGES = [
  'status',
  'close',
  'priority',
  'assignee',
  'labels',
  'project',
  'milestone',
  'cycle',
  'parent',
  'estimate',
  'due',
  'title',
  'description',
] as const

/** What of them Linear's `IssueCreateInput` sets as it files one. */
const CREATES = ['status', 'assignee', 'project', 'milestone', 'cycle', 'parent', 'estimate', 'due'] as const

/**
 * Who a change leaves an issue assigned to, as Linear's one `assigneeId`:
 * the one added in place of whoever had it; none where it takes off the one
 * who has it, or everyone; and nothing said where it takes off someone else.
 */
const assigneeInput = (change: IssueChange['assignee'], assigned: ReadonlyArray<string>): Readonly<Record<string, unknown>> => {
  if (change === undefined) return {}
  const added = oneAssignee(change)
  if (added !== null) return { assigneeId: added.id }
  return change === null || change.remove.some((person) => assigned.includes(person.id)) ? { assigneeId: null } : {}
}

/**
 * The fields a filing and a change both set, as Linear's inputs take them.
 * A milestone is in one project: given without a project, it puts the issue
 * in its own, as Linear would refuse it in another or none.
 */
const fieldsInput = (change: IssueChange, assigned: ReadonlyArray<string>): Readonly<Record<string, unknown>> => ({
  ...(change.status === undefined ? {} : { stateId: change.status.id }),
  ...assigneeInput(change.assignee, assigned),
  ...(change.project !== undefined
    ? { projectId: change.project?.id ?? null }
    : change.milestone?.in === undefined
      ? {}
      : { projectId: change.milestone.in }),
  ...(change.milestone === undefined ? {} : { projectMilestoneId: change.milestone?.id ?? null }),
  ...(change.cycle === undefined ? {} : { cycleId: change.cycle?.id ?? null }),
  ...(change.parent === undefined ? {} : { parentId: change.parent?.id ?? null }),
  ...(change.estimate === undefined ? {} : { estimate: change.estimate }),
  ...(change.due === undefined ? {} : { dueDate: change.due }),
})

/** What an issue is filed with beside its title, body, labels and priority: what is set, as there is nothing yet to take off. */
export const createInput = (fields: IssueChange = {}): Readonly<Record<string, unknown>> =>
  Object.fromEntries(Object.entries(fieldsInput(fields, [])).filter(([, value]) => value !== null))

/**
 * A change as Linear's `IssueUpdateInput` takes it, to an issue assigned to
 * those `assigned` names by id; closed into `closedInto` where it closes
 * without a status of its own.
 */
export const changeInput = (
  change: IssueChange,
  options: { readonly assigned?: ReadonlyArray<string>; readonly closedInto?: string } = {},
): Readonly<Record<string, unknown>> => ({
  ...(change.title === undefined ? {} : { title: change.title }),
  ...(change.description === undefined ? {} : { description: change.description }),
  ...(change.status === undefined && options.closedInto !== undefined ? { stateId: options.closedInto } : {}),
  ...(change.priority === undefined ? {} : { priority: priorityNumber(change.priority) }),
  ...fieldsInput(change, options.assigned ?? []),
  ...(change.labels === undefined || change.labels.add.length === 0 ? {} : { addedLabelIds: change.labels.add.map((label) => label.id) }),
  ...(change.labels === undefined || change.labels.remove.length === 0
    ? {}
    : { removedLabelIds: change.labels.remove.map((label) => label.id) }),
})

export const makeLinear = (options: AdapterOptions): Tracker => {
  const product = 'linear' as const
  const url = `${options.apiUrl.replace(/\/+$/, '')}/graphql`
  const http = makeHttp({ product, fetch: options.fetch, authorization: Effect.map(options.credential, authorizationOf) })

  // A token reaches one workspace: who it is there, and which, as its links name it.
  const account: Effect.Effect<Account, ConnectorFailed> = Effect.map(http.graphql(Viewer, url, `query { ${VIEWER} }`), accountOf)

  /** A team's labels and the workspace's, which any of its issues may take: page after page. */
  const teamLabels = (teamId: string) =>
    paged<typeof Label.Type, string | null>(null, (after) =>
      Effect.map(
        http.graphql(
          Schema.Struct({ issueLabels: Connection(Label) }),
          url,
          'query($teamId: ID!, $after: String) { issueLabels(first: 250, after: $after, filter: { or: [{ team: { id: { eq: $teamId } } }, { team: { null: true } }] }) { nodes { id name isGroup } pageInfo { hasNextPage endCursor } } }',
          { teamId, after },
        ),
        ({ issueLabels }) => pageOf(issueLabels),
      ),
    )

  /** An issue by its key or id, as Linear has it now. */
  const read = (ref: string) =>
    Effect.map(
      http.graphql(Schema.Struct({ issue: LinearIssue }), url, `query($id: String!) { issue(id: $id) { ...IssueFields } } ${IssueFields}`, {
        id: keyOf(ref),
      }),
      ({ issue }) => issueOf(issue),
    )

  /** One of a team's lists (its states, its people, its projects, its cycles), page by page: an issue's team's, in the one query. */
  const ofTeam = <A>(of: TeamOfIssue, node: Schema.Codec<A, unknown>, which: keyof typeof LISTS) =>
    paged<A, string | null>(null, (after) => {
      const { list, first, filter, fields } = LISTS[which]
      const items = `items: ${list}(first: ${first}, after: $after${filter}) { nodes { ${fields} } pageInfo { hasNextPage endCursor } }`
      return 'issue' in of
        ? Effect.map(
            http.graphql(
              Schema.Struct({ issue: Schema.Struct({ team: Items(node) }) }),
              url,
              `query($id: String!, $after: String) { issue(id: $id) { team { ${items} } } }`,
              { id: of.issue, after },
            ),
            ({ issue: found }) => pageOf(found.team.items),
          )
        : Effect.map(
            http.graphql(Schema.Struct({ team: Items(node) }), url, `query($id: String!, $after: String) { team(id: $id) { ${items} } }`, {
              id: of.team,
              after,
            }),
            ({ team }) => pageOf(team.items),
          )
    })

  /** A team's id: its own, or an issue's team's, asked of Linear. */
  const teamOf = (of: TeamOfIssue) =>
    'team' in of
      ? Effect.succeed(of.team)
      : Effect.map(
          http.graphql(
            Schema.Struct({ issue: Schema.Struct({ team: Schema.Struct({ id: Schema.String }) }) }),
            url,
            'query($id: String!) { issue(id: $id) { team { id } } }',
            { id: of.issue },
          ),
          ({ issue: found }) => found.team.id,
        )

  /** A team's states, in their order on its board. */
  const states = (of: TeamOfIssue) => Effect.map(ofTeam(of, State, 'states'), (all) => all.toSorted((a, b) => a.position - b.position))

  /** What a field can be set to for an issue in a team: the same whether the issue is filed yet or not. */
  const choicesOf = (of: TeamOfIssue, field: ChosenField): Effect.Effect<ReadonlyArray<Choice>, ConnectorFailed> => {
    switch (field) {
      case 'status':
        return Effect.map(states(of), (all) => all.map((state): Choice => ({ id: state.id, name: state.name })))
      // Its team's and the workspace's; a group only holds labels.
      case 'labels':
        return Effect.gen(function* () {
          return (yield* teamLabels(yield* teamOf(of)))
            .filter((label) => label.isGroup !== true)
            .map((label): Choice => ({ id: label.id, name: label.name }))
        })
      // Its team's people, still active: who Linear lets it be assigned to.
      case 'assignee':
        return Effect.map(ofTeam(of, Member, 'members'), (items) =>
          items
            .filter((member) => member.active !== false)
            .map((member): Choice => ({
              id: member.id,
              name: member.name,
              also: [member.displayName, member.email].filter((word): word is string => typeof word === 'string' && word !== ''),
            })),
        )
      case 'project':
        return Effect.map(ofTeam(of, Project, 'projects'), (items) =>
          items.map((project): Choice => ({ id: project.id, name: project.name })),
        )
      // Each of its team's projects' milestones, in the project it puts the issue in, by both names as Linear shows them together.
      case 'milestone':
        return Effect.map(ofTeam(of, ProjectMilestones, 'milestones'), (projects) =>
          projects.flatMap((project) =>
            project.projectMilestones.nodes.map((milestone): Choice => ({
              id: milestone.id,
              name: milestone.name,
              in: project.id,
              also: [`${project.name} / ${milestone.name}`],
            })),
          ),
        )
      // Its team's cycles not past, by number as well as name, and the one under way and the next by those words.
      case 'cycle':
        return Effect.map(ofTeam(of, Cycle, 'cycles'), (cycles) =>
          cycles
            .toSorted((a, b) => a.number - b.number)
            .map((cycle): Choice => ({
              id: cycle.id,
              name: cycle.name ?? `Cycle ${cycle.number}`,
              also: [String(cycle.number), ...(cycle.isActive === true ? ['current'] : []), ...(cycle.isNext === true ? ['next'] : [])],
            })),
        )
      case 'type':
        return Effect.fail(cantChange(product, field, 'Linear has no issue types: a label says what kind it is'))
      case 'components':
        return Effect.fail(cantChange(product, field, 'Linear has no components: a label or a project says what part it is in'))
    }
  }

  const changeIssue: Tracker['update'] = (issue, wanted) =>
    Effect.gen(function* () {
      // Closed is done: its team's first completed state, by its place on the board.
      const closing = wanted.close === true && wanted.status === undefined
      const closedInto = closing ? (yield* states({ issue: issue.id })).find((state) => state.type === 'completed') : undefined
      if (closing && closedInto === undefined)
        return yield* new ConnectorFailed({ product, reason: 'rejected', message: 'Its team has no completed state' })
      const { issueUpdate } = yield* http.graphql(
        Schema.Struct({ issueUpdate: Schema.Struct({ success: Schema.Boolean, issue: Schema.optional(Schema.NullOr(LinearIssue)) }) }),
        url,
        `mutation($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success issue { ...IssueFields } } } ${IssueFields}`,
        {
          id: issue.id,
          input: changeInput(wanted, {
            assigned: issue.assignees.map((person) => person.id),
            ...(closedInto === undefined ? {} : { closedInto: closedInto.id }),
          }),
        },
      )
      if (!issueUpdate.success) return yield* new ConnectorFailed({ product, reason: 'rejected', message: 'Linear did not change it' })
      // Changed, by Linear's word: read again where it didn't say how it stands now.
      return issueUpdate.issue == null ? yield* read(issue.ref) : issueOf(issueUpdate.issue)
    })

  return {
    product,
    capabilities: { links: true, starts: true, changes: CHANGES, creates: CREATES, assignees: 'one' },
    account,
    issue: read,
    // Into the team's first started state, by its position on the board: In Progress, before In Review.
    start: (issue) =>
      Effect.gen(function* () {
        if (!unstarted(issue.status.category)) return leftAsItIs(issue)
        const { issue: found } = yield* http.graphql(
          Schema.Struct({ issue: Schema.Struct({ team: Schema.Struct({ states: Schema.Struct({ nodes: Schema.Array(State) }) }) }) }),
          url,
          'query($id: String!) { issue(id: $id) { team { states(first: 100) { nodes { id name type position } } } } }',
          { id: issue.id },
        )
        const [state] = found.team.states.nodes.filter((each) => each.type === 'started').toSorted((a, b) => a.position - b.position)
        if (state === undefined)
          return yield* new ConnectorFailed({ product, reason: 'rejected', message: 'Its team has no started state' })
        const { issueUpdate } = yield* http.graphql(
          Schema.Struct({ issueUpdate: Success }),
          url,
          'mutation($id: String!, $stateId: String!) { issueUpdate(id: $id, input: { stateId: $stateId }) { success } }',
          { id: issue.id, stateId: state.id },
        )
        if (!issueUpdate.success) return yield* new ConnectorFailed({ product, reason: 'rejected', message: 'Linear did not move it' })
        return { moved: true, status: { name: state.name, category: 'started' } }
      }),
    mine: (options = {}) =>
      Effect.map(
        http.graphql(
          Schema.Struct({ viewer: Schema.Struct({ assignedIssues: Schema.Struct({ nodes: Schema.Array(LinearIssue) }) }) }),
          url,
          `query($first: Int!) {
            viewer { assignedIssues(first: $first, orderBy: updatedAt, filter: { state: { type: { nin: ["completed", "canceled"] } } }) {
              nodes { ...IssueFields }
            } }
          } ${IssueFields}`,
          { first: options.limit ?? 50 },
        ),
        ({ viewer }) => viewer.assignedIssues.nodes.map(issueOf),
      ),
    find: (query) =>
      Effect.map(
        http.graphql(
          Schema.Struct({ issues: Schema.Struct({ nodes: Schema.Array(LinearIssue) }) }),
          url,
          `query($first: Int!, $filter: IssueFilter) {
            issues(first: $first, orderBy: updatedAt, filter: $filter) { nodes { ...IssueFields } }
          } ${IssueFields}`,
          { first: Math.min(query.limit, MOST), filter: filterOf(query) },
        ),
        ({ issues }) => issues.nodes.map(issueOf),
      ),
    // Its latest, as Linear lists them newest first, put back in the order they were written.
    comments: (issue, limit) =>
      Effect.map(
        http.graphql(
          Schema.Struct({ issue: Schema.Struct({ comments: Schema.Struct({ nodes: Schema.Array(LinearComment) }) }) }),
          url,
          'query($id: String!, $first: Int!) { issue(id: $id) { comments(first: $first, orderBy: createdAt) { nodes { body createdAt user { id name displayName } } } } }',
          { id: issue.id, first: Math.min(limit, MOST) },
        ),
        ({ issue: found }) => found.comments.nodes.toSorted((a, b) => a.createdAt.localeCompare(b.createdAt)).map(commentOf),
      ),
    // Linear says whether it took each: one it says it didn't is refused, never taken as done.
    comment: (issue, body) =>
      Effect.flatMap(
        http.graphql(
          Schema.Struct({ commentCreate: Success }),
          url,
          'mutation($issueId: String!, $body: String!) { commentCreate(input: { issueId: $issueId, body: $body }) { success } }',
          { issueId: issue.id, body },
        ),
        ({ commentCreate }) =>
          commentCreate.success
            ? Effect.void
            : Effect.fail(new ConnectorFailed({ product, reason: 'rejected', message: 'Linear did not post the comment' })),
      ),
    link: (issue, link) =>
      Effect.flatMap(
        http.graphql(
          Schema.Struct({ attachmentLinkURL: Success }),
          url,
          'mutation($issueId: String!, $url: String!, $title: String) { attachmentLinkURL(issueId: $issueId, url: $url, title: $title) { success } }',
          { issueId: issue.id, url: link.url, title: link.title },
        ),
        ({ attachmentLinkURL }) =>
          attachmentLinkURL.success
            ? Effect.void
            : Effect.fail(new ConnectorFailed({ product, reason: 'rejected', message: 'Linear did not link it' })),
      ),
    // A team is where a Linear issue is filed.
    containers: () =>
      Effect.map(
        paged<typeof Team.Type, string | null>(null, (after) =>
          Effect.map(
            http.graphql(
              Schema.Struct({ teams: Connection(Team) }),
              url,
              'query($after: String) { teams(first: 100, after: $after) { nodes { id key name } pageInfo { hasNextPage endCursor } } }',
              { after },
            ),
            ({ teams }) => pageOf(teams),
          ),
        ),
        (teams) => teams.map((team): Container => ({ id: team.id, key: team.key, name: team.name })),
      ),
    create: (team, issue) =>
      Effect.gen(function* () {
        // Linear takes labels by id, and makes none from a name: the team's and the workspace's are read only when some are asked for.
        const labelIds = issue.labels.length === 0 ? [] : labelIdsOf(yield* teamLabels(team), issue.labels)
        const { issueCreate } = yield* http.graphql(
          Schema.Struct({ issueCreate: Schema.Struct({ success: Schema.Boolean, issue: Schema.optional(Schema.NullOr(LinearIssue)) }) }),
          url,
          `mutation($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { ...IssueFields } } } ${IssueFields}`,
          {
            input: {
              teamId: team,
              title: issue.title,
              description: issue.body,
              ...(labelIds.length === 0 ? {} : { labelIds }),
              ...(issue.priority === undefined || issue.priority === 'none' ? {} : { priority: priorityNumber(issue.priority) }),
              ...createInput(issue.fields),
            },
          },
        )
        if (!issueCreate.success)
          return yield* new ConnectorFailed({ product, reason: 'rejected', message: 'Linear did not file the issue' })
        // Filed, by Linear's word, without saying which: an answer Althar can't read, never a refusal.
        if (issueCreate.issue == null)
          return yield* new ConnectorFailed({ product, reason: 'invalid_response', message: 'Linear filed the issue without saying which' })
        return issueOf(issueCreate.issue)
      }),
    choices: (issue, field) => choicesOf({ issue: issue.id }, field),
    choicesIn: (team, field) => choicesOf({ team }, field),
    update: changeIssue,
  }
}

/*
 * What a Linear connection can do. Its sign-in asks to read and write, so a
 * token from it may comment on issues, move them and file them (Linear's
 * `write` covers `issues:create`); what a personal API key may do
 * isn't said, as keys can be limited where they are made.
 */

const Envelope = Schema.Struct({
  data: Schema.optional(Schema.NullOr(Schema.Unknown)),
  errors: Schema.optional(
    Schema.Array(
      Schema.Struct({
        message: Schema.String,
        extensions: Schema.optional(Schema.Struct({ code: Schema.optional(Schema.String), type: Schema.optional(Schema.String) })),
      }),
    ),
  ),
})

const Teams = Schema.Struct({ teams: Schema.Struct({ nodes: Schema.Array(Schema.Struct({ key: Schema.String })) }) })

/** A query's data, read by a schema, or why there is none: Linear says a credential it didn't take in a 400 as often as a 401. */
const dataOf = <A>(schema: Schema.Codec<A, unknown>, answer: Answer): { readonly data: A } | { readonly reason: AccessReason } => {
  const envelope = readAs(Envelope, answer)
  const [error] = envelope?.errors ?? []
  if (error !== undefined)
    return /AUTHENTICATION|UNAUTHENTICATED/i.test(`${error.extensions?.code ?? ''} ${error.extensions?.type ?? ''}`)
      ? { reason: { kind: 'refused' } }
      : { reason: { kind: 'failed', message: error.message.slice(0, 300) } }
  if (!answered(answer)) return { reason: refusalOf(answer) }
  const data = Option.getOrUndefined(Schema.decodeUnknownOption(schema)(envelope?.data))
  return data === undefined ? { reason: UNREADABLE } : { data }
}

export const accessLinear: Access = (input) =>
  Effect.gen(function* () {
    const url = `${input.apiUrl.replace(/\/+$/, '')}/graphql`
    const me = dataOf(Viewer, yield* probe(input, url, { query: `query { ${VIEWER} }` }))
    if ('reason' in me) return stopped([line('account', 'no', { reason: me.reason })])
    const { viewer, organization } = me.data
    const teams = dataOf(Teams, yield* probe(input, url, { query: 'query { teams(first: 100) { nodes { key } } }' }))
    const signedIn = input.auth === 'pkce'
    return {
      account: accountOf(me.data),
      lines: [
        line('account', 'ok', { fact: `${viewer.name} · ${organization.name}` }),
        'reason' in teams ? line('read', 'no', { reason: teams.reason }) : line('read', 'ok', { count: teams.data.teams.nodes.length }),
        signedIn ? line('comment', 'ok') : line('comment', 'unknown', { reason: UNSAID }),
        signedIn ? line('move', 'ok') : line('move', 'unknown', { reason: UNSAID }),
      ],
      expiresAt: null,
      scopes: null,
    }
  })
