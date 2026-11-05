import { type RefObject, useEffect, useLayoutEffect, useRef } from 'react'

/*
 * PROTOTYPE. Scroll as a scrubber: a tall track with a stage pinned in it,
 * and a frame loop that, while the track is near the screen, reads how far
 * the page has scrolled through it and draws that moment. Everything it
 * draws is written straight to the DOM (or a canvas), so the pictures of
 * the app inside never render again for it. Scrolling back plays it back.
 */

export const clamp = (n: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n))
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k
export const smooth = (a: number, b: number, t: number) => {
  const x = clamp((t - a) / (b - a))
  return x * x * (3 - 2 * x)
}
export const inOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)
export const outCubic = (t: number) => 1 - (1 - t) ** 3
export const inCubic = (t: number) => t * t * t

/** A segment's progress with a rest at each end: still for `hold` of it at either end, eased between. */
export const held = (t: number, hold = 0.2) => inOut(clamp((t - hold) / (1 - 2 * hold)))

/**
 * Calls `frame` every animation frame while `track` is near the screen:
 * `p` is how far the page has scrolled through it (0 as its top meets the
 * screen's top, 1 as its foot meets the screen's foot), `dt` the seconds
 * since the last frame.
 */
export function useScrub(track: RefObject<HTMLElement | null>, frame: (p: number, dt: number, now: number) => void) {
  const latest = useRef(frame)
  useLayoutEffect(() => {
    latest.current = frame
  })
  useEffect(() => {
    const el = track.current
    if (!el) return
    let raf = 0
    let on = false
    let last = performance.now()
    const tick = (now: number) => {
      const box = el.getBoundingClientRect()
      const span = box.height - window.innerHeight
      const p = span > 0 ? clamp(-box.top / span) : 0
      latest.current(p, Math.min(0.1, (now - last) / 1000), now)
      last = now
      if (on) raf = requestAnimationFrame(tick)
    }
    const io = new IntersectionObserver(
      ([e]) => {
        const was = on
        on = e?.isIntersecting ?? false
        if (on && !was) {
          last = performance.now()
          raf = requestAnimationFrame(tick)
        }
        if (!on) cancelAnimationFrame(raf)
      },
      { rootMargin: '200px 0px' },
    )
    io.observe(el)
    return () => {
      on = false
      cancelAnimationFrame(raf)
      io.disconnect()
    }
  }, [track])
}

/** Scrolls the page so that `track` is at `p` of the way through. */
export function scrubTo(track: HTMLElement, p: number) {
  const top = track.getBoundingClientRect().top + window.scrollY
  window.scrollTo({ top: top + p * (track.offsetHeight - window.innerHeight), behavior: 'smooth' })
}
