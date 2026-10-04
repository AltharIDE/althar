/*
 * The agents the developer page names, and how each is signed in. Plain data:
 * the marks are chosen where they are drawn (shared/AgentMark.tsx). OpenCode
 * has no mark in @althar/ui, so it gets a plain one there.
 *
 * AGENTS is what Althar runs today, as packages/provider-adapters' registry
 * has it. Gemini is named on the page, in the "best right now" reel, but
 * Althar doesn't run it yet, so it isn't in AGENTS.
 */

export enum Agent {
  Claude = 'claude',
  Codex = 'codex',
  Gemini = 'gemini',
  OpenCode = 'opencode',
}

export interface AgentInfo {
  id: Agent
  name: string
  /** What you're signed in with, as the agent's own CLI is. */
  signIn: string
  /** What Althar starts: the ACP adapter it ships with, or your own install. */
  runs: { code: string; whose: 'bundled' | 'yours' }
}

export const AGENTS: readonly AgentInfo[] = [
  { id: Agent.Claude, name: 'Claude Code', signIn: 'Claude Pro or Max', runs: { code: 'claude-agent-acp', whose: 'bundled' } },
  { id: Agent.Codex, name: 'Codex', signIn: 'ChatGPT Plus, Pro or Business', runs: { code: 'codex-acp', whose: 'bundled' } },
  { id: Agent.OpenCode, name: 'OpenCode', signIn: 'Any API key, or a local model', runs: { code: 'opencode acp', whose: 'yours' } },
]

const NAMED: Record<Agent, string> = {
  [Agent.Claude]: 'Claude Code',
  [Agent.Codex]: 'Codex',
  [Agent.Gemini]: 'Gemini',
  [Agent.OpenCode]: 'OpenCode',
}

export const agentName = (id: Agent): string => NAMED[id]
