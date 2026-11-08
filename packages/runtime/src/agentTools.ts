import { execFile } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { delimiter, join } from 'node:path'

import type { AgentTools, SyncSettle, SyncView, ToolFailure, ToolHere, ToolRole, ToolRow, ToolSignIn, ToolSource } from '@althar/contracts'
import {
  agentServers,
  type HeldSkill,
  type McpServer,
  referenceOf,
  repositoryServers,
  runsOf,
  type ServerSpec,
  SYNCED_AGENTS,
  type SyncedAgent,
} from '@althar/provider-adapters'
import { listInstalls, parseFrontmatter, setActive } from '@althar/skills'
import { Effect, Schema } from 'effect'
import { SqlClient } from 'effect/sql'

import { RuntimeConfig, type RuntimeOptions } from './Config'
import { type HealthRecord, readHealth } from './mcpHealth'
import * as mcp from './mcpSync'
import * as skills from './skillSync'
import { describe as describeInstall } from './Skills'
import { timestamp } from './records'

/*
 * The person's own MCP servers and skills (ADR-097), as Settings shows them
 * and every role is given them: each server found in Claude Code's, Codex's
 * or OpenCode's settings, whichever found it, with the roles that get it, for
 * every project or one; each skill in their agents' own folders, Claude
 * Code's plugins, Althar's store and a project's repositories, with the roles
 * that get it and those a session holds back (`heldSkillsFor`); and the two
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

/**
 * Which roles get a server or skill here: a project's own choice, else the one for every project, else `fallback`
 * (every role for the person's own; none for a repository's own). A project pressed out keeps an empty list.
 */
const rolesOf = (
  roles: Roles,
  kind: 'server' | 'skill',
  name: string,
  projectId: string | null,
  fallback: ReadonlyArray<ToolRole> = ROLES,
): ReadonlyArray<ToolRole> => {
  const kept = roles[kind][name]
  const chosen = (projectId === null ? undefined : kept?.projects?.[projectId]) ?? kept?.all
  return chosen === undefined ? fallback : ROLES.filter((role) => chosen.includes(role))
}

/** The projects a server or skill is pressed out in: whose own choice is no role at all. */
const offInOf = (roles: Roles, kind: 'server' | 'skill', name: string): Array<string> =>
  Object.entries(roles[kind][name]?.projects ?? {}).flatMap(([projectId, chosen]) => (chosen.length === 0 ? [projectId] : []))

/** What the roles of a repository's own server are kept by: never the same as a person's server of the same name. */
export const toolKey = (name: string, repository: string | null) => (repository === null ? name : `@${repository}/${name}`)

const writeRoles = (change: (roles: Roles) => Roles) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const next = change(yield* readRoles)
    const at = yield* timestamp
    yield* sql`
      INSERT INTO settings ${sql.insert({ key: KEY, value: JSON.stringify(next), updatedAt: at })}
      ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  })

export const setToolRoles = (
  kind: 'server' | 'skill',
  name: string,
  chosen: ReadonlyArray<ToolRole>,
  projectId: string | null,
  repository: string | null = null,
) =>
  writeRoles((roles) => {
    const key = toolKey(name, repository)
    const kept = roles[kind][key] ?? {}
    return {
      ...roles,
      [kind]: {
        ...roles[kind],
        [key]: projectId === null ? { ...kept, all: [...chosen] } : { ...kept, projects: { ...kept.projects, [projectId]: [...chosen] } },
      },
    }
  })

/** One project's mark pressed out (no role gets it there) or back in (its project's choice cleared, so the roles apply again). */
export const setToolInProject = (kind: 'server' | 'skill', name: string, projectId: string, on: boolean) =>
  writeRoles((roles) => {
    const kept = roles[kind][name] ?? {}
    const projects = Object.fromEntries(Object.entries(kept.projects ?? {}).filter(([id]) => id !== projectId))
    return {
      ...roles,
      [kind]: { ...roles[kind], [name]: { ...kept, projects: on ? projects : { ...projects, [projectId]: [] } } },
    }
  })

/** The project's repositories' roots on this computer: the project's own checkouts, never a pull request's. */
export const repositoryRoots = (projectId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{ path: string }>`
      SELECT l.path FROM repository_bindings b
      JOIN projects p ON p.id = b.project_id AND p.archived_at IS NULL
      JOIN repository_locations l ON l.binding_id = b.id
        AND l.device_id = (SELECT id FROM devices ORDER BY created_at, id LIMIT 1)
      WHERE b.project_id = ${projectId} AND b.detached_at IS NULL
      ORDER BY b.created_at, b.rowid`
    return rows.map((row) => row.path).filter((path) => existsSync(path))
  })

/**
 * A repository's own servers, from its `.mcp.json`, the first of a name kept. Each runs a command the person hasn't
 * chosen, so it is in no role until they turn it on: ADR-097 leaves whether to trust it to the agent's own call, and
 * Althar gives it to no agent on its own.
 */
export const repositoryServersOf = (projectId: string) =>
  Effect.map(repositoryRoots(projectId), (roots) => {
    const found: Array<ServerSpec> = []
    for (const root of roots)
      for (const spec of repositoryServers(root))
        if (spec.name !== 'althar' && !found.some((one) => one.name === spec.name)) found.push(spec)
    return found
  })

/** Whether an agent that runs a server is signed in to it, as its own check last said; unknown for one that doesn't run it. */
export const signInOf = (health: HealthRecord, spec: ServerSpec | undefined, agent: SyncedAgent): ToolSignIn => {
  if (spec === undefined) return 'unknown'
  const entry = health.servers[spec.name]?.[agent]
  if (entry?.status === 'needs-auth') return 'no'
  if (entry?.signIn !== undefined) return entry.signIn
  return entry?.status === 'connected' ? (spec.url === undefined ? 'none' : 'yes') : 'unknown'
}

/** The latest failed start among the agents that run a server, in their words. */
const failedOf = (health: HealthRecord, name: string, agents: ReadonlyArray<SyncedAgent>): ToolFailure | null =>
  agents
    .flatMap((agent) => {
      const entry = health.servers[name]?.[agent]
      return entry?.status === 'failed' ? [{ agent, why: entry.why ?? 'It didn’t start.', at: entry.at }] : []
    })
    .reduce<ToolFailure | null>((latest, each) => (latest === null || each.at > latest.at ? each : latest), null)

const NO_SIGN_IN: ToolRow['signIn'] = { claude: 'unknown', codex: 'unknown', opencode: 'unknown' }

export const FILES: Readonly<Record<SyncedAgent, string>> = {
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
const agentPath = (homeDir: string, path: string | undefined) =>
  [
    path ?? '',
    join(homeDir, '.local', 'bin'),
    join(homeDir, '.opencode', 'bin'),
    join(homeDir, '.bun', 'bin'),
    join(homeDir, '.npm-global', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ]
    .filter((one) => one !== '')
    .join(delimiter)

/** The variables that move where an agent keeps its settings: a command sync runs sees only those its settings were read by. */
const PLACES = ['CODEX_HOME', 'XDG_CONFIG_HOME', 'CLAUDE_CONFIG_DIR', 'OPENCODE_CONFIG', 'OPENCODE_CONFIG_DIR'] as const

/**
 * The environment an agent's command runs in, as sync writes through it: the
 * same home and the same places its settings were read from (`env`), so a
 * write lands in the file that was read, never one an inherited `CODEX_HOME`
 * or another home names.
 */
export const commandEnv = (
  homeDir: string,
  env: Readonly<Record<string, string | undefined>>,
  inherited: Readonly<Record<string, string | undefined>> = process.env,
): Record<string, string> => {
  const kept = Object.entries(inherited).filter(([key]) => !(PLACES as ReadonlyArray<string>).includes(key) && key !== 'HOME')
  const places = PLACES.flatMap((key) => (env[key] === undefined ? [] : [[key, env[key]] as const]))
  const defined = (entries: ReadonlyArray<readonly [string, string | undefined]>) =>
    entries.flatMap(([key, value]) => (value === undefined ? [] : [[key, value] as const]))
  return {
    ...Object.fromEntries(defined(kept)),
    ...Object.fromEntries(defined(places)),
    HOME: homeDir,
    // Codex's home where its settings were read: the configured one, else the home's own.
    CODEX_HOME: env['CODEX_HOME'] || join(homeDir, '.codex'),
    PATH: agentPath(homeDir, env['PATH'] ?? inherited['PATH']),
  }
}

const NAMES: Readonly<Record<string, string>> = { claude: 'Claude Code', codex: 'Codex' }

/** Runs one of the person's agents' own commands, as sync writes through them; one that isn't on this computer says so. */
export const runIn =
  (homeDir: string, env: Readonly<Record<string, string | undefined>> = process.env): mcp.Run =>
  (command, args) =>
    new Promise((resolve) => {
      execFile(command, [...args], { timeout: 60_000, env: commandEnv(homeDir, env) }, (error, stdout, stderr) => {
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
  run: configs.run ?? runIn(configs.homeDir, configs.env ?? process.env),
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

/** What a skill's `SKILL.md` frontmatter says of it: what it is for, and the name it gives itself. */
const frontOf = (folder: string): { readonly about: string; readonly called: string | undefined } => {
  try {
    const data = parseFrontmatter(readFileSync(join(folder, 'SKILL.md'), 'utf8'))?.data
    const said = (key: string) => (typeof data?.[key] === 'string' ? data[key].trim() : '')
    return { about: said('description'), called: said('name') || undefined }
  } catch {
    return { about: '', called: undefined }
  }
}

/** The skill folders under one folder: each with a `SKILL.md`, a link to one followed. */
const skillFoldersIn = (folder: string): ReadonlyArray<{ readonly name: string; readonly real: string }> => {
  try {
    return readdirSync(folder).flatMap((name) => {
      try {
        const real = realpathSync(join(folder, name))
        return existsSync(join(real, 'SKILL.md')) ? [{ name, real }] : []
      } catch {
        return []
      }
    })
  } catch {
    return []
  }
}

/**
 * The skills of the plugins Claude Code has on (`enabledPlugins` in its `settings.json`), from where each is
 * installed (`plugins/installed_plugins.json`): each `skills/<name>/SKILL.md`, which Claude Code calls
 * `<plugin>:<name>`. A plugin whose manifest puts its skills elsewhere isn't read. Claude Code alone loads them.
 */
const pluginSkills = (homeDir: string): ReadonlyArray<{ readonly plugin: string; readonly name: string; readonly real: string }> => {
  const read = (path: string): unknown => {
    try {
      return JSON.parse(readFileSync(path, 'utf8'))
    } catch {
      return undefined
    }
  }
  const fields = (value: unknown) =>
    typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Readonly<Record<string, unknown>>) : {}
  const claude = join(homeDir, '.claude')
  const enabled = fields(fields(read(join(claude, 'settings.json'))).enabledPlugins)
  const installed = fields(fields(read(join(claude, 'plugins', 'installed_plugins.json'))).plugins)
  return Object.entries(installed).flatMap(([key, entries]) => {
    if (enabled[key] !== true) return []
    const plugin = key.split('@')[0] ?? key
    // One install for each scope it was installed in (version 2), or the one (version 1).
    const at = (Array.isArray(entries) ? entries : [entries])
      .map((entry) => fields(entry).installPath)
      .find((path) => typeof path === 'string')
    return typeof at === 'string' ? skillFoldersIn(join(at, 'skills')).map((one) => ({ plugin, ...one })) : []
  })
}

/** A skill as Settings lists it, and what holding it back needs: the name its `SKILL.md` gives it, and whether only Althar's store has it. */
interface SkillFound {
  readonly row: ToolRow
  readonly called: string | undefined
  readonly storeOnly: boolean
}

const STORE = 'Althar’s store'

/** The same in each of the person's agents. */
const everyAgent = (here: ToolHere): ToolRow['here'] => ({ claude: here, codex: here, opencode: here })

/**
 * The person's skills, as one list (ADR-097, "Skills"): those in their agents' own folders, each as sync sees it;
 * those of Claude Code's plugins; those in Althar's store, added from GitHub or on their own, which Althar gives each
 * session itself; and each project's repositories' own `.claude/skills`. One in the store and in an agent's folder
 * by the same name is one, the store's: that is the one a session is given. Which roles get each is the person's,
 * every role unless they changed it; one in the store is in none while it is off. `about` reads each `SKILL.md`.
 */
export const skillsFound = (io: mcp.SyncIo & skills.SkillIo, roles: Roles, projectId: string | null, store: string | undefined) =>
  Effect.gen(function* () {
    const record = skills.readSkillRecord(io)
    const plan = skills.planSkills(io, record)
    const folders = skills.skillFolders(io)
    const person = (name: string, here: ToolRow['here'], sources: Array<ToolSource>, home: string, folder: string | undefined) => {
      const front = folder === undefined ? { about: '', called: undefined } : frontOf(folder)
      return {
        row: {
          name,
          about: front.about,
          sources,
          roles: [...rolesOf(roles, 'skill', name, projectId)],
          here,
          offIn: offInOf(roles, 'skill', name),
          repository: null,
          way: 'command',
          signIn: NO_SIGN_IN,
          failed: null,
          home,
          from: null,
        },
        called: front.called,
        storeOnly: false,
      } satisfies SkillFound
    }
    const found = new Map<string, SkillFound>()
    for (const name of Object.keys(plan.here)) {
      // Where it is the person's own: not where sync linked it in, which shows as added.
      const where = SYNCED_AGENTS.filter(
        (agent) =>
          existsSync(join(folders[agent], name, 'SKILL.md')) && !record.linked.some((each) => each.agent === agent && each.name === name),
      )
      const first = where[0]
      found.set(
        name,
        person(
          name,
          Object.fromEntries(SYNCED_AGENTS.map((agent) => [agent, hereOf(plan.here[name]![agent])])) as ToolRow['here'],
          where.map((agent): ToolSource => ({ from: agent, where: FOLDERS[agent] })),
          first === undefined ? '' : `${FOLDERS[first]}/${name}`,
          first === undefined ? undefined : realpathSync(join(folders[first], name)),
        ),
      )
    }
    for (const one of pluginSkills(io.homeDir)) {
      const name = `${one.plugin}:${one.name}`
      if (found.has(name)) continue
      // Sync leaves a plugin's skills to the plugin: Codex and OpenCode can't be given them. Claude Code calls it by its
      // plugin's name, whatever its SKILL.md says.
      const row = person(
        name,
        { claude: 'in', codex: 'cant', opencode: 'cant' },
        [{ from: 'plugin', where: one.plugin }],
        `the ${one.plugin} plugin`,
        one.real,
      )
      found.set(name, { ...row, called: undefined })
    }
    if (store !== undefined) {
      const listed = yield* listInstalls(store).pipe(Effect.orElseSucceed(() => []))
      for (const one of listed) {
        if (!one.ok) continue
        const { install } = one
        const about = yield* describeInstall(store, install).pipe(
          Effect.map((view) => view.description ?? ''),
          Effect.orElseSucceed(() => ''),
        )
        const theirs = found.get(install.id)
        found.set(install.id, {
          row: {
            name: install.id,
            about: about || (theirs?.row.about ?? ''),
            sources: [{ from: 'althar', where: STORE }, ...(theirs?.row.sources ?? [])],
            // On while any role gets it: off, it is in none.
            roles: install.active ? [...rolesOf(roles, 'skill', install.id, projectId)] : [],
            // Althar gives it to each session itself, whichever agent runs it.
            here: everyAgent('in'),
            offIn: offInOf(roles, 'skill', install.id),
            repository: null,
            way: 'command',
            signIn: NO_SIGN_IN,
            failed: null,
            home: STORE,
            from:
              install.source === 'github' && install.repo !== undefined && install.sha !== undefined
                ? { repo: install.repo, subpath: install.subpath ?? '', ref: install.ref ?? install.sha, sha: install.sha }
                : null,
          },
          called: theirs?.called,
          storeOnly: theirs === undefined,
        })
      }
    }
    const rows = [...found.values()].toSorted((a, b) => a.row.name.localeCompare(b.row.name))
    // Each project's repositories' own, which Claude Code and OpenCode load from the checkout; Codex reads only `.agents/skills`.
    for (const project of yield* projectsOf(projectId)) {
      const seen = new Set<string>()
      for (const root of yield* repositoryRoots(project))
        for (const one of skillFoldersIn(join(root, '.claude', 'skills'))) {
          if (seen.has(one.name)) continue
          seen.add(one.name)
          const front = frontOf(one.real)
          rows.push({
            row: {
              name: one.name,
              about: front.about,
              sources: [{ from: 'repository', where: '.claude/skills' }],
              // Every role unless the person changed it: the agent loads it from the checkout whatever Althar says.
              roles: [...rolesOf(roles, 'skill', toolKey(one.name, project), projectId)],
              here: { claude: 'in', codex: 'cant', opencode: 'in' },
              offIn: [],
              repository: project,
              way: 'command',
              signIn: NO_SIGN_IN,
              failed: null,
              home: `.claude/skills/${one.name}`,
              from: null,
            },
            called: front.called,
            storeOnly: false,
          })
        }
    }
    return rows
  })

/** The projects whose repositories' own are listed: the one Settings is open on, or every one. */
const projectsOf = (projectId: string | null) =>
  Effect.gen(function* () {
    if (projectId !== null) return [projectId]
    const sql = yield* SqlClient.SqlClient
    return (yield* sql<{ id: string }>`SELECT id FROM projects WHERE archived_at IS NULL ORDER BY created_at, id`).map((row) => row.id)
  })

/** The person's skills a session of this role in this project isn't given: by name, and as its agent holds each back. */
export interface HeldSkills {
  /** Every one held: Althar's own selection leaves these out. */
  readonly names: ReadonlySet<string>
  /** Those its agent loads from its own folders, its plugins or the repository, to hold back there (`heldSkills.ts`). */
  readonly agent: ReadonlyArray<HeldSkill>
}

const NONE_HELD: HeldSkills = { names: new Set(), agent: [] }

/**
 * The skills a session of this role, in this project, isn't given (ADR-097): each whose roles here leave the role out,
 * a project pressed out included. Nothing where the runtime reads none of the person's agents; one that can't be
 * read holds nothing back, as a session is never kept from starting for it.
 */
export const heldSkillsFor = (role: ToolRole, projectId: string) =>
  Effect.gen(function* () {
    const config = yield* RuntimeConfig
    if (config.agentConfigs === undefined) return NONE_HELD
    const io = ioOf(config.agentConfigs, yield* timestamp)
    const held = (yield* skillsFound(io, yield* readRoles, projectId, config.skills?.root)).filter((one) => !one.row.roles.includes(role))
    return {
      names: new Set(held.map((one) => one.row.name)),
      agent: held.flatMap((one): ReadonlyArray<HeldSkill> =>
        one.storeOnly
          ? []
          : [{ name: one.row.name, ...(one.called === undefined || one.called === one.row.name ? {} : { called: one.called }) }],
      ),
    } satisfies HeldSkills
  }).pipe(Effect.catch(() => Effect.succeed(NONE_HELD)))

/**
 * Which roles get one of the person's skills (`SetToolRoles` for a skill). One in Althar's store is on while any
 * role gets it: the roles chosen for every project turn it on or off there too, refused in words for one never
 * reviewed. Says the store's change, where it made one, for the record of the person's act (`skill.turned_on`,
 * `skill.turned_off`). Any other is only its roles, a repository's own under `@<projectId>/<name>`.
 */
export const setSkillRoles = (
  store: { readonly root: string } | undefined,
  name: string,
  chosen: ReadonlyArray<ToolRole>,
  projectId: string | null,
  repository: string | null,
) =>
  Effect.gen(function* () {
    const listed = repository !== null || store === undefined ? [] : yield* listInstalls(store.root)
    const install = listed.flatMap((one) => (one.ok && one.install.id === name ? [one.install] : []))[0]
    if (store === undefined || install === undefined || projectId !== null) {
      yield* setToolRoles('skill', name, chosen, projectId, repository)
      return undefined
    }
    const active = chosen.length > 0
    const changed = active === install.active ? undefined : yield* setActive(store.root, name, active)
    // Off, it goes back to every role for when it is turned on again; on, with the roles chosen.
    if (active) yield* setToolRoles('skill', name, chosen, null)
    else
      yield* writeRoles((roles) => {
        const { all: _all, ...kept } = roles.skill[name] ?? {}
        return { ...roles, skill: { ...roles.skill, [name]: kept } }
      })
    return changed === undefined ? undefined : { id: changed.id, active: changed.active, treeHash: changed.treeHash }
  })

/** Takes what was kept of a skill's roles out, for one taken out of Althar's store, so no other takes them up by its name. */
export const forgetSkillRoles = (name: string) =>
  writeRoles((roles) => ({ ...roles, skill: Object.fromEntries(Object.entries(roles.skill).filter(([key]) => key !== name)) }))

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
    if (io === undefined)
      return {
        enabled: false,
        servers: [],
        skills: [],
        serverSync: empty,
        skillSync: empty,
        places: [],
        checkedAt: null,
      } satisfies AgentTools
    // While a switch is on, what the person changed in their agents since is brought in step as Settings reads them.
    yield* refresh(io)
    const roles = yield* readRoles
    const { record, plan } = mcp.syncState(io)
    const agents = plan.agents
    const health = readHealth(io)
    const servers: Array<ToolRow> = Object.keys(plan.here).map((name) => {
      const found = agents.flatMap((agent) => {
        const spec = agent.servers.find((server) => server.name === name)
        return spec === undefined ? [] : [{ agent: agent.agent, spec }]
      })
      const specIn = (agent: SyncedAgent) => found.find((one) => one.agent === agent)?.spec
      return {
        name,
        about: found[0] === undefined ? '' : runsOf(found[0].spec),
        sources: found.map(({ agent }): ToolSource => ({ from: agent, where: FILES[agent] })),
        roles: [...rolesOf(roles, 'server', name, projectId)],
        here: Object.fromEntries(SYNCED_AGENTS.map((agent) => [agent, hereOf(plan.here[name]![agent])])) as ToolRow['here'],
        offIn: offInOf(roles, 'server', name),
        repository: null,
        way: found[0]?.spec.url === undefined ? 'command' : 'address',
        signIn: Object.fromEntries(SYNCED_AGENTS.map((agent) => [agent, signInOf(health, specIn(agent), agent)])) as ToolRow['signIn'],
        failed: failedOf(
          health,
          name,
          found.map((one) => one.agent),
        ),
        home: null,
        from: null,
      }
    })
    // Each project's repositories' own servers: in no role until the person turns them on, there only.
    const projectIds =
      projectId === null
        ? (yield* (yield* SqlClient.SqlClient)<{
            id: string
          }>`SELECT id FROM projects WHERE archived_at IS NULL ORDER BY created_at, id`).map((row) => row.id)
        : [projectId]
    for (const project of projectIds)
      for (const spec of yield* repositoryServersOf(project))
        servers.push({
          name: spec.name,
          about: runsOf(spec),
          sources: [{ from: 'repository', where: '.mcp.json' }],
          roles: [...rolesOf(roles, 'server', toolKey(spec.name, project), projectId, [])],
          // Sync never carries a repository's own: it is in none of the person's agents' files.
          here: { claude: 'missing', codex: 'missing', opencode: 'missing' },
          offIn: [],
          repository: project,
          way: spec.url === undefined ? 'command' : 'address',
          signIn: NO_SIGN_IN,
          failed: null,
          home: null,
          from: null,
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
    const skillRows: Array<ToolRow> = (yield* skillsFound(io, roles, projectId, (yield* RuntimeConfig).skills?.root)).map((one) => one.row)
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
    const places = SYNCED_AGENTS.map((agent) => ({
      agent,
      file: agents.find((each) => each.agent === agent)?.file ?? FILES[agent],
      folder: FOLDERS[agent],
    }))
    return {
      enabled: true,
      servers,
      skills: skillRows,
      serverSync,
      skillSync,
      places,
      checkedAt: health.checkedAt,
    } satisfies AgentTools
  })

/** Expands a reference to a variable from the environment Althar runs in; undefined where it names one that isn't set. */
const expand = (value: string): string | undefined => {
  const bearer = /^Bearer\s+(.*)$/i.exec(value)
  const name = referenceOf(bearer?.[1] ?? value)
  if (name === undefined) return value
  const found = process.env[name]
  return found === undefined ? undefined : bearer === null ? found : `Bearer ${found}`
}

export const expanded = (values: Readonly<Record<string, string>> | undefined) =>
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

/** A server with the variables its references name filled in from Althar's environment, as Althar's own check starts it. */
export const expandedSpec = (spec: ServerSpec): ServerSpec => {
  const { tokenVariable, env, headers, ...rest } = spec
  const token = tokenVariable === undefined ? undefined : process.env[tokenVariable]
  const filled = { ...expanded(headers), ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }) }
  return {
    ...rest,
    ...(env === undefined ? {} : { env: expanded(env) }),
    ...(Object.keys(filled).length === 0 ? {} : { headers: filled }),
  }
}

/**
 * The person's servers a session of this role, in this project, is given
 * (ADR-097): each found in one of their agents' settings, whichever, on there,
 * and ticked for the role. Codex and OpenCode have their own switched off by
 * name as they start, and Claude Code loads only what it is given, so a
 * session gets exactly these, beside Althar's own, whichever agent it runs.
 * Then the project's repositories' own, those the person turned on for the
 * role, read from the project's own checkouts; `ownRepository` false gives
 * none of them, for a review of a pull request from outside the project.
 */
export const serversFor = (role: ToolRole, projectId: string, http: boolean, ownRepository = true) =>
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
    if (ownRepository)
      for (const spec of yield* repositoryServersOf(projectId)) {
        // One of the person's own of the same name is theirs: a session gets one server by a name.
        if (seen.has(spec.name)) continue
        seen.add(spec.name)
        if (!rolesOf(roles, 'server', toolKey(spec.name, projectId), projectId, []).includes(role)) continue
        const server = sessionServer(spec)
        if (server !== undefined && (server.type === 'stdio' || http)) given.push(server)
      }
    return given
  }).pipe(Effect.catch(() => Effect.succeed([] as ReadonlyArray<McpServer>)))
