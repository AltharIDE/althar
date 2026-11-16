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

export const useStorage = (): StorageModel => {
  const { client, host } = useServices()
  const [paths, setPaths] = useState<Partial<Record<StoragePlace, string>>>({})
  const [figures, setFigures] = useState(() => {
    // Only a size is worth showing again: a place that wasn't there may be by now.
    const last = remembered.get(host)
    const fresh = measuringAll()
    return last === undefined
      ? fresh
      : { ...fresh, ...Object.fromEntries(Object.entries(last).filter(([, figure]) => figure.state === 'done')) }
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
  // Each round of measuring, so an answer to an earlier one doesn't overwrite a newer.
  const round = useRef(0)

  // The walks of the round in hand: giving up on them (About closed, or measuring again) stops them in the runtime.
  const giveUp = useRef<AbortController | null>(null)
  const forget = useCallback(() => {
    round.current++
    giveUp.current?.abort()
    giveUp.current = null
  }, [])

  const measure = useCallback(
    (refresh: boolean) => {
      forget()
      const mine = round.current
      const stop = new AbortController()
      giveUp.current = stop
      // Asked for anew, the old figures give way; asked as About opens, they stay until main answers (usually from its cache, at once).
      if (refresh) setFigures(measuringAll())
      for (const place of PLACES) {
        client.getStorageSize(place, refresh, stop.signal).then(
          (size) => mine === round.current && keep(place, size),
          () => mine === round.current && keep(place, { state: 'failed' }),
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
    measure(false)
    return () => {
      live = false
      forget()
    }
  }, [host, measure, forget])

  return {
    paths,
    figures,
    problems,
    measureAgain: () => measure(true),
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
