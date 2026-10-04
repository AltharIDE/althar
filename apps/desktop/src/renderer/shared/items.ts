import type { ThreadItem } from '@althar/contracts'

import type { Streamed } from './thread'

/* A thread's items as a window holds them: read a page at a time, and changed one by one. */

/** Items by id, oldest first: what arrives replaces what was there. */
export const mergeItems = (current: ReadonlyArray<ThreadItem>, incoming: ReadonlyArray<ThreadItem>): ReadonlyArray<ThreadItem> => {
  const byId = new Map(current.map((item) => [item.id, item]))
  for (const item of incoming) byId.set(item.id, item)
  return [...byId.values()].toSorted((a, b) => a.sequence - b.sequence)
}

/** Streamed text the store now holds in full needs no streamed copy. */
export const caughtUp = (streaming: ReadonlyMap<string, Streamed>, items: ReadonlyArray<ThreadItem>): ReadonlyMap<string, Streamed> => {
  const kept = new Map(streaming)
  for (const item of items) {
    const live = kept.get(item.id)
    if (
      live !== undefined &&
      'text' in item.content &&
      typeof item.content.text === 'string' &&
      item.content.text.length >= live.text.length
    )
      kept.delete(item.id)
  }
  return kept.size === streaming.size ? streaming : kept
}

/** What the person said that still waits: a change to what they said moves it on, so these are read again. */
export const waiting = (items: ReadonlyArray<ThreadItem>): ReadonlyArray<string> =>
  items.flatMap((item) => (item.kind === 'user_message' && item.input?.state === 'queued' ? [item.id] : []))

/**
 * Reads that can come back out of order, as the runtime answers each on its
 * own: an answer is kept only if no read of the same thing began after it,
 * so an earlier answer never puts back what a later one replaced.
 */
export const newestReads = () => {
  const begun = new Map<string, number>()
  let reads = 0
  return <A>(key: string, read: Promise<A>, keep: (value: A) => void, fail: (failure: unknown) => void): Promise<void> => {
    reads += 1
    const mine = reads
    begun.set(key, mine)
    return read.then((value) => {
      if (begun.get(key) === mine) keep(value)
    }, fail)
  }
}
