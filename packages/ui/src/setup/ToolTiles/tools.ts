import type { Brand } from '../../foundations/brands/brands'
import type { ProjectInk } from '../../foundations/ProjectMark/drawing'

/*
 * What the person's MCP servers and skills are, as the tiles show them
 * (ADR-097): plain shapes, each a field for a field of what the runtime
 * reads, so a consumer maps its own data onto them without translating
 * words. Every word shown is made from them by the parts' `text`.
 */

/** The roles a server or skill loads in: a task's lead, the reviewer, the coordinator. */
export type ToolRoleId = 'lead' | 'reviewer' | 'coordinator'

/** The three roles, in the order they are shown. */
export const TOOL_ROLES: readonly ToolRoleId[] = ['lead', 'reviewer', 'coordinator']

/**
 * How a server or skill stands in one of the person's agents. in: set up there by the person; added: Althar copied
 * or linked it there; missing: not there; out: kept out of it; differs: it runs another way there; cant: Althar can't
 * put it there.
 */
export type ToolHereState = 'in' | 'added' | 'missing' | 'out' | 'differs' | 'cant'

/** Whether one of the person's agents is signed in to a server: yes; no, which its Sign in fixes; none needed; or not known. */
export type ToolSignInState = 'yes' | 'no' | 'none' | 'unknown'

/** One of the person's agents whose servers and skills are read: its name and mark, where it keeps each, and whether it is signed in. */
export interface ToolAgentView {
  /** claude, codex, opencode: the key of `here`, `signIn` and a file's `agent`. */
  id: string
  name: string
  brand?: Brand
  /** Where it keeps its MCP servers, as the person names it: ~/.claude.json. */
  file: string
  /** Where it keeps its skills: ~/.claude/skills. */
  folder: string
  /** On this computer and signed in: a new server goes to it by default, where the person picks the agents. */
  signedIn?: boolean
}

/** A project, for which ones get a server or skill, and whose repository holds one of its own. */
export interface ToolProjectView {
  id: string
  name: string
  ink: ProjectInk
}

/** One of the person's MCP servers, or a repository's own. */
export interface ServerTileModel {
  /** Its key: two repositories may each have a server of the same name. */
  id: string
  name: string
  /** The product's mark, where it has one; otherwise its first letter shows. */
  brand?: Brand
  /** What it runs or calls, in a line: its command or its address. */
  runs: string
  roles: readonly ToolRoleId[]
  /** The projects whose marks are pressed out: it isn't given in them. */
  offIn: readonly string[]
  /** The project whose repository it is in (`.mcp.json`); null for the person's own. */
  repository: string | null
  /** How it stands in each agent, by the agent's id. */
  here: Readonly<Record<string, ToolHereState>>
  /** Whether each agent is signed in to it, by the agent's id. */
  signIn: Readonly<Record<string, ToolSignInState>>
  /** Why its last start failed, while it has, and which agent said so (null for Althar's own check). */
  failed: { agent: string | null; why: string } | null
}

/** One of the person's skills, or a repository's own. */
export interface SkillTileModel {
  id: string
  name: string
  /** Its SKILL.md's description. */
  about: string
  roles: readonly ToolRoleId[]
  offIn: readonly string[]
  /** The project whose repository it is in (`.claude/skills`); null for the person's own. */
  repository: string | null
  here: Readonly<Record<string, ToolHereState>>
  /** The folder it lives in, as the person names it; null where that isn't known. */
  home: string | null
  /** The GitHub repository it was added from through Althar; null for one found in an agent's folder. */
  from: string | null
  /** A newer version of one added from GitHub waits there. */
  update: boolean
}

/** One agent's own file, as it keeps an opened server. */
export interface ToolFileView {
  /** The agent's id, or `repository` for a repository's `.mcp.json`. */
  agent: string
  /** The file, as the person names it: ~/.codex/config.toml. */
  where: string
  /** yours: the person set it up there; copied: Althar added it; differs: it runs another way there; out: kept out; missing: not there; cant: Althar can't put it there. */
  state: 'yours' | 'copied' | 'differs' | 'out' | 'missing' | 'cant'
  /** The server's lines as that agent writes them; for one kept out, as it would, to be struck through. */
  lines: readonly string[]
  /** Where Althar can't put it there, why, in words. */
  why: string | null
  signIn: ToolSignInState
}

/** One agent's file or folder a sync switch writes to, and what it added there (while on) or would add (while off). */
export interface ToolSyncTarget {
  agent: string
  where: string
  adds: readonly string[]
}

/** A change sync saw or made: a line of What it changed, with its Undo or Put it back. */
export interface ToolSyncChange {
  id: string
  /** When, as the page says it: 6 Nov, 10:42. */
  at: string
  name: string
  /** copied: the person added it to one agent and it was copied to the others; tookOut: they took it out of one, and it stays out there. */
  kind: 'copied' | 'tookOut'
  from: string
  to: readonly string[]
  undone: boolean
}

/** How a sync switch stands. */
export interface ToolSyncModel {
  on: boolean
  targets: readonly ToolSyncTarget[]
  /** For servers; skills' sync says nothing of what it changed. */
  changes?: readonly ToolSyncChange[]
  /** What its last write couldn't do, in each agent's own words. */
  errors?: readonly string[]
}

/** A server people often add, ready to fill the form in. */
export interface ServerStarter {
  name: string
  way: 'address' | 'command'
  /** Its address, or its command line. */
  runs: string
  brand?: Brand
}

/** A server the person adds: a name, and an address or a command. Values of `env` and `headers` may be `${VARIABLE}` references. */
export interface NewServerView {
  name: string
  url?: string
  command?: string
  args?: readonly string[]
  env?: Readonly<Record<string, string>>
  headers?: Readonly<Record<string, string>>
}
