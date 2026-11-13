import { Effect, Schema } from 'effect'
import { Kind, parse, visit } from 'graphql'

import { type AdapterOptions, authorizationOf } from './credential'
import { ConnectorFailed } from './errors'
import { GraphqlError, graphqlFailure, makeHttp } from './http'
import type { Product } from './model'
import { uploadIssueAttachment } from './issueAttachments'

/** Requests use the connection's API root, never a caller-supplied origin or credential. */
export interface ApiRequest {
  /** Jira's separately rooted public APIs; omitted for the connection's core API. */
  readonly namespace?: 'agile' | 'service_desk' | undefined
  readonly method?: string | undefined
  readonly path?: string | undefined
  readonly body?: unknown
  readonly query?: string | undefined
  readonly variables?: Readonly<Record<string, unknown>> | undefined
}

export interface ApiPlan {
  readonly method: string
  readonly path: string
  readonly url: string
  readonly write: boolean
  readonly body?: unknown
  readonly graphql: boolean
}

export interface ApiResponse {
  readonly status: number
  readonly body: unknown
  /** A relative path on this connection, or null. GraphQL carries its own pageInfo. */
  readonly next: string | null
}

export interface ServiceApi {
  prepare(request: ApiRequest): Effect.Effect<ApiPlan, ConnectorFailed>
  request(request: ApiRequest): Effect.Effect<ApiResponse, ConnectorFailed>
  uploadAttachment(issue: string, filename: string, mediaType: string, bytes: Uint8Array): Effect.Effect<ApiResponse, ConnectorFailed>
}

// These families control credentials, agents' authority, repository content or the verdict on their own work.
const PRIVATE =
  /(?:^|\/)(?:secrets|tokens?|access[_-]?tokens?|api[_-]?keys?|authorizations|hooks|webhooks|deploy[_-]?keys|runners|credentials)(?:\/|$)/i
const ADMIN = /(?:^|\/)(?:protection|rulesets?|collaborators|permissions|members|invitations|settings|variables|environments)(?:\/|$)/i
const CODE = /(?:^|\/)(?:contents|git|repository\/(?:files|commits|branches|tags)|src|commits|refs|branches|tags)(?:\/|$)/i
const VERDICTS = /(?:^|\/)(?:check-runs|check-suites|statuses|approve|approvals|request-changes|participants|merge|reviews)(?:\/|$)/i
const GRAPH_PRIVATE = /secret|token|apikey|authorization|webhook|deploykey|credential|runner/i
const GRAPH_ADMIN =
  /protection|ruleset|collaborator|permission|invitation|organizationmember|repositorysettings|^(?:(?:create|update|delete)Repository|(?:organization|team|user|oauthclient|oauthapplication)(?:Create|Update|Delete|Archive))$/i
const GRAPH_CODE = /(?:create|update|delete)(?:commit|tree|blob|ref)|createcommitonbranch/i
const GRAPH_VERDICT =
  /checkrun|checksuite|commitstatus|pullrequestreview|mergerequestrequestchanges|mergerequestapprove|merg(?:e|ing)pullrequest|enqueuepullrequest|pullrequestautomerge/i
const hasControl = (text: string) => {
  for (let at = 0; at < text.length; at++) if (text.charCodeAt(at) < 32) return true
  return false
}
const rootOf = (value: string, product: Product, namespace?: ApiRequest['namespace']) => {
  let end = value.length
  while (end > 0 && value[end - 1] === '/') end--
  const root = new URL(`${value.slice(0, end)}/`)
  if (namespace !== undefined) {
    if (
      !['agile', 'service_desk'].includes(namespace) ||
      !['jira_cloud', 'jira_dc'].includes(product) ||
      !/\/rest\/api\/[23]\/$/.test(root.pathname)
    )
      throw new Error('API namespaces are available only on Jira connections.')
    root.pathname = root.pathname.replace(/\/rest\/api\/[23]\/$/, namespace === 'agile' ? '/rest/agile/1.0/' : '/rest/servicedeskapi/')
  }
  return root
}

/** Parse before authorization: GraphQL POST is a read only when its sole operation is a query. */
export const prepareApi = (product: Product, apiRoot: string, request: ApiRequest): Effect.Effect<ApiPlan, ConnectorFailed> =>
  Effect.try({
    try: () => {
      const root = rootOf(apiRoot, product, request.namespace)
      if (root.protocol !== 'https:' && root.hostname !== 'localhost' && root.hostname !== '127.0.0.1')
        throw new Error('An API connection must use HTTPS.')
      if (request.query !== undefined) {
        if (request.namespace !== undefined) throw new Error('GraphQL does not take a Jira API namespace.')
        if (request.path !== undefined || request.body !== undefined || (request.method !== undefined && request.method !== 'POST'))
          throw new Error('A GraphQL call takes query and variables, without path, body or another method.')
        if (!['linear', 'github', 'gitlab'].includes(product)) throw new Error('This service has no GraphQL API.')
        const document = parse(request.query, { maxTokens: 10000 })
        const operations = document.definitions.filter((one) => one.kind === Kind.OPERATION_DEFINITION)
        const operation = operations[0]
        if (operations.length !== 1 || operation === undefined || operation.operation === 'subscription')
          throw new Error('Send exactly one query or mutation, never a subscription.')
        const write = operation.operation === 'mutation'
        if (write && (operation.selectionSet.selections.length !== 1 || operation.selectionSet.selections[0]?.kind !== Kind.FIELD))
          throw new Error('Send one mutation field per call so a partial batch cannot be mistaken for a failed write.')
        visit(document, {
          Field(node) {
            const name = node.name.value
            if (GRAPH_PRIVATE.test(name) || (write && (GRAPH_ADMIN.test(name) || GRAPH_CODE.test(name) || GRAPH_VERDICT.test(name))))
              throw new Error(`The API fallback cannot call ${name}; use the dedicated tool where there is one.`)
          },
        })
        const url =
          product === 'gitlab'
            ? new URL(root.pathname.replace(/api\/v4\/$/, 'api/graphql'), root.origin)
            : new URL(root.pathname.replace(/api\/v3\/$/, 'api/') + 'graphql', root.origin)
        return {
          method: 'POST',
          path: url.pathname,
          url: url.href,
          write,
          body: { query: request.query, variables: request.variables ?? {} },
          graphql: true,
        }
      }
      if (product === 'linear') throw new Error('Linear calls take a GraphQL query or mutation.')
      const path = request.path ?? ''
      if (!path.startsWith('/') || path.startsWith('//') || /[\\#]/.test(path) || hasControl(path))
        throw new Error('Give a relative API path starting with one slash, without fragments or backslashes.')
      const decoded = decodeURIComponent(path.split('?')[0] ?? '')
      if (/[\\#]/.test(decoded) || hasControl(decoded)) throw new Error('The decoded API path contains a forbidden character.')
      if (/%[0-9a-f]{2}/i.test(decoded) || decoded.split('/').some((part) => part === '.' || part === '..'))
        throw new Error('API paths cannot contain traversal or double encoding.')
      const method = (request.method ?? 'GET').toUpperCase()
      if (!['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) throw new Error('Unsupported API method.')
      const write = method !== 'GET' && method !== 'HEAD'
      if (!write && request.body !== undefined) throw new Error('A read takes no request body.')
      if (/\/graphql\/?$/i.test(decoded)) throw new Error('GraphQL calls must use query so their operation can be checked.')
      if (
        PRIVATE.test(decoded) ||
        (write &&
          (ADMIN.test(decoded) ||
            CODE.test(decoded) ||
            VERDICTS.test(decoded) ||
            /^\/(?:repos\/[^/]+\/[^/]+|projects\/[^/]+|repositories\/[^/]+\/[^/]+)\/?$/i.test(path.split('?')[0] ?? '')))
      )
        throw new Error('This API family is kept outside the fallback; use the dedicated tool where there is one.')
      const url = new URL(path.slice(1), root)
      if (url.origin !== root.origin || !url.pathname.startsWith(root.pathname)) throw new Error('The API path leaves this connection.')
      return { method, path, url: url.href, write, ...(request.body === undefined ? {} : { body: request.body }), graphql: false }
    },
    catch: (error) =>
      new ConnectorFailed({ product, reason: 'rejected', message: error instanceof Error ? error.message : 'Invalid API call.' }),
  })

/** Authenticated, bounded calls. No redirects: neither a token nor a mutation is replayed elsewhere. */
export const makeServiceApi = (product: Product, options: AdapterOptions): ServiceApi => {
  const http = makeHttp({
    product,
    fetch: options.fetch,
    authorization: Effect.map(options.credential, authorizationOf),
    ...(product === 'github' ? { headers: { 'X-GitHub-Api-Version': '2022-11-28' } } : {}),
  })
  const prepare = (request: ApiRequest) => prepareApi(product, options.apiUrl, request)
  const api: ServiceApi = {
    prepare,
    uploadAttachment: (issue, filename, mediaType, bytes) =>
      uploadIssueAttachment(product, options, api, issue, filename, mediaType, bytes),
    request: (request) =>
      Effect.gen(function* () {
        const plan = yield* prepare(request)
        const response = yield* http.request(plan.method, plan.url, plan.body)
        if (plan.graphql) {
          const envelope = yield* Schema.decodeUnknownEffect(
            Schema.Struct({ data: Schema.optional(Schema.Unknown), errors: Schema.optional(Schema.Array(GraphqlError)) }),
          )(response.body).pipe(
            Effect.mapError(() => new ConnectorFailed({ product, reason: 'invalid_response', message: 'The API did not return GraphQL.' })),
          )
          const error = envelope.errors?.[0]
          if (error !== undefined)
            return yield* plan.write && envelope.data !== undefined && envelope.data !== null
              ? new ConnectorFailed({
                  product,
                  reason: 'invalid_response',
                  message: 'GraphQL returned a partial mutation result; its outcome is uncertain.',
                })
              : graphqlFailure(product, error, response.status)
          if (envelope.data === undefined || envelope.data === null || typeof envelope.data !== 'object')
            return yield* new ConnectorFailed({
              product,
              reason: 'invalid_response',
              message: 'GraphQL returned no data; a write’s outcome is uncertain.',
            })
          return { status: response.status, body: envelope.data ?? null, next: null }
        }
        const linked = /<([^>]+)>;\s*rel="next"/.exec(response.headers.get('link') ?? '')?.[1]
        const next = linked === undefined ? null : new URL(linked, plan.url)
        const root = rootOf(options.apiUrl, product, request.namespace)
        return {
          status: response.status,
          body: response.body,
          next:
            next !== null && next.origin === root.origin && next.pathname.startsWith(root.pathname)
              ? `/${next.pathname.slice(root.pathname.length)}${next.search}`
              : null,
        }
      }),
  }
  return api
}
