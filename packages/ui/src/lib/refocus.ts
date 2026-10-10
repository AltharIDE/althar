import { useEffect, useRef } from 'react'

/**
 * For a button that something replaces while it is open, like a note form
 * in place of Ask for changes: when `open` turns false and focus went with what
 * closed (it is on the page's body), focus goes back to the button. A
 * keyboard user carries on from where they were, and whatever listens for
 * keys inside the surrounding panel still hears them.
 */
export function useRefocus<T extends HTMLElement>(open: boolean) {
  const ref = useRef<T>(null)
  const was = useRef(open)
  useEffect(() => {
    const lost = document.activeElement === null || document.activeElement === document.body
    if (was.current && !open && lost) ref.current?.focus()
    was.current = open
  }, [open])
  return ref
}
