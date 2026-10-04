import { Clock, Duration, Effect, Schema } from 'effect'

import { ConnectorFailed } from './errors'
import type { Product } from './model'

/*
 * HTTP to a service's API, the way every adapter needs it: signed in by a
 * header asked for on each call (so a refreshed token is used), bounded in
 * time, every answer checked against a schema, and every failure classified
 * (`ConnectorFailed`). A GET can be cached by its ETag, so asking "anything
 * new?" of an unchanged resource is cheap, and free of GitHub's rate limit.
 */

/** `fetch`, or a stand-in for it in tests. */
export type Fetch = (input: string, init?: RequestInit) => Promise<Response>

export interface HttpOptions {
  readonly product: Product
  readonly fetch: Fetch
  /** The `Authorization` header, asked for on each call. */
  readonly authorization: Effect.Effect<string, ConnectorFailed>
  /** Headers every call carries, such as the API's version. */
  readonly headers?: Readonly<Record<string, string>>
  readonly timeout?: Duration.Input
}

export interface Http {
  /** A JSON call, its answer read by `schema`. */
  json<A>(schema: Schema.Codec<A, unknown>, method: string, url: string, body?: unknown): Effect.Effect<A, ConnectorFailed>
  /** A JSON GET, answered from the cache when its ETag says nothing changed. */
  cached<A>(schema: Schema.Codec<A, unknown>, url: string): Effect.Effect<A, ConnectorFailed>
  /** A call whose answer is text, such as a log. */
  text(url: string): Effect.Effect<string, ConnectorFailed>
  /** A GraphQL query or mutation; its `data` read by `schema`, its `errors` classified. */
  graphql<A>(
    schema: Schema.Codec<A, unknown>,
    url: string,
    query: string,
    variables?: Readonly<Record<string, unknown>>,
  ): Effect.Effect<A, ConnectorFailed>
}

/** How much of a service's own words a failure keeps. */
const MESSAGE_KEPT = 300

const ErrorBody = Schema.Struct({
  message: Schema.optional(Schema.String),
  error: Schema.optional(Schema.Unknown),
  errors: Schema.optional(Schema.Array(Schema.Unknown)),
})

/** What a service said went wrong, from its JSON body, or the status's own words. */
const messageOf = (body: string, fallback: string): string => {
  try {
    const parsed = Schema.decodeUnknownSync(ErrorBody)(JSON.parse(body))
    const first = parsed.errors?.[0]
    const detail =
      typeof first === 'string'
        ? first
        : typeof first === 'object' && first !== null && 'message' in first && typeof first.message === 'string'
          ? first.message
          : undefined
    const said = [parsed.message, detail].filter((part) => part !== undefined && part !== '').join(': ')
    if (said !== '') return said.slice(0, MESSAGE_KEPT)
    if (typeof parsed.error === 'string') return parsed.error.slice(0, MESSAGE_KEPT)
  } catch {
    // Not JSON: the status says it.
  }
  return fallback
}

/** When a rate-limited call may be tried again, from whichever header the service sends. */
const retryAtOf = (headers: Headers, now: number): string | undefined => {
  const after = Number(headers.get('retry-after'))
  if (headers.has('retry-after') && Number.isFinite(after)) return new Date(now + after * 1000).toISOString()
  const reset = Number(headers.get('x-ratelimit-reset'))
  if (headers.has('x-ratelimit-reset') && Number.isFinite(reset)) return new Date(reset * 1000).toISOString()
  const resetMs = Number(headers.get('x-ratelimit-requests-reset'))
  if (headers.has('x-ratelimit-requests-reset') && Number.isFinite(resetMs)) return new Date(resetMs).toISOString()
  return undefined
}

/** Classifies an answer that isn't a success. */
export const failureOf = (product: Product, status: number, headers: Headers, body: string, now: number): ConnectorFailed => {
  const message = messageOf(body, `${status}`)
  const limited = status === 429 || (status === 403 && (headers.get('x-ratelimit-remaining') === '0' || headers.has('retry-after')))
  if (limited) {
    const retryAt = retryAtOf(headers, now)
    return new ConnectorFailed({ product, reason: 'rate_limited', status, message, ...(retryAt === undefined ? {} : { retryAt }) })
  }
  const reason =
    status === 401
      ? 'unauthorized'
      : status === 403
        ? 'forbidden'
        : status === 404 || status === 410
          ? 'not_found'
          : status >= 500
            ? 'unreachable'
            : 'rejected'
  return new ConnectorFailed({ product, reason, status, message })
}

const GraphqlError = Schema.Struct({
  message: Schema.String,
  type: Schema.optional(Schema.String),
  extensions: Schema.optional(Schema.Struct({ code: Schema.optional(Schema.String), type: Schema.optional(Schema.String) })),
})

/** Classifies a GraphQL `errors` entry: GitHub names a `type`, Linear an extension code. */
const graphqlFailure = (product: Product, error: typeof GraphqlError.Type): ConnectorFailed => {
  const code = (error.type ?? error.extensions?.code ?? error.extensions?.type ?? '').toUpperCase()
  const reason = /AUTHENTICATION|UNAUTHENTICATED/.test(code)
    ? 'unauthorized'
    : /RATE_?LIMIT/.test(code)
      ? 'rate_limited'
      : /FORBIDDEN/.test(code)
        ? 'forbidden'
        : /NOT_FOUND|ENTITY_NOT_FOUND/.test(code)
          ? 'not_found'
          : 'rejected'
  return new ConnectorFailed({ product, reason, message: error.message.slice(0, MESSAGE_KEPT) })
}

export const makeHttp = (options: HttpOptions): Http => {
  const { product } = options
  const timeout = options.timeout ?? Duration.seconds(30)
  /** Answers by URL, with their ETags. */
  const etags = new Map<string, { readonly etag: string; readonly body: string }>()

  const invalid = (detail: string) => new ConnectorFailed({ product, reason: 'invalid_response', message: detail.slice(0, MESSAGE_KEPT) })

  /** One call: its status, headers and body, or why it never got an answer. */
  const call = (method: string, url: string, init: { readonly body?: unknown; readonly accept?: string; readonly etag?: string }) =>
    Effect.gen(function* () {
      const authorization = yield* options.authorization
      const headers: Record<string, string> = {
        'user-agent': 'Althar',
        accept: init.accept ?? 'application/json',
        ...options.headers,
        authorization,
      }
      if (init.body !== undefined) headers['content-type'] = 'application/json'
      if (init.etag !== undefined) headers['if-none-match'] = init.etag
      const response = yield* Effect.tryPromise({
        try: (signal) =>
          options.fetch(url, {
            method,
            headers,
            signal,
            ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
          }),
        catch: (error) => new ConnectorFailed({ product, reason: 'unreachable', message: String(error).slice(0, MESSAGE_KEPT) }),
      })
      const body = yield* Effect.tryPromise({
        try: () => response.text(),
        catch: (error) => new ConnectorFailed({ product, reason: 'unreachable', message: String(error).slice(0, MESSAGE_KEPT) }),
      })
      return { status: response.status, headers: response.headers, body }
    }).pipe(
      Effect.timeoutOrElse({
        duration: timeout,
        orElse: () => Effect.fail(new ConnectorFailed({ product, reason: 'unreachable', message: 'The service did not answer in time' })),
      }),
    )

  /** An answer that should be a success, or its failure. */
  const success = (answer: { readonly status: number; readonly headers: Headers; readonly body: string }) =>
    answer.status >= 200 && answer.status < 300
      ? Effect.succeed(answer)
      : Effect.flatMap(Clock.currentTimeMillis, (now) => Effect.fail(failureOf(product, answer.status, answer.headers, answer.body, now)))

  const decode = <A>(schema: Schema.Codec<A, unknown>, body: string) =>
    Effect.try({ try: () => (body === '' ? null : (JSON.parse(body) as unknown)), catch: () => invalid('The answer was not JSON') }).pipe(
      Effect.flatMap((value) => Schema.decodeUnknownEffect(schema)(value)),
      Effect.mapError((error) => (error instanceof ConnectorFailed ? error : invalid(error.message))),
    )

  return {
    json: (schema, method, url, body) =>
      call(method, url, { body }).pipe(
        Effect.flatMap(success),
        Effect.flatMap((answer) => decode(schema, answer.body)),
      ),
    cached: (schema, url) =>
      Effect.gen(function* () {
        const known = etags.get(url)
        const answer = yield* call('GET', url, known === undefined ? {} : { etag: known.etag })
        if (answer.status === 304 && known !== undefined) return yield* decode(schema, known.body)
        const ok = yield* success(answer)
        const etag = ok.headers.get('etag')
        if (etag !== null) etags.set(url, { etag, body: ok.body })
        return yield* decode(schema, ok.body)
      }),
    text: (url) =>
      call('GET', url, { accept: '*/*' }).pipe(
        Effect.flatMap(success),
        Effect.map((answer) => answer.body),
      ),
    graphql: (schema, url, query, variables = {}) =>
      Effect.gen(function* () {
        const answer = yield* call('POST', url, { body: { query, variables } })
        // A GraphQL service may say what went wrong in a 400 or a 200 alike.
        const envelope = yield* decode(
          Schema.Struct({ data: Schema.optional(Schema.NullOr(Schema.Unknown)), errors: Schema.optional(Schema.Array(GraphqlError)) }),
          answer.body,
        ).pipe(Effect.catch(() => Effect.flatMap(success(answer), () => Effect.fail(invalid('The answer was not GraphQL')))))
        const first = envelope.errors?.[0]
        if (first !== undefined) return yield* Effect.fail(graphqlFailure(product, first))
        yield* success(answer)
        return yield* Schema.decodeUnknownEffect(schema)(envelope.data ?? null).pipe(Effect.mapError((error) => invalid(error.message)))
      }),
  }
}
