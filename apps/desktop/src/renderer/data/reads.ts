import { QueryClient, queryOptions } from '@tanstack/react-query'

import type { CoordinatorSnapshot, ThreadSnapshot } from '@althar/contracts'

import { mergeItems } from '../shared/items'
import type { Client } from './client'

/*
 * What the window reads from the runtime, each by a key, kept in one cache
 * for the window's life (TanStack Query). A screen shows what the cache holds
 * at once; the window's watch (`feed.ts`) says when a read is out of date,
 * and only then is it read again. Reads are never out of date by age: the
 * runtime's change feed is the only thing that ends them.
 */

export const keys = {
  projects: ['projects'] as const,
  /** The agents on this Mac, as the runtime last checked them. */
  status: ['status'] as const,
  home: ['home'] as const,
  board: (projectId: string) => ['board', projectId] as const,
  coordinator: (projectId: string) => ['coordinator', projectId] as const,
  thread: (threadId: string) => ['thread', threadId] as const,
  rules: (projectId: string) => ['rules', projectId] as const,
  connections: ['connections'] as const,
}

/** The window's cache: nothing goes stale by itself, and a failed read isn't tried again on its own. */
export const makeQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { staleTime: Infinity, retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false },
    },
  })

/**
 * A thread read again keeps the earlier pages already read, as long as the
 * new page meets them; one that doesn't (many items came since) starts over
 * from the new page.
 */
export const continued = <S extends ThreadSnapshot | CoordinatorSnapshot>(was: S | undefined, fresh: S): S => {
  const first = fresh.items[0]
  const last = was?.items.at(-1)
  if (was === undefined || first === undefined || last === undefined || first.sequence > last.sequence + 1) return fresh
  return { ...fresh, items: mergeItems(was.items, fresh.items), earlier: was.earlier }
}

/*
 * Where the home reads what the loop did from, for each window: while the
 * home is open, from where its first read started, so nothing goes while the
 * person looks; once they leave, from whenever they last left.
 */
const homeFrom = new WeakMap<Client, { since?: string }>()
export const homeSince = (client: Client) => {
  const found = homeFrom.get(client)
  if (found !== undefined) return found
  const made = {}
  homeFrom.set(client, made)
  return made as { since?: string }
}

export const reads = (client: Client) => ({
  projects: () => queryOptions({ queryKey: keys.projects, queryFn: () => client.listProjects() }),
  status: () => queryOptions({ queryKey: keys.status, queryFn: () => client.status() }),
  home: () =>
    queryOptions({
      queryKey: keys.home,
      queryFn: () => client.getHome(homeSince(client).since),
    }),
  board: (projectId: string) => queryOptions({ queryKey: keys.board(projectId), queryFn: () => client.getBoard(projectId) }),
  coordinator: (projectId: string) =>
    queryOptions({
      queryKey: keys.coordinator(projectId),
      queryFn: async ({ client: cache }) =>
        continued(cache.getQueryData<CoordinatorSnapshot>(keys.coordinator(projectId)), await client.getCoordinator(projectId)),
      gcTime: 10 * 60_000,
    }),
  thread: (threadId: string) =>
    queryOptions({
      queryKey: keys.thread(threadId),
      queryFn: async ({ client: cache }) =>
        continued(cache.getQueryData<ThreadSnapshot>(keys.thread(threadId)), await client.getThread(threadId)),
      gcTime: 10 * 60_000,
    }),
  rules: (projectId: string) => queryOptions({ queryKey: keys.rules(projectId), queryFn: () => client.getProjectRules(projectId) }),
  connections: () => queryOptions({ queryKey: keys.connections, queryFn: () => client.listConnections() }),
})

export type Reads = ReturnType<typeof reads>

/** Asks every agent again rather than trust the runtime's last answer, and keeps what they say. */
export const recheckStatus = (client: Client, cache: QueryClient) =>
  client.status({ recheck: true }).then((status) => {
    cache.setQueryData(keys.status, status)
    return status
  })

/** Waits for what a screen shows to be read before it shows; a read that fails lets it open anyway, to say so. */
export const readFirst = (...reading: ReadonlyArray<Promise<unknown>>): Promise<void> => Promise.allSettled(reading).then(() => undefined)
