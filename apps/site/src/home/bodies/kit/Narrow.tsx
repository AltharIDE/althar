import { type ReactNode, useEffect, useState } from 'react'

import s from './Narrow.module.css'
import { Shot } from './Shot'

/** Whether a media query matches, following it as it changes. False where there is no window (a server render). */
export function useMedia(query: string) {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches)
  useEffect(() => {
    const q = window.matchMedia(query)
    const on = () => setMatches(q.matches)
    on()
    q.addEventListener('change', on)
    return () => q.removeEventListener('change', on)
  }, [query])
  return matches
}

/** Whether the page is at most `px` wide: by default a phone's width, where pictures lay themselves out for it. */
export const useNarrow = (px = 699) => useMedia(`(max-width: ${px}px)`)

/*
 * On a phone, one of the app's windows as it lays itself out narrow: the
 * window alone on the page, at a width a phone can read, in place of a
 * whole desktop shrunk to fit. `h` is how much of it shows; the rest runs
 * on under the window's edge, as it would scroll.
 */
export function NarrowWindow({ children, label, h, w = 410 }: { children: ReactNode; label: string; h?: number; w?: number }) {
  return (
    <div className={s.wrap}>
      <Shot w={w} h={h} maxScale={1} label={label} frame={s.window}>
        {children}
      </Shot>
    </div>
  )
}
