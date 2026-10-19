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
}

export const brandOf = (agentId: string): Brand | undefined => BRANDS[agentId]

/** The work a step held for a usage limit stopped, as a card and the task's header say it: what waits. */
const heldWork: Readonly<Record<string, string>> = { review: 'The review waits', settle: 'The fixes wait' }

/** What a step held for a usage limit waits for, and why: which step, the agent that ran out, and when it is back. */
export const waitsWords = (agent: string, at: string, step: string | null = null) =>
  `${heldWork[step ?? ''] ?? 'The work waits'}: ${agent} is out of usage until ${at}`

/**
 * What work waiting for a free agent waits for (ADR-032): every agent this
 * computer runs at once is busy. More busy than that, after the person
 * lowered the number, says both.
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
const MAKERS: Readonly<Record<string, string>> = { 'claude-code': 'Anthropic', codex: 'OpenAI' }

/** What Settings says under an agent's name: who makes it, and its version, where known. */
export const agentLineOf = (agent: { readonly id: string; readonly version: string | null }): string | undefined => {
  const line = [MAKERS[agent.id], agent.version].filter((part) => part != null).join(' · ')
  return line === '' ? undefined : line
}
