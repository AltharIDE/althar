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

/** Whether the page is shown: false while its tab is in the background, where what plays by a clock should rest rather than skip ahead. */
export function usePageShown() {
  const [shown, setShown] = useState(true)
  useEffect(() => {
    const sync = () => setShown(!document.hidden)
    document.addEventListener('visibilitychange', sync)
    return () => document.removeEventListener('visibilitychange', sync)
  }, [])
  return shown
}

/** Whether `ref` is on screen now (by `share` of itself): for what loops only while it is watched. */
export function useInView(ref: RefObject<Element | null>, share = 0.3) {
  const [on, setOn] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => setOn(e?.isIntersecting ?? false), { threshold: share })
    io.observe(el)
    return () => io.disconnect()
  }, [ref, share])
  return on
}

/**
 * While `ref` is off screen, everything animating inside it rests where it
 * is, and goes on as it comes back. The app's components loop (a spinner's
 * arc, the light's drift), some of them on the main thread; out of sight
 * they would cost every frame of the page for nothing. `again` rebinds it
 * when the element it points at changes.
 */
export function useRestAway(ref: RefObject<Element | null>, again?: unknown) {
  useEffect(() => {
    const el = ref.current
    if (!el || typeof el.getAnimations !== 'function') return
    let rested: Animation[] = []
    const wake = () => {
      el.removeAttribute('data-away')
      for (const run of rested) if (run.playState === 'paused') run.play()
      rested = []
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) return wake()
        // Anything started while away rests too (base.css), until it is back.
        el.setAttribute('data-away', '')
        rested = el.getAnimations({ subtree: true }).filter((run) => run.playState === 'running')
        for (const run of rested) run.pause()
      },
      { rootMargin: '200px 0px' },
    )
    io.observe(el)
    return () => {
      io.disconnect()
      wake()
    }
  }, [ref, again])
}
