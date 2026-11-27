import { useEffect, useRef } from 'react'

import s from './Story.module.css'

/*
 * The way down, counted: a pill in the corner with the altitude of the scene
 * across the window's middle, eased between scenes as you scroll, from the
 * first screen high up to the ground at the download. Each scene says its
 * altitude (`data-km`, from KM); it shows from the section under the first
 * screen all the way down.
 */

/** How high each part of the page stands, in km, top to bottom: the first screen, the race, the story's scenes, and the download on the ground. */
export const KM = {
  hero: 52,
  race: 45,
  independent: 38,
  workers: 34.5,
  community: 31,
  review: 24,
  flow: 17,
  connections: 10,
  edge: 3,
  gallery: 0.5,
  end: 0,
} as const

export function Altitude() {
  const pill = useRef<HTMLParagraphElement>(null)
  const km = useRef<HTMLElement>(null)
  useEffect(() => {
    const el = pill.current
    const out = km.current
    if (!el || !out) return
    const scenes = [...document.querySelectorAll<HTMLElement>('[data-km]')]
    let frame = 0
    const read = () => {
      frame = 0
      // Read across the window's middle; at the very top, across its top, so the page opens at the first screen's own altitude.
      const line = Math.min(window.innerHeight * 0.5, window.scrollY)
      const at = scenes.map((x) => ({ top: x.getBoundingClientRect().top, km: Number(x.dataset.km) }))
      let value = at[0]?.km ?? 0
      for (let i = 0; i < at.length; i++) {
        const a = at[i]!
        const b = at[i + 1]
        if (a.top > line) continue
        value = a.km
        if (b) value = a.km + (b.km - a.km) * Math.min(1, Math.max(0, (line - a.top) / Math.max(1, b.top - a.top)))
      }
      out.textContent = value.toFixed(1)
      // It comes in with the section under the first screen, as that reaches the window's middle, and goes again above it.
      el.toggleAttribute('data-on', (at[1]?.top ?? 0) <= window.innerHeight * 0.5)
    }
    const later = () => {
      if (!frame) frame = requestAnimationFrame(read)
    }
    read()
    window.addEventListener('scroll', later, { passive: true })
    window.addEventListener('resize', later)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', later)
      window.removeEventListener('resize', later)
    }
  }, [])
  return (
    <p ref={pill} className={s.altitude} aria-hidden="true">
      Alt <b ref={km}>{KM.hero.toFixed(1)}</b> km
    </p>
  )
}
