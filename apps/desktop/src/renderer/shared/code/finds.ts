import { type QueryClient, queryOptions } from '@tanstack/react-query'

import { CODE_NAMES, type CodeFound, type CodePlace } from '@althar/contracts'

import type { Client } from '../../data/client'

/*
 * What the names in a thread's messages name, as the runtime finds them
 * where the thread's agent works (FindCode). Each message asks for its own
 * names, by the item it is, so a coordinator's is read as main was when it
 * said it; the messages of a thread that ask in the same moment, as a
 * thread first shows, go to the runtime as one question, which lists the
 * place's files once for all of them. Kept a little while: a lead's
 * worktree changes as it works, and a name may come to name a file.
 */

export const codeKeys = {
  found: (threadId: string, itemId: string | null, names: readonly string[]) => ['code', threadId, itemId ?? '', names.join('\n')] as const,
  /** Where the thread's agent works: its task's branch, or the default branch. */
  place: (threadId: string) => ['code-place', threadId] as const,
  text: (threadId: string, path: string, commit: string | null, line: number | null) =>
    ['code-text', threadId, path, commit ?? 'now', line ?? 0] as const,
  change: (taskId: string, path: string) => ['code-change', taskId, path] as const,
}

/** How long what a name names, or a file read, is taken as it is: a peek over the same name again isn't asked again. */
export const CODE_FRESH = 30_000

interface Asking {
  readonly itemId: string | null
  readonly names: readonly string[]
  readonly resolve: (found: ReadonlyArray<CodeFound>) => void
  readonly reject: (error: unknown) => void
}

/** The questions waiting to go, by client and thread. */
const waiting = new WeakMap<Client, Map<string, Asking[]>>()

const send = (client: Client, cache: QueryClient, threadId: string, asked: readonly Asking[]) => {
  for (let at = 0; at < asked.length; at += CODE_NAMES.messages) {
    const part = asked.slice(at, at + CODE_NAMES.messages)
    client
      .findCode(
        threadId,
        part.map((one) => ({ ...(one.itemId === null ? {} : { itemId: one.itemId }), names: one.names.slice(0, CODE_NAMES.perMessage) })),
      )
      .then(
        (answer) => {
          cache.setQueryData(codeKeys.place(threadId), answer.place)
          part.forEach((one, index) => one.resolve(answer.messages[index]?.found ?? []))
        },
        (error: unknown) => {
          for (const one of part) one.reject(error)
        },
      )
  }
}

/** What a message's names name: asked with the other messages of the thread that ask now, in one question. */
export const askCode = (client: Client, cache: QueryClient, threadId: string, itemId: string | null, names: readonly string[]) =>
  new Promise<ReadonlyArray<CodeFound>>((resolve, reject) => {
    const byThread = waiting.get(client) ?? new Map<string, Asking[]>()
    waiting.set(client, byThread)
    const asked = byThread.get(threadId)
    if (asked !== undefined) {
      asked.push({ itemId, names, resolve, reject })
      return
    }
    byThread.set(threadId, [{ itemId, names, resolve, reject }])
    setTimeout(() => {
      const all = byThread.get(threadId) ?? []
      byThread.delete(threadId)
      send(client, cache, threadId, all)
    }, 0)
  })

/** What a message's names name, by name. */
export const foundRead = (client: Client, cache: QueryClient, threadId: string, itemId: string | null, names: readonly string[]) =>
  queryOptions({
    queryKey: codeKeys.found(threadId, itemId, names),
    queryFn: async () => new Map((await askCode(client, cache, threadId, itemId, names)).map((found) => [found.name, found] as const)),
    staleTime: CODE_FRESH,
    gcTime: 10 * 60_000,
  })

/** Where the thread's agent works, as the runtime last said with what it found; asked alone where nothing has asked yet. */
export const placeRead = (client: Client, threadId: string) =>
  queryOptions<CodePlace>({
    queryKey: codeKeys.place(threadId),
    queryFn: async () => (await client.findCode(threadId, [])).place,
    staleTime: Number.POSITIVE_INFINITY,
  })
