import { Effect, Schema } from 'effect'

import { type AdapterOptions, authorizationOf } from './credential'
import type { ConnectorFailed } from './errors'
import { makeHttp } from './http'
import type { Account, Issue, Priority, StatusCategory, Tracker } from './model'

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
