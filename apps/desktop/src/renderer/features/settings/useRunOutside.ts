import { useQuery } from '@tanstack/react-query'
import { useCallback, useRef, useState } from 'react'

import type { AppSettings } from '@althar/contracts'

import { keys, reads } from '../../data/reads'
import { useServices } from '../../data/services'

/*
 * What "Run it" on a pull request from outside the team does without asking
 * (a task is a conversation plus parts, "Running someone else's pull
 * request"): ask each time, its default, run safely, or trust it fully. It
 * only answers the question: the code runs once the person says Run it. A
 * change shows at once; one the runtime can't keep reads again what it kept.
 */

export type RunOutside = 'ask' | 'safe' | 'full'

export interface RunOutsideModel {
  readonly to: RunOutside
  readonly failed: boolean
  readonly set: (to: RunOutside) => void
}

/** Null until the settings are read. */
export const useRunOutside = (): RunOutsideModel | null => {
  const { client, cache } = useServices()
  const settings = useQuery(reads(client).settings()).data
  const [failed, setFailed] = useState(false)
  const made = useRef(0)

  const set = useCallback(
    (to: RunOutside) => {
      const at = ++made.current
      cache.setQueryData<AppSettings>(keys.settings, (was) => (was === undefined ? was : { ...was, runOutside: to }))
      setFailed(false)
      client.setRunOutside(to).then(
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

  return settings === undefined ? null : { to: settings.runOutside ?? 'ask', failed, set }
}
