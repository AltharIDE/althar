import { execFile } from 'node:child_process'

import { childEnvironment } from './process'
import type { AgentDefinition, AgentId } from './registry'
import { record } from './usage'

/*
 * Where each (agent, provider) pair's plan usage comes from
 * (docs/plans/plan-usage.md). Usage is required for every
 * subscription, so a pair that can be a plan declares at least one source, and
 * how it is told from a key; a test fails for one that does not. The sources
 * are tried best first: ACP, an adapter's extension, the agent's own channel.
 * A provider's usage endpoint is not among them yet: reading one with an
 * account's token needs a decision of its own, which comes with #221.
 */

/** A source the agent or its adapter gives. `built` says whether Althar has code for it yet. */
export type PlainSource =
  | { readonly kind: 'acp'; readonly built: boolean }
  | { readonly kind: 'acp_extension'; readonly via: string; readonly built: boolean }
  | { readonly kind: 'agent'; readonly channel: 'codex-app-server' | 'claude-agent-sdk'; readonly built: boolean }

/** A gap declared on purpose: the pair has no source until a spike finds one. Listed by the contract test. */
export interface SpikeSource {
  readonly kind: 'spike'
  readonly note: string
}

export type UsageSourceSpec = PlainSource | SpikeSource

/** How a pair is told apart as plan or key. */
export type Classification =
  /** The agent's sign-in status command (`signIn.paidBy`). */
  | 'status'
  /** `opencode auth list`'s output, one entry per provider (`openCodeCredentials`). */
  | 'auth_list'
  /** Nothing the agent gives says yet: the account is taken for a plan, which says it has no source. */
  | 'none'

export interface UsagePair {
  readonly agent: AgentId
  /** The provider the sign-in is for, by the agent's own id for it. */
  readonly provider: string
  /** A plan has windows to read; a key has none, and says what the provider documents. */
  readonly pays: 'plan' | 'key'
  readonly classification: Classification
  readonly sources: ReadonlyArray<UsageSourceSpec>
}

export const usagePairs: ReadonlyArray<UsagePair> = [
  {
    agent: 'claude-code',
    provider: 'anthropic',
    pays: 'plan',
    classification: 'status',
    // No endpoint: Anthropic's terms bar it. Both are planned (stage 2).
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
    sources: [{ kind: 'agent', channel: 'codex-app-server', built: true }],
  },
  { agent: 'codex', provider: 'openai', pays: 'key', classification: 'status', sources: [] },
  {
    agent: 'opencode',
    provider: 'openai',
    pays: 'plan',
    classification: 'auth_list',
    sources: [
      { kind: 'spike', note: 'ChatGPT: its usage endpoint, read with the sign-in’s token, waits on a spike and its own decision (#221)' },
    ],
  },
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
  // The agents run over ACP (#266): none sends its plan's windows yet, so each waits for a spike of its own.
  ...(
    [
      ['copilot', 'github', 'none', 'GitHub Copilot: its premium requests; usage limits come only as errors'],
      ['junie', 'jetbrains', 'none', 'Junie: the JetBrains AI quota, not sent over ACP'],
      ['grok', 'xai', 'status', 'Grok Build: its SuperGrok plan, not sent over ACP'],
      ['kimi', 'moonshot', 'none', 'Kimi Code: its membership plan, not sent over ACP'],
      ['mistral-vibe', 'mistral', 'none', 'Mistral Vibe: its Le Chat plan, not sent over ACP'],
      ['qwen-code', 'qwen', 'none', 'Qwen Code: its Qwen OAuth quota, not sent over ACP'],
      ['antigravity', 'google', 'none', 'Google Antigravity: its plan, not sent over ACP'],
    ] as const
  ).map(([agent, provider, classification, note]): UsagePair => ({
    agent,
    provider,
    pays: 'plan',
    classification,
    sources: [{ kind: 'spike', note }],
  })),
]

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
