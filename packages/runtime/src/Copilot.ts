import { signInHost } from '@althar/contracts'
import { awaitDeviceFlow, refreshToken, startDeviceFlow, type Fetch, type TokenSet } from '@althar/connectors'
import { copilotProvider, type NativeProvider, type SignInCheck } from '@althar/provider-adapters'
import { Clock, Context, Duration, Effect, Layer, Schema, Semaphore } from 'effect'

import { Secrets, type SecretsUnavailable } from './Secrets'

/** Copilot's account and HTTP boundary. The agent sees responses, never the underlying credential. */
export class CopilotFailed extends Schema.TaggedError<CopilotFailed>()('CopilotFailed', { message: Schema.String }) {}

const Token = Schema.Struct({
  accessToken: Schema.String,
  refreshToken: Schema.NullOr(Schema.String),
  expiresAt: Schema.NullOr(Schema.String),
  scope: Schema.NullOr(Schema.String),
})
const Credential = Schema.Struct({ host: Schema.String, clientId: Schema.String, api: Schema.String, token: Token })
type Credential = typeof Credential.Type
const User = Schema.Struct({
  login: Schema.optional(Schema.String),
  chat_enabled: Schema.optional(Schema.Boolean),
  endpoints: Schema.optional(Schema.Struct({ api: Schema.optional(Schema.String) })),
})

export interface CopilotOptions {
  /** Althar's public OAuth application ID. No third-party application identity is substituted. */
  readonly clientId?: string | undefined
  /** Enterprise Server instances register their own applications, independently of github.com. */
  readonly enterpriseClientIds?: Readonly<Record<string, string>>
  readonly fetch?: Fetch
  readonly appVersion?: string
}

export const copilotApi = (host: string, endpoint?: string): string | null => {
  const fallback = host === 'github.com' ? 'https://api.githubcopilot.com' : `https://copilot-api.${host}`
  try {
    const url = new URL(endpoint ?? fallback)
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash) return null
    const owned =
      url.hostname === 'api.githubcopilot.com' ||
      url.hostname.endsWith('.githubcopilot.com') ||
      (host !== 'github.com' && url.hostname === `copilot-api.${host}`)
    return owned ? url.origin : null
  } catch {
    return null
  }
}

const userApi = (host: string) =>
  host === 'github.com' ? 'https://api.github.com' : host.endsWith('.ghe.com') ? `https://api.${host}` : `https://${host}/api/v3`

export class Copilot extends Context.Service<
  Copilot,
  {
    signIn(
      accountId: string,
      host: string | undefined,
      show: (challenge: { readonly code: string; readonly page: string; readonly expiresAt: string }) => void,
    ): Effect.Effect<void, CopilotFailed | SecretsUnavailable>
    status(accountId: string): Effect.Effect<SignInCheck>
    forget(accountId: string): Effect.Effect<void, SecretsUnavailable>
    provider(accountId: string): NativeProvider
  }
>()('@althar/runtime/Copilot') {
  static readonly layer = (options: CopilotOptions = {}): Layer.Layer<Copilot, never, Secrets> =>
    Layer.effect(
      Copilot,
      Effect.gen(function* () {
        const secrets = yield* Secrets
        const context = yield* Effect.context<never>()
        const fetcher = options.fetch ?? globalThis.fetch
        const locks = new Map<string, Semaphore.Semaphore>()
        const key = (accountId: string) => `copilot-${accountId}`
        const lock = (accountId: string) => {
          let mutex = locks.get(accountId)
          if (!mutex) {
            mutex = Semaphore.makeUnsafe(1)
            locks.set(accountId, mutex)
          }
          return mutex
        }
        const headers = { accept: 'application/json', 'user-agent': `Althar/${options.appVersion ?? 'dev'}` }
        const failed = (message: string) => new CopilotFailed({ message })
        const request = (url: string, init: RequestInit) =>
          Effect.tryPromise({
            try: (signal) => fetcher(url, { ...init, signal: init.signal ? AbortSignal.any([init.signal, signal]) : signal }),
            catch: () => failed('GitHub Copilot could not be reached. Check your connection and try again.'),
          }).pipe(
            Effect.timeout(Duration.seconds(45)),
            Effect.mapError((error) =>
              error instanceof CopilotFailed ? error : failed('GitHub Copilot did not answer in time. Try again.'),
            ),
          )
        const read = (accountId: string) =>
          Effect.gen(function* () {
            const value = yield* secrets.get(key(accountId))
            if (value === null) return null
            const credential = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Credential))(value).pipe(
              Effect.mapError(() => failed('This Copilot sign-in could not be read. Sign in again.')),
            )
            if (
              signInHost(credential.host) !== credential.host ||
              copilotApi(credential.host, credential.api) === null ||
              !credential.token.accessToken
            )
              return yield* failed('This Copilot sign-in could not be read. Sign in again.')
            return credential
          })
        const keep = (accountId: string, credential: Credential) => secrets.set(key(accountId), JSON.stringify(credential))
        const current = (accountId: string) =>
          lock(accountId).withPermit(
            Effect.gen(function* () {
              const saved = yield* read(accountId)
              if (!saved) return yield* failed('GitHub Copilot authentication required. Sign in again.')
              const endsAt = saved.token.expiresAt === null ? null : Date.parse(saved.token.expiresAt)
              if (endsAt === null || endsAt > (yield* Clock.currentTimeMillis) + 60_000) return saved
              if (!saved.token.refreshToken) return yield* failed('GitHub Copilot authentication required. Sign in again.')
              const token = yield* refreshToken({
                product: 'github',
                fetch: fetcher,
                tokenUrl: `https://${saved.host}/login/oauth/access_token`,
                clientId: saved.clientId,
                refreshToken: saved.token.refreshToken,
              }).pipe(Effect.mapError(() => failed('GitHub Copilot authentication required. Sign in again.')))
              const next = { ...saved, token }
              yield* keep(accountId, next)
              return next
            }),
          )
        const run = <A, E>(effect: Effect.Effect<A, E>, signal: AbortSignal) =>
          Effect.runPromise(Effect.provideContext(effect, context), { signal })
        const rawProvider = (accountId: string): NativeProvider =>
          copilotProvider((path, input) =>
            run(
              Effect.gen(function* () {
                if (!['/models', '/chat/completions', '/responses', '/v1/messages'].includes(path))
                  return yield* failed('This Copilot API is not supported.')
                const credential = yield* current(accountId)
                const response = yield* request(`${credential.api}${path}`, {
                  method: input.body === undefined ? 'GET' : 'POST',
                  signal: input.signal,
                  headers: {
                    ...headers,
                    authorization: `Bearer ${credential.token.accessToken}`,
                    'content-type': 'application/json',
                    'X-GitHub-Api-Version': '2026-08-01',
                    'Openai-Intent': 'conversation-edits',
                    'X-Interaction-Type': input.compaction ? 'conversation-compaction' : 'conversation-agent',
                    'x-initiator': input.initiator ?? 'agent',
                    ...(input.sessionId ? { 'X-Interaction-Id': input.sessionId } : {}),
                    ...(input.vision ? { 'Copilot-Vision-Request': 'true' } : {}),
                    ...(path === '/v1/messages' ? { 'anthropic-version': '2023-06-01' } : {}),
                  },
                  ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
                })
                return response
              }),
              input.signal,
            ),
          )
        const provider = (accountId: string): NativeProvider => {
          const raw = rawProvider(accountId)
          const timed = <A>(work: (signal: AbortSignal) => Promise<A>, signal: AbortSignal, duration: Duration.Input) =>
            run(
              Effect.tryPromise({ try: (abort) => work(AbortSignal.any([signal, abort])), catch: (error) => error }).pipe(
                Effect.timeout(duration),
              ),
              signal,
            )
          return {
            models: (signal) => timed((abort) => raw.models(abort), signal, Duration.seconds(45)),
            complete: (input) => timed((signal) => raw.complete({ ...input, signal }), input.signal, Duration.minutes(3)),
          }
        }

        return Copilot.of({
          provider,
          forget: (accountId) => lock(accountId).withPermit(secrets.remove(key(accountId))),
          status: (accountId) =>
            read(accountId).pipe(
              Effect.map((value): SignInCheck => ({ status: value === null ? 'signed_out' : 'signed_in', paidBy: 'plan' })),
              Effect.orElseSucceed((): SignInCheck => ({ status: 'unknown', paidBy: 'unknown' })),
            ),
          signIn: (accountId, inputHost, show) =>
            Effect.gen(function* () {
              const host = inputHost === undefined ? 'github.com' : signInHost(inputHost)
              if (!host) return yield* failed('Enter a GitHub Enterprise hostname or HTTPS address.')
              const clientId = options.enterpriseClientIds?.[host] ?? options.clientId
              if (!clientId) return yield* failed('Copilot sign-in is not available in this build. Contact the Althar team.')
              const authorization = yield* startDeviceFlow({
                product: 'github',
                fetch: fetcher,
                codeUrl: `https://${host}/login/device/code`,
                clientId,
                scope: 'read:user',
              }).pipe(
                Effect.timeout(Duration.seconds(45)),
                Effect.mapError(() =>
                  failed('GitHub could not start sign-in. Check your connection or your organization’s application policy.'),
                ),
              )
              const page = yield* Effect.try({
                try: () => new URL(authorization.verificationUri),
                catch: () => failed('GitHub returned an invalid sign-in address.'),
              })
              if (
                page.origin !== `https://${host}` ||
                page.pathname !== '/login/device' ||
                page.search ||
                page.hash ||
                authorization.userCode === '' ||
                authorization.interval <= 0 ||
                authorization.interval > 300
              )
                return yield* failed('GitHub returned an invalid sign-in challenge. Try again.')
              yield* Effect.sync(() => show({ code: authorization.userCode, page: page.href, expiresAt: authorization.expiresAt }))
              const token: TokenSet = yield* awaitDeviceFlow({
                product: 'github',
                fetch: fetcher,
                tokenUrl: `https://${host}/login/oauth/access_token`,
                clientId,
                authorization,
              }).pipe(
                Effect.timeout(Duration.millis(Math.max(1, Date.parse(authorization.expiresAt) - (yield* Clock.currentTimeMillis)))),
                Effect.mapError((error) =>
                  failed(
                    error._tag === 'TimeoutError'
                      ? 'This sign-in code expired. Try again.'
                      : error._tag === 'SignInEnded'
                        ? error.reason === 'denied'
                          ? 'GitHub sign-in was not approved.'
                          : 'This sign-in code expired. Try again.'
                        : 'GitHub could not finish sign-in. Try again.',
                  ),
                ),
              )
              const response = yield* request(`${userApi(host)}/copilot_internal/user`, {
                headers: { ...headers, authorization: `Bearer ${token.accessToken}`, 'X-GitHub-Api-Version': '2025-04-01' },
              })
              if (!response.ok)
                return yield* failed(
                  'GitHub could not confirm Copilot access. Check your subscription and your organization’s application policy.',
                )
              const user = yield* Effect.tryPromise({
                try: () => response.json() as Promise<unknown>,
                catch: () => failed('GitHub returned an unreadable Copilot account.'),
              }).pipe(
                Effect.flatMap(Schema.decodeUnknownEffect(User)),
                Effect.mapError(() => failed('GitHub returned an unreadable Copilot account.')),
              )
              if (user.chat_enabled === false)
                return yield* failed(
                  'This account does not have Copilot Chat access. Check your subscription or ask your organization to assign a Copilot seat.',
                )
              const api = copilotApi(host, user.endpoints?.api)
              if (!api) return yield* failed('GitHub returned an unrecognized Copilot address. No credentials were sent to it.')
              // Verify model access before replacing the account’s previous credential or reporting success.
              const probe = copilotProvider((path, input) =>
                Effect.runPromise(
                  request(`${api}${path}`, {
                    signal: input.signal,
                    headers: { ...headers, authorization: `Bearer ${token.accessToken}`, 'X-GitHub-Api-Version': '2026-08-01' },
                  }),
                  { signal: input.signal },
                ),
              )
              yield* Effect.tryPromise({
                try: (signal) => probe.models(signal),
                catch: () =>
                  failed(
                    'Copilot offers no coding models for Althar on this account. Check your plan and your organization’s application policy.',
                  ),
              }).pipe(
                Effect.timeout(Duration.seconds(45)),
                Effect.mapError((error) =>
                  error instanceof CopilotFailed ? error : failed('GitHub Copilot did not confirm model access in time. Try again.'),
                ),
              )
              yield* lock(accountId).withPermit(keep(accountId, { host, clientId, api, token }))
            }),
        })
      }),
    )
}
