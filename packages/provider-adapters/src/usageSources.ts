import type { TokenLocation } from './credentialStore'
import type { AgentId } from './registry'
import { isoSeconds, record, Unrecognized, type UsageWindow, windowKind } from './usage'

/*
 * Where each (agent, provider) pair's plan usage comes from
 * (docs/plans/plan-usage.md, ADR-043). Usage is required for every
 * subscription, so a pair that can be a plan declares at least one source, and
 * how it is told from a key; a test fails for one that does not. The sources
 * are tried best first: ACP, an adapter's extension, the agent's own channel,
 * the provider's usage endpoint.
 */

/** A source that is not an endpoint. `built` says whether Althar has code for it yet. */
export type PlainSource =
  | { readonly kind: 'acp'; readonly built: boolean }
  | { readonly kind: 'acp_extension'; readonly via: string; readonly built: boolean }
  | { readonly kind: 'agent'; readonly channel: 'codex-app-server' | 'claude-agent-sdk'; readonly built: boolean }

/**
 * A provider's usage URL, called with an account's token under ADR-043. Only
 * `https`, `GET`, one host and one path. `confirmed` is false until a spike
 * has seen the real answer and the provider's terms have been read: the reader
 * refuses an unconfirmed source.
 */
export interface EndpointSource {
  readonly kind: 'endpoint'
  readonly id: string
  readonly url: string
  readonly method: 'GET'
  readonly token: TokenLocation
  /** Headers besides the token's, fixed by the registry. */
  readonly headers?: Readonly<Record<string, string>>
  readonly confirmed: boolean
  /** The agent's major version this is read for; none means any. OpenCode 2.x keeps credentials in a database ADR-043 does not allow reading. */
  readonly agentMajor?: number
  readonly parse: (answer: unknown, now: Date) => ReadonlyArray<UsageWindow>
}

/** A gap declared on purpose: the pair has no source until a spike finds one. Listed by the contract test. */
export interface SpikeSource {
  readonly kind: 'spike'
  readonly note: string
}

export type UsageSourceSpec = PlainSource | EndpointSource | SpikeSource

/** How a pair is told apart as plan or key. */
export type Classification =
  /** The agent's sign-in status command (`signIn.paidBy`). */
  | 'status'
  /** `opencode auth list`'s output, one entry per provider (`openCodeCredentials`). */
  | 'auth_list'

export interface UsagePair {
  readonly agent: AgentId
  /** The provider the sign-in is for, by the agent's own id for it. */
  readonly provider: string
  /** A plan has windows to read; a key has none, and says what the provider documents. */
  readonly pays: 'plan' | 'key'
  readonly classification: Classification
  readonly sources: ReadonlyArray<UsageSourceSpec>
}

/* ChatGPT's usage endpoint, as the tools that read it describe it (CodexBar docs/codex.md, 15 October 2026): unconfirmed. */
const chatGptWindow = (raw: unknown): UsageWindow | null => {
  if (raw === null || raw === undefined) return null
  const window = record(raw)
  if (window === null || typeof window.used_percent !== 'number' || !Number.isFinite(window.used_percent))
    throw new Unrecognized('a window without a use')
  const seconds = typeof window.limit_window_seconds === 'number' ? window.limit_window_seconds : undefined
  const minutes = seconds === undefined ? undefined : seconds / 60
  const resetsAt = isoSeconds(window.reset_at)
  return {
    kind: windowKind(minutes),
    ...(minutes === undefined ? {} : { minutes }),
    usedPercent: window.used_percent,
    ...(resetsAt === undefined ? {} : { resetsAt }),
  }
}

/** The windows in ChatGPT's usage answer. Slots are not durations: each is classified by its length. */
export const chatGptUsageWindows = (answer: unknown): ReadonlyArray<UsageWindow> => {
  const limits = record(record(answer)?.rate_limit)
  if (limits === null) throw new Unrecognized('no rate limit')
  return [chatGptWindow(limits.primary_window), chatGptWindow(limits.secondary_window)].filter((w): w is UsageWindow => w !== null)
}

const chatGptEndpoint = (id: string, agentMajor?: number): EndpointSource => ({
  kind: 'endpoint',
  id,
  url: 'https://chatgpt.com/backend-api/wham/usage',
  method: 'GET',
  // Codex keeps its ChatGPT sign-in in `auth.json` in its home (unconfirmed field names).
  token: { file: 'auth.json', path: ['tokens', 'access_token'] },
  confirmed: false,
  ...(agentMajor === undefined ? {} : { agentMajor }),
  parse: (answer) => chatGptUsageWindows(answer),
})

/**
 * Frozen all the way down. These are the policy the usage reader runs on (which
 * URL gets a token), and `readonly` is only the type: a consumer of the
 * package could otherwise change a URL or the allowlist at run time.
 */
const deepFreeze = <T>(value: T): T => {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const inner of Object.values(value)) deepFreeze(inner)
  }
  return value
}

export const usagePairs: ReadonlyArray<UsagePair> = deepFreeze([
  {
    agent: 'claude-code',
    provider: 'anthropic',
    pays: 'plan',
    classification: 'status',
    // No endpoint: Anthropic's terms bar it (ADR-043). Both are planned (stage 2).
    sources: [
      { kind: 'acp_extension', via: '_meta["_claude/rateLimit"]', built: false },
      { kind: 'agent', channel: 'claude-agent-sdk', built: false },
    ],
  },
  { agent: 'claude-code', provider: 'anthropic', pays: 'key', classification: 'status', sources: [] },
  {
    agent: 'codex',
    provider: 'openai',
    pays: 'plan',
    classification: 'status',
    sources: [{ kind: 'agent', channel: 'codex-app-server', built: true }, chatGptEndpoint('codex-chatgpt')],
  },
  { agent: 'codex', provider: 'openai', pays: 'key', classification: 'status', sources: [] },
  { agent: 'opencode', provider: 'openai', pays: 'plan', classification: 'auth_list', sources: [chatGptEndpoint('opencode-chatgpt', 1)] },
  {
    agent: 'opencode',
    provider: 'opencode',
    pays: 'plan',
    classification: 'auth_list',
    sources: [{ kind: 'spike', note: 'OpenCode Go and Zen: the console API behind issue #49693, not seen yet' }],
  },
  {
    agent: 'opencode',
    provider: 'github-copilot',
    pays: 'plan',
    classification: 'auth_list',
    sources: [{ kind: 'spike', note: 'GitHub Copilot: the premium-request counters, which endpoint takes a sign-in token is unconfirmed' }],
  },
  {
    agent: 'opencode',
    provider: 'google',
    pays: 'plan',
    classification: 'auth_list',
    sources: [{ kind: 'spike', note: 'Gemini: retrieveUserQuota; Google no longer serves individual OAuth to Gemini CLI since June 2026' }],
  },
  { agent: 'opencode', provider: 'api-key', pays: 'key', classification: 'auth_list', sources: [] },
])

export const endpointSources = (): ReadonlyArray<EndpointSource> =>
  usagePairs.flatMap((pair) => pair.sources.filter((source): source is EndpointSource => source.kind === 'endpoint'))

/**
 * The hosts and paths a usage read may call, and no others (ADR-043). An
 * Anthropic host is never on it: Anthropic's terms bar the endpoint for
 * Claude, and only its written clearance with an amendment to the ADR lets one in.
 */
export const allowedEndpoints: ReadonlyArray<{ readonly host: string; readonly path: string }> = deepFreeze([
  { host: 'chatgpt.com', path: '/backend-api/wham/usage' },
])

const ANTHROPIC = /(^|\.)(anthropic\.com|claude\.ai|claude\.com)$/i

/** Why a source may not be called, or null where it may. */
export const endpointProblem = (
  source: EndpointSource,
  allowed: ReadonlyArray<{ readonly host: string; readonly path: string }> = allowedEndpoints,
): string | null => {
  let url: URL
  try {
    url = new URL(source.url)
  } catch {
    return 'its URL is not a URL'
  }
  if (url.protocol !== 'https:') return 'its URL is not https'
  if (url.username !== '' || url.password !== '' || url.port !== '' || url.search !== '' || url.hash !== '')
    return 'its URL carries more than a host and a path'
  if (source.method !== 'GET') return 'it is not a GET'
  if (ANTHROPIC.test(url.hostname)) return 'it is an Anthropic host, which ADR-043 keeps out'
  if (!allowed.some((entry) => entry.host === url.hostname && entry.path === url.pathname))
    return 'its host and path are not on the allowlist'
  return null
}

/* OpenCode: plan or key per provider, from `opencode auth list --standalone --format json` (2.x). */

export interface OpenCodeCredential {
  readonly provider: string
  /** `unknown` where the method is not one the research has seen: a fault, never taken for a key. */
  readonly pays: 'plan' | 'key' | 'unknown'
}

/**
 * The sign-ins in `opencode auth list --format json`: `[{id, name,
 * connections: [{type, method, label}]}]` (OpenCode 2.0.29, 15 October 2026).
 * A `key` method is a key and a `chatgpt…` one is ChatGPT's plan; any other
 * method is unknown until it has been seen. null where the output is not that
 * shape: on 1.x it is a count only, which cannot say which provider.
 */
export const openCodeCredentials = (output: string): ReadonlyArray<OpenCodeCredential> | null => {
  let parsed: unknown
  try {
    parsed = JSON.parse(output)
  } catch {
    return null
  }
  if (!Array.isArray(parsed)) return null
  const found: OpenCodeCredential[] = []
  for (const entry of parsed) {
    const provider = record(entry)
    if (provider === null || typeof provider.id !== 'string' || !Array.isArray(provider.connections)) return null
    for (const connection of provider.connections) {
      const method = typeof record(connection)?.method === 'string' ? String(record(connection)?.method).toLowerCase() : ''
      found.push({ provider: provider.id, pays: method === 'key' ? 'key' : method.startsWith('chatgpt') ? 'plan' : 'unknown' })
    }
  }
  return found
}

/** What an OpenCode credential comes to: the pair that covers it, or why none does. A gap is a fault, never quiet. */
export type CredentialResolution =
  | { readonly kind: 'covered'; readonly pair: UsagePair }
  | { readonly kind: 'cannot_classify' }
  | { readonly kind: 'no_pair'; readonly provider: string }

/** The pair a sign-in belongs to. A key is the key pair; a plan needs a declared plan pair for its provider. */
export const resolveOpenCodeCredential = (credential: OpenCodeCredential): CredentialResolution => {
  if (credential.pays === 'unknown') return { kind: 'cannot_classify' }
  const pair = usagePairs.find(
    (candidate) =>
      candidate.agent === 'opencode' &&
      candidate.pays === credential.pays &&
      (credential.pays === 'key' ? candidate.provider === 'api-key' : candidate.provider === credential.provider),
  )
  return pair === undefined ? { kind: 'no_pair', provider: credential.provider } : { kind: 'covered', pair }
}
