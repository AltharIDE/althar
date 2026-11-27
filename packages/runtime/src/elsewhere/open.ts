import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { Duration, Effect, Option } from 'effect'

import { startApart } from '../spawner'
import type { Agent } from './conversations'
import type { Places } from './places'

/*
 * Whether another process has a conversation brought in from Claude Code or
 * Codex open now (DEV-264; docs/decisions/workspaces-and-runs.md, "Bringing
 * in other tools' work"). A conversation brought in carries on in Althar
 * from where it stood; one still open in a terminal, or in another app,
 * carries on there too, and the two split, each missing the other's turns.
 * So a send to it waits while one is, saying which tool has it.
 *
 * Neither tool promises how it marks a session open, so each sign is named
 * by what it reads and the versions it was read from, as the conversation
 * readers are: a newer version that marks it some other way gets a sign of
 * its own beside these. Each is only read: nothing of the tool's is taken,
 * written or stopped, not even its lock for a moment.
 *
 * - Claude Code, `claude-sessions` (2.1.309): `sessions/<pid>.json` in its
 *   home, `{ pid, sessionId, … }`, for each process with a session open,
 *   whatever opened it (`--resume`, `--continue`, `/resume`, an app on its
 *   SDK). A process that crashed leaves its record, and its pid may be
 *   another's since, so a record counts only while that pid is a process
 *   whose command is Claude Code's.
 * - Codex, `codex-writer-lock` (0.167.0): `thread-writer-locks/<thread>.lock`
 *   in its home, an empty file each process that writes a thread holds an
 *   exclusive lock on while it has it open, left behind once it lets go. Who
 *   holds it is read from the kernel's own list on Linux (`/proc/locks`, by
 *   the file's inode) and with `lsof` on macOS. Windows can't say without
 *   taking the lock, so it isn't read there.
 * - Either, `arguments` (any version): a process of the tool's whose
 *   arguments name the id, as `claude --resume <id>` and `codex resume <id>`
 *   do. Listed with `ps` on macOS and Linux, and with PowerShell on Windows,
 *   whose processes' command lines it reads where Git for Windows' `ps`
 *   can't.
 *
 * Processes are listed through the runner (spawner.ts), off the thread that
 * answers the window, and their command lines, which can hold tokens, are
 * read here and never kept or logged. Where nothing can be read, as where
 * the listing fails, nothing is open: Althar can't tell, and the send goes.
 */

export interface Process {
  readonly pid: number
  /** Its command line, whole. */
  readonly args: string
}

/** The longest a listing is waited for: past it, nothing is known, and the send goes. */
const LISTING = Duration.seconds(5)

/** Processes from `pid args…` lines, as `ps -A -o pid=,args=` and the PowerShell below print them. */
export const processesOf = (listing: string): ReadonlyArray<Process> =>
  listing.split(/\r?\n/).flatMap((line) => {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line)
    return match === null ? [] : [{ pid: Number(match[1]), args: match[2] ?? '' }]
  })

/** A command line's words, a quoted one whole and unquoted, as both a shell and Windows split them closely enough here. */
const wordsOf = (args: string) => [...args.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((one) => one[1] ?? one[2] ?? one[3] ?? '')

/** A program's name from its path, either separator, without the extension Windows or a script gives it. */
const nameOf = (word: string) => (word.split(/[\\/]/).pop() ?? '').toLowerCase().replace(/\.(exe|cmd|bat|ps1|js|mjs|cjs)$/, '')

/**
 * Whose process this is, by what it runs: its program or, for one run by Node or another runtime, its script. Claude
 * Code's native build and its SDK's are `claude`, its npm one `@anthropic-ai/claude-code/cli.js`; Codex's are `codex`,
 * its npm launcher `@openai/codex/bin/codex.js`.
 */
export const toolOf = (args: string): Agent | null => {
  const [program = '', script = ''] = wordsOf(args)
  const runs = RUNTIMES.has(nameOf(program)) ? script : program
  const name = nameOf(runs)
  const path = runs.replaceAll('\\', '/').toLowerCase()
  if (name === 'claude' || path.includes('/@anthropic-ai/claude-code/')) return 'claude_code'
  if (name === 'codex' || path.includes('/@openai/codex/')) return 'codex'
  return null
}

/** What runs a tool's script, whose own name says nothing of whose it is. */
const RUNTIMES = new Set(['node', 'nodejs', 'bun', 'deno'])

/** Whether a process of `agent`'s names `id` in its arguments: as a word of its own, or after `=` (`--resume=<id>`). */
export const namesIn = (process: Process, agent: Agent, id: string) =>
  toolOf(process.args) === agent && wordsOf(process.args).some((word) => word === id || word.endsWith(`=${id}`))

/** What a command printed, run through the runner: null where it couldn't run or didn't end within `LISTING`, when it is stopped. */
const printed = (command: string, args: ReadonlyArray<string>, max: number) =>
  Effect.suspend(() => {
    const started = startApart({ command, args, env: process.env, detached: false, max, first: true })
    return Effect.promise(() => started.result).pipe(
      Effect.timeoutOption(LISTING),
      Effect.onInterrupt(() => Effect.sync(started.stop)),
      Effect.map((ended) => {
        if (Option.isNone(ended)) started.stop()
        return Option.isNone(ended) || ended.value.error !== null || ended.value.over ? null : ended.value
      }),
    )
  })

/** Every process here with its command line, through the runner; null where they can't be listed. */
export const listProcesses = (platform: NodeJS.Platform = process.platform): Effect.Effect<ReadonlyArray<Process> | null> =>
  (platform === 'win32'
    ? printed(
        'powershell',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          "Get-CimInstance Win32_Process | ForEach-Object { '{0} {1}' -f $_.ProcessId, $_.CommandLine }",
        ],
        64 * 1024 * 1024,
      )
    : printed('ps', ['-A', '-ww', '-o', 'pid=,args='], 64 * 1024 * 1024)
  ).pipe(Effect.map((ended) => (ended === null || ended.code !== 0 ? null : processesOf(ended.stdout))))

/** The sessions Claude Code's records say processes have open, by session: each with the pids that say so. */
const claudeRecords = (claude: string) =>
  Effect.promise(async () => {
    const folder = join(claude, 'sessions')
    const names = await readdir(folder).catch(() => [] as Array<string>)
    const open = new Map<string, Array<number>>()
    await Promise.all(
      names
        .filter((name) => /^\d+\.json$/.test(name))
        .map(async (name) => {
          const record = await readFile(join(folder, name), 'utf8')
            .then((text) => JSON.parse(text) as unknown)
            .catch(() => null)
          if (typeof record !== 'object' || record === null) return
          const { pid, sessionId } = record as { readonly pid?: unknown; readonly sessionId?: unknown }
          if (typeof pid !== 'number' || typeof sessionId !== 'string') return
          open.set(sessionId, [...(open.get(sessionId) ?? []), pid])
        }),
    )
    return open
  })

/**
 * The inodes something holds a lock on, from `/proc/locks`' lines (`1: FLOCK  ADVISORY  WRITE 2977689 00:24:68426857 0 EOF`),
 * by inode alone: the device it names is the file system's, which on btrfs isn't the one `stat` gives. One waiting for a
 * lock (`1: -> FLOCK …`) doesn't hold it.
 */
export const lockedInodes = (locks: string): ReadonlySet<number> =>
  new Set(
    locks.split('\n').flatMap((line) => {
      const match = /\s[0-9a-f]+:[0-9a-f]+:(\d+)\s/.exec(line)
      return match === null || line.includes('->') ? [] : [Number(match[1])]
    }),
  )

/** Whether a process holds Codex's writer lock for `id`: false where there is no lock file, or where the platform can't say. */
const codexLockHeld = (codex: string, id: string, platform: NodeJS.Platform) =>
  Effect.gen(function* () {
    const file = join(codex, 'thread-writer-locks', `${id}.lock`)
    const found = yield* Effect.promise(() => stat(file).catch(() => null))
    if (found === null) return false
    if (platform === 'linux') {
      const locks = yield* Effect.promise(() => readFile('/proc/locks', 'utf8').catch(() => ''))
      return lockedInodes(locks).has(found.ino)
    }
    if (platform !== 'darwin') return false
    // `lsof` exits 1 where nothing has it open: a pid printed is one that has.
    const ended = yield* printed('lsof', ['-t', '--', file], 64 * 1024)
    return ended !== null && /^\d+$/m.test(ended.stdout)
  })

export interface Conversation {
  readonly agent: Agent
  /** The agent's own id for it: Claude Code's session, Codex's thread. */
  readonly id: string
}

/**
 * The tool that has one of `conversations` open in another process now, the first found; null where none does, or where
 * that can't be told.
 */
export const openElsewhere = (
  conversations: ReadonlyArray<Conversation>,
  places: Pick<Places, 'claude' | 'codex'>,
  options: {
    readonly platform?: NodeJS.Platform
    readonly processes?: Effect.Effect<ReadonlyArray<Process> | null>
  } = {},
): Effect.Effect<Agent | null> =>
  Effect.gen(function* () {
    if (conversations.length === 0) return null
    const platform = options.platform ?? process.platform
    const [processes, records] = yield* Effect.all(
      [
        options.processes ?? listProcesses(platform),
        conversations.some((one) => one.agent === 'claude_code')
          ? claudeRecords(places.claude)
          : Effect.succeed(new Map<string, Array<number>>()),
      ],
      { concurrency: 'unbounded' },
    )
    const byPid = new Map((processes ?? []).map((one) => [one.pid, one]))
    for (const { agent, id } of conversations) {
      if (processes?.some((one) => namesIn(one, agent, id)) === true) return agent
      if (agent === 'claude_code' && (records.get(id) ?? []).some((pid) => toolOf(byPid.get(pid)?.args ?? '') === 'claude_code'))
        return agent
      if (agent === 'codex' && (yield* codexLockHeld(places.codex, id, platform))) return agent
    }
    return null
  })

/** What the composer says while a send waits for `agent` to let its conversation go. */
export const openWords = (agent: Agent) =>
  `${agent === 'codex' ? 'Codex' : 'Claude Code'} still has this conversation open in another window. Close it there and send again.`
