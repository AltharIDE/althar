import { join } from 'node:path'

import { type KeychainRead, readClaudeKeychainField, readTokenField, type TokenLocation } from './credentialStore'
import type { AgentId } from './registry'
import type { AccountUsage } from './usage'
import { allowedEndpoints, type EndpointSource, endpointProblem, type TokenSource, type UsagePair, usagePairs } from './usageSources'

/*
 * The usage read (ADR-062): an account's access token, read in memory for one
 * call to its provider's usage URL on the allowlist, and dropped. The token is
 * a local of one call. It is never written, refreshed, cached, logged, put in
 * a message or sent anywhere but the one URL; what leaves is windows, or a
 * fault in fixed words. This is the only file that imports the credential
 * store, and a test fails if another does.
 */

/** What the person is told when a read fails; fixed words, never the answer or an error from the network. */
export type UsageFault =
  /** The provider refused the sign-in: it has expired, and the agent renews it when it next runs. Althar never does. */
  | 'expired'
  /** The provider answered in another shape, or moved the URL. */
  | 'source_changed'
  /** No answer: no network, a timeout, an error status or being asked to wait. */
  | 'unreachable'
  /** There is no such source for the account, or it isn't allowed. */
  | 'no_source'

export type EndpointRead =
  /** `stale`: these are the last windows, kept in memory while the provider isn't asked again. */
  | { readonly kind: 'usage'; readonly usage: AccountUsage; readonly stale: boolean }
  /** The account has no plan sign-in for this read: it is paid another way (a key), or not signed in this way. */
  | { readonly kind: 'none' }
  | { readonly kind: 'fault'; readonly fault: UsageFault; readonly message: string; readonly last?: AccountUsage }

/** The account a read is for: bound to its agent and provider, so a source is only used for its own pair. */
export interface UsageAccount {
  readonly agent: AgentId
  readonly provider: string
  /** The account's home folder. */
  readonly home: string
  /** Whether the account names its home (its variable set), rather than the agent's usual folder: Claude's keychain item differs by it. */
  readonly named: boolean
  /** The agent's version as its CLI says it, for a client name that carries one. */
  readonly agentVersion?: string
}

type Fetch = (
  url: string,
  init: { method: 'GET'; headers: Record<string, string>; redirect: 'manual'; signal: AbortSignal },
) => Promise<{
  readonly status: number
  readonly headers?: { readonly get: (name: string) => string | null }
  readonly json: () => Promise<unknown>
}>

/**
 * What a reader is built from. The production reader (`usageReader`) takes
 * none of it from a caller: the registry, the allowlist and the credential
 * store are fixed. Only tests build another, from this file directly; the
 * package does not export `buildUsageReader`.
 */
export interface UsagePolicy {
  readonly pairs?: ReadonlyArray<UsagePair>
  readonly allowed?: ReadonlyArray<{ readonly host: string; readonly path: string; readonly search?: string }>
  readonly fetch?: Fetch
  readonly readFile?: (home: string, location: TokenLocation) => Promise<string | null>
  readonly keychain?: KeychainRead
  /** In ms. */
  readonly timeout?: number
}

/** At most one call per account this often, unless its source says longer; the longest wait after being asked to. */
export const MIN_INTERVAL = 60_000
export const MAX_BACKOFF = 24 * 60 * 60_000

const fault = (kind: UsageFault, message: string, last?: AccountUsage): EndpointRead => ({
  kind: 'fault',
  fault: kind,
  message,
  ...(last === undefined ? {} : { last }),
})

/** How long a 429 asks Althar to wait, from its Retry-After (seconds, or a date); undefined where it doesn't say. */
const retryAfter = (value: string | null | undefined, now: number): number | undefined => {
  if (value === null || value === undefined || value.trim() === '') return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const at = Date.parse(value)
  return Number.isNaN(at) ? undefined : Math.max(0, at - now)
}

export interface UsageReader {
  /**
   * One account's windows from the registry's source `sourceId`, which must
   * be one of the sources of the account's own (agent, provider) plan pair,
   * at the time `now` gives: the caller's clock (Effect's, in the runtime).
   */
  readonly read: (sourceId: string, account: UsageAccount, now: () => Date) => Promise<EndpointRead>
}

/** A reader with its own memory of when each account was last asked and what it said (windows only, never a token). */
export const buildUsageReader = (policy: UsagePolicy = {}): UsageReader => {
  const pairs = policy.pairs ?? usagePairs
  const fetcher: Fetch = policy.fetch ?? ((url, init) => fetch(url, init))
  const readFile = policy.readFile ?? readTokenField
  const allowed = policy.allowed ?? allowedEndpoints
  const timeout = policy.timeout ?? 10_000
  const memory = new Map<string, { usage?: AccountUsage; notBefore: number; strikes: number }>()
  /** A read under way for an account: a second asker gets its answer, not a second call. */
  const inflight = new Map<string, Promise<EndpointRead>>()

  /** A string of the account's own sign-in, from where its agent keeps it. */
  const stringOf = (token: TokenSource, account: UsageAccount, path?: TokenLocation['path']) =>
    token.kind === 'file'
      ? readFile(account.home, path === undefined ? token.location : { file: token.location.file, path })
      : // Claude Code's: its keychain item for the home on a Mac, else the file in it.
        readClaudeKeychainField(account.named ? account.home : undefined, path ?? token.path, policy.keychain).then(
          (found) => found ?? readFile(account.home, { file: '.credentials.json', path: path ?? token.path }),
        )

  const run = async (source: EndpointSource, account: UsageAccount, key: string, now: () => Date): Promise<EndpointRead> => {
    const before = memory.get(key)
    const at = now().getTime()
    // Within the interval, or waiting as the provider asked: the last windows, not another call.
    if (before !== undefined && at < before.notBefore)
      return before.usage === undefined
        ? fault('unreachable', 'The provider asked Althar to wait before reading again.')
        : { kind: 'usage', usage: before.usage, stale: true }

    const every = source.every ?? MIN_INTERVAL
    // The interval is taken before anything is awaited, so no second read can start inside it.
    const remember = (patch: { usage?: AccountUsage; notBefore: number; strikes: number }) => memory.set(key, patch)
    remember({ ...(before?.usage === undefined ? {} : { usage: before.usage }), notBefore: at + every, strikes: before?.strikes ?? 0 })
    const failed = (kind: UsageFault, message: string, strikes = 0, wait = every) => {
      remember({ ...(before?.usage === undefined ? {} : { usage: before.usage }), notBefore: at + wait, strikes })
      return fault(kind, message, before?.usage)
    }

    // The token lives in this call only.
    let token = await stringOf(source.token, account)
    if (token === null) {
      remember({ notBefore: at + every, strikes: 0 })
      return { kind: 'none' }
    }
    const headers: Record<string, string> = { Accept: 'application/json', ...source.headers }
    for (const named of source.accountHeaders ?? []) {
      const value = await stringOf(source.token, account, named.path)
      if (value !== null) headers[named.header] = value
    }
    if (source.userAgent !== undefined) headers['User-Agent'] = source.userAgent(account.agentVersion)
    let answer: Awaited<ReturnType<Fetch>>
    try {
      answer = await fetcher(new URL(source.url).href, {
        method: 'GET',
        headers: { ...headers, Authorization: `Bearer ${token}` },
        // Never to another host.
        redirect: 'manual',
        signal: AbortSignal.timeout(timeout),
      })
    } catch {
      return failed('unreachable', 'The provider could not be reached.')
    } finally {
      token = null
    }

    const status = answer.status
    if (status === 401 || status === 403) return failed('expired', 'Its sign-in has expired.')
    if (status === 429) {
      const strikes = (before?.strikes ?? 0) + 1
      const asked = retryAfter(answer.headers?.get('retry-after'), at)
      return failed(
        'unreachable',
        'The provider asked Althar to wait before reading again.',
        strikes,
        Math.min(MAX_BACKOFF, Math.max(every, asked ?? Math.min(15 * 60_000, MIN_INTERVAL * 2 ** strikes))),
      )
    }
    if (status >= 300 && status < 400) return failed('source_changed', 'The usage address has moved.')
    if (status < 200 || status >= 300) return failed('unreachable', 'The provider answered with an error.')

    try {
      const windows = source.parse(await answer.json(), now())
      const usage: AccountUsage = { windows, source: 'endpoint', observedAt: now().toISOString() }
      remember({ usage, notBefore: at + every, strikes: 0 })
      return { kind: 'usage', usage, stale: false }
    } catch {
      return failed('source_changed', 'The usage answer was not what Althar knows.')
    }
  }

  const read: UsageReader['read'] = async (sourceId, account, now) => {
    // The source is the registry's, for this account's own pair: a caller names it, and cannot supply one.
    const source = pairs
      .filter((pair) => pair.agent === account.agent && pair.provider === account.provider && pair.pays === 'plan')
      .flatMap((pair) => pair.sources)
      .find((candidate): candidate is EndpointSource => candidate.kind === 'endpoint' && candidate.id === sourceId)
    if (source === undefined) return fault('no_source', 'This account has no such usage source.')
    const refused = endpointProblem(source, allowed)
    if (refused !== null) return fault('no_source', `The usage source is not allowed: ${refused}.`)
    const key = `${source.id}\n${join(account.home)}`
    const going = inflight.get(key)
    if (going !== undefined) return going
    const started = run(source, account, key, now).finally(() => inflight.delete(key))
    inflight.set(key, started)
    return started
  }
  return { read }
}

/** The reader the package uses: the registry's sources, the fixed allowlist, and one memory shared by every caller. */
export const usageReader: UsageReader = buildUsageReader()
