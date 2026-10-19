import type { Queued } from '@althar/contracts'
import { Brand } from '@althar/ui'

import { device } from './device'

/*
 * How an agent is drawn: its mark, and its words. Who works is named by
 * model, from the agent's own list (see models.ts and modelNames.ts).
 */

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
}

export const brandOf = (agentId: string): Brand | undefined => BRANDS[agentId]

/** What a step held for a usage limit waits for: the agent, and when it is back. */
export const waitsWords = (agent: string, at: string) => `Waits for ${agent}, back at ${at}`

/**
 * What work waiting for a free agent waits for (ADR-032): every agent this
 * computer runs at once is busy. More busy than that, after the person
 * lowered the number, says both.
 */
export const queuedWords = (queued: Queued, where: string = device.this) => `Waiting: ${busyWords(queued, where)}`

/** How busy this computer's agents are, as work that waits for one says it. */
export const busyWords = ({ busy, atOnce }: Queued, where: string = device.this) =>
  busy > atOnce ? `${busy} agents busy on ${where}, which runs ${atOnce} at once` : `${busy} of ${atOnce} agents busy on ${where}`

/**
 * The same, short, for a project's tasks on the home, which is this
 * computer's anyway: how many wait, and for what, in the line under the
 * project's name.
 */
export const queuedOfWords = (n: number, { busy, atOnce }: Queued) =>
  `${n === 1 ? 'Waiting' : `${n} waiting`}: ${busy > atOnce ? `${busy} agents busy, ${atOnce} at once` : `${busy} of ${atOnce} agents busy`}`

/** What an agent signs in to in the browser, as the window names it: the plan, and the site that asks. */
const SIGN_IN: Readonly<Record<string, { readonly plan: string; readonly host: string }>> = {
  'claude-code': { plan: 'Claude', host: 'claude.ai' },
  codex: { plan: 'ChatGPT', host: 'chatgpt.com' },
}

export const signInWordsOf = (agentId: string): { readonly plan: string; readonly host: string } =>
  SIGN_IN[agentId] ?? { plan: 'your account', host: 'the sign-in page' }

/** Who makes an agent, as Settings says it under its name; none for one that runs anyone's models. */
const MAKERS: Readonly<Record<string, string>> = {
  'claude-code': 'Anthropic',
  codex: 'OpenAI',
  grok: 'xAI',
  kimi: 'Moonshot AI',
  'mistral-vibe': 'Mistral AI',
}

/** What Settings says under an agent's name: who makes it, and its version, where known. */
export const agentLineOf = (agent: { readonly id: string; readonly version: string | null }): string | undefined => {
  const line = [MAKERS[agent.id], agent.version].filter((part) => part != null).join(' · ')
  return line === '' ? undefined : line
}
