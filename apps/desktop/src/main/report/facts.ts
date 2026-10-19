import { createRequire } from 'node:module'
import { basename } from 'node:path'

/*
 * What the runtime tells the main process for a report (DEV-61): ids,
 * versions, states and names, never what anyone wrote. The names are only
 * for hiding: the main process takes them out of everything it sends. It is
 * read here from the runtime's message, checked, as anything crossing
 * between processes is.
 */

export type AgentSignIn = 'signed_in' | 'signed_out' | 'unknown' | 'not_installed'

export interface AgentFacts {
  readonly id: string
  readonly name: string
  /** Its CLI's version, as it says it; null where it doesn't. */
  readonly version: string | null
  /** The ACP adapter Althar runs it through, by version; null where the agent speaks ACP itself. */
  readonly adapter: string | null
  /** Whether any of its accounts is signed in; never who as. */
  readonly signIn: AgentSignIn
}

/** A turn, by its ids and how it ended. */
export interface TurnFacts {
  readonly id: string
  readonly threadId: string
  readonly taskId: string | null
  readonly agent: string
  readonly state: string
  readonly errorClass: string | null
  readonly endedAt: string | null
}

export interface RuntimeFacts {
  readonly agents: ReadonlyArray<AgentFacts>
  /** The profile's migrations, in order. */
  readonly migrations: ReadonlyArray<{ readonly id: number; readonly name: string }>
  /** Names to hide: the projects' names and slugs. */
  readonly projects: ReadonlyArray<string>
  /** Names to hide: the repositories' names, slugs and folders, and the owners and names in their remotes. */
  readonly repositories: ReadonlyArray<string>
  /** The thread the report is about, by its task and project; null where it is about none, or the thread isn't known. */
  readonly thread: { readonly taskId: string | null; readonly projectId: string } | null
  /** The latest turns that ended with an error, and the task's own latest turns, newest first. */
  readonly turns: ReadonlyArray<TurnFacts>
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === 'object' && value !== null
const text = (value: unknown, max = 200): value is string => typeof value === 'string' && value.length <= max
const textOrNull = (value: unknown, max = 200): value is string | null => value === null || text(value, max)
const SIGN_INS: ReadonlyArray<string> = ['signed_in', 'signed_out', 'unknown', 'not_installed']

const agentIn = (value: unknown): AgentFacts | null =>
  isRecord(value) &&
  text(value.id, 64) &&
  text(value.name, 64) &&
  textOrNull(value.version, 64) &&
  textOrNull(value.adapter, 64) &&
  typeof value.signIn === 'string' &&
  SIGN_INS.includes(value.signIn)
    ? { id: value.id, name: value.name, version: value.version, adapter: value.adapter, signIn: value.signIn as AgentSignIn }
    : null

const turnIn = (value: unknown): TurnFacts | null =>
  isRecord(value) &&
  text(value.id, 64) &&
  text(value.threadId, 64) &&
  textOrNull(value.taskId, 64) &&
  text(value.agent, 64) &&
  text(value.state, 32) &&
  textOrNull(value.errorClass, 64) &&
  textOrNull(value.endedAt, 32)
    ? {
        id: value.id,
        threadId: value.threadId,
        taskId: value.taskId,
        agent: value.agent,
        state: value.state,
        errorClass: value.errorClass,
        endedAt: value.endedAt,
      }
    : null

const listOf = <T>(value: unknown, item: (each: unknown) => T | null, max: number): ReadonlyArray<T> =>
  Array.isArray(value) ? value.slice(0, max).flatMap((each) => item(each) ?? []) : []

/** As many agents as the Worker takes. Althar knows more than that. */
export const REPORTED_AGENTS = 10

/**
 * The agents a report names, as many as the Worker takes: those on this
 * computer first (installed, or with a version), as a report is about them,
 * each kept in the registry's order.
 */
export const reportedAgents = (agents: ReadonlyArray<AgentFacts>): ReadonlyArray<AgentFacts> => {
  const here = (agent: AgentFacts) => agent.signIn !== 'not_installed' && (agent.signIn !== 'unknown' || agent.version !== null)
  return [...agents.filter(here), ...agents.filter((agent) => !here(agent))].slice(0, REPORTED_AGENTS)
}

/** The runtime's facts, as far as they are what they should be; null where the message isn't them at all. */
export const factsIn = (value: unknown): RuntimeFacts | null => {
  if (!isRecord(value)) return null
  const thread = value.thread
  return {
    // Every agent Althar knows, as many as there could be; a report keeps those the Worker takes (reportedAgents).
    agents: listOf(value.agents, agentIn, 64),
    migrations: listOf(
      value.migrations,
      (each) =>
        isRecord(each) && typeof each.id === 'number' && Number.isInteger(each.id) && text(each.name, 200)
          ? { id: each.id, name: each.name }
          : null,
      500,
    ),
    projects: listOf(value.projects, (each) => (text(each, 200) ? each : null), 2_000),
    repositories: listOf(value.repositories, (each) => (text(each, 200) ? each : null), 5_000),
    thread:
      isRecord(thread) && textOrNull(thread.taskId, 64) && text(thread.projectId, 64)
        ? { taskId: thread.taskId, projectId: thread.projectId }
        : null,
    turns: listOf(value.turns, turnIn, 40),
  }
}

const require = createRequire(import.meta.url)

/** The ACP adapters Althar ships for agents that don't speak it themselves, by agent. */
const ADAPTERS: Readonly<Record<string, string>> = {
  'claude-code': '@agentclientprotocol/claude-agent-acp',
  codex: '@agentclientprotocol/codex-acp',
}

/** A bundled adapter's version, from its package; null where the agent has none, or it can't be read. */
export const adapterOf = (agentId: string): string | null => {
  const name = ADAPTERS[agentId]
  if (name === undefined) return null
  try {
    const found: unknown = require(`${name}/package.json`)
    return typeof found === 'object' && found !== null && 'version' in found && typeof found.version === 'string' ? found.version : null
  } catch {
    return null
  }
}

/** The owner and name a remote's address carries: github.com/owner/name.git, git@host:owner/name. */
export const remoteNames = (url: string): ReadonlyArray<string> => {
  const found = /[:/]([^/:\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(url)
  return found === null ? [] : [found[1] ?? '', found[2] ?? ''].filter((name) => name !== '')
}

const parsed = (json: string): unknown => {
  try {
    return JSON.parse(json)
  } catch {
    return null
  }
}

/** Every name a repository goes by, from the store's rows: its slug and name, its folders' names, and the owners and names in its remotes. */
export const repositoryNames = (rows: {
  readonly bindings: ReadonlyArray<{ readonly slug: string; readonly displayName: string; readonly remoteFingerprints: string }>
  readonly locations: ReadonlyArray<{ readonly path: string; readonly observedRemotes: string }>
  readonly folders: ReadonlyArray<{ readonly path: string }>
}): ReadonlyArray<string> => {
  const remotes = [...rows.bindings.map((each) => each.remoteFingerprints), ...rows.locations.map((each) => each.observedRemotes)].flatMap(
    (json) => {
      const list = parsed(json)
      return Array.isArray(list) ? list.flatMap((url) => (typeof url === 'string' ? remoteNames(url) : [])) : []
    },
  )
  return [
    ...rows.bindings.flatMap((binding) => [binding.slug, binding.displayName]),
    ...rows.locations.map((location) => basename(location.path)),
    ...rows.folders.map((folder) => basename(folder.path)),
    ...remotes,
  ]
}
