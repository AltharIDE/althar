import type { ThreadItem } from '@charrette/contracts'

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
