import { Effect, Option, Schema } from 'effect'

import { type Access, type AccessReason, line } from './access'
import { type AdapterOptions, authorizationOf } from './credential'
import type { ConnectorFailed } from './errors'
import { makeHttp } from './http'
import type { Account, Issue, Priority, StatusCategory, Tracker } from './model'
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

/** A key as Linear writes it, however it was typed: mer-231 is MER-231. Anything else goes as it is. */
const keyOf = (ref: string) => (/^[A-Z][A-Z0-9]*-\d+$/i.test(ref) ? ref.toUpperCase() : ref)

export const makeLinear = (options: AdapterOptions): Tracker => {
  const product = 'linear' as const
  const url = `${options.apiUrl.replace(/\/+$/, '')}/graphql`
  const http = makeHttp({ product, fetch: options.fetch, authorization: Effect.map(options.credential, authorizationOf) })

  const account: Effect.Effect<Account, ConnectorFailed> = Effect.map(
    http.graphql(
      Schema.Struct({ viewer: Schema.Struct({ id: Schema.String, name: Schema.String, displayName: Schema.optional(Schema.String) }) }),
      url,
      'query { viewer { id name displayName } }',
    ),
    ({ viewer }) => ({ id: viewer.id, login: viewer.displayName ?? viewer.name, name: viewer.name }),
  )

  return {
    product,
    capabilities: { links: true },
    account,
    issue: (ref) =>
      Effect.map(
        http.graphql(
          Schema.Struct({ issue: LinearIssue }),
          url,
          `query($id: String!) { issue(id: $id) { ...IssueFields } } ${IssueFields}`,
          { id: keyOf(ref) },
        ),
        ({ issue }) => issueOf(issue),
      ),
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
    comment: (issue, body) =>
      Effect.asVoid(
        http.graphql(
          Schema.Struct({ commentCreate: Success }),
          url,
          'mutation($issueId: String!, $body: String!) { commentCreate(input: { issueId: $issueId, body: $body }) { success } }',
          { issueId: issue.id, body },
        ),
      ),
    link: (issue, link) =>
      Effect.asVoid(
        http.graphql(
          Schema.Struct({ attachmentLinkURL: Success }),
          url,
          'mutation($issueId: String!, $url: String!, $title: String) { attachmentLinkURL(issueId: $issueId, url: $url, title: $title) { success } }',
          { issueId: issue.id, url: link.url, title: link.title },
        ),
      ),
  }
}

/*
 * What a Linear connection can do. Its sign-in asks to read and write, so a
 * token from it may comment and move issues; what a personal API key may do
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

const Viewer = Schema.Struct({
  viewer: Schema.Struct({ id: Schema.String, name: Schema.String, displayName: Schema.optional(Schema.String) }),
  organization: Schema.Struct({ name: Schema.String }),
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
    const me = dataOf(Viewer, yield* probe(input, url, { query: 'query { viewer { id name displayName } organization { name } }' }))
    if ('reason' in me) return stopped([line('account', 'no', { reason: me.reason })])
    const { viewer, organization } = me.data
    const teams = dataOf(Teams, yield* probe(input, url, { query: 'query { teams(first: 100) { nodes { key } } }' }))
    const signedIn = input.auth === 'pkce'
    return {
      account: { id: viewer.id, login: viewer.displayName ?? viewer.name, name: viewer.name },
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
