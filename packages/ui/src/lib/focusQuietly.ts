/** The nearest ancestor that scrolls by its own overflow: the thread's scroller, not the shell around it. */
function scroller(el: HTMLElement): HTMLElement | null {
  for (let at = el.parentElement; at !== null; at = at.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(at).overflowY) && at.scrollHeight > at.clientHeight) return at
  }
  return null
}

/**
 * Brings `el` into view only inside its own scroller, and only when it is out of
 * view there. Never scrolls the shell around it, as `scrollIntoView` does.
 */
export function revealInScroller(el: HTMLElement, block: 'nearest' | 'center' = 'nearest') {
  const box = scroller(el)
  if (box === null) return
  const a = el.getBoundingClientRect()
  const b = box.getBoundingClientRect()
  if (block === 'center') {
    if (a.top >= b.top && a.bottom <= b.bottom) return
    /* a target taller than the scroller is shown from its top, not its middle */
    box.scrollTop += a.height > b.height ? a.top - b.top : a.top + a.height / 2 - (b.top + b.height / 2)
  } else if (a.top < b.top) {
    box.scrollTop -= b.top - a.top
  } else if (a.bottom > b.bottom) {
    box.scrollTop += Math.min(a.bottom - b.bottom, a.top - b.top)
  }
}

/** Moves focus without letting the browser scroll every ancestor to reveal it; the thread's own scroller shows it if need be. */
export function focusQuietly(el: HTMLElement | null | undefined) {
  if (el == null) return
  el.focus({ preventScroll: true })
  revealInScroller(el)
}
