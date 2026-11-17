import { createReadStream, existsSync, realpathSync } from 'node:fs'
import { open, readdir, readFile, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { createInterface } from 'node:readline'
import { Readable } from 'node:stream'
import { createZstdDecompress } from 'node:zlib'

import { columnsOf, isoOf, readCopy } from './stores'
import { type Places, within } from './places'

/*
 * Claude Code's and Codex's conversations about a repository, from where
 * each keeps them on this computer (DEV-37; docs/decisions/workspaces-and-runs.md,
 * "Bringing in other tools' work"). Neither promises its format, so each
 * reader takes what it knows and passes over the rest, and a file it can't
 * read is left out rather than failing the others.
 *
 * - Claude Code: `projects/<folder>/<session>.jsonl`, the folder its
 *   working folder with every character but letters and digits as `-`. A
 *   session's working folder is read from its records, never from the
 *   folder's name, which more than one folder can make. A conversation is
 *   its `user` and `assistant` records: the person's prompts, not tool
 *   results, Claude Code's own notes (`isMeta`), side chains or compaction
 *   summaries; the agent's text, each message's blocks joined. Its title is
 *   the person's (`custom-title`), else Claude Code's (`ai-title`), else its
 *   first prompt. A file a newer one continues (`continued-in`) is that one's.
 * - Codex: `sessions/YYYY/MM/DD/rollout-…-<id>.jsonl`, older ones as `.zst`;
 *   its `state_5.sqlite` lists them with their folder and title, and
 *   `session_index.jsonl` keeps the names people gave. A conversation is its
 *   `user_message` and `agent_message` events, or, as newer ones write them,
 *   its completed `UserMessage` and `AgentMessage` items. Only conversations
 *   a person had: not `codex exec`'s, an MCP server's or a sub-agent's.
 *
 * Listing reads at most the head and tail of each Claude Code file, so a
 * long history lists in moments; bringing one in reads it whole.
 */

export type Agent = 'claude_code' | 'codex'

export interface Conversation {
  readonly agent: Agent
  /** The agent's own id for it: Claude Code's session, Codex's thread. */
  readonly id: string
  readonly file: string
  /** The folder it ran in. */
  readonly cwd: string
  readonly title: string
  readonly startedAt: string | null
  readonly lastAt: string | null
  /** How many times the person wrote, where that was read; null for a long one only listed. */
  readonly prompts: number | null
  readonly branch: string | null
}

export interface Message {
  readonly role: 'person' | 'agent'
  readonly text: string
  readonly at: string | null
}

/** How much of each end of a Claude Code file is read to list it. */
const END = 256 * 1024

/** What Claude Code writes in a person's turn that isn't their words: its notes on commands, reminders and caveats. */
const NOT_SAID =
  /^\s*<(local-command-caveat|local-command-stdout|local-command-stderr|command-name|command-message|command-args|task-notification|system-reminder|bash-input|bash-stdout|bash-stderr|user-prompt-submit-hook)>/

/** A folder as the file system has it, as the folders looked in are: one reached through a link is the same folder. */
const real = (path: string) => {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
const text = (value: unknown) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null)
const parse = (line: string): Record<string, unknown> | null => {
  try {
    return record(JSON.parse(line))
  } catch {
    return null
  }
}

/** A conversation's title from its first words: their first line, cut short. */
export const titleFrom = (words: string) => {
  const line = words.trim().split('\n')[0]?.trim() ?? ''
  return line.length > 80 ? `${line.slice(0, 79).trimEnd()}…` : line
}

/** Claude Code's folder for a working folder: every character but ASCII letters and digits as `-`, a long one cut and marked with its hash. */
export const claudeFolder = (cwd: string) => {
  const name = cwd.replace(/[^a-zA-Z0-9]/g, '-')
  if (name.length <= 200) return name
  let hash = 0
  for (let at = 0; at < cwd.length; at++) hash = (Math.imul(hash, 31) + cwd.charCodeAt(at)) | 0
  return `${name.slice(0, 200)}-${Math.abs(hash).toString(36)}`
}

/** The person's words in a Claude Code `user` record, or null where it isn't the person writing. */
const claudePrompt = (entry: Record<string, unknown>): string | null => {
  if (entry['type'] !== 'user' || entry['isSidechain'] === true || entry['isMeta'] === true || entry['isCompactSummary'] === true)
    return null
  const origin = record(entry['origin'])
  if (origin !== null && origin['kind'] !== undefined && origin['kind'] !== 'human') return null
  const content = record(entry['message'])?.['content']
  let said: string | null = null
  if (typeof content === 'string') said = content
  else if (Array.isArray(content)) {
    if (content.some((block) => record(block)?.['type'] === 'tool_result')) return null
    said = content.flatMap((block) => (record(block)?.['type'] === 'text' ? (text(record(block)?.['text']) ?? []) : [])).join('\n\n')
  }
  if (said === null || said.trim() === '' || NOT_SAID.test(said)) return null
  const query = /^\s*<user_query>([\s\S]*)<\/user_query>\s*$/.exec(said)
  return (query?.[1] ?? said).trim() || null
}

/** The text of a Claude Code `assistant` record, its thinking and tool calls left out. */
const claudeReply = (entry: Record<string, unknown>): string | null => {
  if (entry['type'] !== 'assistant' || entry['isSidechain'] === true || entry['isMeta'] === true) return null
  const content = record(entry['message'])?.['content']
  if (typeof content === 'string') return text(content)
  if (!Array.isArray(content)) return null
  const said = content.flatMap((block) => (record(block)?.['type'] === 'text' ? (text(record(block)?.['text']) ?? []) : [])).join('\n\n')
  return said === '' ? null : said
}

/** The lines at each end of a file, whole: all of it where it is short. */
const ends = async (file: string): Promise<{ readonly lines: ReadonlyArray<string>; readonly whole: boolean }> => {
  const { size } = await stat(file)
  if (size <= END * 2) return { lines: (await readFile(file, 'utf8')).split('\n'), whole: true }
  const handle = await open(file, 'r')
  try {
    const head = Buffer.alloc(END)
    const tail = Buffer.alloc(END)
    await handle.read(head, 0, END, 0)
    await handle.read(tail, 0, END, size - END)
    // The line cut at each edge is dropped: only whole records are read.
    const first = head.toString('utf8').split('\n').slice(0, -1)
    const last = tail.toString('utf8').split('\n').slice(1)
    return { lines: [...first, ...last], whole: false }
  } finally {
    await handle.close()
  }
}

/** What listing a Claude Code session reads of it: where it ran, when, what it's called, and how often the person wrote. */
export const claudeSession = async (file: string): Promise<Conversation | null> => {
  const { lines, whole } = await ends(file)
  let cwd: string | null = null
  let branch: string | null = null
  let startedAt: string | null = null
  let lastAt: string | null = null
  let custom: string | null = null
  let named: string | null = null
  let first: string | null = null
  let prompts = 0
  for (const line of lines) {
    if (line.trim() === '') continue
    const entry = parse(line)
    if (entry === null) continue
    const type = entry['type']
    if (type === 'continued-in') return null
    if (type === 'custom-title') custom = text(entry['customTitle']) ?? custom
    if (type === 'ai-title') named = text(entry['aiTitle']) ?? named
    if (type === 'summary') named ??= text(entry['summary'])
    if (type !== 'user' && type !== 'assistant') continue
    if (entry['isSidechain'] === true) continue
    cwd ??= text(entry['cwd'])
    branch = text(entry['gitBranch']) ?? branch
    const at = isoOf(entry['timestamp'])
    if (at !== null) {
      startedAt ??= at
      lastAt = at
    }
    const said = claudePrompt(entry)
    if (said !== null) {
      prompts++
      first ??= said
    }
  }
  if (cwd === null || first === null) return null
  return {
    agent: 'claude_code',
    id: basename(file, '.jsonl'),
    file,
    cwd,
    title: custom ?? named ?? titleFrom(first),
    startedAt,
    lastAt,
    prompts: whole ? prompts : null,
    branch: branch === 'HEAD' ? null : branch,
  }
}

/** Claude Code's sessions that ran in any of `folders` or inside one. */
export const claudeSessions = async (places: Places, folders: ReadonlyArray<string>): Promise<ReadonlyArray<Conversation>> => {
  const root = join(places.claude, 'projects')
  const names = await readdir(root).catch(() => [] as Array<string>)
  const wanted = folders.map(claudeFolder)
  // A folder inside one of them has a name that starts as that one's does; which it really is, its records say.
  const candidates = names.filter((name) => wanted.some((one) => name === one || name.startsWith(`${one.slice(0, 200)}-`)))
  const found: Array<Conversation> = []
  for (const name of candidates) {
    const files = await readdir(join(root, name)).catch(() => [] as Array<string>)
    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue
      const session = await claudeSession(join(root, name, file)).catch(() => null)
      if (session !== null && folders.some((folder) => within(real(session.cwd), folder))) found.push(session)
    }
  }
  return found
}

/**
 * Where a rollout is now: Codex compresses one a week old to `.jsonl.zst` beside where it was, and its state database
 * still names the `.jsonl`.
 */
export const rolloutAt = (file: string) =>
  existsSync(file) ? file : !file.endsWith('.zst') && existsSync(`${file}.zst`) ? `${file}.zst` : file

/** Every line of a file, read as it streams: a `.zst` one decompressed on the way. */
const linesOf = (named: string) => {
  const file = rolloutAt(named)
  const raw = createReadStream(file)
  const stream: Readable = file.endsWith('.zst') ? raw.pipe(createZstdDecompress()) : raw
  return createInterface({ input: stream, crlfDelay: Infinity })
}

/** A Claude Code session whole, as the conversation it was: the person's prompts and the agent's replies, in order. */
export const claudeTranscript = async (file: string): Promise<ReadonlyArray<Message>> => {
  const messages: Array<Message & { id?: string }> = []
  for await (const line of linesOf(file)) {
    const entry = parse(line)
    if (entry === null) continue
    const at = isoOf(entry['timestamp'])
    const said = claudePrompt(entry)
    if (said !== null) {
      messages.push({ role: 'person', text: said, at })
      continue
    }
    const reply = claudeReply(entry)
    if (reply === null) continue
    // Claude Code writes each block of a reply as a record of its own, sharing its message's id: one reply.
    const id = text(record(entry['message'])?.['id']) ?? undefined
    const last = messages.at(-1)
    if (last !== undefined && last.role === 'agent' && (id === undefined || last.id === id)) {
      messages[messages.length - 1] = { ...last, text: `${last.text}\n\n${reply}` }
    } else messages.push({ role: 'agent', text: reply, at, ...(id === undefined ? {} : { id }) })
  }
  return messages.map(({ role, text: said, at }) => ({ role, text: said, at }))
}

/** What Codex's sources are where a person had the conversation: not `codex exec`, an MCP server or a sub-agent. */
const spoken = (source: unknown) => typeof source === 'string' && !source.trim().startsWith('{') && !['exec', 'mcp'].includes(source)

/** The names people gave Codex's threads, the latest of each. */
const codexNames = async (places: Places) => {
  const names = new Map<string, string>()
  const body = await readFile(join(places.codex, 'session_index.jsonl'), 'utf8').catch(() => '')
  for (const line of body.split('\n')) {
    const entry = parse(line)
    const id = text(entry?.['id'])
    const name = text(entry?.['thread_name'])
    if (id !== null && name !== null) names.set(id, name)
  }
  return names
}

/** The newest of Codex's state databases, `state_<n>.sqlite`. */
const codexState = async (places: Places) => {
  const files = await readdir(places.codex).catch(() => [] as Array<string>)
  const numbered = files.flatMap((file) => {
    const match = /^state_(\d+)\.sqlite$/.exec(file)
    return match === null ? [] : [{ file, n: Number(match[1]) }]
  })
  const newest = numbered.toSorted((a, b) => b.n - a.n)[0]
  return newest === undefined ? null : join(places.codex, newest.file)
}

/** Codex's first record of a rollout, where it ran and as what: read from its head, decompressed where it is `.zst`. */
const codexMeta = async (file: string) => {
  const lines = linesOf(file)
  try {
    for await (const line of lines) {
      const entry = parse(line)
      return entry?.['type'] === 'session_meta' ? record(entry['payload']) : null
    }
    return null
  } finally {
    lines.close()
  }
}

/** Every rollout file under Codex's `sessions` folder. */
const rollouts = async (folder: string): Promise<ReadonlyArray<string>> => {
  const found: Array<string> = []
  const walk = async (at: string, depth: number) => {
    const entries = await readdir(at, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (entry.isDirectory() && depth < 3) await walk(join(at, entry.name), depth + 1)
      else if (entry.isFile() && /^rollout-.*\.jsonl(\.zst)?$/.test(entry.name)) found.push(join(at, entry.name))
    }
  }
  await walk(folder, 0)
  // A plain file and its compressed copy are one rollout: the plain one is the newer.
  return found.filter((file) => !(file.endsWith('.zst') && found.includes(file.slice(0, -'.zst'.length))))
}

/** Codex's conversations that ran in any of `folders` or inside one: from its state database, else from its rollouts' first records. */
export const codexThreads = async (places: Places, folders: ReadonlyArray<string>): Promise<ReadonlyArray<Conversation>> => {
  const names = await codexNames(places)
  const inside = (cwd: string | null) => cwd !== null && folders.some((folder) => within(real(cwd), folder))
  const state = await codexState(places)
  const listed =
    state === null
      ? null
      : await readCopy(state, (db) => {
          const columns = columnsOf(db, 'threads')
          if (!columns.has('rollout_path') || !columns.has('cwd')) return null
          const pick = (column: string) => (columns.has(column) ? column : `NULL AS ${column}`)
          const rows = db
            .prepare(
              `SELECT id, rollout_path, cwd, ${[
                'created_at',
                'updated_at',
                'source',
                'title',
                'archived',
                'git_branch',
                'first_user_message',
                'name',
                'agent_role',
              ]
                .map(pick)
                .join(', ')} FROM threads`,
            )
            .all()
          return rows.flatMap((row): ReadonlyArray<Conversation> => {
            const id = text(row['id'])
            const cwd = text(row['cwd'])
            const file = text(row['rollout_path'])
            if (id === null || file === null || !inside(cwd) || cwd === null) return []
            if (row['archived'] === 1 || text(row['agent_role']) !== null || !spoken(row['source'] ?? 'cli')) return []
            const first = text(row['first_user_message'])
            const title = names.get(id) ?? text(row['name']) ?? text(row['title']) ?? (first === null ? null : titleFrom(first))
            return [
              {
                agent: 'codex',
                id,
                file,
                cwd,
                title: title ?? 'Codex conversation',
                startedAt: isoOf(row['created_at']),
                lastAt: isoOf(row['updated_at']),
                prompts: null,
                branch: text(row['git_branch']),
              },
            ]
          })
        }).catch(() => null)
  if (listed !== null) return listed
  const found: Array<Conversation> = []
  for (const file of await rollouts(join(places.codex, 'sessions'))) {
    const meta = await codexMeta(file).catch(() => null)
    const cwd = text(meta?.['cwd'])
    const id = text(meta?.['id'])
    if (meta === null || id === null || cwd === null || !inside(cwd) || !spoken(meta['source'] ?? 'cli')) continue
    const at = isoOf(meta['timestamp'])
    found.push({
      agent: 'codex',
      id,
      file,
      cwd,
      title: names.get(id) ?? 'Codex conversation',
      startedAt: at,
      lastAt: await stat(file).then(
        (one) => one.mtime.toISOString(),
        () => at,
      ),
      prompts: null,
      branch: text(record(meta['git'])?.['branch']),
    })
  }
  return found
}

/** What Codex puts in the person's turn for the model, which they never wrote: its context, instructions and notes. */
const INJECTED =
  /^\s*(<environment_context>|<user_instructions>|<INSTRUCTIONS>|# AGENTS\.md instructions|<skill>|<user_shell_command>|<turn_aborted>|<subagent_notification>|<recommended_plugins>|<goal_context>|<external_|<codex_internal_context)/

/** A Codex rollout whole, as the conversation it was: its person's and agent's messages, in order. */
export const codexTranscript = async (file: string): Promise<ReadonlyArray<Message>> => {
  const events: Array<Message> = []
  const items: Array<Message> = []
  for await (const line of linesOf(file)) {
    const entry = parse(line)
    if (entry === null) continue
    const at = isoOf(entry['timestamp'])
    const payload = record(entry['payload'])
    if (payload === null) continue
    if (entry['type'] === 'event_msg') {
      const type = payload['type']
      if (type === 'user_message' && text(payload['message']) !== null)
        events.push({ role: 'person', text: text(payload['message']) ?? '', at })
      else if (type === 'agent_message' && text(payload['message']) !== null)
        events.push({ role: 'agent', text: text(payload['message']) ?? '', at })
      else if (type === 'item_completed') {
        const item = record(payload['item'])
        const content = Array.isArray(item?.['content']) ? item['content'] : []
        const said = content.flatMap((part) => text(record(part)?.['text']) ?? []).join('\n\n')
        if (said === '') continue
        if (item?.['type'] === 'UserMessage') events.push({ role: 'person', text: said, at })
        if (item?.['type'] === 'AgentMessage') events.push({ role: 'agent', text: said, at })
      }
    } else if (entry['type'] === 'response_item' && payload['type'] === 'message') {
      // Only where it has no events: an older rollout, whose messages are what the model saw.
      const role = payload['role']
      const content = Array.isArray(payload['content']) ? payload['content'] : []
      const said = content
        .flatMap((part) => {
          const one = record(part)
          return (one?.['type'] === 'input_text' || one?.['type'] === 'output_text') && text(one['text']) !== null
            ? [text(one['text']) ?? '']
            : []
        })
        .filter((part) => !INJECTED.test(part))
        .join('\n\n')
      if (said === '') continue
      if (role === 'user') items.push({ role: 'person', text: said, at })
      if (role === 'assistant') items.push({ role: 'agent', text: said, at })
    }
  }
  return events.length > 0 ? events : items
}

/** A conversation's transcript, by its agent. */
export const transcriptOf = (conversation: Pick<Conversation, 'agent' | 'file'>) =>
  conversation.agent === 'claude_code' ? claudeTranscript(conversation.file) : codexTranscript(conversation.file)
