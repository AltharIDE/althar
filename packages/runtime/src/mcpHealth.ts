import type { ServerSpec, SyncedAgent } from '@althar/provider-adapters'

import type { SyncIo } from './mcpSync'

/*
 * How each of the person's MCP servers stands in each of their agents, as the agents' own commands say it
 * (`claude mcp list`, `codex mcp list`, `opencode mcp list`), kept in Althar's own folder beside the sync record so the
 * tiles can say Failed to start and Not signed in without asking every agent each time. Stub: the implementation
 * (running, parsing and keeping) is built beside this interface; see the types for what the rest of the runtime reads.
 */

/** What an agent says of one server: connected, needs the person to sign in, failed to start (with its reason), or nothing readable. */
export type AgentStatus = 'connected' | 'needs-auth' | 'failed' | 'unknown'

export interface HealthEntry {
  readonly status: AgentStatus
  /** The agent's own words for why, where it gave any: for a failed start. */
  readonly why?: string
  /** When it was read. */
  readonly at: string
}

export interface HealthRecord {
  /** When the agents were last asked; null before the first time. */
  readonly checkedAt: string | null
  /** By server name, then agent. */
  readonly servers: Readonly<Record<string, Partial<Record<SyncedAgent, HealthEntry>>>>
}

export const emptyHealth: HealthRecord = { checkedAt: null, servers: {} }

/** What was last kept; empty where nothing was. Never runs a command. */
export const readHealth = (_io: SyncIo): HealthRecord => emptyHealth

/** Asks each agent that is on this computer, through its own command, how its servers stand; keeps the answer and returns it. */
export const checkHealth = (_io: SyncIo): Promise<HealthRecord> => Promise.resolve(emptyHealth)

/** What Althar's own check of a server found: how many tools it offers, or why it couldn't count them. */
export type Probed = { readonly tools: number } | { readonly tools: null; readonly why: string }

/** Starts the server (or calls its address), asks it for its tools and stops it; never throws. A stub until built. */
export const probeServer = (_spec: ServerSpec): Promise<Probed> => Promise.resolve({ tools: null, why: 'Not checked.' })
