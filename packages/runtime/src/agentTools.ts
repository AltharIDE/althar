import { execFile } from 'node:child_process'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { delimiter, join } from 'node:path'

import type { AgentTools, SyncSettle, SyncView, ToolHere, ToolRole, ToolRow, ToolSource } from '@althar/contracts'
import {
  agentServers,
  type McpServer,
  referenceOf,
  runsOf,
  type ServerSpec,
  SYNCED_AGENTS,
  type SyncedAgent,
} from '@althar/provider-adapters'
import { Effect, Schema } from 'effect'
import { SqlClient } from 'effect/sql'

import { RuntimeConfig, type RuntimeOptions } from './Config'
import * as mcp from './mcpSync'
import * as skills from './skillSync'
import { timestamp } from './records'

/*
 * The person's own MCP servers and skills (ADR-097), as Settings shows them
 * and every role is given them: each server found in Claude Code's, Codex's
 * or OpenCode's settings, whichever found it, with the roles that get it, for
 * every project or one; each skill in their agents' own folders; and the two
 * switches that keep their agents the same (`mcpSync.ts`, `skillSync.ts`).
 * Nothing is read or written without the runtime's `agentConfigs`.
 */

const ROLES: ReadonlyArray<ToolRole> = ['lead', 'reviewer', 'coordinator']
const KEY = 'agent_tools'

/** Which roles get each server or skill, where the person changed it: for every project, and for a project of their choosing. */
const Roles = Schema.Struct({
  server: Schema.Record(
    Schema.String,
    Schema.Struct({
      all: Schema.optional(Schema.Array(Schema.String)),
      projects: Schema.optional(Schema.Record(Schema.String, Schema.Array(Schema.String))),
    }),
  ),
  skill: Schema.Record(
    Schema.String,
    Schema.Struct({
      all: Schema.optional(Schema.Array(Schema.String)),
      projects: Schema.optional(Schema.Record(Schema.String, Schema.Array(Schema.String))),
    }),
  ),
})
type Roles = typeof Roles.Type
const NO_ROLES: Roles = { server: {}, skill: {} }

const readRoles = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const [row] = yield* sql<{ value: string }>`SELECT value FROM settings WHERE key = ${KEY}`
  if (row === undefined) return NO_ROLES
  return Schema.decodeUnknownOption(Schema.fromJsonString(Roles))(row.value).pipe((found) =>
    found._tag === 'Some' ? found.value : NO_ROLES,
  )
})

const rolesOf = (roles: Roles, kind: 'server' | 'skill', name: string, projectId: string | null): ReadonlyArray<ToolRole> => {
  const kept = roles[kind][name]
  const chosen = (projectId === null ? undefined : kept?.projects?.[projectId]) ?? kept?.all
  return chosen === undefined ? ROLES : ROLES.filter((role) => chosen.includes(role))
}

export const setToolRoles = (kind: 'server' | 'skill', name: string, chosen: ReadonlyArray<ToolRole>, projectId: string | null) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const roles = yield* readRoles
    const kept = roles[kind][name] ?? {}
    const next: Roles = {
      ...roles,
      [kind]: {
        ...roles[kind],
        [name]: projectId === null ? { ...kept, all: [...chosen] } : { ...kept, projects: { ...kept.projects, [projectId]: [...chosen] } },
      },
    }
    const at = yield* timestamp
    yield* sql`
      INSERT INTO settings ${sql.insert({ key: KEY, value: JSON.stringify(next), updatedAt: at })}
      ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  })

const FILES: Readonly<Record<SyncedAgent, string>> = {
  claude: '~/.claude.json',
  codex: '~/.codex/config.toml',
  opencode: '~/.config/opencode/opencode.json',
}
const FOLDERS: Readonly<Record<SyncedAgent, string>> = {
  claude: '~/.claude/skills',
  codex: '~/.agents/skills',
  opencode: '~/.config/opencode/skills',
}

/** Where the person's agents' commands are, beside the PATH Althar was started with, which an app opened from the Dock lacks. */
const agentPath = (homeDir: string) =>
  [
    process.env['PATH'] ?? '',
    join(homeDir, '.local', 'bin'),
    join(homeDir, '.opencode', 'bin'),
    join(homeDir, '.bun', 'bin'),
    join(homeDir, '.npm-global', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ]
    .filter((one) => one !== '')
    .join(delimiter)

const NAMES: Readonly<Record<string, string>> = { claude: 'Claude Code', codex: 'Codex' }

/** Runs one of the person's agents' own commands, as sync writes through them; one that isn't on this computer says so. */
const runIn =
  (homeDir: string): mcp.Run =>
  (command, args) =>
    new Promise((resolve) => {
      execFile(command, [...args], { timeout: 60_000, env: { ...process.env, PATH: agentPath(homeDir) } }, (error, stdout, stderr) => {
        if (error !== null && (error as NodeJS.ErrnoException).code === 'ENOENT')
          return resolve({
            code: 127,
            output: `Its \`${command}\` command isn’t on this computer, so ${NAMES[command] ?? command} wasn’t changed.`,
          })
        resolve({ code: error === null ? 0 : typeof error.code === 'number' ? error.code : 1, output: `${stdout}${stderr}` })
      })
    })

const ioOf = (configs: NonNullable<RuntimeOptions['agentConfigs']>, now: string): mcp.SyncIo & skills.SkillIo => ({
  home: { homeDir: configs.homeDir, env: configs.env ?? process.env },
  homeDir: configs.homeDir,
  env: configs.env ?? process.env,
  folder: configs.folder,
  run: configs.run ?? runIn(configs.homeDir),
  now: () => now,
})

/** The runtime's sync io, where it has one; the time it keeps is the runtime's clock's. */
export const syncIo = Effect.gen(function* () {
  const config = yield* RuntimeConfig
  if (config.agentConfigs === undefined) return undefined
  return ioOf(config.agentConfigs, yield* timestamp)
})

const settleOf = (settle: mcp.Settle): SyncSettle =>
  settle.kind === 'differs'
    ? { kind: 'differs', name: settle.server, ways: settle.ways }
    : settle.kind === 'cant'
      ? { kind: 'cant', name: settle.server, agent: settle.agent, why: settle.why }
      : settle.kind === 'signIn'
        ? { kind: 'signIn', name: settle.server, agents: settle.agents }
        : settle

const hereOf = (here: mcp.Here | skills.SkillHere): ToolHere => (here === 'linked' ? 'added' : here)

/** A skill's description, from its `SKILL.md` frontmatter. */
const describe = (folder: string): string => {
  try {
    const text = readFileSync(join(folder, 'SKILL.md'), 'utf8')
    return (
      /^description:\s*(.+)$/m
        .exec(text)?.[1]
        ?.replace(/^["']|["']$/g, '')
        .trim() ?? ''
    )
  } catch {
    return ''
  }
}

/**
 * Brings the person's agents in step where a switch is on: as Settings reads
 * them, and as a session starts, which is when an agent reads its settings.
 * What can't be done is kept, and said in Settings.
 */
export const refresh = (io: mcp.SyncIo & skills.SkillIo) =>
  Effect.promise(async () => {
    if (mcp.readRecord(io).on) await mcp.reconcile(io)
    if (skills.readSkillRecord(io).on) await mcp.serialized(io, () => skills.reconcileSkills(io))
  })

/** What Settings shows: the person's servers and skills, with the roles each gets here, and how sync stands. */
export const agentTools = (projectId: string | null) =>
  Effect.gen(function* () {
    const io = yield* syncIo
    const empty: SyncView = { on: false, settle: [], since: [], targets: [], errors: [] }
    if (io === undefined) return { enabled: false, servers: [], skills: [], serverSync: empty, skillSync: empty } satisfies AgentTools
    // While a switch is on, what the person changed in their agents since is brought in step as Settings reads them.
    yield* refresh(io)
    const roles = yield* readRoles
    const { record, plan } = mcp.syncState(io)
    const agents = plan.agents
    const servers: Array<ToolRow> = Object.keys(plan.here).map((name) => {
      const found = agents.flatMap((agent) => {
        const spec = agent.servers.find((server) => server.name === name)
        return spec === undefined ? [] : [{ agent: agent.agent, spec }]
      })
      return {
        name,
        about: found[0] === undefined ? '' : runsOf(found[0].spec),
        sources: found.map(({ agent }): ToolSource => ({ from: agent, where: FILES[agent] })),
        roles: [...rolesOf(roles, 'server', name, projectId)],
        here: Object.fromEntries(SYNCED_AGENTS.map((agent) => [agent, hereOf(plan.here[name]![agent])])) as ToolRow['here'],
      }
    })
    const serverSync: SyncView = {
      on: record.on,
      settle: plan.settle.map(settleOf),
      since: record.since.map((each) => ({
        id: each.id,
        at: each.at,
        name: each.server,
        kind: each.kind,
        from: each.from,
        to: [...each.to],
        undone: each.undone === true,
      })),
      targets: SYNCED_AGENTS.map((agent) => ({
        agent,
        where: agents.find((each) => each.agent === agent)?.file ?? FILES[agent],
        adds: record.on
          ? record.added.filter((each) => each.agent === agent).map((each) => each.spec.name)
          : plan.adds.filter((each) => each.agent === agent).map((each) => each.spec.name),
        out: [...record.keptOut[agent]],
      })),
      errors: [...(record.errors ?? [])],
    }
    const skillRecord = skills.readSkillRecord(io)
    const skillPlan = skills.planSkills(io, skillRecord)
    const folders = skills.skillFolders(io)
    const skillRows: Array<ToolRow> = Object.keys(skillPlan.here).map((name) => {
      const where = SYNCED_AGENTS.filter((agent) => {
        const path = join(folders[agent], name)
        return existsSync(join(path, 'SKILL.md')) && !skillRecord.linked.some((each) => each.agent === agent && each.name === name)
      })
      const first = where[0]
      return {
        name,
        about: first === undefined ? '' : describe(realpathSync(join(folders[first], name))),
        sources: where.map((agent): ToolSource => ({ from: agent, where: FOLDERS[agent] })),
        roles: [...ROLES],
        here: Object.fromEntries(SYNCED_AGENTS.map((agent) => [agent, hereOf(skillPlan.here[name]![agent])])) as ToolRow['here'],
      }
    })
    const skillSync: SyncView = {
      on: skillRecord.on,
      settle: skillPlan.settle.map((each) => ({
        kind: 'differs',
        name: each.skill,
        ways: each.versions.map((version) => ({ agent: version.agent, runs: version.real.replace(io.homeDir, '~') })),
      })),
      since: [],
      targets: SYNCED_AGENTS.filter((agent) => agent !== 'opencode').map((agent) => ({
        agent,
        where: FOLDERS[agent],
        adds: skillRecord.on
          ? skillRecord.linked.filter((each) => each.agent === agent).map((each) => each.name)
          : skillPlan.links.filter((each) => each.agent === agent).map((each) => each.name),
        out: [...skillRecord.keptOut[agent]],
      })),
      errors: [...(skillRecord.errors ?? [])],
    }
    return { enabled: true, servers, skills: skillRows, serverSync, skillSync } satisfies AgentTools
  })

/** Expands a reference to a variable from the environment Althar runs in; undefined where it names one that isn't set. */
const expand = (value: string): string | undefined => {
  const bearer = /^Bearer\s+(.*)$/i.exec(value)
  const name = referenceOf(bearer?.[1] ?? value)
  if (name === undefined) return value
  const found = process.env[name]
  return found === undefined ? undefined : bearer === null ? found : `Bearer ${found}`
}

const expanded = (values: Readonly<Record<string, string>> | undefined) =>
  Object.fromEntries(
    Object.entries(values ?? {}).flatMap(([key, value]) => {
      const found = expand(value)
      return found === undefined ? [] : [[key, found]]
    }),
  )

/** A server as a session takes it; none for one it can't call (an SSE server, which ACP gives no way to). */
const sessionServer = (spec: ServerSpec): McpServer | undefined =>
  spec.transport === 'stdio'
    ? { type: 'stdio', name: spec.name, command: spec.command ?? '', args: spec.args ?? [], env: expanded(spec.env) }
    : spec.transport === 'http'
      ? {
          type: 'http',
          name: spec.name,
          url: spec.url ?? '',
          headers: {
            ...expanded(spec.headers),
            ...(spec.tokenVariable !== undefined && process.env[spec.tokenVariable] !== undefined
              ? { Authorization: `Bearer ${process.env[spec.tokenVariable]}` }
              : {}),
          },
        }
      : undefined

/**
 * The person's servers a session of this role, in this project, is given
 * (ADR-097): each found in one of their agents' settings, whichever, on there,
 * and ticked for the role. Codex and OpenCode have their own switched off by
 * name as they start, and Claude Code loads only what it is given, so a
 * session gets exactly these, beside Althar's own, whichever agent it runs.
 */
export const serversFor = (role: ToolRole, projectId: string, http: boolean) =>
  Effect.gen(function* () {
    const config = yield* RuntimeConfig
    if (config.agentConfigs === undefined) return []
    // A session starting is when its agent reads its settings: the person's agents are brought in step meanwhile, not waited on.
    yield* Effect.forkDetach(refresh(ioOf(config.agentConfigs, yield* timestamp)))
    const roles = yield* readRoles
    const home = { homeDir: config.agentConfigs.homeDir, env: config.agentConfigs.env ?? process.env }
    const seen = new Set<string>()
    const given: Array<McpServer> = []
    for (const agent of SYNCED_AGENTS)
      for (const spec of agentServers(agent, home).servers) {
        if (seen.has(spec.name) || spec.name === 'althar') continue
        seen.add(spec.name)
        if (spec.off === true || !rolesOf(roles, 'server', spec.name, projectId).includes(role)) continue
        const server = sessionServer(spec)
        if (server !== undefined && (server.type === 'stdio' || http)) given.push(server)
      }
    return given
  }).pipe(Effect.catch(() => Effect.succeed([] as ReadonlyArray<McpServer>)))
