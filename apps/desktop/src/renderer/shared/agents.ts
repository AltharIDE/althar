import { Brand } from '@althar/ui'

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

/** What a step held for a usage limit waits for: the agent, and when it is back. */
export const waitsWords = (agent: string, at: string) => `Waits for ${agent}, back at ${at}`

/** The site that asks, where an agent signs in in the browser. */
const SIGN_IN_HOSTS: Readonly<Record<string, string>> = { 'claude-code': 'claude.ai', codex: 'chatgpt.com' }

export const signInHostOf = (agentId: string): string => SIGN_IN_HOSTS[agentId] ?? 'the sign-in page'

/** Who makes an agent, as Settings says it under its name; none for one that runs anyone's models. */
const MAKERS: Readonly<Record<string, string>> = { 'claude-code': 'Anthropic', codex: 'OpenAI' }

/** What Settings says under an agent's name: who makes it, and its version, where known. */
export const agentLineOf = (agent: { readonly id: string; readonly version: string | null }): string | undefined => {
  const line = [MAKERS[agent.id], agent.version].filter((part) => part != null).join(' · ')
  return line === '' ? undefined : line
}
