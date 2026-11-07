import { useCallback, useEffect, useRef, useState } from 'react'

import { type StorageFigure } from '@althar/ui'

import { type StoragePlace, useServices } from '../../data/services'

/*
 * Where Althar keeps its data, and how big each place is (About › Storage).
 * The paths come at once; each size comes as the main process finishes
 * measuring it (it keeps them for the session), and Measure again asks for
 * all anew. A measure that fails is a size that couldn't be measured, not an
 * error on the page.
 */

export const PLACES: ReadonlyArray<StoragePlace> = ['profile', 'logs', 'worktrees']

export interface StorageModel {
  /** Each place's path, once main says. */
  readonly paths: Partial<Record<StoragePlace, string>>
  readonly figures: Record<StoragePlace, StorageFigure>
  readonly measureAgain: () => void
  readonly show: (place: StoragePlace) => void
}

const measuringAll = (): Record<StoragePlace, StorageFigure> => ({
  profile: { state: 'measuring' },
  logs: { state: 'measuring' },
  worktrees: { state: 'measuring' },
})

export const useStorage = (): StorageModel => {
  const { host } = useServices()
  const [paths, setPaths] = useState<Partial<Record<StoragePlace, string>>>({})
  const [figures, setFigures] = useState(measuringAll)
  // Each round of measuring, so an answer to an earlier one doesn't overwrite a newer.
  const round = useRef(0)

  const forget = useCallback(() => {
    round.current++
  }, [])

  const measure = useCallback(
    (refresh: boolean) => {
      const mine = ++round.current
      setFigures(measuringAll())
      for (const place of PLACES) {
        host.storage.size(place, refresh).then(
          (size) => mine === round.current && setFigures((now) => ({ ...now, [place]: size })),
          () => mine === round.current && setFigures((now) => ({ ...now, [place]: { state: 'failed' } })),
        )
      }
    },
    [host],
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
    measureAgain: () => measure(true),
    show: (place) => void host.storage.show(place).catch(() => {}),
  }
}
