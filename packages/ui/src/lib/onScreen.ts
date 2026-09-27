import { useEffect, useState, type RefObject } from 'react'

const canObserve = () => typeof IntersectionObserver !== 'undefined'

/**
 * Whether an element is on screen, for clocks that should run only while
 * someone can see them. Where there is no IntersectionObserver it counts as
 * on screen, so a clock still runs. `threshold` is how much of it must show.
 */
export function useOnScreen(
  ref: RefObject<Element | null>,
  { threshold = 0, enabled = true }: { threshold?: number; enabled?: boolean } = {},
) {
  const [onScreen, setOnScreen] = useState(() => !canObserve())
  useEffect(() => {
    const el = ref.current
    if (!enabled || !el || !canObserve()) return
    const io = new IntersectionObserver(([e]) => setOnScreen(!!e?.isIntersecting), { threshold })
    io.observe(el)
    return () => io.disconnect()
  }, [ref, threshold, enabled])
  return onScreen
}
