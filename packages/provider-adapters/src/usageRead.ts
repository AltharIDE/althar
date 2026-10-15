import { readTokenField, type TokenLocation } from './credentialStore'
import { type AccountUsage, Unrecognized } from './usage'
import { allowedEndpoints, type EndpointSource, endpointProblem } from './usageSources'

/*
 * The usage read (ADR-043): an account's access token, read in memory for one
 * call to its provider's usage URL on the allowlist, and dropped. The token is
 * a local of one call. It is never written, refreshed, cached, logged, put in
 * a message or sent anywhere but the one URL; what leaves is windows, or a
 * fault in fixed words. This is the only file that imports the credential
 * store, and a test fails if another does.
 */

/** What the person is told when a read fails; fixed words, never the answer or an error from the network. */
export type UsageFault =
  /** The token is refused, gone, or in a store that won't open: sign in again. Althar does not refresh it. */
  | 'sign_in_again'
  /** The provider answered in another shape, or moved the URL. */
  | 'source_changed'
  /** No answer: no network, a timeout, an error status, a rate limit, or a source not confirmed. */
  | 'unreachable'

export type EndpointRead =
  /** `stale`: these are the last windows, kept in memory while the provider can't be asked. */
  | { readonly kind: 'usage'; readonly usage: AccountUsage; readonly stale: boolean }
  | { readonly kind: 'fault'; readonly fault: UsageFault; readonly message: string; readonly last?: AccountUsage }

export interface UsageReaderDeps {
  readonly fetch?: (
    url: string,
    init: { method: 'GET'; headers: Record<string, string>; redirect: 'manual'; signal: AbortSignal },
  ) => Promise<{
    readonly status: number
    readonly json: () => Promise<unknown>
  }>
  readonly readToken?: (home: string, location: TokenLocation) => Promise<string | null>
  readonly now?: () => Date
  readonly allowed?: ReadonlyArray<{ readonly host: string; readonly path: string }>
  /** In ms. */
  readonly timeout?: number
}

/** At most one call per account this often; the longest back-off after a 429. */
export const MIN_INTERVAL = 60_000
export const MAX_BACKOFF = 15 * 60_000

const fault = (kind: UsageFault, message: string, last?: AccountUsage): EndpointRead => ({
  kind: 'fault',
  fault: kind,
  message,
  ...(last === undefined ? {} : { last }),
})

export interface UsageReader {
  /** One account's windows from `source`, for the agent's version if it has a major. */
  readonly read: (source: EndpointSource, account: { readonly home: string; readonly agentMajor?: number }) => Promise<EndpointRead>
}

/** A reader with its own memory of when each account was last asked and what it said (windows only, never a token). */
export const createUsageReader = (deps: UsageReaderDeps = {}): UsageReader => {
  const fetcher = deps.fetch ?? ((url, init) => fetch(url, init))
  const tokenOf = deps.readToken ?? readTokenField
  const now = deps.now ?? (() => new Date())
  const allowed = deps.allowed ?? allowedEndpoints
  const timeout = deps.timeout ?? 15_000
  const memory = new Map<string, { at: number; usage?: AccountUsage; notBefore: number; strikes: number }>()

  const read: UsageReader['read'] = async (source, account) => {
    const refused = endpointProblem(source, allowed)
    if (refused !== null) return fault('unreachable', `The usage source is not allowed: ${refused}.`)
    if (!source.confirmed) return fault('unreachable', 'This usage source has not been confirmed yet.')
    if (source.agentMajor !== undefined && account.agentMajor !== undefined && source.agentMajor !== account.agentMajor)
      return fault('unreachable', `This usage source is for version ${source.agentMajor} of the agent.`)

    const key = `${source.id}\n${account.home}`
    const before = memory.get(key)
    const at = now().getTime()
    // Within the interval, or backing off after a 429: the last windows, not another call.
    if (before !== undefined && at < before.notBefore)
      return before.usage === undefined
        ? fault('unreachable', 'The provider asked Althar to wait.')
        : { kind: 'usage', usage: before.usage, stale: true }

    const remember = (patch: { usage?: AccountUsage; notBefore: number; strikes: number }) => memory.set(key, { at, ...patch })
    const failed = (kind: UsageFault, message: string, strikes = 0, backoff = MIN_INTERVAL) => {
      remember({ ...(before?.usage === undefined ? {} : { usage: before.usage }), notBefore: at + backoff, strikes })
      return fault(kind, message, before?.usage)
    }

    // The token lives in this call only.
    let token = await tokenOf(account.home, source.token)
    if (token === null) return failed('sign_in_again', 'No sign-in could be read for this account.')
    let status: number
    let body: () => Promise<unknown>
    try {
      const url = new URL(source.url)
      const answer = await fetcher(url.href, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...source.headers },
        // Never to another host.
        redirect: 'manual',
        signal: AbortSignal.timeout(timeout),
      })
      status = answer.status
      body = () => answer.json()
    } catch {
      return failed('unreachable', 'The provider could not be reached.')
    } finally {
      token = null
    }

    if (status === 401 || status === 403) return failed('sign_in_again', 'The provider refused this sign-in.')
    if (status === 429) {
      const strikes = (before?.strikes ?? 0) + 1
      return failed(
        'unreachable',
        'The provider is limiting how often Althar asks.',
        strikes,
        Math.min(MAX_BACKOFF, MIN_INTERVAL * 2 ** strikes),
      )
    }
    if (status >= 300 && status < 400) return failed('source_changed', 'The usage address has moved.')
    if (status < 200 || status >= 300) return failed('unreachable', 'The provider answered with an error.')

    try {
      const windows = source.parse(await body(), now())
      if (windows.length === 0) throw new Unrecognized('no window')
      const usage: AccountUsage = { windows, source: 'endpoint', observedAt: now().toISOString() }
      remember({ usage, notBefore: at + MIN_INTERVAL, strikes: 0 })
      return { kind: 'usage', usage, stale: false }
    } catch {
      return failed('source_changed', 'The usage answer was not what Althar knows.')
    }
  }
  return { read }
}
