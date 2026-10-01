import { createHash, randomBytes } from 'node:crypto'

import { Clock, Duration, Effect, Schema } from 'effect'

import { ConnectorFailed, SignInEnded } from './errors'
import type { Fetch } from './http'
import type { Product } from './model'

/*
 * Signing in to a service without a secret (docs/architecture/06, "Signing
 * in"). The device flow (RFC 8628, GitHub and GitLab): the person types a
 * short code on the service's own page while Charrette waits. And OAuth with
 * PKCE (RFC 7636, Linear): the person approves in their browser, which comes
 * back to a loopback address with a code only this process can redeem.
 * Either way the service hands over a token, and maybe a refresh token; no
 * secret of Charrette's is involved.
 */

/** What a service hands over: a token, and when it expires and how to renew it, where it does. */
export interface TokenSet {
  readonly accessToken: string
  readonly refreshToken: string | null
  /** When the access token expires; null when it doesn't. */
  readonly expiresAt: string | null
  readonly scope: string | null
}

/** A device sign-in under way: the code the person types, and where. */
export interface DeviceAuthorization {
  readonly deviceCode: string
  readonly userCode: string
  readonly verificationUri: string
  /** The page with the code filled in, where the service offers one. */
  readonly verificationUriComplete: string | null
  readonly expiresAt: string
  /** Seconds between polls, as the service asks. */
  readonly interval: number
}

const TokenAnswer = Schema.Struct({
  access_token: Schema.optional(Schema.String),
  refresh_token: Schema.optional(Schema.NullOr(Schema.String)),
  expires_in: Schema.optional(Schema.NullOr(Schema.Number)),
  scope: Schema.optional(Schema.NullOr(Schema.String)),
  error: Schema.optional(Schema.String),
  error_description: Schema.optional(Schema.String),
  interval: Schema.optional(Schema.Number),
})

const DeviceAnswer = Schema.Struct({
  device_code: Schema.String,
  user_code: Schema.String,
  verification_uri: Schema.String,
  verification_uri_complete: Schema.optional(Schema.String),
  expires_in: Schema.Number,
  interval: Schema.optional(Schema.Number),
})

/** A form POST to a sign-in endpoint, its JSON answer read by `schema`, whatever its status (errors come in the body). */
const post = <A>(product: Product, fetch: Fetch, url: string, form: Readonly<Record<string, string>>, schema: Schema.Codec<A, unknown>) =>
  Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: (signal) =>
        fetch(url, {
          method: 'POST',
          headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'Charrette' },
          body: new URLSearchParams(form).toString(),
          signal,
        }),
      catch: (error) => new ConnectorFailed({ product, reason: 'unreachable', message: String(error) }),
    })
    const text = yield* Effect.tryPromise({
      try: () => response.text(),
      catch: (error) => new ConnectorFailed({ product, reason: 'unreachable', message: String(error) }),
    })
    if (response.status >= 500)
      return yield* new ConnectorFailed({ product, reason: 'unreachable', status: response.status, message: text.slice(0, 300) })
    return yield* Effect.try({ try: () => JSON.parse(text) as unknown, catch: () => undefined }).pipe(
      Effect.flatMap((value) => Schema.decodeUnknownEffect(schema)(value)),
      Effect.mapError(
        () =>
          new ConnectorFailed({
            product,
            reason: response.status === 401 ? 'unauthorized' : 'invalid_response',
            status: response.status,
            message: text.slice(0, 300),
          }),
      ),
    )
  })

const tokenSet = (product: Product, answer: typeof TokenAnswer.Type, now: number): Effect.Effect<TokenSet, ConnectorFailed> =>
  answer.access_token === undefined
    ? Effect.fail(
        new ConnectorFailed({
          product,
          reason: answer.error === 'invalid_grant' ? 'unauthorized' : 'rejected',
          message: answer.error_description ?? answer.error ?? 'No token in the answer',
        }),
      )
    : Effect.succeed({
        accessToken: answer.access_token,
        refreshToken: answer.refresh_token ?? null,
        expiresAt: answer.expires_in == null ? null : new Date(now + answer.expires_in * 1000).toISOString(),
        scope: answer.scope ?? null,
      })

/** Starts a device sign-in: the code to show the person, and where they type it. */
export const startDeviceFlow = (input: {
  readonly product: Product
  readonly fetch: Fetch
  readonly codeUrl: string
  readonly clientId: string
  readonly scope?: string
}): Effect.Effect<DeviceAuthorization, ConnectorFailed> =>
  Effect.gen(function* () {
    const answer = yield* post(
      input.product,
      input.fetch,
      input.codeUrl,
      { client_id: input.clientId, ...(input.scope === undefined ? {} : { scope: input.scope }) },
      DeviceAnswer,
    )
    const now = yield* Clock.currentTimeMillis
    return {
      deviceCode: answer.device_code,
      userCode: answer.user_code,
      verificationUri: answer.verification_uri,
      verificationUriComplete: answer.verification_uri_complete ?? null,
      expiresAt: new Date(now + answer.expires_in * 1000).toISOString(),
      interval: answer.interval ?? 5,
    }
  })

/**
 * Waits for the person to finish a device sign-in, asking the service at the
 * pace it sets, and slower when it says so. Ends with the token, or with
 * `SignInEnded` when they say no or the code expires.
 */
export const awaitDeviceFlow = (input: {
  readonly product: Product
  readonly fetch: Fetch
  readonly tokenUrl: string
  readonly clientId: string
  readonly authorization: DeviceAuthorization
}): Effect.Effect<TokenSet, ConnectorFailed | SignInEnded> =>
  Effect.gen(function* () {
    let interval = input.authorization.interval
    const expiresAt = Date.parse(input.authorization.expiresAt)
    for (;;) {
      yield* Effect.sleep(Duration.seconds(interval))
      const now = yield* Clock.currentTimeMillis
      if (now >= expiresAt) return yield* new SignInEnded({ product: input.product, reason: 'expired' })
      const answer = yield* post(
        input.product,
        input.fetch,
        input.tokenUrl,
        {
          client_id: input.clientId,
          device_code: input.authorization.deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        },
        TokenAnswer,
      )
      switch (answer.error) {
        case 'authorization_pending':
          continue
        case 'slow_down':
          interval = answer.interval ?? interval + 5
          continue
        case 'expired_token':
          return yield* new SignInEnded({ product: input.product, reason: 'expired' })
        case 'access_denied':
          return yield* new SignInEnded({ product: input.product, reason: 'denied' })
        default:
          return yield* tokenSet(input.product, answer, now)
      }
    }
  })

/** Renews a token with its refresh token. Device-flow tokens need no secret to renew. */
export const refreshToken = (input: {
  readonly product: Product
  readonly fetch: Fetch
  readonly tokenUrl: string
  readonly clientId: string
  readonly refreshToken: string
}): Effect.Effect<TokenSet, ConnectorFailed> =>
  Effect.gen(function* () {
    const answer = yield* post(
      input.product,
      input.fetch,
      input.tokenUrl,
      { client_id: input.clientId, grant_type: 'refresh_token', refresh_token: input.refreshToken },
      TokenAnswer,
    )
    const set = yield* tokenSet(input.product, answer, yield* Clock.currentTimeMillis)
    // A service that doesn't rotate refresh tokens keeps the one it had.
    return set.refreshToken === null ? { ...set, refreshToken: input.refreshToken } : set
  })

/** A PKCE pair: the verifier this process keeps, and the challenge the browser carries. */
export interface Pkce {
  readonly verifier: string
  readonly challenge: string
  readonly state: string
}

const base64url = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url')

export const makePkce = (): Pkce => {
  const verifier = base64url(randomBytes(32))
  return { verifier, challenge: base64url(createHash('sha256').update(verifier).digest()), state: base64url(randomBytes(16)) }
}

/** The page the person approves on. */
export const authorizeUrl = (input: {
  readonly authorizeUrl: string
  readonly clientId: string
  readonly redirectUri: string
  readonly scope: string
  readonly pkce: Pkce
  readonly extra?: Readonly<Record<string, string>>
}): string => {
  const url = new URL(input.authorizeUrl)
  url.search = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: 'code',
    scope: input.scope,
    state: input.pkce.state,
    code_challenge: input.pkce.challenge,
    code_challenge_method: 'S256',
    ...input.extra,
  }).toString()
  return url.toString()
}

/** Redeems the code the browser came back with. */
export const exchangeCode = (input: {
  readonly product: Product
  readonly fetch: Fetch
  readonly tokenUrl: string
  readonly clientId: string
  readonly redirectUri: string
  readonly code: string
  readonly pkce: Pkce
}): Effect.Effect<TokenSet, ConnectorFailed> =>
  Effect.gen(function* () {
    const answer = yield* post(
      input.product,
      input.fetch,
      input.tokenUrl,
      {
        client_id: input.clientId,
        grant_type: 'authorization_code',
        code: input.code,
        redirect_uri: input.redirectUri,
        code_verifier: input.pkce.verifier,
      },
      TokenAnswer,
    )
    return yield* tokenSet(input.product, answer, yield* Clock.currentTimeMillis)
  })
