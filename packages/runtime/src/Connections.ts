import { createServer, type Server } from 'node:http'

import {
  type Account,
  addressOf,
  authorizeUrl,
  awaitDeviceFlow,
  type CodeHost,
  ConnectorFailed,
  type Credential,
  exchangeCode,
  hostedOf,
  type KnownHosts,
  type LinkRef,
  makePkce,
  parseLink,
  parseRemote,
  type Product,
  type ProductInfo,
  refreshToken,
  SignInEnded,
  startDeviceFlow,
  type TokenSet,
  type Tracker,
} from '@althar/connectors'
import { type ActorId, Ids, newId } from '@althar/domain'
import { Cause, Clock, Context, type Crypto, Deferred, Duration, Effect, Exit, Fiber, Layer, Option, Schema, Semaphore } from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'
import type { Ledger } from '@althar/persistence-sqlite'

import { Connectors } from './Config'
import { NotFound } from './errors'
import { Instance } from './Instance'
import { change, fact, timestamp } from './records'
import { Secrets, SecretsUnavailable } from './Secrets'

/*
 * Connections to code hosts and trackers (docs/architecture/06, ADR-011): a
 * person's sign-in to a service, on this device. Signing in is the service's
 * own, where it gives a desktop app a token without a secret (GitHub's
 * device flow, Linear's browser sign-in with PKCE), or a token the person
 * pastes. The token goes to the keychain; the store keeps which product,
 * which instance, which account, and the name the token is kept under.
 *
 * An adapter asks for its credential on each call: a token about to expire is
 * renewed first, one at a time per connection. When a service says the token
 * is no good, the connection needs its person to sign in again, and says so.
 */

/** No connection reaches what was asked for: a product no one connected, or an instance. */
export class NotConnected extends Schema.TaggedError<NotConnected>()('NotConnected', {
  product: Schema.String,
  /** What it was for: a repository's remote, a link. */
  what: Schema.String,
}) {}

/** The product has no browser sign-in here: Althar's app isn't registered with it, so it takes a pasted token. */
export class SignInUnavailable extends Schema.TaggedError<SignInUnavailable>()('SignInUnavailable', {
  product: Schema.String,
}) {}

export interface ConnectionInfo {
  readonly id: string
  readonly product: Product
  readonly name: string
  readonly webUrl: string
  readonly account: { readonly id: string; readonly login: string; readonly name: string | null }
  readonly auth: 'device_flow' | 'pkce' | 'token'
  readonly state: 'ready' | 'reauth_required'
}

export type SignInStart =
  | {
      readonly flowId: string
      readonly kind: 'device'
      readonly userCode: string
      readonly verificationUri: string
      readonly expiresAt: string
    }
  | { readonly flowId: string; readonly kind: 'browser'; readonly url: string }

export type SignInState =
  | { readonly state: 'waiting' }
  | { readonly state: 'done'; readonly connectionId: string }
  | { readonly state: 'ended'; readonly reason: 'denied' | 'expired' | 'failed'; readonly message: string }

/** What the keychain holds for a connection. */
const Stored = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal('oauth'),
    accessToken: Schema.String,
    refreshToken: Schema.NullOr(Schema.String),
    expiresAt: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({ kind: Schema.Literal('token'), token: Schema.String, user: Schema.NullOr(Schema.String) }),
])
type Stored = typeof Stored.Type

/**
 * The credential a kept secret makes: an OAuth token is sent as a bearer; a
 * pasted one as its product sends them (a bearer, a key as it is, or with the
 * account's email).
 */
export const credentialFor = (kind: Credential['kind'], kept: Stored): Credential => {
  if (kept.kind === 'oauth') return { kind: 'bearer', token: kept.accessToken }
  return kind === 'basic' ? { kind, user: kept.user ?? '', token: kept.token } : { kind, token: kept.token }
}

interface Row {
  readonly id: string
  readonly product: Product
  readonly webUrl: string
  readonly apiUrl: string
  readonly accountLogin: string
  readonly accountName: string | null
  readonly accountId: string
  readonly auth: ConnectionInfo['auth']
  readonly credentialRef: string
  readonly state: 'ready' | 'reauth_required' | 'removed'
}

/** A token is renewed this long before it expires. */
const RENEW_BEFORE = Duration.minutes(5)
/** A browser sign-in waits this long for the person. */
const BROWSER_WAIT = Duration.minutes(10)

type Store = SqlClient.SqlClient | Instance | Ledger | Crypto.Crypto | Secrets | Connectors

export interface Adapters {
  readonly host?: CodeHost
  readonly tracker?: Tracker
}

export class Connections extends Context.Service<
  Connections,
  {
    /** The connections on this device, and the products a person can connect. */
    readonly list: Effect.Effect<ReadonlyArray<ConnectionInfo>, unknown>
    readonly products: ReadonlyArray<ProductInfo & { readonly browserSignIn: boolean }>
    startSignIn(input: {
      readonly product: Product
      readonly webUrl?: string
      readonly actorId: ActorId
    }): Effect.Effect<SignInStart, unknown>
    signIn(flowId: string): Effect.Effect<SignInState, NotFound>
    cancelSignIn(flowId: string): Effect.Effect<void>
    connectToken(input: {
      readonly product: Product
      readonly webUrl?: string
      readonly user?: string
      readonly token: string
      readonly actorId: ActorId
    }): Effect.Effect<ConnectionInfo, unknown>
    remove(connectionId: string, actorId: ActorId): Effect.Effect<void, unknown>
    /** A connection's adapters, signed in through it. */
    adapters(connectionId: string): Effect.Effect<Adapters & { readonly info: ConnectionInfo }, unknown>
    /** The code host a repository's remotes are on, through a ready connection that reaches it. */
    hostOf(
      remotes: ReadonlyArray<string>,
    ): Effect.Effect<{ readonly connectionId: string; readonly host: CodeHost; readonly path: ReadonlyArray<string> } | null, unknown>
    /** What a link points at, and the connection that reaches it; null for a link no connection reaches. */
    resolve(link: string): Effect.Effect<({ readonly connectionId: string; readonly ref: LinkRef } & Adapters) | null, unknown>
    /** Every ready tracker: each connection's, for listing someone's issues. */
    readonly trackers: Effect.Effect<
      ReadonlyArray<{ readonly connectionId: string; readonly product: Product; readonly tracker: Tracker }>,
      unknown
    >
  }
>()('@althar/runtime/Connections') {
  static readonly layer: Layer.Layer<Connections, never, Store> = Layer.effect(
    Connections,
    Effect.gen(function* () {
      const context = yield* Effect.context<Store>()
      const instance = yield* Instance
      const secrets = yield* Secrets
      const connectors = yield* Connectors
      const provide = <A, E>(effect: Effect.Effect<A, E, Store>) => Effect.provideContext(effect, context)
      const infoOf = (product: Product) => connectors.products.find((candidate) => candidate.product === product)

      const rows = Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        return yield* sql<Row>`
          SELECT id, product, web_url, api_url, account_login, account_name, account_id, auth, credential_ref, state
          FROM connections WHERE device_id = ${instance.deviceId} AND state <> 'removed' ORDER BY created_at`
      })

      const toInfo = (row: Row): ConnectionInfo => ({
        id: row.id,
        product: row.product,
        name: infoOf(row.product)?.name ?? row.product,
        webUrl: row.webUrl,
        account: { id: row.accountId, login: row.accountLogin, name: row.accountName },
        auth: row.auth,
        state: row.state === 'reauth_required' ? 'reauth_required' : 'ready',
      })

      const rowOf = (connectionId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [row] = yield* sql<Row>`
            SELECT id, product, web_url, api_url, account_login, account_name, account_id, auth, credential_ref, state
            FROM connections WHERE id = ${connectionId}`
          return row === undefined || row.state === 'removed' ? yield* new NotFound({ kind: 'connection', id: connectionId }) : row
        })

      /** A connection's state moves on, with a fact the window hears. */
      const moveTo = (row: Row, state: Row['state'], type: string, actorId: ActorId, set: Readonly<Record<string, unknown>> = {}) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          yield* sql.withTransaction(
            Effect.gen(function* () {
              const revision = yield* change('connections', row.id, { state, updatedAt: yield* timestamp, ...set })
              yield* fact({ aggregateType: 'connection', aggregateId: row.id, revision, type, payload: { product: row.product }, actorId })
            }),
          )
        })

      const stored = (row: Row) =>
        Effect.gen(function* () {
          const raw = yield* secrets.get(row.credentialRef)
          if (raw === null)
            return yield* new ConnectorFailed({ product: row.product, reason: 'unauthorized', message: 'No token in the keychain' })
          return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Stored))(raw).pipe(
            Effect.mapError(
              () => new ConnectorFailed({ product: row.product, reason: 'unauthorized', message: 'The keychain’s token is unreadable' }),
            ),
          )
        })

      const credentialFrom = (product: Product, kept: Stored): Credential => credentialFor(infoOf(product)?.token.kind ?? 'bearer', kept)

      /** Renewals, one at a time per connection, so a rotated refresh token is never used twice. */
      const renewing = new Map<string, Semaphore.Semaphore>()
      const renewLock = (connectionId: string) => {
        const known = renewing.get(connectionId)
        if (known !== undefined) return known
        const made = Semaphore.makeUnsafe(1)
        renewing.set(connectionId, made)
        return made
      }

      /** The tokens' renewal endpoint, for a product signed in through the browser. */
      const tokenUrlOf = (product: Product, webUrl: string) => {
        const browser = infoOf(product)?.browser
        return browser == null ? undefined : browser.kind === 'device' ? browser.tokenUrl(webUrl) : browser.tokenUrl
      }

      /** The credential to call with now: renewed first when it is about to expire. */
      const credential = (
        connectionId: string,
      ): Effect.Effect<Credential, ConnectorFailed | SecretsUnavailable | NotFound | SqlError.SqlError, Store> =>
        Effect.gen(function* () {
          const row = yield* rowOf(connectionId)
          const kept = yield* stored(row)
          if (kept.kind === 'token' || kept.expiresAt === null || kept.refreshToken === null) return credentialFrom(row.product, kept)
          const now = yield* Clock.currentTimeMillis
          if (Date.parse(kept.expiresAt) - now > Duration.toMillis(RENEW_BEFORE)) return credentialFrom(row.product, kept)
          return yield* renewLock(connectionId).withPermits(1)(
            Effect.gen(function* () {
              // Another call may have renewed it while this one waited.
              const again = yield* stored(row)
              if (again.kind === 'oauth' && again.expiresAt !== null && Date.parse(again.expiresAt) - now > Duration.toMillis(RENEW_BEFORE))
                return credentialFrom(row.product, again)
              const clientId = connectors.clientIds[row.product]
              const tokenUrl = tokenUrlOf(row.product, row.webUrl)
              if (clientId === undefined || tokenUrl === undefined || again.kind !== 'oauth' || again.refreshToken === null)
                return yield* new ConnectorFailed({
                  product: row.product,
                  reason: 'unauthorized',
                  message: 'The token expired and can’t be renewed here',
                })
              const renewed = yield* refreshToken({
                product: row.product,
                fetch: connectors.fetch,
                tokenUrl,
                clientId,
                refreshToken: again.refreshToken,
              })
              yield* keep(row.credentialRef, renewed)
              const sql = yield* SqlClient.SqlClient
              yield* sql`UPDATE connections SET expires_at = ${renewed.expiresAt}, updated_at = ${yield* timestamp} WHERE id = ${row.id}`
              return credentialFrom(row.product, { kind: 'oauth', ...renewed })
            }),
          )
        })

      const keep = (name: string, value: TokenSet | { readonly token: string; readonly user: string | null }) =>
        secrets.set(name, JSON.stringify('accessToken' in value ? { kind: 'oauth', ...value } : { kind: 'token', ...value }))

      /** A service said the token is no good: the connection needs its person to sign in again. */
      const unauthorized = (connectionId: string) =>
        Effect.gen(function* () {
          const row = yield* rowOf(connectionId)
          if (row.state === 'ready') yield* moveTo(row, 'reauth_required', 'connection.reauth_required', instance.systemId)
          adapterCache.delete(connectionId)
        }).pipe(Effect.ignore)

      /**
       * An adapter whose every call, on failing as unauthorized, marks its
       * connection. Each of an adapter's members is an Effect or a function
       * returning one (the models say so), which is what makes wrapping them
       * all alike sound.
       */
      const guarded = <T extends object>(adapter: T, connectionId: string): T => {
        const watch = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
          Effect.tapError(effect, (error) =>
            error instanceof ConnectorFailed && error.reason === 'unauthorized' ? provide(unauthorized(connectionId)) : Effect.void,
          )
        const wrapped: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(adapter)) {
          wrapped[key] = Effect.isEffect(value)
            ? watch(value)
            : typeof value === 'function'
              ? (...args: ReadonlyArray<unknown>) => {
                  const result: unknown = value(...args)
                  return Effect.isEffect(result) ? watch(result) : result
                }
              : value
        }
        return wrapped as T
      }

      const adapterCache = new Map<string, Adapters>()
      const adaptersOf = (row: Row): Adapters => {
        const known = adapterCache.get(row.id)
        if (known !== undefined) return known
        const made = infoOf(row.product)?.make?.({
          fetch: connectors.fetch,
          apiUrl: row.apiUrl,
          webUrl: row.webUrl,
          credential: provide(credential(row.id)).pipe(
            Effect.mapError((error) =>
              error instanceof ConnectorFailed
                ? error
                : // A sign-in Althar can't open here isn't one that stopped working: the connection keeps its state.
                  error instanceof SecretsUnavailable
                  ? new ConnectorFailed({
                      product: row.product,
                      reason: 'unreachable',
                      message: `Althar couldn’t open its sign-in: ${error.reason}`,
                    })
                  : new ConnectorFailed({ product: row.product, reason: 'unauthorized', message: String(error) }),
            ),
          ),
        })
        const adapters: Adapters = {
          ...(made?.host === undefined ? {} : { host: guarded(made.host, row.id) }),
          ...(made?.tracker === undefined ? {} : { tracker: guarded(made.tracker, row.id) }),
        }
        adapterCache.set(row.id, adapters)
        return adapters
      }

      /** Adds a connection, or renews one for the same account, once its credential has said who it signs in as. */
      const save = (input: {
        readonly product: Product
        readonly webUrl: string
        readonly auth: ConnectionInfo['auth']
        readonly secret: TokenSet | { readonly token: string; readonly user: string | null }
        readonly actorId: ActorId
      }) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const info = infoOf(input.product)
          if (info?.make == null)
            return yield* new NotConnected({ product: input.product, what: 'a product Althar has no adapter for yet' })
          // The address as the product keeps it: a Jira Cloud site by its origin, whatever page of it was pasted.
          const webUrl = addressOf(info, input.webUrl)
          const apiUrl = info.apiFor(webUrl)
          const credential: Credential =
            'accessToken' in input.secret
              ? { kind: 'bearer', token: input.secret.accessToken }
              : credentialFrom(input.product, { kind: 'token', ...input.secret })
          const made = info.make({ fetch: connectors.fetch, apiUrl, webUrl, credential: Effect.succeed(credential) })
          const account: Account = yield* (
            (made.host ?? made.tracker)?.account ?? Effect.fail(new NotConnected({ product: input.product, what: 'an account' }))
          )
          const at = yield* timestamp
          const [existing] = yield* sql<Row>`
            SELECT id, product, web_url, api_url, account_login, account_name, account_id, auth, credential_ref, state FROM connections
            WHERE device_id = ${instance.deviceId} AND product = ${input.product} AND web_url = ${webUrl} AND account_id = ${account.id}
              AND state <> 'removed'`
          const id = existing?.id ?? (yield* newId(Ids.connection))
          const credentialRef = existing?.credentialRef ?? id
          yield* keep(credentialRef, input.secret)
          const expiresAt = 'accessToken' in input.secret ? input.secret.expiresAt : null
          yield* sql.withTransaction(
            Effect.gen(function* () {
              if (existing === undefined) {
                yield* sql`INSERT INTO connections ${sql.insert({
                  id,
                  deviceId: instance.deviceId,
                  product: input.product,
                  webUrl,
                  apiUrl,
                  accountId: account.id,
                  accountLogin: account.login,
                  accountName: account.name,
                  auth: input.auth,
                  credentialRef,
                  expiresAt,
                  state: 'ready',
                  createdAt: at,
                  updatedAt: at,
                })}`
                yield* fact({
                  aggregateType: 'connection',
                  aggregateId: id,
                  revision: 1,
                  type: 'connection.added',
                  payload: { product: input.product, webUrl, account: account.login, auth: input.auth },
                  actorId: input.actorId,
                })
              } else {
                const revision = yield* change('connections', id, {
                  state: 'ready',
                  auth: input.auth,
                  accountLogin: account.login,
                  accountName: account.name,
                  expiresAt,
                  updatedAt: at,
                })
                yield* fact({
                  aggregateType: 'connection',
                  aggregateId: id,
                  revision,
                  type: 'connection.renewed',
                  payload: { product: input.product, auth: input.auth },
                  actorId: input.actorId,
                })
              }
            }),
          )
          adapterCache.delete(id)
          return toInfo(yield* rowOf(id))
        })

      /* Sign-ins under way, by flow id. They live as long as the runtime; one that ends is kept for its window to read. */
      const flows = new Map<string, { state: SignInState; fiber?: Fiber.Fiber<unknown, unknown> }>()
      const flowScope = yield* Effect.scope

      const ended = (flowId: string, error: unknown) => {
        const flow = flows.get(flowId)
        if (flow === undefined) return
        flow.state =
          error instanceof SignInEnded
            ? { state: 'ended', reason: error.reason, message: error.reason === 'denied' ? 'Sign-in was declined.' : 'The code expired.' }
            : { state: 'ended', reason: 'failed', message: error instanceof ConnectorFailed ? error.message : 'Sign-in didn’t finish.' }
      }

      /** Runs a sign-in to its end in the background, recording how it went. */
      const follow = (flowId: string, effect: Effect.Effect<ConnectionInfo, unknown, Store>) =>
        Effect.gen(function* () {
          const fiber = yield* Effect.forkIn(
            provide(effect).pipe(
              Effect.onExit((exit) =>
                Effect.sync(() => {
                  const flow = flows.get(flowId)
                  if (flow === undefined) return
                  if (exit._tag === 'Success') flow.state = { state: 'done', connectionId: exit.value.id }
                  else if (!Cause.hasInterruptsOnly(exit.cause)) ended(flowId, Option.getOrUndefined(Cause.findErrorOption(exit.cause)))
                }),
              ),
            ),
            flowScope,
          )
          flows.set(flowId, { state: { state: 'waiting' }, fiber })
        })

      /**
       * Listens on the loopback address for the browser to come back with its
       * code, answering it with a page to close; listening before the address
       * is handed out, so a quick browser finds it there.
       */
      const listenForCode = (port: number, state: string, productName: string) =>
        Effect.callback<{ readonly code: Deferred.Deferred<string>; readonly close: Effect.Effect<void> }, ConnectorFailed>((resume) => {
          const code = Deferred.makeUnsafe<string>()
          const server: Server = createServer((req, res) => {
            const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)
            if (url.pathname !== '/callback') return void res.writeHead(404).end()
            const given = url.searchParams.get('code')
            const ok = given !== null && url.searchParams.get('state') === state
            res.writeHead(ok ? 200 : 400, { 'content-type': 'text/html; charset=utf-8' })
            res.end(
              `<!doctype html><meta charset="utf-8"><title>Althar</title><body style="font:15px system-ui;margin:3rem">${
                ok ? `Signed in to ${productName}. You can close this tab and go back to Althar.` : 'That sign-in didn’t come from Althar.'
              }</body>`,
            )
            if (ok) Deferred.doneUnsafe(code, Exit.succeed(given))
          })
          server.once('error', (error) =>
            resume(
              Effect.fail(
                new ConnectorFailed({ product: 'linear', reason: 'unreachable', message: `Port ${port} is busy: ${error.message}` }),
              ),
            ),
          )
          server.listen(port, '127.0.0.1', () => resume(Effect.succeed({ code, close: Effect.sync(() => void server.close()) })))
        })

      const startSignIn = (input: { readonly product: Product; readonly webUrl?: string; readonly actorId: ActorId }) =>
        Effect.gen(function* () {
          const info = infoOf(input.product)
          const clientId = connectors.clientIds[input.product]
          const webUrl = info === undefined ? '' : addressOf(info, input.webUrl ?? info.hosted?.webUrl ?? '')
          if (info?.browser == null || clientId === undefined || webUrl === '')
            return yield* new SignInUnavailable({ product: input.product })
          const flowId = yield* newId(Ids.command)
          if (info.browser.kind === 'device') {
            const browser = info.browser
            const authorization = yield* startDeviceFlow({
              product: input.product,
              fetch: connectors.fetch,
              codeUrl: browser.codeUrl(webUrl),
              clientId,
              ...(browser.scope === undefined ? {} : { scope: browser.scope }),
            })
            yield* follow(
              flowId,
              Effect.gen(function* () {
                const token = yield* awaitDeviceFlow({
                  product: input.product,
                  fetch: connectors.fetch,
                  tokenUrl: browser.tokenUrl(webUrl),
                  clientId,
                  authorization,
                })
                return yield* save({ product: input.product, webUrl, auth: 'device_flow', secret: token, actorId: input.actorId })
              }),
            )
            return {
              flowId,
              kind: 'device',
              userCode: authorization.userCode,
              verificationUri: authorization.verificationUriComplete ?? authorization.verificationUri,
              expiresAt: authorization.expiresAt,
            } satisfies SignInStart
          }
          const browser = info.browser
          const pkce = makePkce()
          const redirectUri = `http://127.0.0.1:${connectors.callbackPort}/callback`
          const listening = yield* listenForCode(connectors.callbackPort, pkce.state, info.name)
          yield* follow(
            flowId,
            Effect.gen(function* () {
              const code = yield* Deferred.await(listening.code).pipe(
                Effect.timeoutOrElse({
                  duration: BROWSER_WAIT,
                  orElse: () => Effect.fail(new SignInEnded({ product: input.product, reason: 'expired' })),
                }),
              )
              const token = yield* exchangeCode({
                product: input.product,
                fetch: connectors.fetch,
                tokenUrl: browser.tokenUrl,
                clientId,
                redirectUri,
                code,
                pkce,
              })
              return yield* save({ product: input.product, webUrl, auth: 'pkce', secret: token, actorId: input.actorId })
            }).pipe(Effect.ensuring(listening.close)),
          )
          return {
            flowId,
            kind: 'browser',
            url: authorizeUrl({
              authorizeUrl: browser.authorizeUrl,
              clientId,
              redirectUri,
              scope: browser.scope,
              pkce,
              extra: { prompt: 'consent' },
            }),
          } satisfies SignInStart
        })

      const knownHosts = Effect.map(rows, (all): KnownHosts => {
        const hosts = new Map(hostedOf(connectors.products))
        for (const row of all) {
          try {
            hosts.set(new URL(row.webUrl).hostname.toLowerCase(), row.product)
          } catch {
            // A connection's address is checked when it is made; nothing to add.
          }
        }
        return hosts
      })

      const hostOf = (remotes: ReadonlyArray<string>) =>
        Effect.gen(function* () {
          const all = (yield* rows).filter((row) => row.state === 'ready')
          for (const remote of remotes) {
            const ref = parseRemote(remote)
            if (ref === null) continue
            for (const row of all) {
              const host = adaptersOf(row).host
              if (host !== undefined && new URL(row.webUrl).hostname.toLowerCase() === ref.host)
                return { connectionId: row.id, host, path: ref.path }
            }
          }
          return null
        })

      const resolve = (link: string) =>
        Effect.gen(function* () {
          const ref = parseLink(link, yield* knownHosts)
          if (ref === null) return null
          const row = (yield* rows).find(
            (candidate) =>
              candidate.state === 'ready' &&
              candidate.product === ref.product &&
              new URL(candidate.webUrl).hostname.toLowerCase() === ref.host,
          )
          return row === undefined ? null : { connectionId: row.id, ref, ...adaptersOf(row) }
        })

      return Connections.of({
        list: provide(Effect.map(rows, (all) => all.map(toInfo))),
        products: connectors.products.map((info) => ({
          ...info,
          browserSignIn: info.browser !== null && connectors.clientIds[info.product] !== undefined,
        })),
        startSignIn: (input) => provide(startSignIn(input)),
        signIn: (flowId) => {
          const flow = flows.get(flowId)
          return flow === undefined ? Effect.fail(new NotFound({ kind: 'sign-in', id: flowId })) : Effect.succeed(flow.state)
        },
        cancelSignIn: (flowId) =>
          Effect.gen(function* () {
            const flow = flows.get(flowId)
            if (flow?.fiber !== undefined) yield* Fiber.interrupt(flow.fiber)
            flows.delete(flowId)
          }),
        connectToken: (input) =>
          provide(
            save({
              product: input.product,
              webUrl: input.webUrl ?? infoOf(input.product)?.hosted?.webUrl ?? '',
              auth: 'token',
              secret: { token: input.token.trim(), user: input.user?.trim() ?? null },
              actorId: input.actorId,
            }),
          ),
        remove: (connectionId, actorId) =>
          provide(
            Effect.gen(function* () {
              const row = yield* rowOf(connectionId)
              yield* moveTo(row, 'removed', 'connection.removed', actorId)
              yield* secrets.remove(row.credentialRef)
              adapterCache.delete(connectionId)
            }),
          ),
        adapters: (connectionId) => provide(Effect.map(rowOf(connectionId), (row) => ({ ...adaptersOf(row), info: toInfo(row) }))),
        hostOf: (remotes) => provide(hostOf(remotes)),
        resolve: (link) => provide(resolve(link)),
        trackers: provide(
          Effect.map(rows, (all) =>
            all.flatMap((row) => {
              const tracker = row.state === 'ready' ? adaptersOf(row).tracker : undefined
              return tracker === undefined ? [] : [{ connectionId: row.id, product: row.product, tracker }]
            }),
          ),
        ),
      })
    }),
  )
}
