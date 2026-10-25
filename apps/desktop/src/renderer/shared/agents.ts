import type { AgentStatus, HeldForConnection, Queued } from '@althar/contracts'
import { Brand, type PinnedDownload } from '@althar/ui'

import { device } from './device'

/*
 * How an agent is drawn: its mark, and its words. Who works is named by
 * model, from the agent's own list (see models.ts and modelNames.ts).
 */

/** Whether the person can pick the agent for work: it is installed here, and not signed out (one that doesn't say is let through). */
export const canPick = (agent: AgentStatus): boolean => agent.installed && agent.signIn !== 'signed_out'

const BRANDS: Readonly<Record<string, Brand>> = {
  'claude-code': Brand.Anthropic,
  codex: Brand.OpenAI,
  opencode: Brand.OpenCode,
  copilot: Brand.GitHubCopilot,
  junie: Brand.Junie,
  grok: Brand.XAI,
  kimi: Brand.Moonshot,
  'mistral-vibe': Brand.Mistral,
  'qwen-code': Brand.Alibaba,
  antigravity: Brand.Antigravity,
}

export const brandOf = (agentId: string): Brand | undefined => BRANDS[agentId]

/** The work a step held for a usage limit stopped, as a card and the task's header say it: what waits. */
const heldWork: Readonly<Record<string, string>> = { review: 'The review waits', settle: 'The fixes wait' }

/**
 * What a step held for a usage limit waits for: the agent that ran out, and
 * when it is back; with the step, what waits too, where there is room for it,
 * as in the task's header. A card says Paused and shows its step already.
 */
export const waitsWords = (agent: string, at: string, step?: string | null) =>
  `${step === undefined ? '' : `${heldWork[step ?? ''] ?? 'The work waits'}: `}${agent} is out of usage until ${at}`

/**
 * What a step held for the connection waits for (ADR-060): the connection,
 * while the computer is offline or its service out of reach; else the try
 * again at its service, which failed, and when. `at` says a time as the
 * window does.
 */
export const reconnectsWords = (held: HeldForConnection, at: (iso: string) => string) =>
  held.offline || held.next === null ? 'Waiting for the connection' : `${held.service} failed: trying again at ${at(held.next)}`

/**
 * What work waiting for a free agent waits for (ADR-032): every agent this
 * computer runs at once is busy, its own task's left out. More busy than
 * that, by what the person started or after they lowered the number, says
 * how many more.
 */
export const queuedWords = (queued: Queued, where: string = device.this) => `Waiting: ${busyWords(queued, where)}`

/** 1 → Next, 2 → 2nd, 3 → 3rd, 11 → 11th. */
const ordinal = (n: number) => {
  if (n === 1) return 'Next'
  const tens = n % 100
  const suffix = tens >= 11 && tens <= 13 ? 'th' : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th'
  return `${n}${suffix}`
}

/** Where a task waiting for a free agent stands in its project's line: Next in line, 2nd in line. */
export const inLineWords = (place: number) => `${ordinal(place)} in line`

/** Where a task waiting for a free agent stands in its project's line, as the chip over its composer says it: First in Up next, 2nd in Up next. */
export const upNextWords = (place: number) => `${place === 1 ? 'First' : ordinal(place)} in Up next`

/** How busy this computer's agents are, as work that waits for one says it. */
export const busyWords = ({ busy, atOnce }: Queued, where: string = device.this) =>
  `${Math.min(busy, atOnce)} of ${atOnce} agents busy on ${where}${busy > atOnce ? `, and ${busy - atOnce} more` : ''}`

/**
 * The same, short, for a project's tasks on the home, which is this
 * computer's anyway: how many wait, and for what, in the line under the
 * project's name.
 */
export const queuedOfWords = (n: number, { busy, atOnce }: Queued) =>
  `${n === 1 ? 'Waiting' : `${n} waiting`}: ${Math.min(busy, atOnce)} of ${atOnce} agents busy${busy > atOnce ? `, and ${busy - atOnce} more` : ''}`

/** What an agent signs in to in the browser, as the window names it: the plan, and the site that asks. */
const SIGN_IN: Readonly<Record<string, { readonly plan: string; readonly host: string }>> = {
  'claude-code': { plan: 'Claude', host: 'claude.ai' },
  codex: { plan: 'ChatGPT', host: 'chatgpt.com' },
  antigravity: { plan: 'Google', host: 'accounts.google.com' },
}

export const signInWordsOf = (agentId: string): { readonly plan: string; readonly host: string } =>
  SIGN_IN[agentId] ?? { plan: 'your account', host: 'the sign-in page' }

/** What an agent's maker puts on signing in from an app such as Althar, said before the person signs in (ADR-050). */
const CAUTIONS: Readonly<Record<string, string>> = {
  antigravity: 'Google’s terms may count signing in to Antigravity from another app as a breach, which can suspend the account.',
}

export const signInCautionOf = (agentId: string): string | undefined => CAUTIONS[agentId]

/** Who makes an agent, as Settings says it under its name; none for one that runs anyone's models. */
const MAKERS: Readonly<Record<string, string>> = {
  'claude-code': 'Anthropic',
  codex: 'OpenAI',
  grok: 'xAI',
  kimi: 'Moonshot AI',
  'mistral-vibe': 'Mistral AI',
  antigravity: 'Google',
}

/** A download of one version from its maker (Antigravity's server, from Google), rather than a latest release on GitHub: who from, and which. */
export const pinnedOf = (agent: Pick<AgentStatus, 'id' | 'name' | 'download'>): PinnedDownload | undefined =>
  agent.download?.pinned == null ? undefined : { from: MAKERS[agent.id] ?? agent.name, version: agent.download.pinned }

/** What Settings says under an agent's name: who makes it, and its version, where known. */
export const agentLineOf = (agent: { readonly id: string; readonly version: string | null }): string | undefined => {
  const line = [MAKERS[agent.id], agent.version].filter((part) => part != null).join(' · ')
  return line === '' ? undefined : line
}
