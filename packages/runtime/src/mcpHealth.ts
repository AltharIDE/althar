import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { SYNCED_AGENTS, type ServerStatus, type SyncedAgent } from '@althar/provider-adapters'

import type { SyncIo } from './mcpSync'

export { type Probed, probeServer } from './mcpProbe'

/*
 * How each of the person's MCP servers stands in each of their agents, as the agents' own commands say it
 * (`claude mcp list`, `codex mcp list --json`, `opencode mcp list`), kept in Althar's own folder beside the sync record
 * (`mcp-health.json`) so the tiles can say Failed to start and Not signed in without asking every agent each time. What
 * a session says of a server as it works (`serverStatus.ts`) is kept there too, so a failure Althar saw shows without a
 * check. Each agent's words are read defensively: what isn't recognised is unknown, never guessed; an agent that couldn't
 * be asked keeps what it last said, for a day.
 */

/** What an agent says of one server: connected, needs the person to sign in, failed to start (with its reason), or nothing readable. */
export type AgentStatus = 'connected' | 'needs-auth' | 'failed' | 'unknown'

export interface HealthEntry {
  readonly status: AgentStatus
  /** The agent's own words for why, where it gave any: for a failed start. */
  readonly why?: string
  /** When it was read. */
  readonly at: string
  /**
   * Where the agent says how it signs in, apart from whether the server started: signed in (`yes`), or the server needs
   * no sign-in (`none`). Codex says so without starting a server; absent where the agent didn't say.
   */
  readonly signIn?: 'yes' | 'none'
}

export interface HealthRecord {
  /** When the agents were last asked; null before the first time. */
  readonly checkedAt: string | null
  /** By server name, then agent. */
  readonly servers: Readonly<Record<string, Partial<Record<SyncedAgent, HealthEntry>>>>
}

export const emptyHealth: HealthRecord = { checkedAt: null, servers: {} }

/** What one agent's list says of one server, before it is kept with the time. */
export type Heard = Omit<HealthEntry, 'at'>

/** How long what an agent last said is kept while it can't be asked. */
const KEPT_FOR = 24 * 60 * 60 * 1000
/** The most of a reason kept, in characters. */
const WHY_LENGTH = 300

const STATUSES: ReadonlyArray<string> = ['connected', 'needs-auth', 'failed', 'unknown']

// oxlint-disable-next-line no-control-regex -- the escape sequences a terminal colours text with, taken out.
const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-_]/g

const plain = (output: string) => output.replace(ANSI, '').replace(/\r/g, '')

/** A reason as kept: trimmed, on one line, at most 300 characters. */
const reason = (words: string): string | undefined => {
  const one = words.replace(/\s+/g, ' ').trim()
  if (one === '') return undefined
  return one.length > WHY_LENGTH ? `${one.slice(0, WHY_LENGTH - 1).trimEnd()}…` : one
}

const heard = (status: AgentStatus, why?: string, signIn?: Heard['signIn']): Heard => {
  const words = why === undefined ? undefined : reason(why)
  return { status, ...(words === undefined ? {} : { why: words }), ...(signIn === undefined ? {} : { signIn }) }
}

/** A server's name as the person keeps it: a plugin's (`plugin:github:github`) by its own last part. */
const nameOf = (raw: string): { readonly name: string; readonly plugin: boolean } => {
  const name = raw.trim()
  if (!name.startsWith('plugin:')) return { name, plugin: false }
  const last = name.slice(name.lastIndexOf(':') + 1)
  return { name: last === '' ? name : last, plugin: true }
}

/** Keeps one server's line, where a plugin's of the same name gives way to the person's own. */
const keep = (found: Map<string, Heard>, plugins: Set<string>, raw: string, entry: Heard) => {
  const { name, plugin } = nameOf(raw)
  if (name === '') return undefined
  if (plugin && found.has(name) && !plugins.has(name)) return undefined
  if (plugin) plugins.add(name)
  else plugins.delete(name)
  found.set(name, entry)
  return name
}

/** What Claude Code's status words say, after the mark before them (✓, ✗, ⚠): undefined where they aren't a status. */
const claudeStatus = (text: string): Heard | undefined => {
  const words = text.replace(/^[^\p{L}]+/u, '')
  const [status = '', ...rest] = words.split(/\s+[—–]\s+/)
  const why = rest.join(' — ')
  if (/^connected\b/i.test(status)) return heard('connected')
  if (/^needs auth/i.test(status)) return heard('needs-auth')
  if (/^failed\b/i.test(status)) return heard('failed', why)
  if (/^(pending|disabled|connecting|checking)\b/i.test(status)) return heard('unknown')
  return undefined
}

/**
 * `claude mcp list`: after `Checking MCP server health…`, a line a server, `name: what it runs - ✓ Connected`, or
 * `- ✗ Failed to connect — why`. What it runs may have ` - ` in it, so the status is the last ` - ` its words follow.
 * Undefined where nothing in it reads as that list.
 */
export const parseClaudeList = (output: string): Map<string, Heard> | undefined => {
  const found = new Map<string, Heard>()
  const plugins = new Set<string>()
  let last: string | undefined
  let recognised = false
  for (const line of plain(output).split('\n')) {
    if (line.trim() === '') continue
    if (/^checking mcp server health/i.test(line.trim())) continue
    if (/^no mcp servers configured/i.test(line.trim())) {
      recognised = true
      continue
    }
    // A reason that went on to another line, indented under its server's.
    if (/^\s/.test(line)) {
      const before = last === undefined ? undefined : found.get(last)
      if (before?.status === 'failed') found.set(last!, heard('failed', `${before.why ?? ''} ${line}`))
      continue
    }
    last = undefined
    const colon = line.indexOf(': ')
    if (colon <= 0) continue
    const rest = line.slice(colon + 2)
    let status: Heard | undefined
    for (let at = rest.lastIndexOf(' - '); at >= 0 && status === undefined; at = at === 0 ? -1 : rest.lastIndexOf(' - ', at - 1))
      status = claudeStatus(rest.slice(at + 3))
    // A line of a server whose status isn't one Claude Code is known to say: unknown, not guessed.
    if (status === undefined && rest.includes(' - ')) status = heard('unknown')
    if (status === undefined) continue
    recognised = true
    last = keep(found, plugins, line.slice(0, colon), status)
  }
  return recognised ? found : undefined
}

/** Codex's sign-in, in its JSON's words or its table's: whether it needs one, has one, or takes none. */
const codexAuth = (auth: string): Heard => {
  const words = auth
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
  // `codex mcp list` doesn't start servers: it says nothing of a failure, so a server without a sign-in problem is unknown.
  if (words === 'not_logged_in') return heard('needs-auth')
  if (words === 'o_auth' || words === 'oauth' || words === 'bearer_token') return heard('unknown', undefined, 'yes')
  if (words === 'unsupported') return heard('unknown', undefined, 'none')
  return heard('unknown')
}

/** `codex mcp list --json`: an array of servers, each with its name and `auth_status`. Undefined where it isn't that. */
export const parseCodexJson = (output: string): Map<string, Heard> | undefined => {
  let parsed: unknown
  try {
    parsed = JSON.parse(plain(output).trim())
  } catch {
    return undefined
  }
  if (!Array.isArray(parsed)) return undefined
  const found = new Map<string, Heard>()
  for (const each of parsed) {
    if (typeof each !== 'object' || each === null) continue
    const server = each as Readonly<Record<string, unknown>>
    if (typeof server['name'] !== 'string' || server['name'].trim() === '') continue
    found.set(server['name'].trim(), typeof server['auth_status'] === 'string' ? codexAuth(server['auth_status']) : heard('unknown'))
  }
  return found
}

/**
 * `codex mcp list`, as an older Codex without `--json` prints it: a table of its command servers and one of its
 * address servers, each under a header line whose last column is `Auth` where it says one.
 */
export const parseCodexTable = (output: string): Map<string, Heard> | undefined => {
  const found = new Map<string, Heard>()
  let recognised = false
  let columns: { readonly next: number; readonly auth: number | undefined } | undefined
  for (const line of plain(output).split('\n')) {
    if (line.trim() === '') {
      columns = undefined
      continue
    }
    if (/^no mcp servers configured/i.test(line.trim())) {
      recognised = true
      continue
    }
    if (/^Name\s{2,}\S/.test(line)) {
      // Columns are two spaces apart or more; a title may have one inside it (`Bearer Token Env Var`).
      const starts = [...line.matchAll(/(?:^|\s{2,})(?=\S)/g)].map((match) => match.index + match[0].length)
      const titles = starts.map((start, at) => line.slice(start, starts[at + 1] ?? line.length).trim())
      const auth = titles.findIndex((title) => /^auth$/i.test(title))
      columns = { next: starts[1] ?? line.length, auth: auth < 0 ? undefined : starts[auth] }
      recognised = true
      continue
    }
    if (columns === undefined) continue
    const name = line.slice(0, columns.next).trim().split(/\s+/)[0] ?? ''
    if (name === '') continue
    found.set(name, columns.auth === undefined ? heard('unknown') : codexAuth(line.slice(columns.auth)))
  }
  return recognised ? found : undefined
}

/** The frame OpenCode's lists are drawn in, taken off a line's start; its marks (✓, ✗, ⚠, ○) kept. */
const FRAME = /^[\s│┃┆┊|●◆◈■□▪]+/
/** The frame's corners and the line under it (`└  3 server(s)`): not a server, nor a failure's words. */
const CORNER = /^[┌└├╭╰◇]/
const OPENCODE_LINE = /^([✓✔✗✘⚠○])\s+(\S+)\s+(.*)$/

const openCodeStatus = (text: string): Heard => {
  const words = text.trim()
  if (/^connected\b/i.test(words)) return heard('connected')
  if (/^needs[ _]auth/i.test(words)) return heard('needs-auth')
  const failed = /^failed\b:?\s*(.*)$/i.exec(words)
  if (failed !== null) return heard('failed', failed[1])
  return heard('unknown')
}

/**
 * `opencode mcp list`: a line a server, `✓ github  connected`, `⚠ linear  needs authentication`, or
 * `✗ notion  failed: why`; an older OpenCode draws it in a frame (`●  ✓ github connected`) with a failure's words on
 * the lines under it (`│      why`). Undefined where nothing in it reads as that list.
 */
export const parseOpenCodeList = (output: string): Map<string, Heard> | undefined => {
  const found = new Map<string, Heard>()
  let last: string | undefined
  let recognised = false
  for (const raw of plain(output).split('\n')) {
    const trimmed = raw.trim()
    if (trimmed === '') continue
    if (/^\W*no mcp servers/i.test(trimmed)) recognised = true
    if (CORNER.test(trimmed) || /^\W*no mcp servers/i.test(trimmed)) {
      last = undefined
      continue
    }
    const line = raw.replace(FRAME, '').trimEnd()
    const server = OPENCODE_LINE.exec(line)
    if (server !== null) {
      recognised = true
      last = server[2]!
      found.set(last, openCodeStatus(server[3]!))
      continue
    }
    // A failure's words that went on to the lines under it.
    const before = last === undefined ? undefined : found.get(last)
    if (before?.status === 'failed' && line !== '') found.set(last!, heard('failed', `${before.why ?? ''} ${line}`))
    else last = undefined
  }
  return recognised ? found : undefined
}

const healthPath = (io: Pick<SyncIo, 'folder'>) => join(io.folder, 'mcp-health.json')

const entryOf = (value: unknown): HealthEntry | undefined => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const entry = value as Readonly<Record<string, unknown>>
  if (typeof entry['status'] !== 'string' || !STATUSES.includes(entry['status']) || typeof entry['at'] !== 'string') return undefined
  return {
    status: entry['status'] as AgentStatus,
    at: entry['at'],
    ...(typeof entry['why'] === 'string' ? { why: entry['why'] } : {}),
    ...(entry['signIn'] === 'yes' || entry['signIn'] === 'none' ? { signIn: entry['signIn'] } : {}),
  }
}

/** What was last kept; empty where nothing was, or where the file is damaged. Never runs a command. */
export const readHealth = (io: Pick<SyncIo, 'folder'>): HealthRecord => {
  try {
    const path = healthPath(io)
    if (!existsSync(path)) return emptyHealth
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return emptyHealth
    const { checkedAt, servers } = parsed as Readonly<Record<string, unknown>>
    const kept: Record<string, Partial<Record<SyncedAgent, HealthEntry>>> = {}
    if (typeof servers === 'object' && servers !== null && !Array.isArray(servers))
      for (const [name, agents] of Object.entries(servers)) {
        if (typeof agents !== 'object' || agents === null) continue
        const row: Partial<Record<SyncedAgent, HealthEntry>> = {}
        for (const agent of SYNCED_AGENTS) {
          const entry = entryOf((agents as Readonly<Record<string, unknown>>)[agent])
          if (entry !== undefined) row[agent] = entry
        }
        if (Object.keys(row).length > 0) kept[name] = row
      }
    return { checkedAt: typeof checkedAt === 'string' ? checkedAt : null, servers: kept }
  } catch {
    return emptyHealth
  }
}

/** Writes the record whole or not at all: to a file beside it, then moved over it. */
const writeHealth = (io: Pick<SyncIo, 'folder'>, record: HealthRecord) => {
  mkdirSync(io.folder, { recursive: true })
  const path = healthPath(io)
  const next = `${path}.${randomBytes(6).toString('hex')}.tmp`
  try {
    writeFileSync(next, `${JSON.stringify(record, null, 2)}\n`)
    renameSync(next, path)
  } catch (error) {
    try {
      unlinkSync(next)
    } catch {
      // Never written, or gone already.
    }
    throw error
  }
}

/** Whether what was kept at `at` is still young enough to keep, at `now`. */
const fresh = (at: string, now: string) => {
  const then = Date.parse(at)
  const current = Date.parse(now)
  return Number.isFinite(then) && Number.isFinite(current) && current - then < KEPT_FOR
}

/**
 * What was kept, with what the agents asked now said: an agent asked has its entries replaced by what it said, one
 * that couldn't be asked keeps its own while they are younger than a day.
 */
export const mergeHealth = (
  before: HealthRecord,
  asked: Partial<Record<SyncedAgent, ReadonlyMap<string, Heard>>>,
  now: string,
): HealthRecord => {
  const servers: Record<string, Partial<Record<SyncedAgent, HealthEntry>>> = {}
  const put = (name: string, agent: SyncedAgent, entry: HealthEntry) => {
    servers[name] = { ...servers[name], [agent]: entry }
  }
  for (const [name, agents] of Object.entries(before.servers))
    for (const agent of SYNCED_AGENTS) {
      const entry = agents[agent]
      if (entry !== undefined && asked[agent] === undefined && fresh(entry.at, now)) put(name, agent, entry)
    }
  for (const agent of SYNCED_AGENTS) for (const [name, entry] of asked[agent] ?? []) put(name, agent, { ...entry, at: now })
  return { checkedAt: now, servers }
}

/** Asks one agent through its own command; undefined where it couldn't be asked or said nothing readable. */
const ask = async (io: SyncIo, agent: SyncedAgent): Promise<ReadonlyMap<string, Heard> | undefined> => {
  try {
    if (agent === 'claude') {
      const { code, output } = await io.run('claude', ['mcp', 'list'])
      return code === 0 ? parseClaudeList(output) : undefined
    }
    if (agent === 'codex') {
      const json = await io.run('codex', ['mcp', 'list', '--json'])
      if (json.code === 0) return parseCodexJson(json.output) ?? parseCodexTable(json.output)
      // An older Codex refuses `--json`: its table says the sign-ins too.
      if (!/--json|unexpected argument|unrecognized|unknown (option|argument|flag)/i.test(json.output)) return undefined
      const table = await io.run('codex', ['mcp', 'list'])
      return table.code === 0 ? parseCodexTable(table.output) : undefined
    }
    const { code, output } = await io.run('opencode', ['mcp', 'list'])
    return code === 0 ? parseOpenCodeList(output) : undefined
  } catch {
    return undefined
  }
}

/** One check a folder at a time: a second asked while one runs gets the first one's answer. */
const running = new Map<string, Promise<HealthRecord>>()

const checkNow = async (io: SyncIo): Promise<HealthRecord> => {
  try {
    const answers = await Promise.all(SYNCED_AGENTS.map(async (agent) => [agent, await ask(io, agent)] as const))
    const asked = Object.fromEntries(answers.filter(([, found]) => found !== undefined)) as Partial<
      Record<SyncedAgent, ReadonlyMap<string, Heard>>
    >
    // Read again only now, so what a session said meanwhile is kept with it.
    const record = mergeHealth(readHealth(io), asked, io.now())
    writeHealth(io, record)
    return record
  } catch {
    return readHealth(io)
  }
}

/**
 * Asks each agent that is on this computer, through its own command (each at once, each within the 60 seconds its
 * command is given), how its servers stand; keeps the answer and returns it. Never throws: what couldn't be asked is
 * left as it was.
 */
export const checkHealth = (io: SyncIo): Promise<HealthRecord> => {
  const before = running.get(io.folder)
  if (before !== undefined) return before
  const next = checkNow(io).finally(() => running.delete(io.folder))
  running.set(io.folder, next)
  return next
}

/**
 * Keeps what a session said of a server as it worked: one that failed to start, with the notice's words, one that
 * needs a sign-in, or one that connected. One still starting or turned off says nothing new, and isn't kept. Never throws.
 */
export const noteServerStatus = (io: SyncIo, agent: SyncedAgent, server: string, status: ServerStatus | AgentStatus, why?: string) => {
  try {
    if (status === 'pending' || status === 'disabled' || server.trim() === '') return
    const before = readHealth(io)
    const entry: HealthEntry = { ...heard(status, status === 'failed' ? why : undefined), at: io.now() }
    writeHealth(io, { ...before, servers: { ...before.servers, [server]: { ...before.servers[server], [agent]: entry } } })
  } catch {
    // What a session said is kept where it can be; a folder that can't be written to loses only this.
  }
}
