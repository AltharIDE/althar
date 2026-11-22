import { type RefObject, useEffect, useLayoutEffect, useRef } from 'react'

import { useMedia } from '../../lib/browser'

/*
 * How the page's pictures follow the scroll. A section is measured as it
 * passes through the window, 0 to 1, written to its `--p` for its CSS and
 * handed to `on` for what a script draws. Where it is pinned, the section is
 * made taller than its picture by `run` windows, and the picture holds under
 * the nav while the extra height scrolls by: the scroll is its clock, so it
 * plays back exactly as far as you scroll back. A track runs its row
 * sideways instead, as far as the row is wider than the window.
 *
 * Where the reader asks for reduced motion nothing is pinned or moved: the
 * sections stand at their natural height, and `on` is told the picture's
 * still moment (`rest`) once.
 */

/** Where a pinned picture holds: under the floating nav. */
const UNDER_NAV = 76

export type Measure =
  /** Pinned for `run` windows: 0 as it pins, 1 as it lets go. */
  | { pin: number }
  /** A sideways row, as far as it is wider than the window. */
  | { track: true }
  /** From its top at the window's foot (0) to its top at the window's top (1). */
  | { enter: true }

export function useScrolled(ref: RefObject<HTMLElement | null>, measure: Measure, on?: (p: number) => void, rest = 1) {
  const still = useMedia('(prefers-reduced-motion: reduce)')
  const call = useRef(on)
  useLayoutEffect(() => {
    call.current = on
  })
  const key = JSON.stringify(measure)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const kind = JSON.parse(key) as Measure
    if (still) {
      el.style.removeProperty('height')
      el.style.setProperty('--p', String(rest))
      call.current?.(rest)
      return
    }
    const stick = el.querySelector<HTMLElement>('[data-stick]')
    const row = el.querySelector<HTMLElement>('[data-row]')
    let extra = 0

    const size = () => {
      const vh = window.innerHeight
      if ('pin' in kind && stick) {
        stick.style.top = `${Math.min(UNDER_NAV, vh - stick.offsetHeight - 12)}px`
        el.style.height = `${Math.max(stick.offsetHeight + vh * kind.pin, vh * 2)}px`
      }
      if ('track' in kind && row) {
        extra = Math.max(0, row.scrollWidth - window.innerWidth + 128)
        el.style.height = `${vh + extra}px`
      }
    }

    let last = -1
    const read = () => {
      const vh = window.innerHeight
      const r = el.getBoundingClientRect()
      let p = 'enter' in kind ? 1 - r.top / vh : -r.top / Math.max(1, r.height - vh)
      p = Math.min(1, Math.max(0, p))
      if (Math.abs(p - last) < 1e-4) return
      last = p
      el.style.setProperty('--p', p.toFixed(4))
      if (row && 'track' in kind) row.style.setProperty('--x', `${(-p * extra).toFixed(1)}px`)
      call.current?.(p)
    }

    let frame = 0
    const later = () => {
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0
          read()
        })
    }
    const resized = () => {
      size()
      last = -1
      later()
    }
    size()
    read()
    const ro = new ResizeObserver(resized)
    if (stick) ro.observe(stick)
    if (row) ro.observe(row)
    window.addEventListener('scroll', later, { passive: true })
    window.addEventListener('resize', resized)
    return () => {
      cancelAnimationFrame(frame)
      ro.disconnect()
      window.removeEventListener('scroll', later)
      window.removeEventListener('resize', resized)
      el.style.removeProperty('height')
    }
  }, [ref, key, still, rest])

  return still
}
