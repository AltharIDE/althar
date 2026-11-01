import type { QueryClient } from '@tanstack/react-query'
import { useCallback, useMemo, useSyncExternalStore } from 'react'

import type { RepositorySetup } from '@althar/contracts'

import { messageOf } from '../../data/client'
import { keys } from '../../data/reads'
import { useServices } from '../../data/services'

/*
 * Each repository's setup as the person changes it in Running (ADR-079):
 * shown at once, kept by the runtime, and the repositories read again
 * either way, so one that didn't hold goes back as it was, and says why.
 *
 * Each change sends the whole setup, so a repository's changes go one after
 * another, never side by side: an older one landing late would undo a newer.
 * Until the last of them is kept and read back, the newest is what shows,
 * whatever a read in between says. The window keeps them, beside its cache,
 * rather than the section: leaving Running and coming back neither starts a
 * second line beside the first nor loses what is still on its way. And the
 * newest shows the moment it is made, so the next change, to the other
 * lines, is built on it.
 */

export interface SetupsModel {
  /** The setup to show for a repository: the person's newest change while it is on its way, else the one kept. */
  readonly shown: (repositoryId: string, kept: RepositorySetup | null) => RepositorySetup | null
  readonly change: (repositoryId: string, setup: RepositorySetup) => void
  /** Why the last change didn't hold. */
  readonly failed: string | null
}

interface Held {
  /** Each repository's newest change, while it is on its way. */
  readonly pending: ReadonlyMap<string, RepositorySetup>
  readonly failed: string | null
}

interface Store {
  held: Held
  /** Each repository's last change on its way, and how many it has had, so only the last reads back. */
  readonly queues: Map<string, { readonly tail: Promise<void>; readonly turn: number }>
  readonly listeners: Set<() => void>
}

const stores = new WeakMap<QueryClient, Map<string, Store>>()

const storeOf = (cache: QueryClient, projectId: string): Store => {
  const projects = stores.get(cache) ?? new Map<string, Store>()
  stores.set(cache, projects)
  const store = projects.get(projectId) ?? { held: { pending: new Map(), failed: null }, queues: new Map(), listeners: new Set() }
  projects.set(projectId, store)
  return store
}

const hold = (store: Store, change: (held: Held) => Held) => {
  store.held = change(store.held)
  for (const listener of store.listeners) listener()
}

export const useSetups = (projectId: string): SetupsModel => {
  const { client, cache } = useServices()
  const store = useMemo(() => storeOf(cache, projectId), [cache, projectId])
  const subscribe = useCallback(
    (listener: () => void) => {
      store.listeners.add(listener)
      return () => store.listeners.delete(listener)
    },
    [store],
  )
  const { pending, failed } = useSyncExternalStore(subscribe, () => store.held)
  const change = useCallback(
    (repositoryId: string, setup: RepositorySetup) => {
      hold(store, (held) => ({ pending: new Map(held.pending).set(repositoryId, setup), failed: null }))
      const before = store.queues.get(repositoryId)
      const turn = (before?.turn ?? 0) + 1
      const last = () => store.queues.get(repositoryId)?.turn === turn
      const tail = (before?.tail ?? Promise.resolve())
        .then(() => client.setRepository({ projectId, repositoryId, setup }))
        .catch((failure: unknown) => hold(store, (held) => ({ ...held, failed: messageOf(failure) })))
      store.queues.set(repositoryId, { tail, turn })
      void tail.then(async () => {
        if (!last()) return
        await cache.refetchQueries({ queryKey: keys.repositories(projectId) })
        if (!last()) return
        store.queues.delete(repositoryId)
        hold(store, (held) => {
          const next = new Map(held.pending)
          next.delete(repositoryId)
          return { ...held, pending: next }
        })
      })
    },
    [cache, client, projectId, store],
  )
  const shown = useCallback((repositoryId: string, kept: RepositorySetup | null) => pending.get(repositoryId) ?? kept, [pending])
  return { shown, change, failed }
}
