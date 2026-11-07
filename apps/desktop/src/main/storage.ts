import type { Stats } from 'node:fs'
import { lstat, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'

/*
 * What Althar's folders take on disk (DEV-147), for About › Storage. The walk
 * is asynchronous, so the main process stays free for the window, and it keeps
 * to a time: when that is up, what it has counted so far is the answer, said
 * to be approximate. It never follows a symlink (a link counts as itself, not
 * as what it points to, so a worktree's links can't send it out of the folder
 * or round in a circle), counts a file with several hard links once, and
 * leaves out the folders it is told are another row's, so nothing is counted
 * twice. What it can't read is skipped, and counted.
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
  /** Reads the clock; tests give their own. */
  readonly now?: () => number
  /** Directories read at once. */
  readonly parallel?: number
}

export const MEASURE_TIMEOUT = 30_000
const PARALLEL = 8
/** Entries read at once in a directory; the clock is looked at between batches. */
const BATCH = 64

const onDisk = (stats: Stats) => (stats.blocks > 0 ? stats.blocks * 512 : stats.size)

export const measure = async (root: string, options: MeasureOptions = {}): Promise<Size> => {
  const { timeout = MEASURE_TIMEOUT, now = Date.now, parallel = PARALLEL } = options
  const excluded = new Set((options.exclude ?? []).map((path) => resolve(path)))
  excluded.delete(resolve(root))
  const until = now() + timeout
  const late = () => now() >= until

  let top: Stats
  try {
    top = await lstat(root)
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' || (error as NodeJS.ErrnoException).code === 'ENOTDIR'
      ? { state: 'missing' }
      : { state: 'failed' }
  }

  let bytes = 0
  let unreadable = 0
  let approximate = false
  // Files with more than one link, by device and inode: each counts once.
  const linked = new Set<string>()
  const count = (stats: Stats) => {
    if (stats.nlink > 1 && !stats.isDirectory()) {
      const key = `${stats.dev}:${stats.ino}`
      if (linked.has(key)) return
      linked.add(key)
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
        finish()
      }
      // A single slow directory can't hold the answer past the limit: the clock is read between small batches, and this ends the wait even inside one read.
      const timer = setTimeout(() => {
        over = true
        approximate = true
        done()
      }, timeout)
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
          names = await readdir(folder, { withFileTypes: true })
        } catch {
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
              if (excluded.has(path)) return
              let stats: Stats
              try {
                // lstat: a symlink is itself, never what it points to.
                stats = await lstat(path)
              } catch {
                unreadable++
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
  return { state: 'done', bytes, approximate, unreadable }
}

/** Opens a place in the system's file manager; fails with what the system said where it couldn't. */
export const showPlace = async (places: Readonly<Record<PlaceId, string>>, place: PlaceId, openPath: (path: string) => Promise<string>) => {
  const failed = await openPath(places[place])
  if (failed !== '') throw new Error(failed)
}

/** A place Althar keeps things, by the id the window asks for it with. */
export type PlaceId = 'profile' | 'logs' | 'worktrees'
export const PLACES: ReadonlyArray<PlaceId> = ['profile', 'logs', 'worktrees']
export const isPlace = (value: unknown): value is PlaceId => PLACES.some((place) => place === value)

const inside = (outer: string, path: string) => {
  const from = resolve(outer)
  const to = resolve(path)
  return to !== from && to.startsWith(from.endsWith('/') || from.endsWith('\\') ? from : `${from}${from.includes('\\') ? '\\' : '/'}`)
}

/**
 * Sizes kept for the session, by place; a refresh measures again. Asking while
 * a measure is under way joins it. Where the logs or the task folders sit
 * inside the profile (a Flatpak keeps its worktrees there), the profile's size
 * leaves them out: they have their own rows.
 */
export const storageSizes = (places: () => Readonly<Record<PlaceId, string>>, measureIt: typeof measure = measure) => {
  const kept = new Map<PlaceId, Promise<Size>>()
  return {
    places,
    size: (place: PlaceId, refresh = false): Promise<Size> => {
      const found = kept.get(place)
      if (found !== undefined && !refresh) return found
      const where = places()
      const exclude = PLACES.filter((other) => other !== place && inside(where[place], where[other])).map((other) => where[other])
      const next = measureIt(where[place], { exclude })
      kept.set(place, next)
      return next
    },
  }
}
