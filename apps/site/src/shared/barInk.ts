import { type RefObject, useEffect } from 'react'

/*
 * The home bar over a dark section (the review, which lays a LightUnder of
 * tone `ink` over itself), by the scroll rather than on a timer: where the
 * section is under the bar, the bar is its frosted black, and where the page
 * is, its frosted paper, the edge between them the section's own edge as it
 * passes up through the bar (and down again, scrolled back). Its words turn
 * from ink to white as that edge crosses them, as far through as it is.
 * Written straight onto the bar (Bar.module.css reads it): the clip of each
 * frost, and the words' two inks; and once the page has scrolled past
 * `SCROLLED`, `data-scrolled`, for the hairline along its foot.
 */

type Rgba = readonly [number, number, number, number]

/** The words' inks, on paper and on the dark: the name and the page being read; the other pages. */
const INK: readonly [Rgba, Rgba] = [
  [20, 20, 23, 1],
  [244, 239, 231, 1],
]
const INK_2: readonly [Rgba, Rgba] = [
  [69, 69, 76, 1],
  [244, 239, 231, 0.66],
]
/** How far the page scrolls, in px, before the bar draws its hairline: at the top it would run along a night head's own rim, just under it. */
const SCROLLED = 30
/** The band the bar's words stand in, from its top, in px: they turn as the edge crosses it. */
const WORDS = [26, 50] as const

const clamp = (v: number) => Math.min(1, Math.max(0, v))
const mix = ([a, b]: readonly [Rgba, Rgba], t: number) =>
  `rgba(${[0, 1, 2].map((i) => Math.round(a[i]! + (b[i]! - a[i]!) * t)).join(', ')}, ${(a[3] + (b[3] - a[3]) * t).toFixed(3)})`

export function useInkUnder(bar: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = bar.current
    if (!el) return
    let frame = 0
    let was = ''
    const draw = () => {
      frame = 0
      el.toggleAttribute('data-scrolled', window.scrollY > SCROLLED)
      const h = el.offsetHeight
      // The dark's part of the bar, from its top, in px: none, unless a dark section is under it.
      let top = h
      let bottom = h
      for (const mark of document.querySelectorAll<HTMLElement>('[data-under="ink"]')) {
        const r = mark.getBoundingClientRect()
        const from = Math.min(h, Math.max(0, r.top))
        const to = Math.min(h, Math.max(0, r.bottom))
        if (to > from) {
          top = from
          bottom = to
          break
        }
      }
      const dark = bottom > top
      const band = WORDS[1] - WORDS[0]
      const words = Math.min(clamp((WORDS[1] - top) / band), clamp((bottom - WORDS[0]) / band))
      const ink = dark ? `inset(${top.toFixed(1)}px 0 ${(h - bottom).toFixed(1)}px 0)` : 'inset(0 0 100% 0)'
      // The paper is what the dark leaves: above it coming in, below it going out.
      const paper = !dark
        ? 'none'
        : top > 0
          ? `inset(0 0 ${(h - top).toFixed(1)}px 0)`
          : bottom < h
            ? `inset(${bottom.toFixed(1)}px 0 0 0)`
            : 'inset(0 0 100% 0)'
      const next = `${ink}|${paper}|${words.toFixed(3)}`
      if (next === was) return
      was = next
      el.style.setProperty('--ink-clip', ink)
      el.style.setProperty('--paper-clip', paper)
      el.style.setProperty('--bar-ink', mix(INK, words))
      el.style.setProperty('--bar-ink-2', mix(INK_2, words))
      el.toggleAttribute('data-dark', words > 0.5)
    }
    const ask = () => {
      if (!frame) frame = requestAnimationFrame(draw)
    }
    draw()
    window.addEventListener('scroll', ask, { passive: true })
    window.addEventListener('resize', ask)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', ask)
      window.removeEventListener('resize', ask)
    }
  }, [bar])
}
