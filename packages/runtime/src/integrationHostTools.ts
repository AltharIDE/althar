import type { ApiRequest } from '@althar/connectors'
import { Effect, Schema } from 'effect'
import { SqlClient } from 'effect/sql'

import { Connections } from './Connections'
import { placeOf } from './coordinatorPullRequests'
import type { FreshAction } from './Errands'
import {
  connected,
  connectionInput,
  decode,
  ensureSuccess,
  type Needs,
  Record,
  refused,
  wordInput,
  Word,
  write,
} from './integrationSupport'
import type { Tool, ToolAccess } from './ToolServer'

export type IntegrationTool = (
  name: string,
  description: string,
  properties: Readonly<Record<string, unknown>>,
  required: ReadonlyArray<string>,
  call: (input: unknown, access: ToolAccess) => Effect.Effect<string, unknown, Needs>,
) => Tool
const PullAsked = Schema.Struct({
  pull_request: Schema.Union([Schema.String, Schema.Number]),
  reviewers: Schema.optional(Schema.Array(Schema.String)),
  teams: Schema.optional(Schema.Array(Schema.String)),
  thread: Schema.optional(Schema.String),
  resolved: Schema.optional(Schema.Boolean),
  ...Word,
})
const ReviewAsked = Schema.Struct({
  pull_request: Schema.Union([Schema.String, Schema.Number]),
  verdict: Schema.Literals(['approve', 'request_changes', 'comment']),
  body: Schema.String,
  commit: Schema.String,
  comments: Schema.optional(Schema.Array(Schema.Struct({ path: Schema.String, line: Schema.Number, body: Schema.String }))),
  ...Word,
})
const SearchPullsAsked = Schema.Struct({
  connection: Schema.optional(Schema.String),
  query: Schema.String,
  page: Schema.optional(Schema.Number),
  limit: Schema.optional(Schema.Number),
})

/** Explicit links can reach any repository the connection can see; bare numbers use the project's repository. */
const pullAt = (projectId: string, wanted: string | number) =>
  Effect.gen(function* () {
    const connections = yield* Connections
    const value = String(wanted)
    const link = value.startsWith('https://')
      ? value
      : yield* Effect.gen(function* () {
          const place = yield* placeOf(projectId, value)
          return (yield* place.host.change(place.repository, place.number)).url
        })
    const found = yield* connections.resolve(link)
    if (found === null || found.ref.kind !== 'change' || found.host === undefined || found.api === undefined)
      return yield* refused('Give a pull request link on a connected host, or its number in this project.')
    const repository = yield* found.host.repository(found.ref.path)
    const change = yield* found.host.change(repository, found.ref.number)
    const path = repository.path.map(encodeURIComponent).join('/')
    const base =
      found.host.product === 'github'
        ? `/repos/${path}/pulls/${change.number}`
        : found.host.product === 'gitlab'
          ? `/projects/${encodeURIComponent(repository.id)}/merge_requests/${change.number}`
          : found.host.product === 'bitbucket_cloud'
            ? `/repositories/${path}/pullrequests/${change.number}`
            : `/projects/${encodeURIComponent(repository.path[0] ?? '')}/repos/${encodeURIComponent(repository.path[1] ?? '')}/pull-requests/${change.number}`
    return { host: found.host, api: found.api, repository, change, base }
  })

export const hostIntegrationTools = (tool: IntegrationTool): ReadonlyArray<Tool> => [
  tool(
    'search_pull_requests',
    'Searches GitHub pull requests across any repositories the connection can access, including an entire organisation. query is GitHub search syntax, e.g. org:acme is:open updated:>=2026-11-01; is:pr is added. Follow next_page with the same query and limit. GitHub Search has a 1000-result window: partition larger searches by created/updated dates. incomplete_results and window_exhausted never mean complete. GitLab uses global merge request search and pages it.',
    {
      connection: connectionInput,
      query: { type: 'string' },
      page: { type: 'integer', minimum: 1 },
      limit: { type: 'integer', minimum: 1, maximum: 100 },
    },
    ['query'],
    (input) =>
      Effect.gen(function* () {
        const asked = yield* decode(SearchPullsAsked, input)
        const found = yield* connected(asked.connection, 'host')
        const page = asked.page ?? 1
        const limit = Math.min(100, Math.max(1, asked.limit ?? 100))
        if (!Number.isSafeInteger(page) || page < 1) return yield* refused('page must be a positive integer.')
        if (found.connection.product === 'github') {
          if ((page - 1) * limit >= 1000)
            return yield* refused(
              'GitHub Search returns at most 1000 matches per query. Split by created or updated dates and search each range.',
            )
          const result = yield* found.api.request({
            path: `/search/issues?q=${encodeURIComponent(`is:pr ${asked.query}`)}&sort=updated&order=desc&per_page=${limit}&page=${page}`,
          })
          const body = yield* decode(
            Schema.Struct({ total_count: Schema.Number, incomplete_results: Schema.Boolean, items: Schema.Array(Record) }),
            result.body,
          )
          const more = page * limit < body.total_count
          return JSON.stringify({
            ...body,
            next_page: more && page * limit < 1000 ? page + 1 : null,
            window_exhausted: more && page * limit >= 1000,
            partition_required: body.total_count > 1000 || body.incomplete_results,
          })
        }
        if (found.connection.product === 'gitlab') {
          const result = yield* found.api.request({
            path: `/merge_requests?scope=all&state=all&search=${encodeURIComponent(asked.query)}&per_page=${limit}&page=${page}&order_by=updated_at&sort=desc`,
          })
          const items = yield* decode(Schema.Array(Record), result.body)
          return JSON.stringify({ items, next_page: result.next !== null || items.length === limit ? page + 1 : null })
        }
        return yield* refused(
          'Use code_host_api to page this host’s repositories and pull requests; global search is available on GitHub and GitLab.',
        )
      }),
  ),
  tool(
    'request_pull_request_reviewers',
    'Requests reviewers on the person’s word. GitHub takes reviewer logins and team slugs; GitLab numeric user IDs; Bitbucket Cloud UUIDs, Data Center user names. A full pull_request link can be outside this project. Requires message or errand and leaves a receipt.',
    {
      pull_request: { type: ['string', 'number'] },
      reviewers: { type: 'array', items: { type: 'string' } },
      teams: { type: 'array', items: { type: 'string' } },
      ...wordInput,
    },
    ['pull_request'],
    (input, access) =>
      Effect.gen(function* () {
        const asked = yield* decode(PullAsked, input)
        if ((asked.reviewers?.length ?? 0) + (asked.teams?.length ?? 0) === 0) return yield* refused('Name at least one reviewer or team.')
        const found = yield* pullAt(access.projectId, asked.pull_request)
        if (found.host.product !== 'github' && (asked.teams?.length ?? 0) > 0)
          return yield* refused('Team review requests are supported on GitHub; name individual reviewers on this host.')
        let request: ApiRequest
        if (found.host.product === 'github')
          request = {
            method: 'POST',
            path: `${found.base}/requested_reviewers`,
            body: { reviewers: asked.reviewers ?? [], team_reviewers: asked.teams ?? [] },
          }
        else if (found.host.product === 'gitlab') {
          if ((asked.teams?.length ?? 0) > 0 || (asked.reviewers ?? []).some((one) => !/^\d+$/.test(one)))
            return yield* refused('GitLab reviewers are numeric user IDs; read /users with code_host_api to resolve names.')
          request = { method: 'PUT', path: found.base, body: { reviewer_ids: (asked.reviewers ?? []).map(Number) } }
        } else if (found.host.product === 'bitbucket_cloud')
          request = { method: 'PUT', path: found.base, body: { reviewers: (asked.reviewers ?? []).map((uuid) => ({ uuid })) } }
        else {
          const now = yield* found.api.request({ path: found.base })
          const { version } = yield* decode(Schema.Struct({ version: Schema.Number }), now.body)
          request = {
            method: 'PUT',
            path: found.base,
            body: { version, reviewers: (asked.reviewers ?? []).map((name) => ({ user: { name } })) },
          }
        }
        return yield* write(
          'request_pull_request_reviewers',
          access,
          asked,
          found.change.url,
          { reviewers: asked.reviewers ?? [], teams: asked.teams ?? [] },
          found.api.request(request).pipe(Effect.flatMap(ensureSuccess)),
          found.host.change(found.repository, found.change.number).pipe(Effect.as({ state: 'ready' as const })),
        )
      }),
  ),
  tool(
    'resolve_review_thread',
    'Resolves or reopens a GitHub or GitLab review thread by its stable ID; resolved defaults to true. Requires the person’s message or errand and leaves a receipt. This resolves conversation, never approves code.',
    { pull_request: { type: ['string', 'number'] }, thread: { type: 'string' }, resolved: { type: 'boolean' }, ...wordInput },
    ['pull_request', 'thread'],
    (input, access) =>
      Effect.gen(function* () {
        const asked = yield* decode(PullAsked, input)
        if (asked.thread === undefined) return yield* refused('Name the review thread ID.')
        const found = yield* pullAt(access.projectId, asked.pull_request)
        const resolved = asked.resolved ?? true
        if (found.host.product === 'github') {
          const target = yield* found.api.request({
            query: 'query($id: ID!) { node(id: $id) { ... on PullRequestReviewThread { pullRequest { url } } } }',
            variables: { id: asked.thread },
          })
          const parsed = yield* decode(
            Schema.Struct({ node: Schema.NullOr(Schema.Struct({ pullRequest: Schema.Struct({ url: Schema.String }) })) }),
            target.body,
          )
          if (parsed.node?.pullRequest.url.toLowerCase() !== found.change.url.toLowerCase())
            return yield* refused('That review thread belongs to another pull request.')
        }
        const request: ApiRequest =
          found.host.product === 'github'
            ? {
                query: `mutation($id: ID!) { result: ${resolved ? 'resolve' : 'unresolve'}ReviewThread(input: { threadId: $id }) { thread { id isResolved } } }`,
                variables: { id: asked.thread },
              }
            : found.host.product === 'gitlab'
              ? { method: 'PUT', path: `${found.base}/discussions/${encodeURIComponent(asked.thread)}`, body: { resolved } }
              : yield* refused('Use code_host_api for this host’s thread resolution.')
        return yield* write(
          'resolve_review_thread',
          access,
          asked,
          `${found.change.url} thread ${asked.thread}`,
          { thread: asked.thread, resolved },
          found.api.request(request).pipe(Effect.flatMap(ensureSuccess)),
          found.host.change(found.repository, found.change.number).pipe(Effect.as({ state: 'ready' as const })),
        )
      }),
  ),
  tool(
    'mark_pull_request_draft',
    'Puts an open pull request back into draft on GitHub, GitLab or Bitbucket where drafts are supported. mark_ready does the reverse. Requires the person’s message or errand and leaves a receipt.',
    { pull_request: { type: ['string', 'number'] }, ...wordInput },
    ['pull_request'],
    (input, access) =>
      Effect.gen(function* () {
        const asked = yield* decode(PullAsked, input)
        const found = yield* pullAt(access.projectId, asked.pull_request)
        if (found.change.state !== 'open') return yield* refused('Only an open pull request can become a draft.')
        if (!found.host.capabilities.drafts) return yield* refused('This host’s version does not support drafts.')
        let request: ApiRequest
        if (found.host.product === 'github') {
          const raw = yield* found.api.request({ path: found.base })
          const { node_id } = yield* decode(Schema.Struct({ node_id: Schema.String }), raw.body)
          request = {
            query: 'mutation($id: ID!) { result: convertPullRequestToDraft(input: { pullRequestId: $id }) { pullRequest { id isDraft } } }',
            variables: { id: node_id },
          }
        } else if (found.host.product === 'gitlab')
          request = {
            method: 'PUT',
            path: found.base,
            body: { title: /^draft:/i.test(found.change.title) ? found.change.title : `Draft: ${found.change.title}` },
          }
        else if (found.host.product === 'bitbucket_cloud') request = { method: 'PUT', path: found.base, body: { draft: true } }
        else {
          const raw = yield* found.api.request({ path: found.base })
          const { version } = yield* decode(Schema.Struct({ version: Schema.Number }), raw.body)
          request = { method: 'PUT', path: found.base, body: { version, draft: true } }
        }
        const read = found.host
          .change(found.repository, found.change.number)
          .pipe(
            Effect.map((now): FreshAction =>
              now.draft ? { state: 'done', answer: 'The pull request is already a draft.' } : { state: 'ready' },
            ),
          )
        return yield* write(
          'mark_pull_request_draft',
          access,
          asked,
          found.change.url,
          { draft: true },
          found.api.request(request).pipe(Effect.flatMap(ensureSuccess)),
          read,
        )
      }),
  ),
  tool(
    'post_review',
    'Posts a review the person asked for directly. Give pull_request, verdict (approve/request_changes/comment), Markdown body and the exact commit SHA reviewed; optional comments address new-side paths and lines. The current head must match. An agent cannot approve its own work or a PR Althar opened. Requires the person’s message or errand and leaves a receipt.',
    {
      pull_request: { type: ['string', 'number'] },
      verdict: { type: 'string', enum: ['approve', 'request_changes', 'comment'] },
      body: { type: 'string' },
      commit: { type: 'string' },
      comments: {
        type: 'array',
        items: {
          type: 'object',
          properties: { path: { type: 'string' }, line: { type: 'integer', minimum: 1 }, body: { type: 'string' } },
          required: ['path', 'line', 'body'],
        },
      },
      ...wordInput,
    },
    ['pull_request', 'verdict', 'body', 'commit'],
    (input, access) =>
      Effect.gen(function* () {
        const asked = yield* decode(ReviewAsked, input)
        const found = yield* pullAt(access.projectId, asked.pull_request)
        if (!found.host.capabilities.reviews) return yield* refused('This host does not yet support posting reviews through its adapter.')
        const sql = yield* SqlClient.SqlClient
        const owned = yield* sql<{
          id: string
        }>`SELECT id FROM external_links WHERE kind = 'change' AND lower(url) = ${found.change.url.toLowerCase()} LIMIT 1`
        const account = yield* found.host.account
        if (asked.verdict === 'approve' && (owned.length > 0 || found.change.author?.id === account.id))
          return yield* refused('An agent cannot approve its own work or a pull request Althar opened.')
        if ((asked.comments ?? []).some((one) => !Number.isSafeInteger(one.line) || one.line < 1))
          return yield* refused('Review comment lines must be positive integers.')
        const read = found.host
          .change(found.repository, found.change.number)
          .pipe(
            Effect.flatMap((now) =>
              now.headSha !== asked.commit
                ? Effect.fail(refused('The head moved. Review the current commit before posting.'))
                : Effect.succeed({ state: 'ready' as const, head: now.headSha ?? undefined }),
            ),
          )
        return yield* write(
          'post_review',
          access,
          asked,
          found.change.url,
          { verdict: asked.verdict, body: asked.body, commit: asked.commit, comments: asked.comments ?? [] },
          found.host
            .postReview(found.repository, found.change.number, {
              event: asked.verdict,
              body: asked.body,
              commit: asked.commit,
              comments: asked.comments ?? [],
            })
            .pipe(Effect.map(JSON.stringify)),
          read,
        )
      }),
  ),
]
