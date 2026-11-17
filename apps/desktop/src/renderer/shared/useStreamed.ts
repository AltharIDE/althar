import { useEffect, useMemo, useState } from 'react'

import type { ConversationView, ThreadItem } from '@althar/contracts'

import { useServices, useWatch } from '../data/services'
import { type Heard, type Hearing, hearing, useHeard } from './heard'
import { caughtUp, placedInView } from './items'
import type { Streamed } from './thread'
/*
 * What agents are still writing on a thread, by the item each will be. It
 * streams to the window as `Streaming`, only while the window listens, and
 * the store catches up behind it. So it holds only while it is heard: a
 * screen that stops listening (hidden, as `KeptScreens` keeps it, or gone),
 * or a watch that broke, may miss the rest of a message, and its end. What
 * was held of it then would stand for the item from then on, and once the
 * item is out of the pages the window holds, show as words not read yet at
 * the thread's end, in whatever turn runs there. So it goes as listening
 * stops or starts again, and the store's text shows until the next words
 * stream. What the store holds in full goes too, however its items arrive:
 * read one by one, or the whole thread again.
 *
 * On the coordinator's thread the view decides what is heard. Words of an item
 * the view leaves out, before the mark of a cleared view, or after it while the
 * earlier conversation shows, are not kept; and as the view is cleared, brought
 * back, opened or closed, or the conversation wiped (its version moves), what
 * was held goes: the words of an item still being written come again whole.
 */

/** Words heard of an item on a thread, whole as they stand now; when they were first heard stays. */
export const hear = (words: Hearing<Streamed>, itemId: string, text: string, about: Pick<Streamed, 'kind' | 'agentId' | 'sequence'>) =>
  words.change((held) => new Map(held).set(itemId, { ...about, text, at: held.get(itemId)?.at ?? new Date().toISOString() }))

/**
 * What agents are still writing on a thread, held apart from the screen (`heard.ts`): the screen holding the thread is
 * not drawn again as each word streams; what shows them reads them (`useStreaming`).
 */
export const useStreamed = (
  threadId: string | null,
  items: ReadonlyArray<ThreadItem>,
  view?: ConversationView,
  conversationVersion?: number,
): Heard<Streamed> => {
  const { feed } = useServices()
  // Another thread's words aren't this one's, nor are the words of a thread before its view changed: each has its own.
  const version = conversationVersion ?? view?.version
  const [held, setHeld] = useState(() => ({ threadId, version, words: hearing<Streamed>() }))
  if (held.threadId !== threadId || held.version !== version) setHeld({ threadId, version, words: hearing<Streamed>() })
  const { words } = held

  // Heard only while listening: as the screen stops (hidden or gone), and as the watch listens again after it broke.
  useEffect(() => {
    const forget = () => words.change((now) => (now.size === 0 ? now : new Map()))
    const unwatched = feed.rewatched(forget)
    return () => {
      unwatched()
      forget()
    }
  }, [feed, words])

  useWatch((event) => {
    if (event._tag !== 'Streaming' || event.threadId !== threadId) return
    if (view !== undefined && !placedInView(view, event.sequence)) return
    hear(words, event.itemId, event.text, { kind: event.kind, agentId: event.agentId, sequence: event.sequence })
  })

  // What the store now holds in full goes from here, as its items arrive; those reading it leave it out already.
  useEffect(() => words.change((now) => caughtUp(now, items)), [words, items])
  return words
}

/** What is still being written on a thread, as it streams, but what its items hold in full already: drawn again as it does. */
export const useStreaming = (words: Heard<Streamed>, items: ReadonlyArray<ThreadItem>): ReadonlyMap<string, Streamed> => {
  const heard = useHeard(words)
  return useMemo(() => caughtUp(heard, items), [heard, items])
}
