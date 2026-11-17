import { useQuery } from '@tanstack/react-query'
import { useCallback, useRef, useState } from 'react'

import type { AppSettings, ShipRoute } from '@althar/contracts'

import { keys, reads } from '../../data/reads'
import { useServices } from '../../data/services'

/*
 * The route the person's Ships take unless they choose another for one, as Ship's Make this my default sets it: absent until
 * they make one theirs. A change shows at once; one the runtime can't keep reads again what it kept.
 */

export interface ShipRouteModel {
  /** Their default, null where they haven't made one: each task's own then. */
  readonly route: ShipRoute | null
  readonly failed: boolean
  readonly set: (route: ShipRoute | null) => void
}

/** Null until the settings are read. */
export const useShipRoute = (): ShipRouteModel | null => {
  const { client, cache } = useServices()
  const settings = useQuery(reads(client).settings()).data
  const [failed, setFailed] = useState(false)
  const made = useRef(0)

  const set = useCallback(
    (route: ShipRoute | null) => {
      const at = ++made.current
      cache.setQueryData<AppSettings>(keys.settings, (was) => {
        if (was === undefined) return was
        const { shipRoute: _was, ...rest } = was
        return route === null ? rest : { ...rest, shipRoute: route }
      })
      setFailed(false)
      client.setShipRoute(route).then(
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

  return settings === undefined ? null : { route: settings.shipRoute ?? null, failed, set }
}
