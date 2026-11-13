import type { ApiRequest, Product, ServiceApi } from '@althar/connectors'
import { reviewCommitMatches } from '@althar/connectors'
import { Effect, Schema } from 'effect'
import { SqlClient } from 'effect/sql'

import { Connections } from './Connections'
import { Instance } from './Instance'
import { Reviews } from './Reviews'
import { signed } from './pullRequestWords'
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
import { ActionNotPerformed, type Tool, type ToolAccess } from './ToolServer'

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
  pull_request: Schema.optional(Schema.Union([Schema.String, Schema.Number])),
  draft: Schema.optional(Schema.String),
  verdict: Schema.optional(Schema.Literals(['approve', 'request_changes', 'comment'])),
  body: Schema.optional(Schema.String),
  commit: Schema.optional(Schema.String),
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

/** These hosts replace the reviewer list, so add to the people already requested. */
export const reviewerRequest = (
  product: Product,
  api: ServiceApi,
  base: string,
  reviewers: ReadonlyArray<string>,
  teams: ReadonlyArray<string>,
): Effect.Effect<ApiRequest, unknown> =>
  Effect.gen(function* () {
    if (product === 'github') return { method: 'POST', path: `${base}/requested_reviewers`, body: { reviewers, team_reviewers: teams } }
    if (product === 'gitlab' && reviewers.some((one) => !/^\d+$/.test(one)))
      return yield* refused('GitLab reviewers are numeric user IDs; read /users with code_host_api to resolve names.')
    const now = yield* api.request({ path: base })
    if (product === 'gitlab') {
      const current = yield* decode(Schema.Struct({ reviewers: Schema.Array(Schema.Struct({ id: Schema.Number })) }), now.body)
      return {
        method: 'PUT',
        path: base,
        body: { reviewer_ids: [...new Set([...current.reviewers.map((one) => one.id), ...reviewers.map(Number)])] },
      }
    }
    if (product === 'bitbucket_cloud') {
      const current = yield* decode(Schema.Struct({ reviewers: Schema.Array(Schema.Struct({ uuid: Schema.String })) }), now.body)
      return {
        method: 'PUT',
        path: base,
        body: { reviewers: [...new Set([...current.reviewers.map((one) => one.uuid), ...reviewers])].map((uuid) => ({ uuid })) },
      }
    }
    const current = yield* decode(
      Schema.Struct({ version: Schema.Number, reviewers: Schema.Array(Schema.Struct({ user: Schema.Struct({ name: Schema.String }) })) }),
      now.body,
    )
    return {
      method: 'PUT',
      path: base,
      body: {
        version: current.version,
        reviewers: [...new Set([...current.reviewers.map((one) => one.user.name), ...reviewers])].map((name) => ({ user: { name } })),
      },
    }
  })

export const bitbucketThreadRequest = (
  product: Product,
  api: ServiceApi,
  base: string,
  id: string,
  resolved: boolean,
): Effect.Effect<ApiRequest, unknown> =>
  Effect.gen(function* () {
    const path = `${base}/comments/${encodeURIComponent(id)}`
    if (product === 'bitbucket_cloud') return { method: resolved ? 'POST' : 'DELETE', path: `${path}/resolve`, body: {} }
    if (product !== 'bitbucket_dc') return yield* refused('This host does not expose a supported resolution endpoint.')
    const current = yield* api.request({ path })
    const { version } = yield* decode(Schema.Struct({ version: Schema.Number }), current.body)
    return { method: 'PUT', path, body: { version, state: resolved ? 'RESOLVED' : 'OPEN' } }
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
        const request = yield* reviewerRequest(found.host.product, found.api, found.base, asked.reviewers ?? [], asked.teams ?? [])
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
    'Resolves or reopens a GitHub/GitLab review thread or a Bitbucket comment by its stable ID; resolved defaults to true. Requires the person’s message or errand and leaves a receipt. This resolves conversation, never approves code.',
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
              : yield* bitbucketThreadRequest(found.host.product, found.api, found.base, asked.thread, resolved)
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
    'Posts a review the person asked for directly. To post an existing card, give draft (its ID), or omit it on a review task for its latest draft; optional verdict overrides its chosen or suggested verdict. The card is updated and the review task settles. For a new review without a card, give pull_request, verdict (approve/request_changes/comment), Markdown body and the exact commit SHA reviewed; optional comments address new-side paths and lines. The current head must match. An agent cannot approve its own work or a PR Althar opened. Requires the person’s message or errand and leaves a receipt.',
    {
      pull_request: { type: ['string', 'number'] },
      draft: { type: 'string' },
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
    [],
    (input, access) =>
      Effect.gen(function* () {
        const asked = yield* decode(ReviewAsked, input)
        const sql = yield* SqlClient.SqlClient
        if (asked.draft !== undefined || (asked.pull_request === undefined && access.taskId !== null)) {
          if (asked.body !== undefined || asked.commit !== undefined || asked.comments !== undefined)
            return yield* refused(
              'Posting a draft uses the saved card. Change it with draft_review first; only verdict can be chosen here.',
            )
          const [draft] = yield* sql<{
            id: string
            url: string
            headCommit: string
            suggested: 'approve' | 'changes' | 'comment'
            verdict: 'approve' | 'changes' | 'comment' | null
            summary: string
            comments: string
          }>`
            SELECT id, url, head_commit, suggested, verdict, summary, comments FROM review_drafts
            WHERE project_id = ${access.projectId} AND (${asked.draft ?? null} IS NULL OR id = ${asked.draft ?? null})
              AND (${asked.draft ?? null} IS NOT NULL OR task_id = ${access.taskId}) ORDER BY created_at DESC, rowid DESC LIMIT 1`
          if (draft === undefined) return yield* refused('No review draft was found in this project.')
          const found = yield* pullAt(access.projectId, draft.url)
          const verdict = asked.verdict === 'request_changes' ? 'changes' : (asked.verdict ?? draft.verdict ?? draft.suggested)
          const own = yield* sql<{
            id: string
          }>`SELECT id FROM external_links WHERE kind = 'change' AND lower(url) = ${draft.url.toLowerCase()} LIMIT 1`
          const account = yield* found.host.account
          if (verdict === 'approve' && (own.length > 0 || found.change.author?.id === account.id))
            return yield* refused('An agent cannot approve its own work or a pull request Althar opened.')
          const reviews = yield* Reviews
          const actor = (yield* Instance).personId
          const act = Effect.gen(function* () {
            yield* reviews.change(draft.id, { verdict }, actor)
            const card = yield* reviews.post(draft.id, actor)
            if (card.state === 'failed') return yield* new ActionNotPerformed({ message: card.error ?? 'The host refused the review.' })
            if (card.state !== 'posted') return yield* refused(card.error ?? 'The review was not confirmed posted.')
            return JSON.stringify(card)
          })
          const read = found.host
            .change(found.repository, found.change.number)
            .pipe(
              Effect.flatMap((now) =>
                !reviewCommitMatches(draft.headCommit, now.headSha)
                  ? Effect.fail(refused('The head moved. Review the current commit and draft again before posting.'))
                  : Effect.succeed({ state: 'ready' as const, head: draft.headCommit }),
              ),
            )
          return yield* write(
            'post_review',
            access,
            asked,
            draft.url,
            { draft: draft.id, verdict, commit: draft.headCommit, summary: draft.summary, comments: draft.comments },
            act,
            read,
          )
        }
        if (asked.pull_request === undefined || asked.verdict === undefined || asked.body === undefined || asked.commit === undefined)
          return yield* refused('Give a draft ID, or pull_request, verdict, body and commit for a new review.')
        const { verdict, body, commit } = asked
        const found = yield* pullAt(access.projectId, asked.pull_request)
        if (!found.host.capabilities.reviews) return yield* refused('This host does not yet support posting reviews through its adapter.')
        const owned = yield* sql<{
          id: string
        }>`SELECT id FROM external_links WHERE kind = 'change' AND lower(url) = ${found.change.url.toLowerCase()} LIMIT 1`
        const account = yield* found.host.account
        if (asked.verdict === 'approve' && (owned.length > 0 || found.change.author?.id === account.id))
          return yield* refused('An agent cannot approve its own work or a pull request Althar opened.')
        if ((asked.comments ?? []).some((one) => !Number.isSafeInteger(one.line) || one.line < 1))
          return yield* refused('Review comment lines must be positive integers.')
        const pending = yield* sql<{
          id: string
        }>`SELECT id FROM review_drafts WHERE project_id = ${access.projectId} AND lower(url) = ${found.change.url.toLowerCase()} AND state IN ('pending', 'posting', 'uncertain') ORDER BY created_at DESC, rowid DESC LIMIT 1`
        if (pending[0] !== undefined)
          return yield* refused(
            `This pull request has review draft ${pending[0].id}; post_review with draft posts that card without leaving another review waiting.`,
          )
        const read = found.host
          .change(found.repository, found.change.number)
          .pipe(
            Effect.flatMap((now) =>
              !reviewCommitMatches(commit, now.headSha)
                ? Effect.fail(refused('The head moved. Review the current commit before posting.'))
                : Effect.succeed({ state: 'ready' as const, head: now.headSha ?? undefined }),
            ),
          )
        return yield* write(
          'post_review',
          access,
          asked,
          found.change.url,
          { verdict, body, commit, comments: asked.comments ?? [] },
          found.host
            .postReview(found.repository, found.change.number, {
              event: verdict,
              body: signed(body, null),
              commit,
              comments: asked.comments ?? [],
            })
            .pipe(Effect.map(JSON.stringify)),
          read,
        )
      }),
  ),
]
