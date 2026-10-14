import { useQuery } from '@tanstack/react-query'
import { useCallback, useRef, useState } from 'react'

import type { AppSettings } from '@althar/contracts'

import { keys, reads } from '../../data/reads'
import { useServices } from '../../data/services'

/*
 * Whether a review of the person's team's pull request posts itself as soon
 * as its lead drafts it, as Settings shows and changes it: off unless they
 * turn it on, and never for a pull request from outside the team. A change
 * shows at once; if the runtime can't keep it, and it is still the latest,
 * the view reads again what the runtime kept, and says so.
 */

export interface PostTeamReviewsModel {
  readonly on: boolean
  /** The last change couldn't be kept. */
  readonly failed: boolean
  readonly set: (on: boolean) => void
}

/** Null until the settings are read. */
export const usePostTeamReviews = (): PostTeamReviewsModel | null => {
  const { client, cache } = useServices()
  const settings = useQuery(reads(client).settings()).data
  const [failed, setFailed] = useState(false)
  // Changes in the order they were made: only the latest failing reads again.
  const made = useRef(0)

  const set = useCallback(
    (on: boolean) => {
      const at = ++made.current
      cache.setQueryData<AppSettings>(keys.settings, (was) => (was === undefined ? was : { ...was, postTeamReviews: on }))
      setFailed(false)
      client.setPostTeamReviews(on).then(
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

  return settings === undefined ? null : { on: settings.postTeamReviews, failed, set }
}
