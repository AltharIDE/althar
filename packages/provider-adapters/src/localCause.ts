import { lstat, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { Worker } from 'node:worker_threads'

/*
 * Why an agent couldn't start or carry on, where the reason is on this
 * computer rather than at its provider (DEV-285): a file where it reads a
 * folder, a folder it may not open, a read-only disk, its settings that don't
 * parse. Retrying never helps these, and the provider is not to blame: the
 * person, or the coordinator for them, puts the file right.
 *
 * An agent's stream often hides it. Codex's said only "stream disconnected -
 * retrying sampling request" and then "Codex encountered an internal error",
 * while its own log (`~/.codex/logs_2.sqlite`, `codex_core::responses_retry`)
 * said `sampling_error=failed to load workspace requirements: not a directory`
 * on every try: `~/projects/ai-teacher/.codex` was a file. So the words are
 * read from wherever the agent said them (its error, its stderr, its log), and
 * where they name no path, the checkout is looked at for what stands in the way
 * (`strayIn`). The texts are what the agents said (tests/localCause.test.ts).
 */

export type LocalCauseKind = 'not_a_folder' | 'is_a_folder' | 'no_permission' | 'read_only' | 'config'

export interface LocalCause {
  readonly kind: LocalCauseKind
  /** The path it is about, where the agent named it or the checkout shows it. */
  readonly path?: string
  /** The agent's own line that says it. */
  readonly said: string
}

/** Terminal colours, which mean nothing in a line of the window. */
// oxlint-disable-next-line no-control-regex
const escapes = /\u001b\[[0-9;]*[A-Za-z]/g

/** A line about something the agent runs, an MCP server, a hook or a plugin: its own trouble, not the agent's. */
const aside = /\bmcp\b|\bhooks?\b|\bplugins?\b/i

/** A file where a folder is read: Node's ENOTDIR, Rust's `Not a directory (os error 20)`, Codex's `not a directory`. */
const notAFolder = /\bENOTDIR\b|\bnot a directory\b|\(os error 20\)/i
/** A folder where a file is read. */
const isAFolder = /\bEISDIR\b|\bis a directory\b|\(os error 21\)/i
/** A disk mounted read-only. */
const readOnly = /\bEROFS\b|\bread-only file system\b|\(os error 30\)/i
/**
 * A file the agent may not open: Node's EACCES, or EPERM said of a path, and Rust's `(os error 13)`. Never a bare
 * "permission denied", which an agent says of a command its sandbox or the person refused.
 */
const noPermission = /\bEACCES\b|\bEPERM\b[^\n]{0,40}'|\(os error 13\)/i
/**
 * Settings it can't read: Codex's `failed to load workspace requirements` / `Error loading config.toml`, Claude Code's
 * `Invalid settings`, OpenCode's `ConfigJSONError` and `ConfigInvalidError`, and a TOML or JSON file that doesn't parse.
 */
const config =
  /failed to (?:re)?load (?:workspace requirements|configuration|config(?:\.toml)?\b)|error loading config(?:uration|\.toml)?|invalid configuration|toml parse error|config ?json ?error|config ?invalid ?error|invalid settings|settings (?:file )?(?:is )?invalid|toml parse error/i

/**
 * A JSON file that doesn't parse is the agent's settings only where the line names one: a provider's HTML error page
 * read as JSON (`Unexpected token < in JSON at position 0`) is the provider's trouble, and backs off as one.
 */
const settingsParse = /(?:json|jsonc) parse error|unexpected token .{0,40} in json|is not valid json/i
const settingsFile = /\.(?:jsonc?|toml)\b/i

/** Node's `<syscall> '<path>'`, a quoted path, or a bare absolute one. */
const quoted = /['"`]((?:\/|~\/|[A-Za-z]:\\)[^'"`\n]+)['"`]/
const bare = /(?:^|[\s=(])((?:\/|~\/)[^\s:'"`),]+|[A-Za-z]:\\[^\s:'"`),]+)/

const pathIn = (line: string): string | undefined => {
  const found = quoted.exec(line)?.[1] ?? bare.exec(line)?.[1]
  return found === undefined ? undefined : found.replace(/[.,;]+$/, '')
}

const kindOf = (line: string): LocalCauseKind | undefined =>
  notAFolder.test(line)
    ? 'not_a_folder'
    : isAFolder.test(line)
      ? 'is_a_folder'
      : readOnly.test(line)
        ? 'read_only'
        : noPermission.test(line)
          ? 'no_permission'
          : config.test(line) || (settingsParse.test(line) && settingsFile.test(line))
            ? 'config'
            : undefined

/**
 * Codex's log keeps the error after `sampling_error=` or `Turn error: `, after a long trace of spans. Only that part is
 * the agent's own words; the spans name the turn and the thread.
 */
const ownPart = (line: string): string => {
  const sampling = /\bsampling_error=(.+)$/.exec(line)?.[1]
  if (sampling !== undefined) return sampling.trim()
  const turn = /\bTurn error: (.+)$/.exec(line)?.[1]
  if (turn !== undefined) return turn.trim()
  return line
}

/**
 * The local reason in what an agent said, where there is one: the first line that names it, past an MCP server's, a
 * hook's or a plugin's. Undefined where none does, such as a provider's 500 or a dropped connection.
 */
export const localCauseOf = (said: string): LocalCause | undefined => {
  for (const raw of said.replace(escapes, '').split('\n')) {
    const line = ownPart(raw.trim())
    // Said of something it runs, by its words rather than a path it names (`.opencode/plugin`).
    if (line === '' || aside.test(line.replace(/['"`][^'"`\n]*['"`]/g, ''))) continue
    const kind = kindOf(line)
    if (kind === undefined) continue
    const path = pathIn(line)
    return { kind, said: line, ...(path === undefined ? {} : { path }) }
  }
  return undefined
}

/** The folder of its own each agent reads in a project, where it has one: where a stray file stops it. */
export const projectFolders: Readonly<Record<string, ReadonlyArray<string>>> = {
  codex: ['.codex', '.agents'],
  'claude-code': ['.claude'],
  opencode: ['.opencode'],
}

const what = async (path: string): Promise<'file' | 'folder' | 'none'> => {
  try {
    const stat = await lstat(path)
    return stat.isDirectory() ? 'folder' : 'file'
  } catch {
    return 'none'
  }
}

/**
 * The repository's own root for a checkout: a worktree's `.git` file names its gitdir, whose `commondir` is the
 * repository's `.git`; its parent is the checkout every worktree shares. Undefined where it isn't in one.
 */
const rootsOf = async (folder: string): Promise<ReadonlyArray<string>> => {
  const roots: Array<string> = []
  for (let at = resolve(folder); ; at = dirname(at)) {
    const git = join(at, '.git')
    const kind = await what(git)
    if (kind === 'folder') return [...roots, at]
    if (kind === 'file') {
      roots.push(at)
      try {
        const gitdir = /^gitdir:\s*(.+)$/m.exec(await readFile(git, 'utf8'))?.[1]?.trim()
        if (gitdir !== undefined) {
          const own = isAbsolute(gitdir) ? gitdir : resolve(at, gitdir)
          const common = (await readFile(join(own, 'commondir'), 'utf8')).trim()
          roots.push(dirname(isAbsolute(common) ? common : resolve(own, common)))
        }
      } catch {
        // A worktree whose repository moved: its own root is still looked at.
      }
      return roots
    }
    if (dirname(at) === at) return roots
  }
}

/**
 * Where a file stands where an agent reads a folder: its own folder (`.codex` for Codex) in the checkout it starts in,
 * the folders up to the repository's root, or the repository's own checkout every worktree shares. A path the agent
 * named is looked at first, and the first of its folders that is a file is the one in the way. Undefined where nothing
 * is out of place, or it is somewhere Althar can't see.
 */
export const strayIn = async (agentId: string, folder: string, named?: string): Promise<string | undefined> => {
  if (named !== undefined) {
    const full = named.startsWith('~/') ? join(homedir(), named.slice(2)) : named
    if (isAbsolute(full))
      for (let at = full; dirname(at) !== at; at = dirname(at)) {
        // The deepest that exists says it: a file where a folder is read.
        const kind = await what(at)
        if (kind === 'none') continue
        if (kind === 'file' && at !== full) return at
        if (kind === 'file' && at === full) continue
        break
      }
  }
  const names = projectFolders[agentId] ?? []
  if (names.length === 0) return undefined
  const looked = new Set<string>()
  const start = resolve(folder)
  const roots = await rootsOf(start)
  const top = roots.at(0) ?? start
  for (let at = start; ; at = dirname(at)) {
    looked.add(at)
    if (at === top || dirname(at) === at) break
  }
  for (const root of roots) looked.add(root)
  for (const at of looked)
    for (const name of names) {
      const path = join(at, name)
      if ((await what(path)) === 'file') return path
    }
  return undefined
}

/**
 * Where a path stands within the repository a checkout is in, as every worktree of it has it (`.codex`): the same
 * cause on each task of a project, whether it is a tracked file each worktree holds or one at the checkout they share.
 * Undefined where it is outside the checkout and the repository.
 */
export const inRepository = async (folder: string, path: string): Promise<string | undefined> => {
  for (const root of [resolve(folder), ...(await rootsOf(folder))]) {
    const within = relative(root, path)
    if (within !== '' && !within.startsWith('..') && !isAbsolute(within)) return within.split(sep).join('/')
  }
  return undefined
}

/** Whether a cause found in the checkout is still there: the file where a folder is read, still a file. */
export const stillThere = async (cause: LocalCause): Promise<boolean | undefined> => {
  if (cause.path === undefined) return undefined
  const full = cause.path.startsWith('~/') ? join(homedir(), cause.path.slice(2)) : cause.path
  switch (cause.kind) {
    case 'not_a_folder':
      return (await what(full)) === 'file'
    case 'is_a_folder':
      return (await what(full)) === 'folder'
    default:
      return undefined
  }
}

/** Codex's home, where its log is: `CODEX_HOME`, else `~/.codex`. */
export const codexHome = (env: NodeJS.ProcessEnv = process.env): string => env['CODEX_HOME'] ?? join(homedir(), '.codex')

/** How many of a turn's log lines are read: its tries, and the error it ended on. */
const LOG_LINES = 40

/** Codex's targets that say why a turn's request failed: its retries, and the turn's own end. */
export const CODEX_LOG_TARGETS = ['codex_core::responses_retry', 'codex_core::session::turn', 'codex_core::codex'] as const

/*
 * Read in a thread of its own: the log grows to hundreds of megabytes, and `node:sqlite` reads it synchronously, so it
 * never holds the thread that answers the window. Read-only; the query is bounded by the thread and the turn's time.
 */
const READER = `
const { parentPort, workerData } = require('node:worker_threads')
let rows = []
try {
  const { DatabaseSync } = require('node:sqlite')
  const db = new DatabaseSync(workerData.path, { readOnly: true })
  try {
    const targets = workerData.targets.map(() => '?').join(', ')
    rows = db.prepare(
      'SELECT feedback_log_body AS body FROM logs WHERE thread_id = ? AND (ts > ? OR (ts = ? AND ts_nanos >= ?)) ' +
      'AND target IN (' + targets + ") AND level IN ('WARN', 'ERROR', 'INFO') ORDER BY ts DESC, ts_nanos DESC, id DESC LIMIT ?",
    ).all(workerData.thread, workerData.seconds, workerData.seconds, workerData.nanos, ...workerData.targets, workerData.limit)
  } finally {
    db.close()
  }
} catch {}
parentPort.postMessage(rows.map((row) => row.body ?? ''))
`

/**
 * What Codex wrote to its own log of a thread since a turn began, where its stream said less: the retries' and the
 * turn's warnings and errors, newest first, as `sampling_error=…` or `Turn error: …` say them. An earlier turn's, or
 * another target's, is no reason this one failed. Empty where there is no log, or it can't be read; never written to.
 */
export const codexLogSaid = async (home: string, turn: { readonly id: string; readonly since: number }): Promise<string> => {
  const path = join(home, 'logs_2.sqlite')
  if ((await what(path)) !== 'file') return ''
  const bodies = await new Promise<ReadonlyArray<string>>((done) => {
    const worker = new Worker(READER, {
      eval: true,
      workerData: {
        path,
        thread: turn.id,
        // Codex keeps a line's time as whole seconds and the nanoseconds past them.
        seconds: Math.floor(turn.since / 1000),
        nanos: (turn.since % 1000) * 1_000_000,
        targets: [...CODEX_LOG_TARGETS],
        limit: LOG_LINES,
      },
    })
    worker.once('message', (said: ReadonlyArray<string>) => done(said))
    worker.once('error', () => done([]))
    worker.once('exit', () => done([]))
  })
  return bodies
    .map((body) => body.split('\n').map(ownPart).join(' ').trim())
    .filter((line) => line !== '')
    .join('\n')
}
