import type { Connection } from '../client/AltharClient'

/*
 * Small words the phone's screens share: who works, for how long, since when.
 */

const AGENTS: Readonly<Record<string, string>> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  copilot: 'GitHub Copilot',
  opencode: 'OpenCode',
  'qwen-code': 'Qwen Code',
  grok: 'Grok',
}

export const agentName = (agentId: string | null): string => (agentId === null ? 'An agent' : (AGENTS[agentId] ?? agentId))

const MODELS: Readonly<Record<string, string>> = {
  'claude-opus-5': 'Opus 5',
  'claude-sonnet-5': 'Sonnet 5',
  'gpt-5.5-codex': 'GPT-5.5',
  'gpt-5.5': 'GPT-5.5',
}

/** Who works is named by model, as on the desktop; the agent where the model isn't known. */
export const whoWorks = (agentId: string | null, model: string | null): string =>
  model === null ? agentName(agentId) : (MODELS[model] ?? model)

/** 12m, 1h 4m, 3d. */
export const duration = (ms: number): string => {
  const minutes = Math.max(0, Math.floor(ms / 60_000))
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return minutes % 60 === 0 ? `${hours}h` : `${hours}h ${minutes % 60}m`
  return `${Math.floor(hours / 24)}d`
}

/** Just now, 4m ago, 2h ago. */
export const since = (at: string, now: number): string => {
  const ms = now - Date.parse(at)
  return ms < 60_000 ? 'just now' : `${duration(ms)} ago`
}

/** 18:00, by the phone's clock. */
export const clock = (at: string): string => {
  const date = new Date(at)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** +312 −198 */
export const lines = (add: number | null, del: number | null): string => `+${add ?? 0} −${del ?? 0}`

export const plural = (count: number, one: string, many: string = `${one}s`): string => `${count} ${count === 1 ? one : many}`

/** What the connection banner says, or null while there is nothing to say. */
export const connectionWords = (connection: Connection, now: number): { readonly title: string; readonly detail: string } | null => {
  switch (connection.state) {
    case 'online':
      return null
    case 'unpaired':
      return { title: 'Not paired', detail: 'Pair with Althar on your Mac to see your work here.' }
    case 'connecting':
      return { title: `Reaching ${connection.mac.name}…`, detail: 'Althar on your Mac answers once it’s awake.' }
    case 'away':
      return {
        title: `${connection.mac.name} is away`,
        detail: `Asleep, offline, or Althar isn’t running. This is how things stood ${since(connection.lastSeen, now)}.`,
      }
  }
}
