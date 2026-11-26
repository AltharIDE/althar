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
 * A window here is the small one (100svh, as the pictures' own CSS has it),
 * not `innerHeight`: on a phone the browser's bar slides away and back as
 * you scroll, and each time `innerHeight` changes and the window says it was
 * resized. Sections sized by it all changed height at once, the page above
 * the reader with them, by more than a window in all; a browser that doesn't
 * hold the reader's place through that (Safari) threw them past the scene
 * they were in, and at the page's foot, where the bar comes back, again.
 *
 * Where the reader asks for reduced motion nothing is pinned or moved: the
 * sections stand at their natural height, and `on` is told the picture's
 * still moment (`rest`) once.
 */

/** Where a pinned picture holds: under the floating nav. */
const UNDER_NAV = 76

export type Measure =
  /**
   * Pinned for `run` windows: 0 as it pins, 1 as it lets go. `bare` where
   * nothing in its CSS follows the scroll: its `--p` isn't written, as
   * writing it restyles everything in the section, every frame.
   */
  | { pin: number; bare?: true }
  /** A sideways row, as far as it is wider than the window. */
  | { track: true }
  /** From its top at the window's foot (0) to its top at the window's top (1); `bare` as for a pin. */
  | { enter: true; bare?: true }

/**
 * The small window's height (100svh): what a phone shows with its browser's bar out, and the same once the bar has slid
 * away. `innerHeight` where the unit isn't known, or nothing is laid out.
 */
export function smallWindow() {
  const probe = document.createElement('div')
  probe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:100svh;visibility:hidden;pointer-events:none'
  document.body.append(probe)
  const tall = probe.offsetHeight
  probe.remove()
  return tall > 0 ? tall : window.innerHeight
}

/** How tall a pinned section is: its picture and `run` windows to scroll by, two windows at least, and its own padding. */
export const pinnedHeight = (picture: number, run: number, tall: number, pad: number) => Math.max(picture + tall * run, tall * 2) + pad

/** How tall a track is: a window, and as far as its row runs sideways. */
/**
 * How far a row runs sideways, in px: `row` wide, starting `left` px into a window `across`, its last piece `last` wide.
 * On a wide window, until its end is 128px short of the window's far side. On a phone, where a piece is nearly the
 * window's width, until its last piece is in the window's middle: it is the last, and stops there to be looked at.
 */
export const trackRun = (row: number, across: number, left: number, last: number) =>
  Math.max(0, across < 700 && last > 0 ? left + row - (across + last) / 2 : row - across + 128)

export const trackHeight = (extra: number, tall: number) => tall + extra

/**
 * How far through a section the scroll is, 0 to 1, from where its top is in the window and how tall it is: a pin or a
 * track from its top at the window's top until it has scrolled by all but one window (`tall`, as it was sized by);
 * `enter` from its top at the window's foot to its top at the window's top (`tall`, the window as it is now).
 */
export const progress = (enter: boolean, top: number, height: number, tall: number) =>
  Math.min(1, Math.max(0, enter ? 1 - top / tall : -top / Math.max(1, height - tall)))

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
      if (!('bare' in kind)) el.style.setProperty('--p', String(rest))
      call.current?.(rest)
      return
    }
    const stick = el.querySelector<HTMLElement>('[data-stick]')
    const row = el.querySelector<HTMLElement>('[data-row]')
    let extra = 0
    // The small window, as the section was last sized by.
    let tall = window.innerHeight

    const size = () => {
      tall = smallWindow()
      if ('pin' in kind && kind.pin > 0 && stick) {
        stick.style.top = `${Math.min(UNDER_NAV, tall - stick.offsetHeight - 12)}px`
        // The section's own padding (room under the picture once it lets go) is on top of the run, not taken from it.
        const css = getComputedStyle(el)
        const pad = css.boxSizing === 'border-box' ? parseFloat(css.paddingTop) + parseFloat(css.paddingBottom) : 0
        el.style.height = `${pinnedHeight(stick.offsetHeight, kind.pin, tall, pad)}px`
      }
      if ('track' in kind && row) {
        extra = trackRun(
          row.scrollWidth,
          window.innerWidth,
          row.getBoundingClientRect().left - (parseFloat(row.style.getPropertyValue('--x')) || 0),
          (row.lastElementChild as HTMLElement | null)?.offsetWidth ?? 0,
        )
        el.style.height = `${trackHeight(extra, tall)}px`
      }
    }

    let last = -1
    const read = () => {
      const r = el.getBoundingClientRect()
      const p = 'enter' in kind ? progress(true, r.top, r.height, window.innerHeight) : progress(false, r.top, r.height, tall)
      if (Math.abs(p - last) < 1e-4) return
      last = p
      if (!('bare' in kind)) el.style.setProperty('--p', p.toFixed(4))
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
