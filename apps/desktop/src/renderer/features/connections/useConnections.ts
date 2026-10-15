import { useQuery } from '@tanstack/react-query'
import { useCallback, useState } from 'react'

import type { ConnectionList } from '@althar/contracts'

import { messageOf } from '../../data/client'
import { keys, reads } from '../../data/reads'
import { useServices } from '../../data/services'

/*
 * The connections view model (docs/architecture/06): the code hosts and
 * trackers on this Mac, and disconnecting one. Connecting is a walk of its
 * own (`useConnect`), which the list opens.
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

  const disconnect = useCallback(
    async (connectionId: string) => {
      setError(null)
      try {
        await client.disconnect(connectionId)
        await cache.refetchQueries({ queryKey: keys.connections })
      } catch (failure) {
        setError(messageOf(failure))
      }
    },
    [client, cache],
  )

  return { list: listRead.data ?? null, error, disconnect }
}
