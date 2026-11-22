import { useEffect, useSyncExternalStore } from 'react'

/*
 * An artifact opened from the project's Artifacts view (ADR-104) opens beside
 * the conversation that drew it, where it is talked about and changed: the
 * view asks for it here by that conversation's thread, and the conversation's
 * workbench takes the ask as it shows, with a way back to every artifact.
 */

/** A canvas asked to open beside a thread, and the project whose Artifacts view it came from. */
export interface AskedBeside {
  readonly canvasId: string
  readonly from: string
}

const asked = new Map<string, AskedBeside>()
const listeners = new Set<() => void>()
let changes = 0

/** Asks the conversation on `threadId` to open a canvas beside it, from the Artifacts view of the project `from`. */
export const askBeside = (threadId: string, canvasId: string, from: string) => {
  asked.set(threadId, { canvasId, from })
  changes += 1
  for (const listener of listeners) listener()
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

/** Opens what was asked of this thread's conversation, once, as it shows or as it is asked. */
export const useAskedBeside = (threadId: string | null, open: (ask: AskedBeside) => void) => {
  const seen = useSyncExternalStore(subscribe, () => changes)
  useEffect(() => {
    if (threadId === null) return
    const ask = asked.get(threadId)
    if (ask === undefined) return
    asked.delete(threadId)
    open(ask)
  }, [threadId, open, seen])
}
