import { useEffect, useRef } from 'react'

import s from './Story.module.css'

/*
 * The way down, counted: a pill in the corner with the altitude of the scene
 * across the window's middle, eased between scenes as you scroll. It comes
 * in once the first screen is behind you.
 */

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
      const vh = window.innerHeight
      const at = scenes.map((x) => ({ top: x.getBoundingClientRect().top, km: Number(x.dataset.km) }))
      let value = at[0]?.km ?? 0
      for (let i = 0; i < at.length; i++) {
        const a = at[i]!
        const b = at[i + 1]
        if (a.top > vh * 0.5) continue
        value = a.km
        if (b) value = a.km + (b.km - a.km) * Math.min(1, Math.max(0, (vh * 0.5 - a.top) / Math.max(1, b.top - a.top)))
      }
      out.textContent = value.toFixed(1)
      el.toggleAttribute('data-on', window.scrollY > vh * 0.6)
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
      Alt <b ref={km}>38.0</b> km
    </p>
  )
}
