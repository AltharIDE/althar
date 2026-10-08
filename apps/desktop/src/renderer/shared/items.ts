import type { ThreadItem } from '@althar/contracts'

import type { Streamed } from './thread'

/* A thread's items as a window holds them: read a page at a time, and changed one by one. */

/** Items by id, oldest first: what arrives replaces what was there. */
export const mergeItems = (current: ReadonlyArray<ThreadItem>, incoming: ReadonlyArray<ThreadItem>): ReadonlyArray<ThreadItem> => {
  const byId = new Map(current.map((item) => [item.id, item]))
  for (const item of incoming) byId.set(item.id, item)
  return [...byId.values()].toSorted((a, b) => a.sequence - b.sequence)
}

/**
 * An item that can't change any more: a tool call that completed or failed,
 * a message delivered (or never queued), a plan with every entry done, a
 * task settled. What an agent said, a notice, a step's result and what
 * arrived from outside are settled once written.
 */
export const settled = (item: ThreadItem): boolean => {
  switch (item.kind) {
    case 'tool_call':
      return item.content.status === 'completed' || item.content.status === 'failed'
    case 'user_message':
      return item.input?.state !== 'queued'
    case 'plan':
      return item.content.entries.every((entry) => entry.status === 'completed')
    case 'task':
      return item.content.phase === 'settled'
    case 'agent_message':
    case 'agent_thought':
    case 'notice':
    case 'step_result':
    case 'arrival':
      return true
  }
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
 * Whether what waits its turn shows in the composer's queue: behind a turn
 * running, or with no agent on the thread to take it, where it could wait
 * for long. With an agent idle there is nothing to wait behind, and while the
 * person's own send is on its way (which may start the agent), what they just
 * sent is about to be read: it goes straight to the thread, rather than
 * flashing in the queue.
 */
export const queueShown = (session: { readonly turnRunning: boolean } | null, sending: boolean): boolean =>
  session === null ? !sending : session.turnRunning

/**
 * What waits its turn, oldest first, in the composer where the person can
 * edit it or take it back, when the queue shows. A message sent now isn't
 * there: it goes first, as soon as the turn stops.
 */
export const queuedOf = (
  items: ReadonlyArray<ThreadItem>,
  shown: boolean,
): ReadonlyArray<{ readonly id: string; readonly text: string }> =>
  !shown
    ? []
    : items.flatMap((item) =>
        item.kind === 'user_message' && item.input?.state === 'queued' && !item.input.interrupting
          ? [{ id: item.id, text: item.content.text }]
          : [],
      )

/** A message taken back, as the window holds it until the runtime's word of it arrives. */
export const takenBack = (items: ReadonlyArray<ThreadItem>, itemId: string): ReadonlyArray<ThreadItem> =>
  items.flatMap((item) =>
    item.id === itemId && item.kind === 'user_message' && item.input !== null
      ? [{ ...item, input: { ...item.input, state: 'withdrawn' as const } }]
      : [],
  )

/** A queued message back in the composer: in place of nothing, or after what is already written. */
export const withQueued = (draft: string, text: string): string => (draft.trim() === '' ? text : `${draft.trimEnd()}\n\n${text}`)

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
