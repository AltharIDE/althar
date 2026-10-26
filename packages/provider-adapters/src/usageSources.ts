import { execFile } from 'node:child_process'

import type { PathStep, TokenLocation } from './credentialStore'
import { childEnvironment } from './process'
import type { AgentDefinition, AgentId } from './registry'
import { isoSeconds, record, Unrecognized, type UsageWindow, windowKind } from './usage'

/*
 * Where each (agent, provider) pair's plan usage comes from
 * (docs/plans/plan-usage.md, ADR-061). A pair that can be a plan declares its
 * sources, best first: ACP, an adapter's extension, the agent's own channel,
 * the provider's usage endpoint read with the account's own sign-in (the
 * usage read, `usageRead.ts`). One with none says why, in words the person
 * reads calmly: a test lists them, so a new one can't slip in unsaid.
 */

/** A source the agent or its adapter gives. */
export type PlainSource =
  | { readonly kind: 'acp' }
  | { readonly kind: 'acp_extension'; readonly via: string }
  | { readonly kind: 'agent'; readonly channel: 'codex-app-server' }

/** Where a usage read takes the account's token from. */
export type TokenSource =
  /** A file in the account's home, and the path to the token in its JSON. */
  | { readonly kind: 'file'; readonly location: TokenLocation }
  /** Claude Code's sign-in: on a Mac its keychain item for the home, elsewhere `.credentials.json` in it. */
  | { readonly kind: 'claude'; readonly path: ReadonlyArray<PathStep> }

/**
 * A provider's usage URL, called with an account's token under ADR-061: only
 * `https`, `GET`, one host and one path, on the allowlist. `seen` is where the
 * request and its answer were seen working.
 */
export interface EndpointSource {
  readonly kind: 'endpoint'
  readonly id: string
  readonly url: string
  readonly method: 'GET'
  readonly token: TokenSource
  /** Headers besides the token's, fixed by the registry. */
  readonly headers?: Readonly<Record<string, string>>
  /** Headers naming the account, from the token's own file (Codex's account id, Grok's user id): never a secret. */
  readonly accountHeaders?: ReadonlyArray<{ readonly header: string; readonly path: ReadonlyArray<PathStep> }>
  /** Where the endpoint wants the agent's own client named, as its CLI names itself, with its version where known. */
  readonly userAgent?: (version: string | undefined) => string
  /** The least time between two reads of an account, in ms: a minute, unless the provider limits reads harder. */
  readonly every?: number
  readonly seen: string
  readonly parse: (answer: unknown, now: Date) => ReadonlyArray<UsageWindow>
}

/** No reading, on purpose: why, as the person reads it. */
export interface NoReading {
  readonly kind: 'none'
  readonly why: string
}

export type UsageSourceSpec = PlainSource | EndpointSource | NoReading

/** How a pair is told apart as plan or key. */
export type Classification =
  /** The agent's sign-in status command (`signIn.paidBy`). */
  | 'status'
  /** `opencode auth list`'s output, one entry per provider (`openCodeCredentials`). */
  | 'auth_list'
  /** Whether the plan's sign-in the usage read takes is there: without it, the account is paid another way, as a key. */
  | 'token'
  /** Nothing the agent gives says: the account is taken for a plan, and says it has no reading. */
  | 'none'

export interface UsagePair {
  readonly agent: AgentId
  /** The provider the sign-in is for, by the agent's own id for it. */
  readonly provider: string
  /** A plan has windows to read; a key has none. */
  readonly pays: 'plan' | 'key'
  readonly classification: Classification
  readonly sources: ReadonlyArray<UsageSourceSpec>
}

/* The answers' shapes, as Orca reads them (stablyai/orca at ef950401, src/main/rate-limits/). */

/** A share given as a number, or a number in a string. */
const numberOf = (value: unknown): number | undefined => {
  const parsed = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : undefined
}

/** A time given as ISO 8601, or epoch seconds, or epoch ms past 1e10; absent as undefined, anything else unrecognized. */
const isoTime = (value: unknown): string | undefined => {
  if (value === null || value === undefined || value === '') return undefined
  if (typeof value === 'number') return isoSeconds(value > 1e10 ? value / 1000 : value)
  const at = typeof value === 'string' ? Date.parse(value) : Number.NaN
  if (Number.isNaN(at)) throw new Unrecognized('a reset time that is no date')
  return new Date(at).toISOString()
}

const percent = (used: number) => Math.min(100, Math.max(0, used))

/** One of Claude's windows: `utilization` (or `used_percentage`), 0 to 100, and `resets_at`. Null where the plan has none. */
const claudeWindow = (raw: unknown, window: Omit<UsageWindow, 'usedPercent' | 'resetsAt'>): UsageWindow | null => {
  if (raw === null || raw === undefined) return null
  const entry = record(raw)
  const used = numberOf(entry?.utilization) ?? numberOf(entry?.used_percentage) ?? numberOf(entry?.percent)
  if (entry === null || used === undefined) throw new Unrecognized('a window without a use')
  const resetsAt = isoTime(entry.resets_at)
  return { ...window, usedPercent: percent(used), ...(resetsAt === undefined ? {} : { resetsAt }) }
}

/**
 * The windows in Claude's usage answer (`/api/oauth/usage`): five hours and
 * a week, a model's own week where its plan has one (`seven_day_opus`, or a
 * scoped entry in `limits`), and extra usage, money past the plan, where it
 * is turned on. An answer with neither the five hours nor the week is not one
 * Althar knows.
 */
export const claudeUsageWindows = (answer: unknown): ReadonlyArray<UsageWindow> => {
  const body = record(answer)
  if (body === null || (body.five_hour === undefined && body.seven_day === undefined)) throw new Unrecognized('no five hours or week')
  const windows = [
    claudeWindow(body.five_hour, { kind: 'five_hour' }),
    claudeWindow(body.seven_day, { kind: 'weekly' }),
    claudeWindow(body.seven_day_opus, { kind: 'weekly', label: 'Opus', model: 'opus' }),
    claudeWindow(body.seven_day_sonnet, { kind: 'weekly', label: 'Sonnet', model: 'sonnet' }),
  ]
  for (const limit of Array.isArray(body.limits) ? body.limits : []) {
    const entry = record(limit)
    const name = record(record(entry?.scope)?.model)?.display_name
    if (entry?.kind !== 'weekly_scoped' || entry.is_active === false || typeof name !== 'string' || name === '') continue
    const label = `${name.charAt(0).toUpperCase()}${name.slice(1)}`
    if (windows.some((window) => window?.label === label)) continue
    windows.push(claudeWindow(entry, { kind: 'weekly', label, model: name.toLowerCase() }))
  }
  const extra = record(body.extra_usage)
  const spent = numberOf(extra?.utilization)
  if (extra?.is_enabled === true && spent !== undefined)
    windows.push({ kind: 'other', label: 'Extra usage', usedPercent: percent(spent), spend: true })
  return windows.filter((window): window is UsageWindow => window !== null)
}

/* ChatGPT's usage answer (`wham/usage`), as Codex's own sign-in reads it. */
const chatGptWindow = (raw: unknown): UsageWindow | null => {
  if (raw === null || raw === undefined) return null
  const window = record(raw)
  const used = numberOf(window?.used_percent)
  if (window === null || used === undefined) throw new Unrecognized('a window without a use')
  const seconds = numberOf(window.limit_window_seconds)
  const minutes = seconds === undefined ? undefined : seconds / 60
  const resetsAt = isoSeconds(window.reset_at)
  return {
    kind: windowKind(minutes),
    ...(minutes === undefined ? {} : { minutes }),
    usedPercent: percent(used),
    ...(resetsAt === undefined ? {} : { resetsAt }),
  }
}

/** The windows in ChatGPT's usage answer. Slots are not durations: each is classified by its length. */
export const chatGptUsageWindows = (answer: unknown): ReadonlyArray<UsageWindow> => {
  const limits = record(record(answer)?.rate_limit)
  if (limits === null) throw new Unrecognized('no rate limit')
  return [chatGptWindow(limits.primary_window), chatGptWindow(limits.secondary_window)].filter((w): w is UsageWindow => w !== null)
}

/** One of Kimi Code's quotas: `limit` and `used` (or `remaining`), as numbers or strings, and its reset. */
const kimiWindow = (raw: unknown, minutes: number): UsageWindow | null => {
  const detail = record(raw)
  if (detail === null) return null
  const limit = numberOf(detail.limit)
  const used = numberOf(detail.used) ?? (limit === undefined ? undefined : limit - (numberOf(detail.remaining) ?? Number.NaN))
  if (limit === undefined || limit <= 0 || used === undefined || Number.isNaN(used)) return null
  const resetsAt = isoTime(detail.resetTime ?? detail.resetAt)
  return { kind: windowKind(minutes), minutes, usedPercent: percent((used / limit) * 100), ...(resetsAt === undefined ? {} : { resetsAt }) }
}

const KIMI_UNITS: ReadonlyArray<readonly [RegExp, number]> = [
  [/SECOND/, 1 / 60],
  [/MINUTE/, 1],
  [/HOUR/, 60],
  [/DAY/, 24 * 60],
]

/** The windows in Kimi Code's usage answer (`/coding/v1/usages`): `usage` is the week, and `limits` the shorter windows, each with its length. */
export const kimiUsageWindows = (answer: unknown): ReadonlyArray<UsageWindow> => {
  const body = record(answer)
  if (body === null) throw new Unrecognized('no usage')
  const windows = [kimiWindow(body.usage, 7 * 24 * 60)]
  for (const limit of Array.isArray(body.limits) ? body.limits : []) {
    const window = record(record(limit)?.window)
    const duration = numberOf(window?.duration)
    const unit = String(window?.timeUnit ?? '').toUpperCase()
    const minutes = duration === undefined ? 5 * 60 : duration * (KIMI_UNITS.find(([named]) => named.test(unit))?.[1] ?? 1)
    windows.push(kimiWindow(record(limit)?.detail, Math.round(minutes)))
  }
  const found = windows.filter((window): window is UsageWindow => window !== null)
  if (found.length === 0) throw new Unrecognized('no quota')
  return found
}

/** A sum of money as Grok gives it: `{ val }`, a number or a string. */
const moneyOf = (value: unknown) => numberOf(record(value)?.val)

/**
 * The windows in Grok's billing answer (`/v1/billing?format=credits`, its
 * own fields or under `config`): the week's credits used, in percent, and the
 * month's spend against its limit where it has one, each until its period
 * ends. A week the answer confirms with no share given is unused.
 */
export const grokUsageWindows = (answer: unknown): ReadonlyArray<UsageWindow> => {
  const body = record(answer)
  const config = record(body?.config) ?? body
  if (config === null) throw new Unrecognized('no billing')
  const period = record(config.currentPeriod)
  const ends = isoTime(period?.end ?? config.billingPeriodEnd)
  const windows: UsageWindow[] = []
  const limit = moneyOf(config.monthlyLimit)
  const used = moneyOf(config.used)
  const monthly = limit !== undefined && limit > 0 && used !== undefined
  const weekly = numberOf(config.creditUsagePercent) ?? (period?.type === 'USAGE_PERIOD_TYPE_WEEKLY' && !monthly ? 0 : undefined)
  if (weekly !== undefined)
    windows.push({ kind: 'weekly', usedPercent: percent(weekly), ...(ends === undefined ? {} : { resetsAt: ends }) })
  if (monthly)
    windows.push({ kind: 'monthly', usedPercent: percent((used / limit) * 100), ...(ends === undefined ? {} : { resetsAt: ends }) })
  if (windows.length === 0) throw new Unrecognized('no credits or monthly spend')
  return windows
}

const claudeEndpoint: EndpointSource = {
  kind: 'endpoint',
  id: 'claude-oauth',
  url: 'https://api.anthropic.com/api/oauth/usage',
  method: 'GET',
  token: { kind: 'claude', path: ['claudeAiOauth', 'accessToken'] },
  headers: { 'anthropic-beta': 'oauth-2025-04-20' },
  // It answers only Claude Code's own client, and limits how often it is asked (it may say wait an hour).
  userAgent: (version) => `claude-code/${version ?? '2.1.0'}`,
  every: 5 * 60_000,
  seen: 'Orca, rate-limits/claude-oauth-usage-request.ts; CodexBar docs/claude.md',
  parse: (answer) => claudeUsageWindows(answer),
}

const chatGptEndpoint: EndpointSource = {
  kind: 'endpoint',
  id: 'codex-chatgpt',
  url: 'https://chatgpt.com/backend-api/wham/usage',
  method: 'GET',
  token: { kind: 'file', location: { file: 'auth.json', path: ['tokens', 'access_token'] } },
  headers: { 'OpenAI-Beta': 'codex-1', originator: 'Codex Desktop' },
  accountHeaders: [{ header: 'ChatGPT-Account-Id', path: ['tokens', 'account_id'] }],
  userAgent: () => 'codex-cli',
  seen: 'Orca, rate-limits/codex-backend-usage-client.ts and codex-backend-auth.ts',
  parse: (answer) => chatGptUsageWindows(answer),
}

const kimiEndpoint: EndpointSource = {
  kind: 'endpoint',
  id: 'kimi-usages',
  url: 'https://api.kimi.com/coding/v1/usages',
  method: 'GET',
  // Its sign-in lasts a quarter of an hour and Kimi Code renews it as it runs: Althar never does, which would sign the CLI out.
  token: { kind: 'file', location: { file: 'credentials/kimi-code.json', path: ['access_token'] } },
  seen: 'Orca, rate-limits/kimi-fetcher.ts',
  parse: (answer) => kimiUsageWindows(answer),
}

const grokEndpoint: EndpointSource = {
  kind: 'endpoint',
  id: 'grok-billing',
  url: 'https://cli-chat-proxy.grok.com/v1/billing?format=credits',
  method: 'GET',
  // Its sign-ins are kept by issuer; xAI's own is `https://auth.x.ai`, alone or with its client after `::`.
  token: { kind: 'file', location: { file: 'auth.json', path: [{ startsWith: 'https://auth.x.ai' }, 'key'] } },
  headers: { 'X-XAI-Token-Auth': 'xai-grok-cli' },
  accountHeaders: [{ header: 'x-userid', path: [{ startsWith: 'https://auth.x.ai' }, 'user_id'] }],
  seen: 'Orca, rate-limits/grok-fetcher.ts and grok-auth.ts',
  parse: (answer) => grokUsageWindows(answer),
}

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

const none = (why: string): NoReading => ({ kind: 'none', why })

export const usagePairs: ReadonlyArray<UsagePair> = deepFreeze([
  {
    agent: 'claude-code',
    provider: 'anthropic',
    pays: 'plan',
    classification: 'status',
    // While a session runs, each window as it changes; for any account, the endpoint, at most every five minutes.
    sources: [{ kind: 'acp_extension', via: '_meta["_claude/rateLimit"]' }, claudeEndpoint],
  },
  { agent: 'claude-code', provider: 'anthropic', pays: 'key', classification: 'status', sources: [] },
  {
    agent: 'codex',
    provider: 'openai',
    pays: 'plan',
    classification: 'status',
    // Its app-server first; the endpoint only where that can't answer.
    sources: [{ kind: 'agent', channel: 'codex-app-server' }, chatGptEndpoint],
  },
  { agent: 'codex', provider: 'openai', pays: 'key', classification: 'status', sources: [] },
  {
    agent: 'opencode',
    provider: 'openai',
    pays: 'plan',
    classification: 'auth_list',
    sources: [
      none('OpenCode keeps its ChatGPT sign-in in its own database, which Althar doesn’t open. Codex shows the same plan’s usage.'),
    ],
  },
  {
    agent: 'opencode',
    provider: 'opencode',
    pays: 'plan',
    classification: 'auth_list',
    sources: [none('OpenCode Go’s usage needs its key from OpenCode’s own database, which Althar doesn’t open.')],
  },
  {
    agent: 'opencode',
    provider: 'github-copilot',
    pays: 'plan',
    classification: 'auth_list',
    sources: [none('OpenCode keeps its GitHub Copilot sign-in in its own database, which Althar doesn’t open.')],
  },
  {
    agent: 'opencode',
    provider: 'google',
    pays: 'plan',
    classification: 'auth_list',
    sources: [none('Google doesn’t report a Gemini plan’s usage to other apps’ sign-ins.')],
  },
  { agent: 'opencode', provider: 'api-key', pays: 'key', classification: 'auth_list', sources: [] },
  { agent: 'grok', provider: 'xai', pays: 'plan', classification: 'status', sources: [grokEndpoint] },
  { agent: 'kimi', provider: 'moonshot', pays: 'plan', classification: 'token', sources: [kimiEndpoint] },
  {
    agent: 'copilot',
    provider: 'github',
    pays: 'plan',
    classification: 'none',
    sources: [none('Copilot shows its premium requests in its own window and in your GitHub settings, not to other apps.')],
  },
  {
    agent: 'junie',
    provider: 'jetbrains',
    pays: 'plan',
    classification: 'none',
    sources: [none('Junie shows its JetBrains AI credits only in its own /stats, not to other apps.')],
  },
  {
    agent: 'mistral-vibe',
    provider: 'mistral',
    pays: 'plan',
    classification: 'none',
    sources: [none('Mistral shows Vibe’s usage only in its own console, not to other apps.')],
  },
  {
    agent: 'qwen-code',
    provider: 'qwen',
    pays: 'plan',
    classification: 'none',
    sources: [none('Qwen Code says its quota only when it runs out, not before.')],
  },
  {
    agent: 'antigravity',
    provider: 'google',
    pays: 'plan',
    classification: 'none',
    sources: [none('Althar runs Antigravity’s ACP server, which doesn’t report usage. Antigravity’s own agy app shows it under /usage.')],
  },
])

export const endpointSources = (): ReadonlyArray<EndpointSource> =>
  usagePairs.flatMap((pair) => pair.sources.filter((source): source is EndpointSource => source.kind === 'endpoint'))

/** Why a pair has no reading, where it has none: the first `none` among its sources. */
export const noReadingOf = (pair: UsagePair): string | null =>
  pair.sources.find((source): source is NoReading => source.kind === 'none')?.why ?? null

/** An agent's plan pair: the first it declares (OpenCode's are per provider, read from its own listing). */
export const planPairOf = (agent: string): UsagePair | undefined => usagePairs.find((pair) => pair.agent === agent && pair.pays === 'plan')

/** The hosts and paths a usage read may call, and no others (ADR-061), each with the one query it may carry. */
export const allowedEndpoints: ReadonlyArray<{ readonly host: string; readonly path: string; readonly search?: string }> = deepFreeze([
  { host: 'api.anthropic.com', path: '/api/oauth/usage' },
  { host: 'chatgpt.com', path: '/backend-api/wham/usage' },
  { host: 'api.kimi.com', path: '/coding/v1/usages' },
  { host: 'cli-chat-proxy.grok.com', path: '/v1/billing', search: '?format=credits' },
])

/** Why a source may not be called, or null where it may. */
export const endpointProblem = (
  source: EndpointSource,
  allowed: ReadonlyArray<{ readonly host: string; readonly path: string; readonly search?: string }> = allowedEndpoints,
): string | null => {
  let url: URL
  try {
    url = new URL(source.url)
  } catch {
    return 'its URL is not a URL'
  }
  if (url.protocol !== 'https:') return 'its URL is not https'
  if (url.username !== '' || url.password !== '' || url.port !== '' || url.hash !== '')
    return 'its URL carries more than a host, a path and a query'
  if (source.method !== 'GET') return 'it is not a GET'
  if (!allowed.some((entry) => entry.host === url.hostname && entry.path === url.pathname && (entry.search ?? '') === url.search))
    return 'its host, path and query are not on the allowlist'
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

/* OpenCode: which of an account's sign-ins are plans and which are keys, from its own listing. */

/** The first major version of OpenCode whose `auth list` takes `--standalone --format json`: 1.x has neither, and exits 1. */
export const OPENCODE_LISTS_SIGN_INS_FROM = 2

/**
 * Why an OpenCode at this major version can't say which sign-ins are plans,
 * so its listing isn't run; null where it can. Unknown is not taken for 2.
 */
export const openCodeCannotList = (name: string, major: number | undefined): string | null =>
  major === undefined
    ? `Althar couldn’t tell which version of ${name} this is, so it can’t tell its plans from its API keys. Check that its --version answers.`
    : major < OPENCODE_LISTS_SIGN_INS_FROM
      ? `${name} ${major} can’t tell plans from API keys: it doesn’t list which of its sign-ins are which, so Althar can’t show a plan’s usage.`
      : null

export type CredentialsRead =
  | { readonly kind: 'credentials'; readonly credentials: ReadonlyArray<OpenCodeCredential> }
  /** It could not be listed, or the listing is not the shape known (OpenCode 1.x prints a count only): a fault, never "no sign-ins". */
  | { readonly kind: 'failed'; readonly message: string }

/**
 * Runs the agent's own listing of sign-ins in an account's home and reads it.
 * It lists; it opens no credential file. A command that fails, or
 * prints another shape, is a fault to show.
 */
export const readOpenCodeCredentials = (
  agent: AgentDefinition,
  options: { readonly node?: string; readonly home?: Readonly<Record<string, string>>; readonly timeout?: number } = {},
): Promise<CredentialsRead> =>
  new Promise((resolve) => {
    const credentials = agent.signIn.credentials
    if (credentials === undefined) return resolve({ kind: 'failed', message: `${agent.name} cannot list its sign-ins.` })
    const spec = credentials(options.node ?? process.execPath)
    const inherited = { ...childEnvironment(spec), ...options.home }
    const launched = spec.onDevice === undefined ? spec : spec.onDevice({ env: inherited })
    const env = launched === spec ? inherited : { ...childEnvironment(launched), ...options.home }
    execFile(launched.command, [...launched.args], { timeout: options.timeout ?? 15_000, env }, (error, stdout, stderr) => {
      if (error !== null) {
        // Why, in a few words, for the person to act on: a missing command, an unknown flag, a timeout.
        const why = (String(stderr).trim().split('\n').pop() || error.message.split('\n')[0] || '').slice(0, 160)
        return resolve({
          kind: 'failed',
          message: `${agent.name} would not list its sign-ins${why === '' ? '' : `: ${why}`}.`.replace(/\.+$/, '.'),
        })
      }
      const found = openCodeCredentials(stdout)
      resolve(
        found === null
          ? { kind: 'failed', message: `${agent.name} listed its sign-ins in a form Althar does not know.` }
          : { kind: 'credentials', credentials: found },
      )
    })
  })
