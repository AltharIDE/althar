import { readTokenField, type TokenLocation } from './credentialStore'
import { type AccountUsage, Unrecognized } from './usage'
import type { AgentId } from './registry'
import { allowedEndpoints, type EndpointSource, endpointProblem, type UsagePair, usagePairs } from './usageSources'

/*
 * The usage read (ADR-050): an account's access token, read in memory for one
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
  /** No answer: no network, a timeout, an error status or a rate limit. */
  | 'unreachable'
  /** There is no source to ask: none for this account, one not confirmed yet or not allowed, or one for another version of the agent. */
  | 'no_source'

export type EndpointRead =
  /** `stale`: these are the last windows, kept in memory while the provider can't be asked. */
  | { readonly kind: 'usage'; readonly usage: AccountUsage; readonly stale: boolean }
  | { readonly kind: 'fault'; readonly fault: UsageFault; readonly message: string; readonly last?: AccountUsage }

/** The account a read is for: bound to its agent and provider, so a source is only used for its own pair. */
export interface UsageAccount {
  readonly agent: AgentId
  readonly provider: string
  readonly home: string
  /** The agent's major version. A source for one version is not read when this is unknown. */
  readonly agentMajor?: number
}

/**
 * What a reader is built from. The production reader (`usageReader`) takes
 * none of it from a caller: the registry, the allowlist and the credential
 * store are fixed. Only tests build another, from this file directly; the
 * package does not export `buildUsageReader`.
 */
export interface UsagePolicy {
  readonly pairs?: ReadonlyArray<UsagePair>
  readonly allowed?: ReadonlyArray<{ readonly host: string; readonly path: string }>
  readonly fetch?: (
    url: string,
    init: { method: 'GET'; headers: Record<string, string>; redirect: 'manual'; signal: AbortSignal },
  ) => Promise<{
    readonly status: number
    readonly json: () => Promise<unknown>
  }>
  readonly readToken?: (home: string, location: TokenLocation) => Promise<string | null>
  readonly now?: () => Date
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
  /**
   * One account's windows from the registry's source `sourceId`, which must
   * be one of the sources of the account's own (agent, provider) plan pair.
   */
  readonly read: (sourceId: string, account: UsageAccount) => Promise<EndpointRead>
}

/** A reader with its own memory of when each account was last asked and what it said (windows only, never a token). */
export const buildUsageReader = (policy: UsagePolicy = {}): UsageReader => {
  const pairs = policy.pairs ?? usagePairs
  const fetcher = policy.fetch ?? ((url, init) => fetch(url, init))
  const tokenOf = policy.readToken ?? readTokenField
  const now = policy.now ?? (() => new Date())
  const allowed = policy.allowed ?? allowedEndpoints
  const timeout = policy.timeout ?? 15_000
  const memory = new Map<string, { usage?: AccountUsage; notBefore: number; strikes: number }>()
  /** A read under way for an account: a second asker gets its answer, not a second call. */
  const inflight = new Map<string, Promise<EndpointRead>>()

  const run = async (source: EndpointSource, account: UsageAccount, key: string): Promise<EndpointRead> => {
    const before = memory.get(key)
    const at = now().getTime()
    // Within the interval, or backing off after a 429: the last windows, not another call.
    if (before !== undefined && at < before.notBefore)
      return before.usage === undefined
        ? fault('unreachable', 'The provider asked Althar to wait.')
        : { kind: 'usage', usage: before.usage, stale: true }

    // The interval is taken before anything is awaited, so no second read can start inside it.
    const remember = (patch: { usage?: AccountUsage; notBefore: number; strikes: number }) => memory.set(key, patch)
    remember({
      ...(before?.usage === undefined ? {} : { usage: before.usage }),
      notBefore: at + MIN_INTERVAL,
      strikes: before?.strikes ?? 0,
    })
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

  const read: UsageReader['read'] = async (sourceId, account) => {
    // The source is the registry's, for this account's own pair: a caller names it, and cannot supply one.
    const source = pairs
      .filter((pair) => pair.agent === account.agent && pair.provider === account.provider && pair.pays === 'plan')
      .flatMap((pair) => pair.sources)
      .find((candidate): candidate is EndpointSource => candidate.kind === 'endpoint' && candidate.id === sourceId)
    if (source === undefined) return fault('no_source', 'This account has no such usage source.')
    const refused = endpointProblem(source, allowed)
    if (refused !== null) return fault('no_source', `The usage source is not allowed: ${refused}.`)
    if (!source.confirmed) return fault('no_source', 'This usage source has not been confirmed yet.')
    // A source for one version is read only for a version known to match.
    if (source.agentMajor !== undefined && account.agentMajor !== source.agentMajor)
      return fault('no_source', `This usage source is for version ${source.agentMajor} of the agent, and this one is not known to be.`)

    const key = `${source.id}\n${account.home}`
    const going = inflight.get(key)
    if (going !== undefined) return going
    const started = run(source, account, key).finally(() => inflight.delete(key))
    inflight.set(key, started)
    return started
  }
  return { read }
}

/** The reader the package uses: the registry's sources, the fixed allowlist, and one memory shared by every caller. */
export const usageReader: UsageReader = buildUsageReader()
