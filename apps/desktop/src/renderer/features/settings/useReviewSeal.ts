import { useQuery } from '@tanstack/react-query'
import { useCallback, useRef, useState } from 'react'

import type { AppSettings, SealStyle } from '@althar/contracts'

import { keys, reads } from '../../data/reads'
import { useServices } from '../../data/services'

/*
 * Whether a pull request Althar opens says how its change was reviewed, and
 * how its seal looks, as Settings shows and changes them. A change shows at
 * once; if the runtime can't keep it, and it is still the latest, the view
 * reads again what the runtime kept, and says so.
 */

export interface ReviewSealModel {
  readonly on: boolean
  readonly style: SealStyle
  /** The last change couldn't be kept. */
  readonly failed: boolean
  readonly set: (on: boolean) => void
  readonly choose: (style: SealStyle) => void
}

/** Null until the settings are read. */
export const useReviewSeal = (): ReviewSealModel | null => {
  const { client, cache } = useServices()
  const settings = useQuery(reads(client).settings()).data
  const [failed, setFailed] = useState(false)
  // Changes in the order they were made: only the latest failing reads again.
  const made = useRef(0)

  const change = useCallback(
    (next: Partial<AppSettings['reviewSeal']>, keep: () => Promise<void>) => {
      const at = ++made.current
      cache.setQueryData<AppSettings>(keys.settings, (was) =>
        was === undefined ? was : { ...was, reviewSeal: { ...was.reviewSeal, ...next } },
      )
      setFailed(false)
      keep().then(
        () => undefined,
        () => {
          if (at !== made.current) return
          // Not the opposite of what was asked: what the runtime kept, as it says.
          void cache.refetchQueries({ queryKey: keys.settings })
          setFailed(true)
        },
      )
    },
    [cache],
  )
  const set = useCallback((on: boolean) => change({ on }, () => client.setReviewSeal(on)), [change, client])
  const choose = useCallback((style: SealStyle) => change({ style }, () => client.setReviewSealStyle(style)), [change, client])

  return settings === undefined ? null : { ...settings.reviewSeal, failed, set, choose }
}
