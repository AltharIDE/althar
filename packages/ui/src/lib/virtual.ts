/*
 * What a thread drawn in part (VirtualBlocks) tells the rest of the window:
 * the messages it holds, for the navigator's stops, and a way to bring any of
 * its blocks into view, for a search or a link that takes the person to an
 * item drawn nowhere yet. Each such thread registers by the scroller it is
 * in while it shows.
 */

/** A message of the person's in a thread drawn in part: where the navigator stops. */
export interface VirtualStop {
  /** Its block's key. */
  readonly key: string
  /** What the person said, for the stop's preview. */
  readonly prompt: string
  /** The start of what answered it. */
  readonly reply: string
}

export interface VirtualThread {
  /** Every stop it holds, drawn or not, in order. */
  readonly stops: () => ReadonlyArray<VirtualStop>
  /** Where a block's top is, from the top of the scroller's content, in px, as measured or estimated. */
  readonly topOf: (key: string) => number | null
  /** Draws a block and scrolls to it, its top `offset` px under the scroller's top. */
  readonly bring: (key: string, offset: number) => void
  /** Draws the block that holds an item, by the item's id, and scrolls to it; whether one does. */
  readonly bringItem: (itemId: string) => boolean
  /** Keeps the bottom in view when the scroller's contents outside the blocks change size. */
  readonly followResize: () => void
  /** Hears when what it holds or where it is changes; returns the way to stop hearing. */
  readonly subscribe: (listener: () => void) => () => void
}

const byScroller = new Map<Element, VirtualThread>()

/** Registers a thread drawn in part under its scroller, while it shows; returns the way to unregister it. */
export const registerVirtualThread = (scroller: Element, thread: VirtualThread) => {
  byScroller.set(scroller, thread)
  return () => {
    if (byScroller.get(scroller) === thread) byScroller.delete(scroller)
  }
}

/** The thread drawn in part in a scroller, if one is. */
export const virtualThreadIn = (scroller: Element | null): VirtualThread | undefined =>
  scroller === null ? undefined : byScroller.get(scroller)

/**
 * Draws the block holding an item, in whichever thread on show holds it, so a search or a link can bring the person to
 * it as to one drawn already. Whether one held it.
 */
export const bringItemIntoView = (itemId: string): boolean => {
  for (const thread of byScroller.values()) if (thread.bringItem(itemId)) return true
  return false
}
