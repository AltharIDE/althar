import { useQuery } from '@tanstack/react-query'
import { useCallback, useRef, useState } from 'react'

import type { AgentsAtOnce, AppSettings, Places } from '@althar/contracts'

import { keys, reads } from '../../data/reads'
import { useServices } from '../../data/services'
import { placesAfter } from '../../shared/usePlaces'

/*
 * How many agents work at once on this machine, as Settings shows and
 * changes it (ADR-032): the person's number, or the default the runtime
 * worked out from this machine's memory and cores, with why. A change shows
 * at once and takes effect in the runtime without a restart; if it can't be
 * kept, and it is still the latest, the view reads again what the runtime
 * kept, and says so. The load popover's agents move with it, and back with
 * it: as they were before, fewer for now and why included, then read again.
 */

export interface AgentsAtOnceModel {
  readonly atOnce: AgentsAtOnce
  /** The last change couldn't be kept. */
  readonly failed: boolean
  /** A number of the person's own; null goes back to the default. */
  readonly set: (count: number | null) => void
}

/** Null until the settings are read. */
export const useAgentsAtOnce = (): AgentsAtOnceModel | null => {
  const { client, cache } = useServices()
  const settings = useQuery(reads(client).settings()).data
  const [failed, setFailed] = useState(false)
  // Changes in the order they were made: only the latest failing reads again.
  const made = useRef(0)

  const set = useCallback(
    (count: number | null) => {
      const at = ++made.current
      cache.setQueryData<AppSettings>(keys.settings, (was) =>
        was === undefined
          ? was
          : { ...was, agentsAtOnce: { ...was.agentsAtOnce, own: count, count: count ?? was.agentsAtOnce.machine.count } },
      )
      // The load popover's number moves with it.
      const before = cache.getQueryData<Places>(keys.places)
      const number = cache.getQueryData<AppSettings>(keys.settings)?.agentsAtOnce.count
      if (number !== undefined) cache.setQueryData<Places>(keys.places, (was) => (was === undefined ? was : placesAfter(was, number)))
      setFailed(false)
      client.setAgentsAtOnce(count).then(
        () => undefined,
        () => {
          if (at !== made.current) return
          void cache.refetchQueries({ queryKey: keys.settings })
          if (before !== undefined) cache.setQueryData<Places>(keys.places, before)
          void cache.refetchQueries({ queryKey: keys.places })
          setFailed(true)
        },
      )
    },
    [cache, client],
  )

  return settings === undefined ? null : { atOnce: settings.agentsAtOnce, failed, set }
}
