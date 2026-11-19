import { useCallback, useEffect, useRef, useState } from 'react'

import { type StorageFigure } from '@althar/ui'

import { type StoragePlace, useServices } from '../../data/services'

/*
 * Where Althar keeps its data, and how big each place is (About › Storage).
 * The paths come at once; each size comes as the main process finishes
 * measuring it (it keeps them for the session), and Measure again asks for
 * all anew. A measure that fails is a size that couldn't be measured, not an
 * error on the page. The last figures are kept, so coming back to About shows
 * them at once; a Show that fails says why at its row.
 */

export const PLACES: ReadonlyArray<StoragePlace> = ['profile', 'logs', 'worktrees']

export interface StorageModel {
  /** Each place's path, once main says. */
  readonly paths: Partial<Record<StoragePlace, string>>
  readonly figures: Record<StoragePlace, StorageFigure>
  /** Why a place couldn't be opened, by place. */
  readonly problems: Partial<Record<StoragePlace, string>>
  readonly measureAgain: () => void
  readonly show: (place: StoragePlace) => void
}

const measuringAll = (): Record<StoragePlace, StorageFigure> => ({
  profile: { state: 'measuring' },
  logs: { state: 'measuring' },
  worktrees: { state: 'measuring' },
})

// The figures last seen, by host, so About doesn't flash "measuring…" for what it showed a moment ago.
const remembered = new WeakMap<object, Record<StoragePlace, StorageFigure>>()

// Places whose last figure no longer holds, as the task folders after some were removed: About measures them anew,
// as it opens, or at once where it is open (a cleanup can finish after About read the old size).
const changed = new Set<StoragePlace>()
const open = new Set<(place: StoragePlace) => void>()

/** A place's size changed, as after its folders were removed: About shows it measuring, not the old figure. */
export const sizeChanged = (place: StoragePlace) => {
  changed.add(place)
  for (const heard of open) heard(place)
}

export const useStorage = (): StorageModel => {
  const { client, host } = useServices()
  const [paths, setPaths] = useState<Partial<Record<StoragePlace, string>>>({})
  const [figures, setFigures] = useState(() => {
    // Only a size is worth showing again: a place that wasn't there may be by now.
    const last = remembered.get(host)
    const fresh = measuringAll()
    return last === undefined
      ? fresh
      : {
          ...fresh,
          ...Object.fromEntries(
            Object.entries(last).filter(([place, figure]) => figure.state === 'done' && !changed.has(place as StoragePlace)),
          ),
        }
  })
  const [problems, setProblems] = useState<Partial<Record<StoragePlace, string>>>({})
  const keep = useCallback(
    (place: StoragePlace, figure: StorageFigure) =>
      setFigures((now) => {
        const next = { ...now, [place]: figure }
        remembered.set(host, next)
        return next
      }),
    [host],
  )
  // Each place's round of measuring, so an answer to an earlier one doesn't overwrite a newer.
  const rounds = useRef<Record<StoragePlace, number>>({ profile: 0, logs: 0, worktrees: 0 })

  // Each place's walk in hand: giving up on it (About closed, or measuring again) stops it in the runtime.
  const giveUp = useRef<Partial<Record<StoragePlace, AbortController>>>({})
  const forget = useCallback((places: ReadonlyArray<StoragePlace> = PLACES) => {
    for (const place of places) {
      rounds.current[place]++
      giveUp.current[place]?.abort()
      delete giveUp.current[place]
    }
  }, [])

  const measure = useCallback(
    (refresh: boolean, places: ReadonlyArray<StoragePlace> = PLACES) => {
      forget(places)
      for (const place of places) {
        const mine = rounds.current[place]
        const stop = new AbortController()
        giveUp.current[place] = stop
        client.getStorageSize(place, refresh, stop.signal).then(
          (size) => mine === rounds.current[place] && keep(place, size),
          () => mine === rounds.current[place] && keep(place, { state: 'failed' }),
        )
      }
    },
    [client, forget, keep],
  )

  useEffect(() => {
    let live = true
    host.storage.places().then(
      (found) => live && setPaths(found),
      () => {},
    )
    changed.clear()
    measure(false)
    // A size that changes while About is open: the old figure gives way, and the place is measured anew.
    const heard = (place: StoragePlace) => {
      changed.delete(place)
      keep(place, { state: 'measuring' })
      measure(false, [place])
    }
    open.add(heard)
    return () => {
      live = false
      open.delete(heard)
      forget()
    }
  }, [host, measure, forget, keep])

  return {
    paths,
    figures,
    problems,
    measureAgain: () => {
      // Asked for anew, the old figures give way; asked as About opens, they stay until main answers (usually from its cache, at once).
      setFigures(measuringAll())
      measure(true)
    },
    show: (place) => {
      setProblems(({ [place]: _gone, ...rest }) => rest)
      host.storage.show(place).catch((error: unknown) =>
        setProblems((now) => ({
          ...now,
          [place]: (error instanceof Error ? error.message : String(error)).replace(
            /^Error invoking remote method '[^']*': (Error: )?/,
            '',
          ),
        })),
      )
    },
  }
}
