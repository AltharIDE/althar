import { type RefObject, useEffect, useState } from 'react'

/** Whether `ref` has been on screen (by `share` of itself), once: what plays when it comes into view. With reduced motion, at once. */
export function useSeen(ref: RefObject<Element | null>, share = 0.35) {
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || new URLSearchParams(window.location.search).has('t')) {
      setSeen(true)
      return
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) {
          setSeen(true)
          io.disconnect()
        }
      },
      { threshold: share },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [ref, share])
  return seen
}
