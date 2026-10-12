import { useEffect, useRef, type RefObject } from 'react'
import { focusQuietly } from './focusQuietly'

/**
 * For a button that something replaces while it is open, like a note form
 * in place of Ask for changes: when `open` turns false and focus went with what
 * closed (it is on the page's body), focus goes back to the button. A
 * keyboard user carries on from where they were, and whatever listens for
 * keys inside the surrounding panel still hears them. Give it `target` where
 * the element's ref is kept elsewhere, as when it is shared with a consumer's.
 */
export function useRefocus<T extends HTMLElement>(open: boolean, target?: RefObject<T | null>) {
  const own = useRef<T>(null)
  const ref = target ?? own
  const was = useRef(open)
  useEffect(() => {
    const lost = document.activeElement === null || document.activeElement === document.body
    if (was.current && !open && lost) focusQuietly(ref.current)
    was.current = open
  }, [open, ref])
  return ref
}
