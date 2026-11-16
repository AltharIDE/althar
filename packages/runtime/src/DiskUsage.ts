import type { BigIntStats } from 'node:fs'
import { lstat, readdir, realpath, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

/*
 * What folders take on disk (DEV-147), for About › Storage and for what removing
 * finished tasks' folders frees (`ownedBytes`, FolderCleanup.ts): one walk, so
 * the two never count a folder by different rules. It is asynchronous and keeps
 * to a time: when that is up, what it has counted so far is the answer, said
 * to be approximate. It never follows a symlink (a link counts as itself, not
 * as what it points to, so a worktree's links can't send it out of the folder
 * or round in a circle), counts a file with several hard links once, and
 * leaves out the folders it is told are another row's, so nothing is counted
 * twice. What it can't read is skipped, and counted. The place itself may be
 * a link (a folder moved to another disk, with a link left in its place): that
 * one is followed, and what is under it is not. All the walks share a few reads
 * in flight, so three of them at once don't hold up the
 * runtime's other file reads (logs, preferences, pictures).
 */

export interface Measured {
  /** Bytes the files take on disk (their blocks where the system says, else their length). */
  readonly bytes: number
  /** The time was up before the walk was: `bytes` is what it had counted. */
  readonly approximate: boolean
  /** Entries it couldn't read, and so left out. */
  readonly unreadable: number
}

export type Size = ({ readonly state: 'done' } & Measured) | { readonly state: 'missing' } | { readonly state: 'failed' }

export interface MeasureOptions {
  /** Milliseconds the walk may take; the default is 30 seconds. */
  readonly timeout?: number
  /** Folders to leave out, as paths (another row's folder inside this one). */
  readonly exclude?: ReadonlyArray<string>
  /** Stops the walk, as at the limit: what it has counted is the answer, which the one who stopped it no longer wants. */
  readonly signal?: AbortSignal
  /**
   * Counts only what the folders own: a file with other links, by device and
   * inode, counts when the last of its links is seen, so only if every link
   * is among the folders walked with this map (what removing them would
   * free). Without it, a file with several links counts once.
   */
  readonly owned?: Map<string, number>
  /** Reads the clock; tests give their own. */
  readonly now?: () => number
  /** Directories read at once. */
  readonly parallel?: number
  /** The system's name, for how paths compare; tests give their own. */
  readonly platform?: string
  /** Lists a directory; tests give one that never answers. */
  readonly list?: (folder: string) => Promise<Array<{ name: string }>>
}

export const MEASURE_TIMEOUT = 30_000
/** What a Measure again may take: the person asked for a real number, so it is given longer. */
export const REFRESH_TIMEOUT = 180_000
const PARALLEL = 8
/** Entries read at once in a directory; the clock is looked at between batches. */
const BATCH = 64

/** Reads in flight across every walk: the thread pool is shared with the rest of the main process. */
export const IN_FLIGHT = 4
let flying = 0
const queue: Array<() => void> = []
const io = async <T>(read: () => Promise<T>): Promise<T> => {
  if (flying >= IN_FLIGHT) await new Promise<void>((go) => queue.push(go))
  else flying++
  try {
    return await read()
  } finally {
    // Hands the slot straight on to the next in line, or frees it.
    const next = queue.shift()
    if (next === undefined) flying--
    else next()
  }
}

const gone = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT' || (error as NodeJS.ErrnoException).code === 'ENOTDIR'

// Inodes are read as bigints: on Windows and some network disks they pass 2^53, where two files would look like one.
type Stats = BigIntStats

export const onDisk = (stats: Stats) => (stats.blocks > 0n ? Number(stats.blocks) * 512 : stats.isFile() ? Number(stats.size) : 0)

/** Paths compare without case where the system does (Windows). */
export const fold = (path: string, platform: string = process.platform) => (platform === 'win32' ? path.toLowerCase() : path)

export const measure = async (root: string, options: MeasureOptions = {}): Promise<Size> => {
  const {
    timeout = MEASURE_TIMEOUT,
    // The walk runs in Node's file system calls, outside any effect, with a limit only a timer can keep.
    // oxlint-disable-next-line althar/one-clock
    now = Date.now,
    parallel = PARALLEL,
    platform = process.platform,
    signal,
    owned,
    list = async (folder) => (await readdir(folder)).map((name) => ({ name })),
  } = options
  const excluded = new Set((options.exclude ?? []).map((path) => fold(resolve(path), platform)))
  excluded.delete(fold(resolve(root), platform))
  const until = now() + timeout
  const late = () => now() >= until || signal?.aborted === true

  let top: Stats
  try {
    // stat, not lstat: where the place is itself a link, it is what it points to that is measured.
    top = await stat(root, { bigint: true })
  } catch (error) {
    return gone(error) ? { state: 'missing' } : { state: 'failed' }
  }

  let bytes = 0
  let unreadable = 0
  // The place's own listing couldn't be read: there is no size to give, not a small one.
  let unlisted = false
  let approximate = false
  // Files with more than one link, by device and inode: each counts once.
  const linked = new Set<string>()
  const count = (stats: Stats) => {
    if (stats.nlink > 1n && !stats.isDirectory()) {
      const key = `${stats.dev}:${stats.ino}`
      if (owned === undefined) {
        if (linked.has(key)) return
        linked.add(key)
      } else {
        const seen = (owned.get(key) ?? 0) + 1
        owned.set(key, seen)
        if (BigInt(seen) !== stats.nlink) return
      }
    }
    bytes += onDisk(stats)
  }

  count(top)
  if (top.isDirectory()) {
    const waiting: string[] = [root]
    let busy = 0
    // Set once time is up: what is still reading stops counting, and the answer is what was counted by then.
    let over = false
    await new Promise<void>((finish) => {
      let finished = false
      const done = () => {
        if (finished) return
        finished = true
        clearTimeout(timer)
        signal?.removeEventListener('abort', stop)
        finish()
      }
      // A single slow directory can't hold the answer past the limit: the clock is read between small batches, and this ends the wait even inside one read.
      const stop = () => {
        over = true
        approximate = true
        done()
      }
      // Beyond what a timer can hold, there is no limit.
      // oxlint-disable-next-line althar/one-clock
      const timer = timeout < 2 ** 31 ? setTimeout(stop, timeout) : undefined
      if (signal?.aborted === true) stop()
      else signal?.addEventListener('abort', stop, { once: true })
      const pump = () => {
        while (!over && busy < parallel && waiting.length > 0) {
          if (late()) {
            approximate = true
            waiting.length = 0
            break
          }
          const folder = waiting.pop() as string
          busy++
          void look(folder).finally(() => {
            busy--
            pump()
          })
        }
        if (busy === 0 && waiting.length === 0) done()
      }
      const look = async (folder: string) => {
        let names
        try {
          names = await io(() => (over ? Promise.resolve([]) : list(folder)))
        } catch (error) {
          // Gone since its parent was read: not a part left out.
          if (gone(error)) return
          if (folder === root) unlisted = true
          unreadable++
          return
        }
        for (let from = 0; from < names.length; from += BATCH) {
          if (over || late()) {
            approximate = true
            return
          }
          await Promise.all(
            names.slice(from, from + BATCH).map(async (entry) => {
              const path = join(folder, entry.name)
              if (excluded.has(fold(path, platform))) return
              let stats: Stats
              try {
                // lstat: a symlink is itself, never what it points to.
                stats = await io(() => lstat(path, { bigint: true }))
              } catch (error) {
                if (!gone(error)) unreadable++
                return
              }
              if (over) return
              count(stats)
              if (stats.isDirectory()) waiting.push(path)
            }),
          )
        }
      }
      pump()
    })
  }
  if (unlisted) return { state: 'failed' }
  return { state: 'done', bytes, approximate, unreadable }
}
