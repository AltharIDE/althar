import { useCallback, useEffect, useSyncExternalStore } from 'react'

import type { AgentModels } from '@charrette/contracts'

import type { Client } from './client'
import { useServices } from './services'

/*
 * The models each agent offers, read once for the window and shared by
 * every picker in it: read again when a picker appears, and shortly after
 * while an agent is still being asked.
 */

/** How soon an agent still being asked is read again. */
const AGAIN = 2000

interface Store {
  known: ReadonlyArray<AgentModels> | null
  reading: boolean
  readonly listeners: Set<() => void>
}

const stores = new WeakMap<Client, Store>()

const storeOf = (client: Client): Store => {
  const found = stores.get(client)
  if (found !== undefined) return found
  const made: Store = { known: null, reading: false, listeners: new Set() }
  stores.set(client, made)
  return made
}

const read = (client: Client, store: Store) => {
  if (store.reading) return
  store.reading = true
  client.getModels().then(
    (known) => {
      store.reading = false
      store.known = known
      store.listeners.forEach((listener) => listener())
      if (known.some((agent) => agent.probing) && store.listeners.size > 0) setTimeout(() => read(client, store), AGAIN)
    },
    // A picker without them offers each agent's own default.
    () => {
      store.reading = false
    },
  )
}

/** Every agent's models, as far as they are known; null until first read. */
export const useModels = (): ReadonlyArray<AgentModels> | null => {
  const { client } = useServices()
  const store = storeOf(client)
  const subscribe = useCallback(
    (listener: () => void) => {
      store.listeners.add(listener)
      return () => void store.listeners.delete(listener)
    },
    [store],
  )
  const known = useSyncExternalStore(subscribe, () => store.known)
  useEffect(() => read(client, store), [client, store])
  return known
}
