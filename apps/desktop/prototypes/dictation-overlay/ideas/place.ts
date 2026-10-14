// Throwaway: where the screen's own composer is, so what floats sits just above it rather than over it.
import { useEffect, useState } from 'react'

/** How far up from the bottom of `within` the screen's composer reaches, plus a gap; the gap alone where there is none. */
export const useAboveComposer = (within: HTMLElement | null, gap = 14) => {
  const [bottom, setBottom] = useState(gap + 6)
  useEffect(() => {
    const measure = () => {
      const area = within?.getBoundingClientRect()
      // The screen's own composer, never the overlay's (C is a composer too).
      const composer = [...document.querySelectorAll('[data-tray-host]')]
        .find((one) => one.closest('[data-overlay]') === null)
        ?.getBoundingClientRect()
      const next =
        area === undefined || composer === undefined || composer.height === 0 ? gap + 6 : Math.max(gap, area.bottom - composer.top + gap)
      setBottom((was) => (Math.abs(was - next) < 1 ? was : next))
    }
    measure()
    const id = window.setInterval(measure, 250)
    window.addEventListener('resize', measure)
    return () => {
      window.clearInterval(id)
      window.removeEventListener('resize', measure)
    }
  }, [within, gap])
  return bottom
}
