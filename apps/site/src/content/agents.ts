/*
 * The agents the developer page names, and how each is signed in. Plain data:
 * the marks are chosen where they are drawn (shared/AgentMark.tsx). OpenCode
 * has no mark in @althar/ui, so it gets a plain one there.
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
  /** The command Althar runs. */
  command: string
}

export const AGENTS: readonly AgentInfo[] = [
  { id: Agent.Claude, name: 'Claude Code', signIn: 'Claude Pro or Max', command: 'claude' },
  { id: Agent.Codex, name: 'Codex', signIn: 'ChatGPT Plus, Pro or Business', command: 'codex' },
  { id: Agent.Gemini, name: 'Gemini', signIn: 'Your Google account', command: 'gemini' },
  { id: Agent.OpenCode, name: 'OpenCode', signIn: 'Any API key, or a local model', command: 'opencode' },
]

export const agentName = (id: Agent): string => AGENTS.find((a) => a.id === id)?.name ?? id
