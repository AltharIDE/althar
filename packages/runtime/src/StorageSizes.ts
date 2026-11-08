import { realpath } from 'node:fs/promises'
import { resolve } from 'node:path'

import { PLACES, type PlaceId, type StorageSize } from '@althar/contracts'

import { fold, measure } from './DiskUsage'

/*
 * What Althar's places take on disk, for About › Storage (DEV-147), measured
 * here so the headless host and the command line can show it too (ADR-048).
 */

/** The first look at a place may take this long; what it has counted by then is said to be approximate. */
export const MEASURE_TIMEOUT = 30_000
/** What a Measure again may take: the person asked for a real number, so it is given longer. */
export const REFRESH_TIMEOUT = 180_000

const inside = (outer: string, path: string, platform: string = process.platform) => {
  const from = fold(resolve(outer), platform)
  const to = fold(resolve(path), platform)
  return to !== from && to.startsWith(from.endsWith('/') || from.endsWith('\\') ? from : `${from}${from.includes('\\') ? '\\' : '/'}`)
}

/** Where a path really is, so a place reached through a link still matches the one it holds. */
const real = (path: string) => realpath(path).catch(() => resolve(path))

interface Walk {
  readonly size: Promise<StorageSize>
  /** Who is waiting on it; when the last gives up, the walk stops. */
  waiting: number
  readonly stop: AbortController
}

/**
 * Sizes kept for the session, by place; a refresh measures again, and longer.
 * Asking while a measure is under way joins it, and it stops once everyone
 * who asked has given up (About closed). A place that wasn't there, or
 * couldn't be measured, or whose walk was stopped, isn't kept: the first
 * task's folder appears after About was opened, and the next look should find
 * it. Where the logs or the task folders sit inside the profile (a Flatpak
 * keeps its worktrees there), the profile's size leaves them out: they have
 * their own rows.
 */
export const storageSizes = (places: Readonly<Record<PlaceId, string>>, measureIt: typeof measure = measure) => {
  const kept = new Map<PlaceId, Walk>()
  const start = (place: PlaceId, refresh: boolean): Walk => {
    const stop = new AbortController()
    const size = (async (): Promise<StorageSize> => {
      const here = await real(places[place])
      const others = await Promise.all(PLACES.filter((other) => other !== place).map((other) => real(places[other])))
      const exclude = others.filter((other) => inside(here, other))
      return measureIt(here, { exclude, timeout: refresh ? REFRESH_TIMEOUT : MEASURE_TIMEOUT, signal: stop.signal })
    })()
    const walk: Walk = { size, waiting: 0, stop }
    const forget = () => {
      if (kept.get(place) === walk) kept.delete(place)
    }
    void size.then((found) => (found.state !== 'done' || stop.signal.aborted ? forget() : undefined), forget)
    return walk
  }
  return {
    /**
     * Its size. `signal` is the asker giving up: the walk goes on for others
     * waiting on it, else stops, and the asker's promise rejects.
     */
    size: (place: PlaceId, refresh = false, signal?: AbortSignal): Promise<StorageSize> => {
      let walk = kept.get(place)
      if (walk === undefined || refresh) {
        // A refresh replaces the walk under way: the ones still waiting on it keep it until they are done.
        walk = start(place, refresh)
        kept.set(place, walk)
      }
      const joined = walk
      joined.waiting++
      return new Promise<StorageSize>((resolveSize, reject) => {
        const leave = () => {
          if (--joined.waiting === 0 && signal?.aborted === true) joined.stop.abort()
        }
        const abandon = () => {
          signal?.removeEventListener('abort', abandon)
          leave()
          reject(new Error('Stopped measuring.'))
        }
        if (signal?.aborted === true) return abandon()
        signal?.addEventListener('abort', abandon, { once: true })
        joined.size.then(
          (found) => {
            signal?.removeEventListener('abort', abandon)
            joined.waiting--
            resolveSize(found)
          },
          (error) => {
            signal?.removeEventListener('abort', abandon)
            joined.waiting--
            reject(error)
          },
        )
      })
    },
  }
}
