import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import {
  agentServers,
  type AgentServers,
  isReference,
  referenceOf,
  asWritten,
  sameServer,
  type ServerHome,
  type ServerSpec,
  SYNCED_AGENTS,
  type SyncedAgent,
} from '@althar/provider-adapters'
import { applyEdits, modify } from 'jsonc-parser'

/*
 * One switch that keeps the person's agents' MCP servers the same
 * (docs/decisions/097, "MCP servers and skills"): what one of Claude Code,
 * Codex and OpenCode has, the others get, written into each agent's own
 * settings so each has them when the person uses it on its own.
 *
 * It writes into files that are the person's, so it keeps to a few rules:
 * - Writes go through each agent's own command (`claude mcp add-json
 *   --scope user`, `codex mcp add`), never into `~/.claude.json` by hand,
 *   which Claude Code rewrites all the time. OpenCode has no command for it,
 *   so its JSON is edited in place, comments kept.
 * - A copy of each file is kept before Althar first writes to it, and a
 *   record of each server it added, so taking them back out removes only what
 *   Althar added, and only while it is still as Althar wrote it.
 * - The person's decisions hold: a server already in an agent is left as they
 *   set it, on or off; one they take out of an agent is kept out there; one set
 *   up two ways waits for them to pick; nothing is removed on its own.
 * - A secret written out in a file isn't copied: a token goes across as the
 *   name of its variable, never its value, or not at all.
 *
 * Everything it does goes through `SyncIo`, so tests run it against a
 * temporary home and a fake of each agent's command.
 */

/** Running an agent's own command: its exit code and what it said. */
export type Run = (command: string, args: ReadonlyArray<string>) => Promise<{ readonly code: number; readonly output: string }>

export interface SyncIo {
  readonly home: ServerHome
  /** Where Althar keeps its record and the copies of the files it changed. */
  readonly folder: string
  readonly run: Run
  /** The time now, as the record keeps it. */
  readonly now: () => string
}

/** Something the person took out of an agent, a server Althar copied since, or one it added: a line under Since. */
export interface SinceEntry {
  readonly id: string
  readonly at: string
  readonly server: string
  /** The person added it to `from`, and Althar copied it to `to`. */
  readonly kind: 'copied' | 'tookOut'
  readonly from: SyncedAgent
  readonly to: ReadonlyArray<SyncedAgent>
  /** Undone since: what it copied taken back out, or what was taken out put back. */
  readonly undone?: boolean
}

/** What Althar wrote, so it can take exactly that back out. */
export interface Added {
  readonly agent: SyncedAgent
  readonly spec: ServerSpec
  readonly at: string
}

/** The record of the switch, kept in Althar's own folder. */
export interface SyncRecord {
  readonly on: boolean
  readonly added: ReadonlyArray<Added>
  /** Servers kept out of an agent: taken back, left out before it started, or taken out of the agent by the person. */
  readonly keptOut: Readonly<Record<SyncedAgent, ReadonlyArray<string>>>
  /** For a server set up two ways: whose way it runs everywhere, or left out of syncing. */
  readonly picks: Readonly<Record<string, SyncedAgent | 'apart'>>
  /** Each agent's servers by name, as last seen: what tells the person's own changes since. */
  readonly seen: Readonly<Record<SyncedAgent, ReadonlyArray<string>>>
  readonly since: ReadonlyArray<SinceEntry>
  /** The copy of each file kept before Althar first wrote to it. */
  readonly backups: Readonly<Partial<Record<SyncedAgent, string>>>
  /** Sign-ins the person started, by server and agent: off To settle once started. */
  readonly signedIn: ReadonlyArray<string>
  /** Whether `seen` was read once already, so a server not in it is one the person added since. */
  readonly looked?: boolean
  /** What its last writes couldn't do, in each agent's own words: said in Settings until a write goes through. */
  readonly errors?: ReadonlyArray<string>
}

const NONE: Readonly<Record<SyncedAgent, ReadonlyArray<string>>> = { claude: [], codex: [], opencode: [] }

export const emptyRecord: SyncRecord = { on: false, added: [], keptOut: NONE, picks: {}, seen: NONE, since: [], backups: {}, signedIn: [] }

const recordPath = (io: SyncIo) => join(io.folder, 'mcp-sync.json')

export const readRecord = (io: SyncIo): SyncRecord => {
  try {
    const path = recordPath(io)
    return existsSync(path) ? { ...emptyRecord, ...(JSON.parse(readFileSync(path, 'utf8')) as Partial<SyncRecord>) } : emptyRecord
  } catch {
    return emptyRecord
  }
}

const writeRecord = (io: SyncIo, record: SyncRecord) => {
  mkdirSync(io.folder, { recursive: true })
  writeFileSync(recordPath(io), `${JSON.stringify(record, null, 2)}\n`)
}

/** Why a server can't go to an agent as it is set up: it wouldn't run there, or it holds a secret in plain words. */
export type Cant = 'sse' | 'secret' | 'headers' | 'reference'

/** Something sync can't do alone: a file it can't read, a server set up two ways, a server it can't carry, a sign-in. */
export type Settle =
  | { readonly kind: 'unreadable'; readonly agent: SyncedAgent; readonly file: string; readonly problem: string }
  | {
      readonly kind: 'differs'
      readonly server: string
      readonly ways: ReadonlyArray<{ readonly agent: SyncedAgent; readonly runs: string }>
    }
  | { readonly kind: 'cant'; readonly server: string; readonly agent: SyncedAgent; readonly why: Cant }
  | { readonly kind: 'signIn'; readonly server: string; readonly agents: ReadonlyArray<SyncedAgent> }

/** How a server stands in one agent. */
export type Here = 'in' | 'added' | 'missing' | 'out' | 'differs' | 'cant'

/** What sync would do, or has: what it adds to each agent, what it can't, and how each server stands in each. */
export interface SyncPlan {
  readonly agents: ReadonlyArray<AgentServers>
  readonly adds: ReadonlyArray<{ readonly agent: SyncedAgent; readonly spec: ServerSpec }>
  /** A server whose picked way replaces how another agent ran it. */
  readonly replaces: ReadonlyArray<{ readonly agent: SyncedAgent; readonly spec: ServerSpec; readonly before: ServerSpec }>
  readonly settle: ReadonlyArray<Settle>
  readonly here: Readonly<Record<string, Readonly<Record<SyncedAgent, Here>>>>
}

const SECRET_KEY = /token|secret|password|passwd|api[_-]?key|auth|credential|private/i

/** A value written out in a file that looks like a secret: under a key that says so, and not a reference to a variable. */
const holdsSecret = (spec: ServerSpec): boolean =>
  [...Object.entries(spec.env ?? {}), ...Object.entries(spec.headers ?? {})].some(
    ([key, value]) => SECRET_KEY.test(key) && !isReference(value) && !isReference(value.replace(/^Bearer\s+/i, '')),
  )

/** Why a server can't go to an agent as it is, if it can't. */
const cantGo = (spec: ServerSpec, agent: SyncedAgent): Cant | undefined => {
  if (holdsSecret(spec)) return 'secret'
  if (agent !== 'codex') return undefined
  // Codex takes streamable HTTP, not SSE; a bearer token by its variable, not other headers; values, not names, for a command.
  if (spec.transport === 'sse') return 'sse'
  const headers = Object.entries(spec.headers ?? {})
  if (headers.some(([key, value]) => key.toLowerCase() !== 'authorization' || referenceOf(value.replace(/^Bearer\s+/i, '')) === undefined))
    return 'headers'
  if (Object.values(spec.env ?? {}).some(isReference)) return 'reference'
  return undefined
}

/** Plans what the switch would do now, from each agent's servers and what the person decided. */
export const planSync = (record: SyncRecord, agents: ReadonlyArray<AgentServers>): SyncPlan => {
  const readable = agents.filter((each) => each.problem === undefined)
  const settle: Array<Settle> = agents.flatMap((each) =>
    each.problem === undefined ? [] : [{ kind: 'unreadable' as const, agent: each.agent, file: each.file, problem: each.problem }],
  )
  const names = [...new Set(readable.flatMap((each) => each.servers.map((server) => server.name)))].sort()
  const adds: Array<SyncPlan['adds'][number]> = []
  const replaces: Array<SyncPlan['replaces'][number]> = []
  const here: Record<string, Record<SyncedAgent, Here>> = {}
  for (const name of names) {
    const having = readable.flatMap((each) => {
      const spec = each.servers.find((server) => server.name === name)
      return spec === undefined ? [] : [{ agent: each.agent, spec }]
    })
    const ways = having.filter((one, index) => having.findIndex((other) => sameServer(one.spec, other.spec)) === index)
    const pick = record.picks[name]
    const row: Record<SyncedAgent, Here> = { claude: 'missing', codex: 'missing', opencode: 'missing' }
    for (const { agent } of having)
      row[agent] = record.added.some((each) => each.agent === agent && each.spec.name === name) ? 'added' : 'in'
    for (const agent of SYNCED_AGENTS) if (row[agent] === 'missing' && record.keptOut[agent].includes(name)) row[agent] = 'out'
    here[name] = row
    if (pick === 'apart') continue
    let source = ways[0]?.spec
    if (ways.length > 1) {
      const picked = pick === undefined ? undefined : having.find((one) => one.agent === pick)
      if (picked === undefined) {
        settle.push({ kind: 'differs', server: name, ways: ways.map((one) => ({ agent: one.agent, runs: runsLine(one.spec) })) })
        for (const { agent } of having) row[agent] = 'differs'
        continue
      }
      source = picked.spec
      // Each other agent's way is replaced by the one picked, where it can go there as it is: a secret written out, or a way the
      // agent doesn't take, stays under To settle, and its own way is left. One the person turned off there stays as they left it.
      for (const one of having) {
        if (sameServer(one.spec, picked.spec) || record.keptOut[one.agent].includes(name) || one.spec.off === true) continue
        const cant = cantGo(picked.spec, one.agent)
        if (cant !== undefined) {
          settle.push({ kind: 'cant', server: name, agent: one.agent, why: cant })
          continue
        }
        const { off: _, ...spec } = picked.spec
        replaces.push({ agent: one.agent, spec, before: one.spec })
      }
    }
    if (source === undefined) continue
    for (const agent of SYNCED_AGENTS) {
      if (row[agent] !== 'missing' || !readable.some((each) => each.agent === agent)) continue
      const cant = cantGo(source, agent)
      if (cant !== undefined) {
        settle.push({ kind: 'cant', server: name, agent, why: cant })
        row[agent] = 'cant'
        continue
      }
      const { off: _, ...spec } = source
      adds.push({ agent, spec })
    }
  }
  // A remote server signs in on its own in each agent: one Althar copied waits on a sign-in there, until the person starts it.
  const remote = new Map<string, Array<SyncedAgent>>()
  for (const each of record.added)
    if (each.spec.transport !== 'stdio' && each.spec.headers === undefined && each.spec.tokenVariable === undefined)
      if (!record.signedIn.includes(`${each.spec.name}:${each.agent}`))
        remote.set(each.spec.name, [...(remote.get(each.spec.name) ?? []), each.agent])
  for (const [server, waiting] of remote) settle.push({ kind: 'signIn', server, agents: waiting })
  return { agents, adds, replaces, settle, here }
}

const runsLine = (spec: ServerSpec) => spec.url ?? [spec.command ?? '', ...(spec.args ?? [])].join(' ').trim()

/** A reference as Claude Code writes one, from any agent's way. */
const claudeValue = (value: string) => {
  const name = referenceOf(value)
  return name === undefined ? value : `\${${name}}`
}

/** A reference as OpenCode writes one. */
const openCodeValue = (value: string) => {
  const bearer = /^Bearer\s+(.*)$/i.exec(value)
  const name = referenceOf(bearer?.[1] ?? value)
  return name === undefined ? value : bearer === null ? `{env:${name}}` : `Bearer {env:${name}}`
}

const mapValues = (values: Readonly<Record<string, string>> | undefined, as: (value: string) => string) =>
  values === undefined ? undefined : Object.fromEntries(Object.entries(values).map(([key, value]) => [key, as(value)]))

/** A server as Claude Code's `add-json` takes it. */
export const claudeJson = (spec: ServerSpec): Record<string, unknown> =>
  spec.transport === 'stdio'
    ? {
        type: 'stdio',
        command: spec.command,
        args: spec.args ?? [],
        ...(spec.env === undefined ? {} : { env: mapValues(spec.env, claudeValue) }),
      }
    : {
        type: spec.transport,
        url: spec.url,
        ...(spec.headers === undefined && spec.tokenVariable === undefined
          ? {}
          : {
              headers: {
                ...mapValues(spec.headers, (value) =>
                  value.replace(/(Bearer\s+)?(.*)/i, (_, bearer = '', rest: string) => `${bearer}${claudeValue(rest)}`),
                ),
                ...(spec.tokenVariable === undefined ? {} : { Authorization: `Bearer \${${spec.tokenVariable}}` }),
              },
            }),
      }

/** A server as `codex mcp add` takes it. */
export const codexArgs = (spec: ServerSpec): ReadonlyArray<string> => {
  if (spec.transport !== 'stdio') {
    const bearer =
      spec.tokenVariable ??
      referenceOf((spec.headers?.['Authorization'] ?? spec.headers?.['authorization'] ?? '').replace(/^Bearer\s+/i, ''))
    return ['mcp', 'add', spec.name, '--url', spec.url ?? '', ...(bearer === undefined ? [] : ['--bearer-token-env-var', bearer])]
  }
  return [
    'mcp',
    'add',
    spec.name,
    ...Object.entries(spec.env ?? {}).flatMap(([key, value]) => ['--env', `${key}=${value}`]),
    '--',
    spec.command ?? '',
    ...(spec.args ?? []),
  ]
}

/** A server as OpenCode's `mcp` keeps it. */
export const openCodeEntry = (spec: ServerSpec): Record<string, unknown> =>
  spec.transport === 'stdio'
    ? {
        type: 'local',
        command: [spec.command ?? '', ...(spec.args ?? [])],
        ...(spec.env === undefined ? {} : { environment: mapValues(spec.env, openCodeValue) }),
      }
    : {
        type: 'remote',
        url: spec.url,
        ...(spec.headers === undefined && spec.tokenVariable === undefined
          ? {}
          : {
              headers: {
                ...mapValues(spec.headers, openCodeValue),
                ...(spec.tokenVariable === undefined ? {} : { Authorization: `Bearer {env:${spec.tokenVariable}}` }),
              },
            }),
      }

/** Writes into OpenCode's file in place, keeping its comments and the rest as the person wrote it. */
const editOpenCode = (path: string, name: string, value: Record<string, unknown> | undefined) => {
  const text = existsSync(path) ? readFileSync(path, 'utf8') : '{\n  "$schema": "https://opencode.ai/config.json"\n}\n'
  const edits = modify(text, ['mcp', name], value, { formattingOptions: { insertSpaces: true, tabSize: 2 } })
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, applyEdits(text, edits))
}

/** Why an agent's command failed, in its own words, short. */
const failed = (agent: SyncedAgent, output: string) =>
  new Error(`${AGENT_NAMES[agent]}: ${output.trim().split('\n').slice(-1)[0] ?? 'it failed'}`)

export const AGENT_NAMES: Readonly<Record<SyncedAgent, string>> = { claude: 'Claude Code', codex: 'Codex', opencode: 'OpenCode' }

/** Adds one server to one agent, through its own command. */
const write = async (io: SyncIo, agent: SyncedAgent, path: string, spec: ServerSpec) => {
  if (agent === 'opencode') return editOpenCode(path, spec.name, openCodeEntry(spec))
  const { code, output } =
    agent === 'claude'
      ? await io.run('claude', ['mcp', 'add-json', '--scope', 'user', spec.name, JSON.stringify(claudeJson(spec))])
      : await io.run('codex', codexArgs(spec))
  if (code !== 0) throw failed(agent, output)
}

/** Takes one server out of one agent, through its own command. */
const unwrite = async (io: SyncIo, agent: SyncedAgent, path: string, name: string) => {
  if (agent === 'opencode') return editOpenCode(path, name, undefined)
  const { code, output } =
    agent === 'claude' ? await io.run('claude', ['mcp', 'remove', '--scope', 'user', name]) : await io.run('codex', ['mcp', 'remove', name])
  if (code !== 0) throw failed(agent, output)
}

/** Keeps a copy of an agent's file before Althar first writes to it. */
const backUp = (io: SyncIo, record: SyncRecord, agent: SyncedAgent, path: string): SyncRecord => {
  if (record.backups[agent] !== undefined || !existsSync(path)) return record
  const copy = join(io.folder, 'backups', `${agent}-${io.now().replace(/[:.]/g, '-')}${path.slice(path.lastIndexOf('.'))}`)
  mkdirSync(dirname(copy), { recursive: true })
  copyFileSync(path, copy)
  return { ...record, backups: { ...record.backups, [agent]: copy } }
}

const read = (io: SyncIo) => SYNCED_AGENTS.map((agent) => agentServers(agent, io.home))

const seenNow = (agents: ReadonlyArray<AgentServers>, before: SyncRecord['seen']): SyncRecord['seen'] =>
  Object.fromEntries(
    SYNCED_AGENTS.map((agent) => {
      const found = agents.find((each) => each.agent === agent)
      // A file it can't read says nothing of what is in it now: what was seen stays.
      return [agent, found === undefined || found.problem !== undefined ? before[agent] : found.servers.map((server) => server.name)]
    }),
  ) as SyncRecord['seen']

/** A failure, in its own words. */
const said = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** Sync's steps on one record, one at a time: a read of Settings that brings the agents in step, and a press, never at once. */
const queues = new Map<string, Promise<unknown>>()
export const serialized = <A>(io: { readonly folder: string }, step: () => Promise<A> | A): Promise<A> => {
  const before = queues.get(io.folder) ?? Promise.resolve()
  const next = before.then(step, step)
  queues.set(
    io.folder,
    next.then(
      () => undefined,
      () => undefined,
    ),
  )
  return next
}

const idOf = (io: SyncIo, server: string, agent: SyncedAgent) => `${io.now()}:${server}:${agent}`

/**
 * Brings the agents in step, while the switch is on: what the person took
 * out of an agent since is kept out there; what they added to one is copied
 * to the others; and what the plan adds is written, each through its agent's
 * own command. A write that fails is said, and the rest goes on.
 */
const reconcileNow = async (io: SyncIo): Promise<{ readonly record: SyncRecord; readonly errors: ReadonlyArray<string> }> => {
  let record = readRecord(io)
  const agents = read(io)
  if (!record.on) {
    const looked = { ...record, seen: seenNow(agents, record.seen), looked: true }
    writeRecord(io, looked)
    return { record: looked, errors: [] }
  }
  const errors: Array<string> = []
  /** Servers the person added to an agent since Althar last looked, by the agent they added it to. */
  const fresh = new Map<string, SyncedAgent>()
  const keptOut = { ...record.keptOut }
  const since: Array<SinceEntry> = [...record.since]
  let added = [...record.added]
  for (const found of agents) {
    if (found.problem !== undefined) continue
    const now = new Set(found.servers.map((server) => server.name))
    const before = new Set(record.seen[found.agent])
    if (record.looked === true) for (const name of now) if (!before.has(name) && !fresh.has(name)) fresh.set(name, found.agent)
    // What Althar added there and the person took out: it stays out there.
    for (const gone of added.filter((each) => each.agent === found.agent && !now.has(each.spec.name))) {
      keptOut[found.agent] = [...new Set([...keptOut[found.agent], gone.spec.name])]
      added = added.filter((each) => each !== gone)
      since.unshift({
        id: idOf(io, gone.spec.name, found.agent),
        at: io.now(),
        server: gone.spec.name,
        kind: 'tookOut',
        from: found.agent,
        to: [],
      })
    }
    // What the person took out of an agent that was theirs there: kept out too, so it isn't copied back.
    for (const name of before)
      if (!now.has(name) && !record.added.some((each) => each.agent === found.agent && each.spec.name === name)) {
        keptOut[found.agent] = [...new Set([...keptOut[found.agent], name])]
        since.unshift({ id: idOf(io, name, found.agent), at: io.now(), server: name, kind: 'tookOut', from: found.agent, to: [] })
      }
  }
  record = { ...record, keptOut, added, since }
  const plan = planSync(record, agents)
  const copied = new Map<string, Array<SyncedAgent>>()
  for (const { agent, spec } of [...plan.replaces, ...plan.adds]) {
    const path = agents.find((each) => each.agent === agent)?.path ?? ''
    try {
      record = backUp(io, record, agent, path)
      if (plan.replaces.some((each) => each.agent === agent && each.spec.name === spec.name)) await unwrite(io, agent, path, spec.name)
      await write(io, agent, path, spec)
      record = { ...record, added: [...record.added, { agent, spec, at: io.now() }] }
      if (fresh.has(spec.name)) copied.set(spec.name, [...(copied.get(spec.name) ?? []), agent])
    } catch (error) {
      errors.push(said(error))
    }
  }
  // A server the person added to one agent, now copied to the others: said under Since, with Undo.
  for (const [server, to] of copied) {
    const from = fresh.get(server)
    if (from !== undefined)
      record = { ...record, since: [{ id: idOf(io, server, from), at: io.now(), server, kind: 'copied', from, to }, ...record.since] }
  }
  record = { ...record, seen: seenNow(read(io), record.seen), since: record.since.slice(0, 20), looked: true, errors }
  writeRecord(io, record)
  return { record, errors }
}

/** Brings the agents in step, one step of sync at a time. */
export const reconcile = (io: SyncIo) => serialized(io, () => reconcileNow(io))

/** Turns the switch on, and brings the agents in step. */
export const turnOn = (io: SyncIo) =>
  serialized(io, () => {
    writeRecord(io, { ...readRecord(io), on: true })
    return reconcileNow(io)
  })

/**
 * Turns the switch off: what it added stays in each agent, the person's now,
 * or comes back out of each, where it is still as Althar wrote it. What the
 * person changed since stays as they left it.
 */
export const turnOff = (io: SyncIo, takeBack: boolean): Promise<{ readonly errors: ReadonlyArray<string> }> =>
  serialized(io, async () => {
    const record = readRecord(io)
    const errors: Array<string> = []
    // What it couldn't take back stays its own, to take back again; the rest is the person's now.
    const kept: Array<Added> = []
    if (takeBack) {
      const agents = read(io)
      for (const each of record.added) {
        const found = agents.find((agent) => agent.agent === each.agent)
        const now = found?.servers.find((server) => server.name === each.spec.name)
        // Changed since, or gone: the person's now, and left as it is.
        if (found === undefined || found.problem !== undefined || now === undefined || !asWritten(now, each.spec)) continue
        try {
          await unwrite(io, each.agent, found.path, each.spec.name)
        } catch (error) {
          errors.push(said(error))
          kept.push(each)
        }
      }
    }
    writeRecord(io, { ...record, on: false, added: kept, errors, seen: seenNow(read(io), record.seen) })
    return { errors }
  })

/**
 * Keeps a server out of one agent: taken back out where Althar added it and
 * it is still as Althar wrote it; left as it is where the person changed it
 * since, which makes it theirs; left out of the plan where it isn't there.
 */
const keepOutNow = async (io: SyncIo, agent: SyncedAgent, server: string) => {
  const record = readRecord(io)
  const mine = record.added.find((each) => each.agent === agent && each.spec.name === server)
  const found = agentServers(agent, io.home)
  const now = found.servers.find((each) => each.name === server)
  const errors: Array<string> = []
  let stillMine = false
  if (mine !== undefined && now !== undefined && found.problem === undefined && asWritten(now, mine.spec))
    try {
      await unwrite(io, agent, found.path, server)
    } catch (error) {
      errors.push(said(error))
      stillMine = true
    }
  writeRecord(io, {
    ...record,
    added: stillMine ? record.added : record.added.filter((each) => each !== mine),
    keptOut: { ...record.keptOut, [agent]: [...new Set([...record.keptOut[agent], server])] },
    errors,
    seen: seenNow(read(io), record.seen),
  })
}

export const keepOut = (io: SyncIo, agent: SyncedAgent, server: string) => serialized(io, () => keepOutNow(io, agent, server))

const putBackNow = (io: SyncIo, agent: SyncedAgent, server: string) => {
  const record = readRecord(io)
  writeRecord(io, { ...record, keptOut: { ...record.keptOut, [agent]: record.keptOut[agent].filter((name) => name !== server) } })
  return reconcileNow(io)
}

/** Puts a server kept out of an agent back in the plan, and, while the switch is on, back in the agent. */
export const putBack = (io: SyncIo, agent: SyncedAgent, server: string) => serialized(io, () => putBackNow(io, agent, server))

/** Picks whose way a server set up two ways runs everywhere, or leaves it out of syncing. */
export const pickWay = (io: SyncIo, server: string, way: SyncedAgent | 'apart') =>
  serialized(io, () => {
    const record = readRecord(io)
    writeRecord(io, { ...record, picks: { ...record.picks, [server]: way } })
    return reconcileNow(io)
  })

/** Undoes a line under Since: what it copied taken back out of each agent and kept out; what was taken out put back. */
export const undoSince = (io: SyncIo, id: string) =>
  serialized(io, async () => {
    const record = readRecord(io)
    const entry = record.since.find((each) => each.id === id)
    if (entry === undefined || entry.undone === true) return
    writeRecord(io, { ...record, since: record.since.map((each) => (each.id === id ? { ...each, undone: true } : each)) })
    if (entry.kind === 'copied') for (const agent of entry.to) await keepOutNow(io, agent, entry.server)
    else await putBackNow(io, entry.from, entry.server)
  })

/**
 * A server's sign-in in one agent, as the line the person runs in a terminal:
 * each agent keeps its own, so each signs in on its own. It goes off To settle
 * once started. OpenCode's is started from OpenCode itself.
 */
export const signIn = (io: SyncIo, agent: SyncedAgent, server: string): string | undefined => {
  const record = readRecord(io)
  writeRecord(io, { ...record, signedIn: [...new Set([...record.signedIn, `${server}:${agent}`])] })
  return agent === 'claude' ? `claude mcp login ${server}` : agent === 'codex' ? `codex mcp login ${server}` : undefined
}

/** How the switch stands, and what turning it on would do: for Settings. */
export const syncState = (io: SyncIo) => {
  const record = readRecord(io)
  const agents = read(io)
  return { record, plan: planSync(record, agents) }
}
