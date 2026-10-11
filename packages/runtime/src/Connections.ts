import { createServer, type Server } from 'node:http'
import { homedir } from 'node:os'

import {
  type Account,
  type AccessLine,
  addressOf,
  authorizeUrl,
  awaitDeviceFlow,
  type CodeHost,
  ConnectorFailed,
  type Credential,
  exchangeCode,
  hostedOf,
  identify,
  type KnownHosts,
  type LinkRef,
  makePkce,
  parseLink,
  parseRemote,
  type Product,
  type ProductInfo,
  refreshToken,
  type RemoteRef,
  type Service,
  SignInEnded,
  startDeviceFlow,
  type TokenSet,
  type Tracker,
} from '@althar/connectors'
import { type ActorId, Ids, newId } from '@althar/domain'
import { Cause, Clock, Context, type Crypto, Deferred, Duration, Effect, Exit, Fiber, Layer, Option, Schema, Semaphore } from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'
import type { Ledger } from '@althar/persistence-sqlite'

import { type CliTool, Connectors } from './Config'
import { NotFound } from './errors'
import { git, namedRemotes } from './git'
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

/** A command-line tool isn't signed in to the host here, so there is no sign-in of its to take. */
export class CliSignedOut extends Schema.TaggedError<CliSignedOut>()('CliSignedOut', {
  tool: Schema.String,
  host: Schema.String,
}) {}

/**
 * An address gh's or glab's sign-in isn't given to: one not over HTTPS, or
 * not an instance Althar knows of (the hosted service at its own address, a
 * server connected, or one a project's remote names that answered).
 */
export class CliElsewhere extends Schema.TaggedError<CliElsewhere>()('CliElsewhere', {
  tool: Schema.String,
  address: Schema.String,
}) {}

/** A token for another account than the connection it was to sign in again. */
export class OtherAccount extends Schema.TaggedError<OtherAccount>()('OtherAccount', {
  product: Schema.String,
  /** Who the token is for. */
  login: Schema.String,
  /** Who the connection signs in as. */
  expected: Schema.String,
}) {}

/** A project's repositories on an instance of a service, as their remotes name them. */
export interface Place {
  readonly product: Product
  readonly webUrl: string
  readonly project: string
  /** The remote that names it, where git was asked: origin. */
  readonly remote: string | null
  /** The repositories' paths there: northwind/meridian-api. */
  readonly repositories: ReadonlyArray<string>
}

/** A command-line tool's sign-in on this device, for an instance. */
export interface CliSignIn {
  readonly product: Product
  readonly webUrl: string
  readonly tool: CliTool
  readonly account: string
  readonly scopes: ReadonlyArray<string> | null
}

/** What connecting a service starts from. */
export interface Guide {
  readonly service: Service
  readonly places: ReadonlyArray<Place>
  readonly clis: ReadonlyArray<CliSignIn>
  readonly email: { readonly address: string; readonly project: string | null } | null
  readonly tokenPages: ReadonlyArray<{ readonly product: Product; readonly webUrl: string; readonly url: string }>
}

/** What answered at an address, and where a token is made there. */
export interface Found {
  readonly product: Product | null
  readonly webUrl: string
  readonly reason: 'invalid' | 'unreachable' | 'other' | null
  readonly tokenPage: string | null
}

/** What a connection can do, as its service says. */
export interface Check {
  readonly connectionId: string
  readonly lines: ReadonlyArray<AccessLine>
  readonly expiresAt: string | null
  readonly renews: boolean
  readonly settings: string
}

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
  Schema.Struct({
    kind: Schema.Literal('token'),
    token: Schema.String,
    user: Schema.NullOr(Schema.String),
    // The API key the token was made for, where its product wants one (Trello's); none in those kept before.
    key: Schema.optional(Schema.NullOr(Schema.String)),
  }),
])
type Stored = typeof Stored.Type

/**
 * The credential a kept secret makes: an OAuth token is sent as a bearer; a
 * pasted one as its product sends them (a bearer, a key as it is, with the
 * account's email, or with the API key it was made for).
 */
export const credentialFor = (kind: Credential['kind'], kept: Stored): Credential => {
  if (kept.kind === 'oauth') return { kind: 'bearer', token: kept.accessToken }
  return kind === 'basic'
    ? { kind, user: kept.user ?? '', token: kept.token }
    : kind === 'app'
      ? { kind, key: kept.key ?? '', token: kept.token }
      : { kind, token: kept.token }
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

/** Where a repository's remote is, as Althar reads it without asking the host. */
export interface RemotePlace {
  /** The host's name: github.com. */
  readonly host: string
  /** The repository's path there: under the instance's own path, where a code host is known. */
  readonly path: ReadonlyArray<string>
  /** The code host there, where Althar knows one: by its hosted service, or an instance the person connected; and whether it is the hosted service. */
  readonly code: { readonly product: Product; readonly name: string; readonly hosted: boolean } | null
  /** The repository's page there; null where no code host is known. */
  readonly url: string | null
  /** The connection to it there: one signed in, else one that needs signing in again; null where there is none. */
  readonly connection: ConnectionInfo | null
}

/**
 * A repository's path on its code host, and its page there. A remote repeats
 * an instance's own path (a server at example.org/git), which the path is
 * read under. Bitbucket Data Center's pages are a project's repository,
 * whatever its remote says (`scm/prj/api` over HTTPS), or a person's own.
 */
export const pageOf = (product: Product, web: string, path: ReadonlyArray<string>) => {
  const base = web.replace(/\/+$/, '')
  let under: ReadonlyArray<string> = []
  try {
    under = new URL(base).pathname.split('/').filter((segment) => segment !== '')
  } catch {
    // A connection's address is checked when it is made; a hosted one is Althar's own.
  }
  const own = under.every((segment, at) => path[at]?.toLowerCase() === segment.toLowerCase()) ? path.slice(under.length) : path
  if (product !== 'bitbucket_dc') return { path: own, url: `${base}/${own.join('/')}` }
  const [key = '', slug = ''] = own[0]?.toLowerCase() === 'scm' ? own.slice(1) : own
  return {
    path: [key, slug],
    url: key.startsWith('~') ? `${base}/users/${key.slice(1)}/repos/${slug}` : `${base}/projects/${key.toUpperCase()}/repos/${slug}`,
  }
}

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
    /** Starts the service's own sign-in; with a connection, to sign that one in again, for its own account only. */
    startSignIn(input: {
      readonly product: Product
      readonly webUrl?: string
      readonly connectionId?: string
      readonly actorId: ActorId
    }): Effect.Effect<SignInStart, unknown>
    signIn(flowId: string): Effect.Effect<SignInState, NotFound>
    cancelSignIn(flowId: string): Effect.Effect<void>
    /** Connects with a pasted token; with a connection, signs it in again, keeping its address, email and key, for its own account. */
    connectToken(input: {
      readonly product: Product
      readonly webUrl?: string
      readonly user?: string
      readonly key?: string
      readonly token: string
      readonly connectionId?: string
      readonly actorId: ActorId
    }): Effect.Effect<ConnectionInfo, unknown>
    /** Connects with gh's or glab's sign-in on this device, taking a copy of its token. */
    connectCli(input: {
      readonly product: Product
      readonly webUrl: string
      readonly connectionId?: string
      readonly actorId: ActorId
    }): Effect.Effect<ConnectionInfo, unknown>
    /** Where the projects' code is: on the hosted services and servers already connected, as their stored remotes say. */
    readonly places: Effect.Effect<ReadonlyArray<Place>, unknown>
    /** What connecting a service starts from, each server the projects' remotes name asked what it is. */
    guide(service: Service): Effect.Effect<Guide, unknown>
    /** Which of a service's products answers at an address. */
    findServer(service: Service, typed: string): Effect.Effect<Found, unknown>
    /** Asks the service what a connection can do. */
    check(connectionId: string): Effect.Effect<Check, unknown>
    remove(connectionId: string, actorId: ActorId): Effect.Effect<void, unknown>
    /** A connection's adapters, signed in through it. */
    adapters(connectionId: string): Effect.Effect<Adapters & { readonly info: ConnectionInfo }, unknown>
    /** The code host a repository's remotes are on, through a ready connection that reaches it. */
    hostOf(
      remotes: ReadonlyArray<string>,
    ): Effect.Effect<{ readonly connectionId: string; readonly host: CodeHost; readonly path: ReadonlyArray<string> } | null, unknown>
    /**
     * Where a remote is: the host, the repository's path there, the code host
     * Althar knows there, and the connection that reaches it, signed in or
     * needing it again; null for a remote that names no host, such as a folder.
     */
    placeOf(remote: string): Effect.Effect<RemotePlace | null, unknown>
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

      const keep = (
        name: string,
        value: TokenSet | { readonly token: string; readonly user: string | null; readonly key: string | null },
      ) => secrets.set(name, JSON.stringify('accessToken' in value ? { kind: 'oauth', ...value } : { kind: 'token', ...value }))

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

      /**
       * Adds a connection, or renews one for the same account, once its
       * credential has said who it signs in as; to sign one in again, only
       * for the account it was.
       */
      const save = (input: {
        readonly product: Product
        readonly webUrl: string
        readonly auth: ConnectionInfo['auth']
        readonly secret: TokenSet | { readonly token: string; readonly user: string | null; readonly key: string | null }
        readonly actorId: ActorId
        readonly sameAs?: { readonly id: string; readonly login: string }
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
          if (input.sameAs !== undefined && account.id !== input.sameAs.id)
            return yield* new OtherAccount({ product: input.product, login: account.login, expected: input.sameAs.login })
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
            : {
                state: 'ended',
                reason: 'failed',
                message:
                  error instanceof ConnectorFailed
                    ? error.message
                    : error instanceof OtherAccount
                      ? `That signed in as ${error.login}, not ${error.expected}.`
                      : 'Sign-in didn’t finish.',
              }
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

      /** The connection a sign-in signs in again: where it is, and the account it signs in as. */
      const againOf = (connectionId: string | undefined) =>
        connectionId === undefined
          ? Effect.succeed(undefined)
          : Effect.map(rowOf(connectionId), (row) => ({
              product: row.product,
              webUrl: row.webUrl,
              sameAs: { id: row.accountId, login: row.accountLogin },
            }))

      const startSignIn = (given: {
        readonly product: Product
        readonly webUrl?: string
        readonly connectionId?: string
        readonly actorId: ActorId
      }) =>
        Effect.gen(function* () {
          // Signing a connection in again: at its own instance, whatever address came with it.
          const again = yield* againOf(given.connectionId)
          const input = again === undefined ? given : { ...given, product: again.product, webUrl: again.webUrl }
          const sameAs = again?.sameAs
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
                return yield* save({
                  product: input.product,
                  webUrl,
                  auth: 'device_flow',
                  secret: token,
                  actorId: input.actorId,
                  ...(sameAs === undefined ? {} : { sameAs }),
                })
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
              return yield* save({
                product: input.product,
                webUrl,
                auth: 'pkce',
                secret: token,
                actorId: input.actorId,
                ...(sameAs === undefined ? {} : { sameAs }),
              })
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

      /* ---- connecting: where the code is, the ways in, and what a connection can do ---- */

      const hostnameOf = (url: string) => {
        try {
          return new URL(url).hostname.toLowerCase()
        } catch {
          return ''
        }
      }

      /** Each repository of every project, with its stored remotes, and where it is on this device. */
      const bindings = Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        return yield* sql<{ project: string; remotes: string; path: string | null }>`
          SELECT p.name AS project, b.remote_fingerprints AS remotes, l.path
          FROM repository_bindings b JOIN projects p ON p.id = b.project_id
          LEFT JOIN repository_locations l ON l.binding_id = b.id AND l.device_id = ${instance.deviceId}
          WHERE b.detached_at IS NULL AND p.archived_at IS NULL
          ORDER BY p.created_at, b.created_at, b.rowid`
      })

      const Remotes = Schema.fromJsonString(Schema.Array(Schema.String))

      /* What answered on the servers the remotes name, by service and host: asked once a launch. */
      const servers = new Map<string, { readonly product: Product; readonly webUrl: string } | null>()
      const serverAt = (service: Service, host: string) =>
        Effect.gen(function* () {
          const key = `${service} ${host}`
          if (servers.has(key)) return servers.get(key) ?? null
          const found = yield* identify(connectors.fetch, service, `https://${host}`)
          const known =
            found.product !== null && infoOf(found.product) !== undefined ? { product: found.product, webUrl: found.webUrl } : null
          servers.set(key, known)
          return known
        })

      /** An instance's own path on its host: `gitlab` for a server at tools.example.org/gitlab. */
      const basePathOf = (webUrl: string): ReadonlyArray<string> => {
        try {
          return new URL(webUrl).pathname.split('/').filter((segment) => segment !== '')
        } catch {
          return []
        }
      }

      /**
       * The instance a remote is on, of those known on its host: the one whose
       * own path the remote's starts with, the longest; else the one at the
       * host's root, as an SSH remote, which doesn't say the path, is read;
       * else the only one there. None where that leaves several.
       */
      const instanceAt = <A extends { readonly webUrl: string }>(known: ReadonlyArray<A>, ref: RemoteRef): A | undefined => {
        const here = known.filter((at) => hostnameOf(at.webUrl) === ref.host)
        const under = here
          .map((at) => ({ at, base: basePathOf(at.webUrl) }))
          .filter(({ base }) => base.length > 0 && base.every((segment, index) => ref.path[index]?.toLowerCase() === segment.toLowerCase()))
          .sort((a, b) => b.base.length - a.base.length)
        return under[0]?.at ?? here.find((at) => basePathOf(at.webUrl).length === 0) ?? (here.length === 1 ? here[0] : undefined)
      }

      /**
       * Where the projects' code is, by project and instance: on a hosted
       * service, a server already connected, or one connecting found. With
       * `named`, each remote is read from the repository here, for its name;
       * with a service, only its places, and each other host the remotes
       * name is asked whether it is one of that service's servers. A remote
       * is a code host's, whatever tracker shares its server; connecting a
       * tracker, its server may be where the code is.
       */
      const placesOf = (named: boolean, service?: Service) =>
        Effect.gen(function* () {
          const tracking = service !== undefined && !connectors.products.some((info) => info.service === service && info.host)
          const fits = (product: Product) => {
            const info = infoOf(product)
            return info !== undefined && (tracking ? info.service === service : info.host)
          }
          const known: Array<{ readonly product: Product; readonly webUrl: string }> = []
          for (const info of connectors.products)
            if (info.hosted !== null) known.push({ product: info.product, webUrl: info.hosted.webUrl })
          for (const row of yield* rows) known.push({ product: row.product, webUrl: row.webUrl })
          for (const found of servers.values()) if (found !== null) known.push(found)
          const read = yield* Effect.forEach(
            yield* bindings,
            (binding) =>
              Effect.gen(function* () {
                const stored = Option.getOrElse(Schema.decodeUnknownOption(Remotes)(binding.remotes), () => [] as ReadonlyArray<string>)
                const remotes =
                  named && binding.path !== null
                    ? yield* namedRemotes(binding.path).pipe(
                        Effect.map((found) => found.map((remote) => ({ name: remote.name as string | null, url: remote.url }))),
                        Effect.orElseSucceed(() => stored.map((url) => ({ name: null, url }))),
                      )
                    : stored.map((url) => ({ name: null as string | null, url }))
                return { project: binding.project, path: binding.path, remotes }
              }),
            { concurrency: 4 },
          )
          // The hosts no product is known on, asked what they are, a few at a time.
          if (service !== undefined) {
            const unknown = new Set<string>()
            for (const binding of read)
              for (const remote of binding.remotes) {
                const ref = parseRemote(remote.url)
                const coded = ref !== null && known.some((at) => infoOf(at.product)?.host === true && hostnameOf(at.webUrl) === ref.host)
                if (ref !== null && !coded && ref.host.includes('.')) unknown.add(ref.host)
              }
            yield* Effect.forEach(
              [...unknown],
              (host) =>
                Effect.map(serverAt(service, host), (found) => {
                  if (found !== null) known.push(found)
                }),
              { concurrency: 4 },
            )
          }
          const candidates = [...new Map(known.filter((at) => fits(at.product)).map((at) => [`${at.product} ${at.webUrl}`, at])).values()]
          const places = new Map<string, { place: Place & { repositories: Array<string> }; paths: Array<string> }>()
          for (const binding of read)
            for (const remote of binding.remotes) {
              const ref = parseRemote(remote.url)
              const at = ref === null ? undefined : instanceAt(candidates, ref)
              if (ref === null || at === undefined) continue
              if (service !== undefined && infoOf(at.product)?.service !== service) continue
              const key = `${binding.project} ${at.product} ${at.webUrl}`
              const entry = places.get(key) ?? {
                place: { product: at.product, webUrl: at.webUrl, project: binding.project, remote: remote.name, repositories: [] },
                paths: [],
              }
              // The repository's path as its code host knows it: under the instance's own path, as its page reads it.
              const path = pageOf(at.product, at.webUrl, ref.path).path.join('/')
              if (!entry.place.repositories.includes(path)) entry.place.repositories.push(path)
              if (binding.path !== null && !entry.paths.includes(binding.path)) entry.paths.push(binding.path)
              places.set(key, entry)
            }
          return [...places.values()]
        })

      /** The token's name on a service's page: Althar, for the one project it is for, and the day, since GitHub wants each name once. */
      const tokenName = (projects: ReadonlyArray<string>, today: string) => {
        const [only] = projects
        const day = ` (${today})`
        return projects.length === 1 && only !== undefined ? `Althar for ${only.slice(0, 40 - 11 - day.length)}${day}` : `Althar${day}`
      }

      /** Where a token is made on an instance, filled in for its places: the projects it is for, and their repositories' one owner. */
      const tokenPageOf = (product: Product, webUrl: string, places: ReadonlyArray<Place>, today: string) => {
        const info = infoOf(product)
        if (info === undefined) return null
        const here = places.filter((place) => place.product === product && place.webUrl === webUrl)
        const owners = [...new Set(here.flatMap((place) => place.repositories.map((path) => path.split('/')[0] ?? '')))]
        const [owner] = owners
        return info.token.page(webUrl, {
          name: tokenName([...new Set(here.map((place) => place.project))], today),
          ...(owners.length === 1 && owner !== undefined && owner !== '' ? { owner } : {}),
        })
      }

      /** The product's check, as a token or an app's sign-in it is given would be asked. */
      const accessOf = (
        product: Product,
        webUrl: string,
        apiUrl: string,
        credential: Credential,
        auth: ConnectionInfo['auth'],
        repositories: ReadonlyArray<ReadonlyArray<string>>,
      ) =>
        Effect.gen(function* () {
          const info = infoOf(product)
          const access = info?.access
          if (info === undefined || access == null) {
            // Without a check of its own, the product says who it signs in as, and no more.
            const made = info?.make?.({ fetch: connectors.fetch, apiUrl, webUrl, credential: Effect.succeed(credential) })
            const account = yield* ((made?.host ?? made?.tracker)?.account ?? Effect.fail(null)).pipe(Effect.option)
            return {
              account: Option.getOrNull(account),
              lines: [
                {
                  need: 'account' as const,
                  state: Option.isSome(account) ? ('ok' as const) : ('no' as const),
                  fact: Option.match(account, { onNone: () => null, onSome: (found) => found.login }),
                  count: null,
                  reason: Option.isSome(account) ? null : { kind: 'refused' as const },
                },
              ],
              expiresAt: null,
              scopes: null,
            }
          }
          return yield* access({
            fetch: connectors.fetch,
            apiUrl,
            webUrl,
            hosted: info.hosted !== null && hostnameOf(info.hosted.webUrl) === hostnameOf(webUrl),
            credential,
            auth,
            repositories,
            ...(connectors.appSlug === undefined ? {} : { appSlug: connectors.appSlug }),
          })
        })

      /**
       * Where gh's or glab's sign-in may go, as the instance's own address:
       * over HTTPS only, to the hosted service at its own address however it
       * was written, or to a server connected or found where a project's
       * remote names it. Null anywhere else, before the tool is asked for
       * its token.
       */
      const cliDestination = (product: Product, typed: string) =>
        Effect.gen(function* () {
          const info = infoOf(product)
          if (info === undefined) return null
          let url: URL
          try {
            url = new URL(typed)
          } catch {
            return null
          }
          if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') return null
          const hosted = info.hosted?.webUrl
          if (hosted !== undefined && url.hostname === hostnameOf(hosted))
            return url.origin === new URL(hosted).origin && url.pathname.replace(/\/+$/, '') === '' ? hosted : null
          const webUrl = addressOf(info, typed)
          const connected = (yield* rows).some((row) => row.product === product && row.webUrl === webUrl)
          const found = [...servers.values()].some((server) => server?.product === product && server.webUrl === webUrl)
          return connected || found ? webUrl : null
        })

      /** gh's or glab's sign-in to an instance here, and who it is: null where the tool isn't signed in there, or its token no longer works. */
      const cliSignIn = (tool: CliTool, product: Product, instanceUrl: string) =>
        Effect.gen(function* () {
          const info = infoOf(product)
          const webUrl = yield* cliDestination(product, instanceUrl)
          if (webUrl === null) return null
          const token = yield* connectors.cliToken(tool, hostnameOf(webUrl))
          if (info === undefined || token === null) return null
          const report = yield* accessOf(product, webUrl, info.apiFor(webUrl), { kind: 'bearer', token }, 'token', [])
          return report.account === null
            ? null
            : { product, webUrl, tool, account: report.account.login, scopes: report.scopes === null ? null : [...report.scopes] }
        })

      const toolOf = (service: Service): CliTool | null => (service === 'github' ? 'gh' : service === 'gitlab' ? 'glab' : null)

      /** The email the projects commit with: a place's repository's git config, else git's own. */
      const emailOf = (paths: ReadonlyArray<{ readonly project: string; readonly path: string }>) =>
        Effect.gen(function* () {
          for (const { project, path } of paths) {
            const address = yield* git(path, 'config', 'user.email').pipe(Effect.orElseSucceed(() => ''))
            if (address.includes('@')) return { address, project }
          }
          const address = yield* git(homedir(), 'config', '--global', 'user.email').pipe(Effect.orElseSucceed(() => ''))
          return address.includes('@') ? { address, project: null } : null
        })

      const today = Effect.map(Clock.currentTimeMillis, (now) => new Date(now).toISOString().slice(0, 10))

      const guide = (service: Service) =>
        Effect.gen(function* () {
          const found = yield* placesOf(true, service)
          const places = found.map((entry) => entry.place)
          const instances = new Map<string, { readonly product: Product; readonly webUrl: string }>()
          for (const info of connectors.products)
            if (info.service === service && info.hosted !== null)
              instances.set(`${info.product} ${info.hosted.webUrl}`, { product: info.product, webUrl: info.hosted.webUrl })
          for (const place of places) instances.set(`${place.product} ${place.webUrl}`, { product: place.product, webUrl: place.webUrl })
          // Each connection's own instance too, for its token to be made again there.
          for (const row of yield* rows)
            if (infoOf(row.product)?.service === service)
              instances.set(`${row.product} ${row.webUrl}`, { product: row.product, webUrl: row.webUrl })
          const tool = toolOf(service)
          const clis =
            tool === null
              ? []
              : (yield* Effect.forEach([...instances.values()], ({ product, webUrl }) => cliSignIn(tool, product, webUrl), {
                  concurrency: 2,
                })).filter((cli) => cli !== null)
          // Bitbucket Cloud and Jira Cloud take the Atlassian account's email with a token.
          const wantsEmail = connectors.products.some((info) => info.service === service && info.token.needs === 'email')
          const email = wantsEmail
            ? yield* emailOf(
                found.length > 0
                  ? found.flatMap((entry) => entry.paths.map((path) => ({ project: entry.place.project, path })))
                  : (yield* bindings).flatMap((binding) =>
                      binding.path === null ? [] : [{ project: binding.project, path: binding.path }],
                    ),
              )
            : null
          const day = yield* today
          const tokenPages = [...instances.values()].flatMap(({ product, webUrl }) => {
            const url = tokenPageOf(product, webUrl, places, day)
            return url === null ? [] : [{ product, webUrl, url }]
          })
          return { service, places, clis, email, tokenPages } satisfies Guide
        })

      const findServer = (service: Service, typed: string) =>
        Effect.gen(function* () {
          const found = yield* identify(connectors.fetch, service, typed)
          // A product this runtime has no adapter for is something else, as far as connecting goes.
          const product = found.product !== null && infoOf(found.product) !== undefined ? found.product : null
          const places = (yield* placesOf(false, service)).map((entry) => entry.place)
          return {
            product,
            webUrl: found.webUrl,
            reason: product === null ? (found.reason ?? 'other') : null,
            tokenPage: product === null ? null : tokenPageOf(product, found.webUrl, places, yield* today),
          } satisfies Found
        })

      const check = (connectionId: string) =>
        Effect.gen(function* () {
          const row = yield* rowOf(connectionId)
          const info = infoOf(row.product)
          const kept = yield* stored(row)
          const now = yield* credential(connectionId)
          const places = (yield* placesOf(false)).map((entry) => entry.place)
          const repositories = places
            .filter((place) => place.product === row.product && place.webUrl === row.webUrl)
            .flatMap((place) => place.repositories.map((path) => path.split('/')))
          const unique = [...new Map(repositories.map((path) => [path.join('/'), path])).values()]
          const report = yield* accessOf(row.product, row.webUrl, row.apiUrl, now, row.auth, unique)
          return {
            connectionId,
            lines: report.lines,
            expiresAt: report.expiresAt ?? (kept.kind === 'oauth' ? kept.expiresAt : null),
            renews: kept.kind === 'oauth' && kept.refreshToken !== null,
            settings: info?.token.settings(row.webUrl) ?? row.webUrl,
          } satisfies Check
        })

      const connectCli = (input: {
        readonly product: Product
        readonly webUrl: string
        readonly connectionId?: string
        readonly actorId: ActorId
      }) =>
        Effect.gen(function* () {
          // Signing a connection in again: at its own instance, whatever address came with it.
          const again = yield* againOf(input.connectionId)
          const product = again?.product ?? input.product
          const info = infoOf(product)
          const tool = info === undefined ? null : toolOf(info.service)
          if (tool === null) return yield* new CliSignedOut({ tool: 'gh', host: hostnameOf(input.webUrl) })
          // The address is checked before the tool is asked: its token goes nowhere else.
          const address = again?.webUrl ?? input.webUrl
          const webUrl = yield* cliDestination(product, address)
          if (webUrl === null) return yield* new CliElsewhere({ tool, address })
          const host = hostnameOf(webUrl)
          const token = yield* connectors.cliToken(tool, host)
          if (token === null) return yield* new CliSignedOut({ tool, host })
          return yield* save({
            product,
            webUrl,
            auth: 'token',
            secret: { token, user: null, key: null },
            actorId: input.actorId,
            ...(again === undefined ? {} : { sameAs: again.sameAs }),
          })
        })

      const connectToken = (input: {
        readonly product: Product
        readonly webUrl?: string
        readonly user?: string
        readonly key?: string
        readonly token: string
        readonly connectionId?: string
        readonly actorId: ActorId
      }) =>
        Effect.gen(function* () {
          const token = input.token.trim()
          if (input.connectionId === undefined)
            return yield* save({
              product: input.product,
              webUrl: input.webUrl ?? infoOf(input.product)?.hosted?.webUrl ?? '',
              auth: 'token',
              secret: { token, user: input.user?.trim() ?? null, key: input.key?.trim() ?? null },
              actorId: input.actorId,
            })
          // Signing a connection in again: its address, and the email or key that went with its token, stay as they were.
          const row = yield* rowOf(input.connectionId)
          const kept = yield* stored(row).pipe(Effect.option)
          const was = Option.getOrUndefined(kept)
          return yield* save({
            product: row.product,
            webUrl: row.webUrl,
            auth: 'token',
            secret: {
              token,
              user: input.user?.trim() ?? (was?.kind === 'token' ? was.user : null),
              key: input.key?.trim() ?? (was?.kind === 'token' ? (was.key ?? null) : null),
            },
            actorId: input.actorId,
            sameAs: { id: row.accountId, login: row.accountLogin },
          })
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

      const placeOf = (remote: string) =>
        Effect.gen(function* () {
          const ref = parseRemote(remote)
          if (ref === null) return null
          const here = (yield* rows).filter((row) => hostnameOf(row.webUrl) === ref.host && infoOf(row.product)?.host === true)
          const row = here.find((candidate) => candidate.state === 'ready') ?? here[0]
          const product = row?.product ?? hostedOf(connectors.products).get(ref.host)
          const info = product === undefined ? undefined : infoOf(product)
          const connection = row === undefined ? null : toInfo(row)
          if (info === undefined || !info.host)
            return { host: ref.host, path: ref.path, code: null, url: null, connection } satisfies RemotePlace
          const hosted = info.hosted !== null && hostnameOf(info.hosted.webUrl) === ref.host
          const page = pageOf(
            info.product,
            connection?.webUrl ?? (hosted ? info.hosted?.webUrl : undefined) ?? `https://${ref.host}`,
            ref.path,
          )
          return {
            host: ref.host,
            path: page.path,
            code: { product: info.product, name: info.name, hosted },
            url: page.url,
            connection,
          } satisfies RemotePlace
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
        connectToken: (input) => provide(connectToken(input)),
        connectCli: (input) => provide(connectCli(input)),
        places: provide(Effect.map(placesOf(false), (found) => found.map((entry) => entry.place))),
        guide: (service) => provide(guide(service)),
        findServer: (service, typed) => provide(findServer(service, typed)),
        check: (connectionId) => provide(check(connectionId)),
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
        placeOf: (remote) => provide(placeOf(remote)),
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
