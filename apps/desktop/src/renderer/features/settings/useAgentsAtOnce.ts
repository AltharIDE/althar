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
 * it to what the runtime last confirmed: as they were before the first change
 * still on its way, fewer for now and why included, at the number of a later
 * one that was kept; then read again.
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
  // While changes are on their way: how many, the popover's agents before the first, and the latest kept of them.
  const going = useRef<{ count: number; before: Places | undefined; kept: { at: number; number: number } | undefined }>({
    count: 0,
    before: undefined,
    kept: undefined,
  })

  const set = useCallback(
    (count: number | null) => {
      const at = ++made.current
      cache.setQueryData<AppSettings>(keys.settings, (was) =>
        was === undefined
          ? was
          : { ...was, agentsAtOnce: { ...was.agentsAtOnce, own: count, count: count ?? was.agentsAtOnce.machine.count } },
      )
      // The load popover's number moves with it.
      if (going.current.count === 0) going.current = { count: 0, before: cache.getQueryData<Places>(keys.places), kept: undefined }
      going.current.count += 1
      const number = cache.getQueryData<AppSettings>(keys.settings)?.agentsAtOnce.count
      if (number !== undefined) cache.setQueryData<Places>(keys.places, (was) => (was === undefined ? was : placesAfter(was, number)))
      setFailed(false)
      client.setAgentsAtOnce(count).then(
        () => {
          const now = going.current
          now.count -= 1
          if (number !== undefined && (now.kept === undefined || at > now.kept.at)) now.kept = { at, number }
        },
        () => {
          const { before, kept } = going.current
          going.current.count -= 1
          if (at !== made.current) return
          void cache.refetchQueries({ queryKey: keys.settings })
          if (before !== undefined) cache.setQueryData<Places>(keys.places, kept === undefined ? before : placesAfter(before, kept.number))
          void cache.refetchQueries({ queryKey: keys.places })
          setFailed(true)
        },
      )
    },
    [cache, client],
  )

  return settings === undefined ? null : { atOnce: settings.agentsAtOnce, failed, set }
}
