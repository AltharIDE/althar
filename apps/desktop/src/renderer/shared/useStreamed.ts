import { useEffect, useMemo, useState } from 'react'

import type { ConversationView, ThreadItem } from '@althar/contracts'

import { useServices, useWatch } from '../data/services'
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

/* Nothing streamed: what a thread shows the moment another replaces it. */
const NONE: ReadonlyMap<string, Streamed> = new Map()

export const useStreamed = (
  threadId: string | null,
  items: ReadonlyArray<ThreadItem>,
  view?: ConversationView,
  conversationVersion?: number,
): ReadonlyMap<string, Streamed> => {
  const { feed } = useServices()
  const [streaming, setStreaming] = useState<ReadonlyMap<string, Streamed>>(NONE)

  // Heard only while listening: as the screen stops (hidden or gone), and as the watch listens again after it broke.
  useEffect(() => {
    const forget = () => setStreaming(NONE)
    const unwatched = feed.rewatched(forget)
    return () => {
      unwatched()
      forget()
    }
  }, [feed])

  useWatch((event) => {
    if (event._tag !== 'Streaming' || event.threadId !== threadId) return
    if (view !== undefined && !placedInView(view, event.sequence)) return
    setStreaming((current) =>
      new Map(current).set(event.itemId, {
        kind: event.kind,
        agentId: event.agentId,
        text: event.text,
        sequence: event.sequence,
        at: current.get(event.itemId)?.at ?? new Date().toISOString(),
      }),
    )
  })

  // Another thread's words aren't this one's.
  // Nor are the words of a thread before its view changed.
  const version = conversationVersion ?? view?.version
  const [shownFor, setShownFor] = useState({ threadId, version })
  const another = shownFor.threadId !== threadId || shownFor.version !== version
  if (another) {
    setShownFor({ threadId, version })
    setStreaming(NONE)
  }

  const shown = useMemo(() => caughtUp(streaming, items), [streaming, items])
  if (!another && shown !== streaming) setStreaming(shown)
  return another ? NONE : shown
}
