import { useQuery } from '@tanstack/react-query'
import { useCallback, useRef, useState } from 'react'

import type { AppSettings, PlansAndReviews, PlansAndReviewsChange } from '@althar/contracts'

import { keys, reads } from '../../data/reads'
import { useServices } from '../../data/services'

/*
 * How long work goes on alone, as Settings shows and changes it: the plan's
 * countdown, the rounds of review, when a quiet turn restarts and when agents
 * check in. A change shows at once and holds from the next plan, round or
 * look at a running turn; if it can't be kept, and it is still the latest,
 * the view reads again what the runtime kept, and says so.
 */

export interface PlansAndReviewsModel {
  readonly value: PlansAndReviews
  /** The last change couldn't be kept. */
  readonly failed: boolean
  readonly set: (change: PlansAndReviewsChange) => void
}

/** Null until the settings are read. */
export const usePlansAndReviews = (): PlansAndReviewsModel | null => {
  const { client, cache } = useServices()
  const settings = useQuery(reads(client).settings()).data
  const [failed, setFailed] = useState(false)
  // Changes in the order they were made: only the latest failing reads again.
  const made = useRef(0)

  const set = useCallback(
    (change: PlansAndReviewsChange) => {
      const at = ++made.current
      cache.setQueryData<AppSettings>(keys.settings, (was) =>
        was === undefined ? was : { ...was, plansAndReviews: { ...was.plansAndReviews, ...definedOf(change) } },
      )
      setFailed(false)
      client.setPlansAndReviews(change).then(
        () => undefined,
        () => {
          if (at !== made.current) return
          void cache.refetchQueries({ queryKey: keys.settings })
          setFailed(true)
        },
      )
    },
    [cache, client],
  )

  return settings === undefined ? null : { value: settings.plansAndReviews, failed, set }
}

/** A change without what it leaves as it is. */
const definedOf = <T extends object>(change: T) =>
  Object.fromEntries(Object.entries(change).filter(([, value]) => value !== undefined)) as T
