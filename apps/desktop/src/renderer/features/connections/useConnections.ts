import { useQuery } from '@tanstack/react-query'
import { useCallback, useState } from 'react'

import type { ConnectionList } from '@althar/contracts'

import { messageOf } from '../../data/client'
import { useGoneAtOnce } from '../../data/goneAtOnce'
import { keys, reads } from '../../data/reads'
import { useServices } from '../../data/services'

/*
 * The connections view model (docs/architecture/06): the code hosts and
 * trackers on this Mac, and disconnecting one, gone from the list at once
 * until a read without it lands, and back, saying why, where it stays.
 * Connecting is a walk of its own (`useConnect`), which the list opens.
 */

export interface ConnectionsModel {
  readonly list: ConnectionList | null
  readonly error: string | null
  readonly disconnect: (connectionId: string) => Promise<void>
}

export const useConnections = (): ConnectionsModel => {
  const { client, cache } = useServices()
  // Read again when a connection changes, as the window hears it.
  const listRead = useQuery(reads(client).connections())
  const [failed, setError] = useState<string | null>(null)
  const error = failed ?? (listRead.error === null ? null : messageOf(listRead.error))
  const gone = useGoneAtOnce(listRead.data?.connections, (one) => one.id)
  const { hide, back } = gone

  const disconnect = useCallback(
    async (connectionId: string) => {
      setError(null)
      hide([connectionId])
      try {
        await client.disconnect(connectionId)
        await cache.refetchQueries({ queryKey: keys.connections })
      } catch (failure) {
        back(connectionId)
        setError(messageOf(failure))
      }
    },
    [client, cache, hide, back],
  )

  const list = listRead.data ?? null
  return {
    list: list === null || gone.shown === list.connections ? list : { ...list, connections: gone.shown ?? [] },
    error,
    disconnect,
  }
}
