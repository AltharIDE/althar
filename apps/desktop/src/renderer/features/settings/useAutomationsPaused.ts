import { useQuery } from '@tanstack/react-query'
import { useCallback, useRef, useState } from 'react'

import type { AppSettings } from '@althar/contracts'

import { keys, reads } from '../../data/reads'
import { useServices } from '../../data/services'

/*
 * Whether every automation is paused, as Settings shows and changes it: none
 * starts until the person turns it off; runs under way finish. A change
 * shows at once, here and on every project's Automations; if the runtime
 * can't keep it, and it is still the latest, what it kept is read again, and
 * the view says so.
 */

export interface AutomationsPausedModel {
  readonly on: boolean
  /** The last change couldn't be kept. */
  readonly failed: boolean
  readonly set: (on: boolean) => void
}

/** Null until the settings are read. */
export const useAutomationsPaused = (): AutomationsPausedModel | null => {
  const { client, cache } = useServices()
  const settings = useQuery(reads(client).settings()).data
  const [failed, setFailed] = useState(false)
  // Changes in the order they were made: only the latest failing reads again.
  const made = useRef(0)

  const set = useCallback(
    (on: boolean) => {
      const at = ++made.current
      cache.setQueryData<AppSettings>(keys.settings, (was) => (was === undefined ? was : { ...was, automationsPaused: on }))
      setFailed(false)
      client.setAutomationsPaused(on).then(
        // Every project's automations say whether they are all paused.
        () => void cache.invalidateQueries({ queryKey: ['automations'] }),
        () => {
          if (at !== made.current) return
          void cache.refetchQueries({ queryKey: keys.settings })
          setFailed(true)
        },
      )
    },
    [cache, client],
  )

  return settings === undefined ? null : { on: settings.automationsPaused, failed, set }
}
