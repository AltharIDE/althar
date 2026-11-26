import { Schema } from 'effect'
import { RpcGroup } from 'effect/rpc'
import { call, ClientAuthority, command } from './rpc'

/** The roles the person's MCP servers and skills load in (ADR-097): a task's lead, the reviewer, the coordinator. */
export const ToolRole = Schema.Literals(['lead', 'reviewer', 'coordinator'])
export type ToolRole = typeof ToolRole.Type

/** The person's agents whose servers and skills Althar reads, and keeps the same where they ask it to. */
export const SyncedAgent = Schema.Literals(['claude', 'codex', 'opencode'])
export type SyncedAgent = typeof SyncedAgent.Type

/** Where a server or a skill was found: one of the person's agents, a repository of the project, a plugin, or Althar's store (a skill added from GitHub). */
export const ToolSource = Schema.Struct({
  from: Schema.Literals(['claude', 'codex', 'opencode', 'repository', 'plugin', 'althar']),
  /** The file or folder, as the person names it: ~/.claude.json, .mcp.json. */
  where: Schema.String,
})
export type ToolSource = typeof ToolSource.Type

/** How a server or a skill stands in each of the person's agents, for sync's marks beside its name. */
export const ToolHere = Schema.Literals(['in', 'added', 'missing', 'out', 'differs', 'cant'])
export type ToolHere = typeof ToolHere.Type

/**
 * Whether one of the person's agents is signed in to a server, as the agent's own command says (`claude mcp list`,
 * `codex mcp list`, `opencode mcp list`): yes; no, which the person fixes with that agent's Sign in; none, for a
 * server that needs none; unknown, where that agent says nothing of it or hasn't been asked yet.
 */
export const ToolSignIn = Schema.Literals(['yes', 'no', 'none', 'unknown'])
export type ToolSignIn = typeof ToolSignIn.Type

/** Why a server's last start failed, where it did, in the words the agent or the server gave. */
export const ToolFailure = Schema.Struct({
  /** The agent that said so; null where Althar's own check of the server did. */
  agent: Schema.NullOr(SyncedAgent),
  why: Schema.String,
  at: Schema.String,
})
export type ToolFailure = typeof ToolFailure.Type

/**
 * One of the person's MCP servers or skills, a tile of Settings: where it was found, which roles get it and where,
 * and how it stands in each agent. A repository's own (a project's `.mcp.json` or `.claude/skills`) has `repository`.
 */
export const ToolRow = Schema.Struct({
  name: Schema.String,
  /** What a server runs or calls; what a skill is for. */
  about: Schema.String,
  sources: Schema.Array(ToolSource),
  /** The roles that get it, in every project. A repository's own is in no role until the person turns it on. */
  roles: Schema.Array(ToolRole),
  here: Schema.Record(SyncedAgent, ToolHere),
  /** The projects whose marks the person pressed out: it isn't given in them, whatever the roles say. Empty for a repository's own. */
  offIn: Schema.Array(Schema.String),
  /** The project whose repository it is in; null for the person's own. */
  repository: Schema.NullOr(Schema.String),
  /** A server: whether it runs a command or opens an address. A skill: command. */
  way: Schema.Literals(['command', 'address']),
  /** A server: signed in or not, by agent, for the agents that run it. A skill: every agent unknown. */
  signIn: Schema.Record(SyncedAgent, ToolSignIn),
  /** A server: why its last start failed, while it has; null otherwise. */
  failed: Schema.NullOr(ToolFailure),
  /** A skill: where it lives, as the person names it (a folder, a plugin, Althar's store); a server: null. */
  home: Schema.NullOr(Schema.String),
  /** A skill added from GitHub through Althar: where it came from, and the commit it is at. */
  from: Schema.NullOr(Schema.Struct({ repo: Schema.String, subpath: Schema.String, ref: Schema.String, sha: Schema.String })),
})
export type ToolRow = typeof ToolRow.Type

/**
 * One agent's own file, as it keeps a server: how it stands there, and its lines as that agent writes them. Lines
 * Althar copied are shown as they are in the file; lines it keeps out, as it would write them, to be struck through.
 * Values of env and headers that aren't references to a variable are masked.
 */
export const ToolFile = Schema.Struct({
  agent: Schema.Literals(['claude', 'codex', 'opencode', 'repository']),
  /** As the person names it: ~/.claude.json, ~/.codex/config.toml, .mcp.json. */
  where: Schema.String,
  /**
   * yours: set up there by the person; copied: Althar added it; differs: it runs another way there; out: kept out of it;
   * missing: not there; cant: Althar can't put it there.
   */
  state: Schema.Literals(['yours', 'copied', 'differs', 'out', 'missing', 'cant']),
  lines: Schema.Array(Schema.String),
  /** What it runs in this agent, in a line. */
  runs: Schema.String,
  /** Where Althar can't put it, why, in words. */
  why: Schema.NullOr(Schema.String),
  signIn: ToolSignIn,
})
export type ToolFile = typeof ToolFile.Type

/** A server opened out: each agent's file as it keeps it, and what it exposes, where Althar's own check could read that. */
export const ServerDetail = Schema.Struct({
  name: Schema.String,
  /** What it runs, in a line: its address or its command. */
  runs: Schema.String,
  files: Schema.Array(ToolFile),
  /** How many tools it offers, from Althar's own check; null where that couldn't be read. */
  tools: Schema.NullOr(Schema.Int),
  /** Why there is no count, where there is none: it needs a sign-in, it didn't start, it isn't one Althar can ask. Null otherwise. */
  toolsWhy: Schema.NullOr(Schema.String),
})
export type ServerDetail = typeof ServerDetail.Type

/** A server the person adds: a name, and an address or a command. Values of `env` and `headers` may be `${VARIABLE}` references. */
export const NewServer = Schema.Struct({
  name: Schema.String,
  url: Schema.optional(Schema.String),
  command: Schema.optional(Schema.String),
  args: Schema.optional(Schema.Array(Schema.String)),
  env: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  headers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
})
export type NewServer = typeof NewServer.Type

/** Something sync can't do alone, which the person settles: under To settle, problems first. */
export const SyncSettle = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('unreadable'), agent: SyncedAgent, file: Schema.String, problem: Schema.String }),
  Schema.Struct({
    kind: Schema.Literal('differs'),
    name: Schema.String,
    ways: Schema.Array(Schema.Struct({ agent: SyncedAgent, runs: Schema.String })),
  }),
  Schema.Struct({
    kind: Schema.Literal('cant'),
    name: Schema.String,
    agent: SyncedAgent,
    why: Schema.Literals(['sse', 'secret', 'headers', 'reference']),
  }),
  Schema.Struct({ kind: Schema.Literal('signIn'), name: Schema.String, agents: Schema.Array(SyncedAgent) }),
])
export type SyncSettle = typeof SyncSettle.Type

/** One agent's file or folder that sync writes to, and what it added there or would. */
export const SyncTarget = Schema.Struct({
  agent: SyncedAgent,
  /** As the person names it: ~/.codex/config.toml. */
  where: Schema.String,
  /** What it added there, while on; what turning it on would add, while off. */
  adds: Schema.Array(Schema.String),
  /** What is kept out of it. */
  out: Schema.Array(Schema.String),
})
export type SyncTarget = typeof SyncTarget.Type

/** A change sync saw or made since it was turned on: a line under Since, with its Undo or Put it back. */
export const SyncSince = Schema.Struct({
  id: Schema.String,
  at: Schema.String,
  name: Schema.String,
  kind: Schema.Literals(['copied', 'tookOut']),
  from: SyncedAgent,
  to: Schema.Array(SyncedAgent),
  undone: Schema.Boolean,
})
export type SyncSince = typeof SyncSince.Type

/** How a sync switch stands: on or off, To settle, Since, and each agent's file. */
export const SyncView = Schema.Struct({
  on: Schema.Boolean,
  settle: Schema.Array(SyncSettle),
  since: Schema.Array(SyncSince),
  targets: Schema.Array(SyncTarget),
  /** What its last write couldn't do, in each agent's own words. */
  errors: Schema.Array(Schema.String),
})
export type SyncView = typeof SyncView.Type

/** The person's MCP servers and skills, as Settings shows them, and the two switches that keep their agents the same. */
export const AgentTools = Schema.Struct({
  /** False where this Althar reads no agent's settings (a test, a sandbox): the sections say so and nothing else. */
  enabled: Schema.Boolean,
  servers: Schema.Array(ToolRow),
  skills: Schema.Array(ToolRow),
  serverSync: SyncView,
  skillSync: SyncView,
  /** Where each agent keeps its servers (a file) and its skills (a folder), as the person names them. */
  places: Schema.Array(Schema.Struct({ agent: SyncedAgent, file: Schema.String, folder: Schema.String })),
  /** When the agents' own checks last ran, for the sign-ins and failures the rows say; null before the first. */
  checkedAt: Schema.NullOr(Schema.String),
})
export type AgentTools = typeof AgentTools.Type

/**
 * The person's MCP servers and tools: which roles and projects get each, a server's detail, checking, adding and removing.
 * Syncing them across agents' own files, and a server's sign-in.
 */
export const ToolsApi = RpcGroup.make(
  /** The person's MCP servers and skills, which roles get each, for every project or one, and how sync stands (ADR-097). */
  call('GetAgentTools', { projectId: Schema.NullOr(Schema.String) }, AgentTools),
  /** Which roles get one of the person's servers or skills in every project; `repository` names the project whose own it is. A skill added from GitHub is on while any role gets it. */
  command(
    'SetToolRoles',
    {
      kind: Schema.Literals(['server', 'skill']),
      name: Schema.String,
      roles: Schema.Array(ToolRole),
      projectId: Schema.NullOr(Schema.String),
      repository: Schema.optional(Schema.NullOr(Schema.String)),
    },
    Schema.Void,
  ),
  /** One project's mark pressed out or in on a server or skill: out, it isn't given in that project; in, it goes by the roles again. */
  command(
    'SetToolInProject',
    { kind: Schema.Literals(['server', 'skill']), name: Schema.String, projectId: Schema.String, on: Schema.Boolean },
    Schema.Void,
  ),
  /** A server opened out: each agent's file as it keeps it, and its tools counted by Althar's own check. May take a few seconds. */
  call('GetServerDetail', { name: Schema.String, repository: Schema.NullOr(Schema.String) }, ServerDetail),
  /** Asks each of the person's agents, through its own command, how each server stands: signed in, or why it failed to start. */
  command('CheckServers', {}, Schema.Void),
  /** Adds a server to each of the agents listed, in its own file, as the person's own there. Refused where the name is taken in one of them. */
  command('AddServer', { server: NewServer, agents: Schema.Array(SyncedAgent) }, Schema.Void),
  /** Takes a server out of every one of the agents' files that has it, and out of what sync keeps for it. */
  command('RemoveServer', { name: Schema.String }, Schema.Void),
  /** Turns a sync switch on, or off with what it added left in or taken back out. */
  command('SetToolSync', { kind: Schema.Literals(['server', 'skill']), on: Schema.Boolean, takeBack: Schema.Boolean }, Schema.Void),
  /** Keeps a server or a skill out of one agent (taken back out where sync added it), or puts it back. */
  command(
    'SetToolKeptOut',
    { kind: Schema.Literals(['server', 'skill']), agent: SyncedAgent, name: Schema.String, out: Schema.Boolean },
    Schema.Void,
  ),
  /** For one set up two ways: whose way it runs everywhere, or left out of syncing. */
  command(
    'PickToolWay',
    { kind: Schema.Literals(['server', 'skill']), name: Schema.String, way: Schema.Literals(['claude', 'codex', 'opencode', 'apart']) },
    Schema.Void,
  ),
  /** Undoes a line under Since. */
  command('UndoToolSync', { id: Schema.String }, Schema.Void),
  /** Starts a server's sign-in in one of the person's agents, through its own command. */
  command('SignInToolServer', { agent: SyncedAgent, name: Schema.String }, Schema.Void),
).middleware(ClientAuthority)
