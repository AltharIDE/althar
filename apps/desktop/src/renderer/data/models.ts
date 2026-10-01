import { useCallback, useEffect, useSyncExternalStore } from 'react'

import type { AgentModels } from '@charrette/contracts'

import type { Client } from './client'
import { useServices } from './services'

/*
 * The models each agent offers, read once for the window and shared by
 * every picker in it: read again when a picker appears, shortly after while
 * an agent is still being asked, and when the person sets a default effort.
 */

/** How soon an agent still being asked is read again. */
const AGAIN = 2000

interface Store {
  known: ReadonlyArray<AgentModels> | null
  reading: boolean
  /* asked for while a read was on its way: read again after it */
  again: boolean
  readonly listeners: Set<() => void>
}

const stores = new WeakMap<Client, Store>()

const storeOf = (client: Client): Store => {
  const found = stores.get(client)
  if (found !== undefined) return found
  const made: Store = { known: null, reading: false, again: false, listeners: new Set() }
  stores.set(client, made)
  return made
}

/** Reads the models, unless a read is on its way; `again` reads once more after it, for something that changed since it began. */
const read = (client: Client, store: Store, again = false) => {
  if (store.reading) {
    store.again ||= again
    return
  }
  store.reading = true
  const done = () => {
    store.reading = false
    if (!store.again) return false
    store.again = false
    read(client, store)
    return true
  }
  client.getModels().then(
    (known) => {
      store.known = known
      store.listeners.forEach((listener) => listener())
      if (!done() && known.some((agent) => agent.probing) && store.listeners.size > 0) setTimeout(() => read(client, store), AGAIN)
    },
    // A picker without them offers each agent's own default.
    () => void done(),
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

/** Sets the person's default effort for one of an agent's models, then reads the models again, so every picker shows it. */
export const useSetDefaultEffort = () => {
  const { client } = useServices()
  return useCallback(
    (input: { readonly agentId: string; readonly model: string; readonly effort: string }) =>
      client.setDefaultEffort(input).then(
        () => read(client, storeOf(client), true),
        // Not set: every picker still shows the one there was.
        () => undefined,
      ),
    [client],
  )
}
