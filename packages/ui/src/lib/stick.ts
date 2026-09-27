import { useEffect, useRef, type RefObject } from 'react'

/**
 * Keeps a scroller at its bottom while what is inside it grows, as a thread
 * does while an answer streams in, unless the reader has scrolled away from
 * the bottom. `slack` is how far from the bottom still counts as at it.
 */
export function useStickToBottom(ref: RefObject<HTMLElement | null>, slack = 90) {
  const pinned = useRef(true)
  useEffect(() => {
    const el = ref.current
    const content = el?.firstElementChild
    if (!el || !content || typeof ResizeObserver === 'undefined') return
    const onScroll = () => {
      pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < slack
    }
    const ro = new ResizeObserver(() => {
      if (pinned.current) el.scrollTop = el.scrollHeight
    })
    el.addEventListener('scroll', onScroll, { passive: true })
    ro.observe(content)
    return () => {
      el.removeEventListener('scroll', onScroll)
      ro.disconnect()
    }
  }, [ref, slack])
}
