import { Effect, Option, Schema } from 'effect'

import { type Access, type AccessReason, line } from './access'
import { type AdapterOptions, authorizationOf } from './credential'
import { ConnectorFailed } from './errors'
import { makeHttp, paged } from './http'
import {
  type Account,
  type Choice,
  type Container,
  type Issue,
  type IssueChange,
  leftAsItIs,
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

/** An issue's team, with its id and one of its lists, as `items`: each asked for only when a change needs it. */
const TeamOf = <A>(node: Schema.Codec<A, unknown>) =>
  Schema.Struct({ issue: Schema.Struct({ team: Schema.Struct({ id: Schema.String, items: Connection(node) }) }) })

/** Each of a team's lists Althar reads: how many to a page, and what of each. */
const LISTS = {
  states: { first: 100, fields: 'id name type position' },
  members: { first: 250, fields: 'id name displayName email active' },
  projects: { first: 100, fields: 'id name' },
} as const

/** A key as Linear writes it, however it was typed: mer-231 is MER-231. Anything else goes as it is. */
const keyOf = (ref: string) => (/^[A-Z][A-Z0-9]*-\d+$/i.test(ref) ? ref.toUpperCase() : ref)

/** What Linear changes of an issue: every field the model has. */
const CHANGES = ['status', 'close', 'priority', 'assignee', 'labels', 'project', 'title'] as const

/** A change as Linear's `IssueUpdateInput` takes it, closed into `closedInto` where it closes without a status of its own. */
export const changeInput = (change: IssueChange, closedInto?: string): Readonly<Record<string, unknown>> => ({
  ...(change.title === undefined ? {} : { title: change.title }),
  ...(change.status !== undefined ? { stateId: change.status.id } : closedInto === undefined ? {} : { stateId: closedInto }),
  ...(change.priority === undefined ? {} : { priority: priorityNumber(change.priority) }),
  ...(change.assignee === undefined ? {} : { assigneeId: change.assignee?.id ?? null }),
  ...(change.project === undefined ? {} : { projectId: change.project?.id ?? null }),
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

  /** One of an issue's team's lists (its states, its people, its projects), page by page. */
  const ofTeam = <A>(issue: Issue, node: Schema.Codec<A, unknown>, list: keyof typeof LISTS) =>
    paged<A, string | null>(null, (after) =>
      Effect.map(
        http.graphql(
          TeamOf(node),
          url,
          `query($id: String!, $after: String) { issue(id: $id) { team { id items: ${list}(first: ${LISTS[list].first}, after: $after) { nodes { ${LISTS[list].fields} } pageInfo { hasNextPage endCursor } } } } }`,
          { id: issue.id, after },
        ),
        ({ issue: found }) => pageOf(found.team.items),
      ),
    )

  /** An issue's team, by its id. */
  const teamOf = (issue: Issue) =>
    Effect.map(
      http.graphql(
        Schema.Struct({ issue: Schema.Struct({ team: Schema.Struct({ id: Schema.String }) }) }),
        url,
        'query($id: String!) { issue(id: $id) { team { id } } }',
        { id: issue.id },
      ),
      ({ issue: found }) => found.team.id,
    )

  /** An issue's team's states, in their order on its board. */
  const states = (issue: Issue) => Effect.map(ofTeam(issue, State, 'states'), (all) => all.toSorted((a, b) => a.position - b.position))

  const choices: Tracker['choices'] = (issue, field) => {
    switch (field) {
      case 'status':
        return Effect.map(states(issue), (all) => all.map((state): Choice => ({ id: state.id, name: state.name })))
      // Its team's and the workspace's; a group only holds labels.
      case 'labels':
        return Effect.gen(function* () {
          return (yield* teamLabels(yield* teamOf(issue)))
            .filter((label) => label.isGroup !== true)
            .map((label): Choice => ({ id: label.id, name: label.name }))
        })
      // Its team's people, still active: who Linear lets it be assigned to.
      case 'assignee':
        return Effect.map(ofTeam(issue, Member, 'members'), (items) =>
          items
            .filter((member) => member.active !== false)
            .map((member): Choice => ({
              id: member.id,
              name: member.name,
              also: [member.displayName, member.email].filter((word): word is string => typeof word === 'string' && word !== ''),
            })),
        )
      case 'project':
        return Effect.map(ofTeam(issue, Project, 'projects'), (items) =>
          items.map((project): Choice => ({ id: project.id, name: project.name })),
        )
    }
  }

  const changeIssue: Tracker['update'] = (issue, wanted) =>
    Effect.gen(function* () {
      // Closed is done: its team's first completed state, by its place on the board.
      const closing = wanted.close === true && wanted.status === undefined
      const closedInto = closing ? (yield* states(issue)).find((state) => state.type === 'completed') : undefined
      if (closing && closedInto === undefined)
        return yield* new ConnectorFailed({ product, reason: 'rejected', message: 'Its team has no completed state' })
      const { issueUpdate } = yield* http.graphql(
        Schema.Struct({ issueUpdate: Schema.Struct({ success: Schema.Boolean, issue: Schema.optional(Schema.NullOr(LinearIssue)) }) }),
        url,
        `mutation($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success issue { ...IssueFields } } } ${IssueFields}`,
        { id: issue.id, input: changeInput(wanted, closedInto?.id) },
      )
      if (!issueUpdate.success) return yield* new ConnectorFailed({ product, reason: 'rejected', message: 'Linear did not change it' })
      // Changed, by Linear's word: read again where it didn't say how it stands now.
      return issueUpdate.issue == null ? yield* read(issue.ref) : issueOf(issueUpdate.issue)
    })

  return {
    product,
    capabilities: { links: true, starts: true, changes: CHANGES },
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
    choices,
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
