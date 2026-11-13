import { useEffect, useState } from 'react'

import type { Draft } from '@althar/contracts'

import { useServices, useWatch } from '../data/services'

/*
 * The tasks the coordinator is drafting on a thread now, as far as it has
 * written them, whole each time they change (`drafts.ts` in the runtime): a
 * task's card shows from the moment its draft begins. Nothing of it is kept:
 * it holds only while it is heard, as `useStreamed`'s words do, and a draft
 * whose card is in the thread is that card's from then on.
 */

const NONE: ReadonlyArray<Draft> = []

export const useDrafts = (threadId: string | null): ReadonlyArray<Draft> => {
  const { feed } = useServices()
  const [held, setHeld] = useState<{ readonly threadId: string | null; readonly drafts: ReadonlyArray<Draft> }>({ threadId, drafts: NONE })

  // Heard only while listening: as the screen stops, and as the watch listens again after it broke.
  useEffect(() => {
    const forget = () => setHeld((current) => ({ ...current, drafts: NONE }))
    const unwatched = feed.rewatched(forget)
    return () => {
      unwatched()
      forget()
    }
  }, [feed])

  useWatch((event) => {
    if (event._tag !== 'Drafting' || event.threadId !== threadId) return
    setHeld({ threadId, drafts: event.drafts })
  })
  return held.threadId === threadId ? held.drafts : NONE
}
