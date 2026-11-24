import { lstat, readdir, readFile, readlink, rmdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'

import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { commonDirOf } from './worktreeLinks'

/*
 * What an agent's sandbox leaves in the person's repositories (DEV-286). On
 * Linux, bubblewrap denies a write to a path that isn't there by mounting
 * over it, and a mount needs something to mount on: Claude Code's sandbox
 * makes an empty read-only file (0444) where a path it protects is missing,
 * such as `.git/config.lock` in the checkout every task worktree shares, and
 * Codex's makes empty folders for `.agents`, `.aws` and `.codex` at a
 * worktree's root. Each takes its own away when it ends cleanly, and leaves
 * them when it is killed, or ends while a command still runs: a
 * `config.lock` left in `.git` stops the person's own `git config` ("could
 * not lock config file"), and a file where a tool expects a folder stops
 * that tool.
 *
 * Neither lets Althar deny those paths another way, short of giving the
 * protection up (Claude Code's `allowGitConfig`), so Althar clears up after
 * them. Before an agent's process starts it records which of these paths
 * are missing; once the process has gone, and at the next start after a
 * crash, it takes away what has since appeared there in a placeholder's
 * shape: an empty read-only file, or an empty folder. Nothing else: a path
 * that was there before it started is never recorded, so the person's own
 * `.codex`, whatever it holds, stays; one that holds something now is
 * theirs; and one still mounted over by any running sandbox, another
 * session's or one of the person's own, is left until that ends.
 */

/** At a worktree's root: Claude Code's protected files and folders, and Codex's protected folders. */
export const ROOT_PLACEHOLDERS: ReadonlyArray<string> = [
  // Claude Code's dangerous files.
  '.gitconfig',
  '.gitmodules',
  '.bashrc',
  '.bash_profile',
  '.zshrc',
  '.zprofile',
  '.profile',
  '.ripgreprc',
  '.mcp.json',
  // Claude Code's dangerous folders, which it makes as files where they are missing.
  '.vscode',
  '.idea',
  '.claude',
  '.husky',
  '.cargo',
  '.devcontainer',
  '.yarn',
  '.mvn',
  // Codex's protected folders in a writable root.
  '.agents',
  '.aws',
  '.codex',
]

/** In the git directory the worktrees share: what Claude Code protects there that git may not have made. */
export const GIT_PLACEHOLDERS: ReadonlyArray<string> = [
  'config.lock',
  'config.worktree',
  'config.worktree.lock',
  'commondir',
  'branches',
  'remotes',
]

/** Where a sandbox in `folder` may leave a placeholder: at its root, and in its repository's shared git directory. */
export const placesIn = (folder: string): ReadonlyArray<string> => {
  const common = commonDirOf(folder)
  return [
    ...ROOT_PLACEHOLDERS.map((name) => join(folder, name)),
    ...(common === null ? [] : GIT_PLACEHOLDERS.map((name) => join(common, name))),
  ]
}

const missing = (path: string) =>
  lstat(path).then(
    () => false,
    (error: NodeJS.ErrnoException) => error.code === 'ENOENT',
  )

/** Of the places a sandbox in these folders may leave a placeholder, those missing now. Only on Linux, where bubblewrap makes them. */
export const missingPlaces = async (folders: ReadonlyArray<string>, platform = process.platform): Promise<ReadonlyArray<string>> => {
  if (platform !== 'linux') return []
  const places = [...new Set(folders.flatMap(placesIn))]
  const absent = await Promise.all(places.map(missing))
  return places.filter((_, index) => absent[index])
}

/** A mount point as mountinfo writes it, with its octal escapes (`\040` for a space) read back. */
const unescape = (field: string) => field.replace(/\\([0-7]{3})/g, (_, octal: string) => String.fromCharCode(parseInt(octal, 8)))

/**
 * Every path something is mounted on, in every mount namespace this user's
 * processes are in: a running sandbox's mounts are seen in its own namespace
 * only, at the same paths it protects. One mountinfo read per namespace.
 */
export const mountPoints = async (proc = '/proc'): Promise<ReadonlySet<string>> => {
  const points = new Set<string>()
  const pids = await readdir(proc).catch(() => [] as Array<string>)
  const seen = new Set<string>()
  for (const pid of pids) {
    if (!/^\d+$/.test(pid)) continue
    const space = await readlink(join(proc, pid, 'ns', 'mnt')).catch(() => undefined)
    if (space === undefined || seen.has(space)) continue
    seen.add(space)
    const table = await readFile(join(proc, pid, 'mountinfo'), 'utf8').catch(() => '')
    for (const line of table.split('\n')) {
      const point = line.split(' ')[4]
      if (point !== undefined && point !== '') points.add(unescape(point))
    }
  }
  return points
}

/** What became of a recorded place: gone already, taken away, left as the person's, or left while a sandbox is mounted on it. */
export type Settled = 'gone' | 'removed' | 'theirs' | 'mounted'

/** Takes a placeholder away where it is one: an empty read-only file, or an empty folder, that nothing is mounted on. */
export const settle = async (path: string, mounted: ReadonlySet<string>): Promise<Settled> => {
  const found = await lstat(path).catch(() => undefined)
  if (found === undefined) return 'gone'
  if (mounted.has(path)) return 'mounted'
  try {
    if (found.isFile() && found.size === 0 && (found.mode & 0o222) === 0) {
      await unlink(path)
      return 'removed'
    }
    if (found.isDirectory() && (await readdir(path)).length === 0) {
      // Fails, and so stays, where something was written into it in between.
      // oxlint-disable-next-line althar/one-removal -- Only an empty folder may go: one that isn't is the person's, and stays.
      await rmdir(path)
      return 'removed'
    }
  } catch {
    return 'theirs'
  }
  return 'theirs'
}

/** Records, before an agent's process starts, where its sandbox may leave a placeholder that isn't there now. */
export const recordPlaces = (processId: string, folders: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const places = yield* Effect.promise(() => missingPlaces(folders))
    for (const path of places) yield* sql`INSERT OR IGNORE INTO sandbox_places ${sql.insert({ path, processId })}`
  })

/**
 * Takes away the placeholders sandboxes left: at the places recorded for
 * processes that have ended, but for those a running one also recorded.
 * A place is forgotten once settled; one still mounted on is tried again
 * when the next process ends, or Althar starts. What it took away, by path.
 */
export const sweepPlaces = (look: { readonly mounted?: () => Promise<ReadonlySet<string>> } = {}) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{ path: string; live: number }>`
      SELECT sandbox_places.path, processes.state IN ('launching', 'running') AS live
      FROM sandbox_places JOIN processes ON processes.id = sandbox_places.process_id`
    const held = new Set(rows.filter((row) => row.live === 1).map((row) => row.path))
    const due = [...new Set(rows.filter((row) => row.live !== 1 && !held.has(row.path)).map((row) => row.path))]
    if (due.length === 0) return []
    const mounted = yield* Effect.promise(
      look.mounted ?? (() => (process.platform === 'linux' ? mountPoints() : Promise.resolve(new Set<string>()))),
    )
    const removed: Array<string> = []
    for (const path of due) {
      const settled = yield* Effect.promise(() => settle(path, mounted))
      if (settled === 'mounted') continue
      if (settled === 'removed') removed.push(path)
      yield* sql`DELETE FROM sandbox_places WHERE path = ${path}`
    }
    if (removed.length > 0) yield* Effect.logInfo('Took away what sandboxes left').pipe(Effect.annotateLogs({ removed }))
    return removed
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.as(Effect.logWarning('Could not take away what sandboxes left', cause), [] as ReadonlyArray<string>),
    ),
  )
