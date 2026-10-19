/*
 * The agents the developer page names, and how each is signed in. Plain data:
 * the marks are chosen where they are drawn (shared/AgentMark.tsx). OpenCode
 * has no mark in @althar/ui, so it gets a plain one there.
 *
 * AGENTS is what Althar runs today, as packages/provider-adapters' registry
 * has it. The rest speak the Agent Client Protocol too (as the ACP registry
 * lists them) and are named in the hero and the "best right now" reel, but
 * Althar doesn't run them yet (ADR-050), so they aren't in AGENTS.
 */

export enum Agent {
  Claude = 'claude',
  Codex = 'codex',
  Gemini = 'gemini',
  OpenCode = 'opencode',
  Copilot = 'copilot',
  Cursor = 'cursor',
  Qwen = 'qwen',
  Kimi = 'kimi',
  Mistral = 'mistral',
  Junie = 'junie',
  Grok = 'grok',
  Antigravity = 'antigravity',
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
  {
    id: Agent.Copilot,
    name: 'GitHub Copilot',
    signIn: 'Copilot Pro, Pro+, Business or Enterprise',
    runs: { code: 'copilot --acp', whose: 'yours' },
  },
  { id: Agent.Junie, name: 'Junie', signIn: 'JetBrains AI Pro or Ultimate', runs: { code: 'junie --acp=true', whose: 'yours' } },
  { id: Agent.Grok, name: 'Grok Build', signIn: 'SuperGrok or X Premium+', runs: { code: 'grok agent stdio', whose: 'yours' } },
  { id: Agent.Kimi, name: 'Kimi Code', signIn: 'A Kimi Code membership', runs: { code: 'kimi acp', whose: 'yours' } },
  { id: Agent.Mistral, name: 'Mistral Vibe', signIn: 'Le Chat Pro or Team', runs: { code: 'vibe-acp', whose: 'yours' } },
  { id: Agent.Qwen, name: 'Qwen Code', signIn: 'Alibaba Cloud Coding Plan, or any API key', runs: { code: 'qwen --acp', whose: 'yours' } },
  {
    id: Agent.Antigravity,
    name: 'Google Antigravity',
    signIn: 'A Google account, in Althar',
    runs: { code: 'agy_acp_server.par', whose: 'yours' },
  },
]

const NAMED: Record<Agent, string> = {
  [Agent.Claude]: 'Claude Code',
  [Agent.Codex]: 'Codex',
  [Agent.Gemini]: 'Gemini',
  [Agent.OpenCode]: 'OpenCode',
  [Agent.Copilot]: 'GitHub Copilot',
  [Agent.Cursor]: 'Cursor',
  [Agent.Qwen]: 'Qwen Code',
  [Agent.Kimi]: 'Kimi Code',
  [Agent.Mistral]: 'Mistral Vibe',
  [Agent.Junie]: 'Junie',
  [Agent.Grok]: 'Grok Build',
  [Agent.Antigravity]: 'Google Antigravity',
}

export const agentName = (id: Agent): string => NAMED[id]
