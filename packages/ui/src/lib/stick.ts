import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

/**
 * Keeps a scroller at its bottom while what is inside it grows, as a thread
 * does while an answer streams in, unless the reader has scrolled away from
 * the bottom. `slack` is how far from the bottom still counts as at it.
 * Only a move up leaves the bottom: the browser moves it down on its own,
 * keeping its place as content above changes, and a scroll it reports may
 * come after more has arrived.
 * Returns whether it is at the bottom, so a host can offer a way down
 * (JumpToLatest), and the way down.
 */
export function useStickToBottom(ref: RefObject<HTMLElement | null>, slack = 90) {
  const pinned = useRef(true)
  const [atBottom, setAtBottom] = useState(true)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    let last = el.scrollTop
    const onScroll = () => {
      if (el.scrollHeight - el.scrollTop - el.clientHeight < slack) pinned.current = true
      else if (el.scrollTop < last) pinned.current = false
      last = el.scrollTop
      setAtBottom(pinned.current)
    }
    const follow = () => {
      if (!pinned.current) return
      el.scrollTop = el.scrollHeight
      last = el.scrollTop
    }
    const ro = new ResizeObserver(follow)
    /* whatever is inside, even when the host swaps it */
    const watch = () => {
      ro.disconnect()
      for (const child of Array.from(el.children)) ro.observe(child)
    }
    const mo = new MutationObserver(watch)
    watch()
    mo.observe(el, { childList: true })
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      ro.disconnect()
      mo.disconnect()
    }
  }, [ref, slack])
  const toBottom = useCallback(() => {
    const el = ref.current
    if (!el) return
    pinned.current = true
    setAtBottom(true)
    /* at once: a smooth scroll reports positions short of the bottom on its way, which would unpin it */
    el.scrollTop = el.scrollHeight
  }, [ref])
  return { atBottom, toBottom }
}
