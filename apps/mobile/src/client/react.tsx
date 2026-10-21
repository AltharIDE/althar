import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'

import type { AltharClient, Connection } from './AltharClient'

/*
 * The client, as screens use it: queries cached by React Query, read again
 * when the watch says a record changed, and what an agent is saying as far
 * as it has come, from the watch's stream, held apart until the store has
 * all of it.
 */

const Client = createContext<AltharClient | null>(null)

type Streamed = { readonly itemId: string; readonly agentId: string; readonly text: string }

/** What agents are saying now, by thread. */
const streaming = (() => {
  let byThread = new Map<string, Streamed>()
  const listeners = new Set<() => void>()
  return {
    set(threadId: string, streamed: Streamed | null) {
      byThread = new Map(byThread)
      if (streamed === null) byThread.delete(threadId)
      else byThread.set(threadId, streamed)
      for (const listener of listeners) listener()
    },
    get: (threadId: string) => byThread.get(threadId) ?? null,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
})()

export function ClientProvider({ client, children }: { readonly client: AltharClient; readonly children: ReactNode }) {
  const [queries] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } }))
  useEffect(
    () =>
      client.watch((event) => {
        if (event._tag === 'Changed') {
          if (event.threadId !== null) streaming.set(event.threadId, null)
          void queries.invalidateQueries()
        } else if (event._tag === 'Streaming') {
          streaming.set(event.threadId, { itemId: event.itemId, agentId: event.agentId, text: event.text })
        }
      }),
    [client, queries],
  )
  return (
    <Client.Provider value={client}>
      <QueryClientProvider client={queries}>{children}</QueryClientProvider>
    </Client.Provider>
  )
}

export const useClient = (): AltharClient => {
  const client = useContext(Client)
  if (client === null) throw new Error('useClient outside ClientProvider')
  return client
}

export const useConnection = (): Connection => {
  const client = useClient()
  return useSyncExternalStore(
    (listener) => client.onConnection(listener),
    () => client.connection(),
    () => client.connection(),
  )
}

export const useStreaming = (threadId: string): Streamed | null =>
  useSyncExternalStore(
    streaming.subscribe,
    () => streaming.get(threadId),
    () => streaming.get(threadId),
  )

export const useHome = () => {
  const client = useClient()
  return useQuery({ queryKey: ['home'], queryFn: () => client.home() })
}

export const useBoard = (projectId: string) => {
  const client = useClient()
  return useQuery({ queryKey: ['board', projectId], queryFn: () => client.board(projectId) })
}

export const useThread = (threadId: string) => {
  const client = useClient()
  return useQuery({ queryKey: ['thread', threadId], queryFn: () => client.thread(threadId) })
}

export const useFileDiff = (taskId: string, path: string) => {
  const client = useClient()
  return useQuery({ queryKey: ['diff', taskId, path], queryFn: () => client.fileDiff(taskId, path) })
}

/** A command, which reads everything again once it's done: the watch would say so too, a moment later. */
export const useCommand = <I,>(run: (client: AltharClient, input: I) => Promise<unknown>) => {
  const client = useClient()
  const queries = useQueryClient()
  return useMutation({
    mutationFn: (input: I) => run(client, input),
    onSettled: () => queries.invalidateQueries(),
  })
}

/** The time, again every `every` milliseconds, for what says how long ago. */
export const useNow = (every: number = 30_000): number => {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), every)
    return () => clearInterval(timer)
  }, [every])
  return now
}
