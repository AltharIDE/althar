// Throwaway: where the screen's own composer is, so what floats sits just above it rather than over it.
import { useEffect, useState } from 'react'

/** The screen's own composer, never the overlay's (C is a composer too). */
const screenComposer = () =>
  [...document.querySelectorAll<HTMLElement>('[data-tray-host]')].find((one) => one.closest('[data-overlay]') === null)

/** How far up from the bottom of `within` the screen's composer reaches, plus a gap; the gap alone where there is none. */
export const useAboveComposer = (within: HTMLElement | null, gap = 14) => {
  const [bottom, setBottom] = useState(gap + 6)
  useEffect(() => {
    const measure = () => {
      const area = within?.getBoundingClientRect()
      const composer = screenComposer()?.getBoundingClientRect()
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

/**
 * The composer and the pills over it (Running, Listening), from the bottom
 * left of `within`: where the composer's top is, its left and right, and the
 * stack of pills: its top, and where its lowest row ends. The pills are the
 * composer's own `above`, a row that wraps upward when they don't fit.
 */
export interface Edges {
  readonly composer: { readonly left: number; readonly right: number; readonly top: number } | null
  readonly pills: {
    readonly element: HTMLElement
    readonly top: number
    /** Where the lowest row of pills ends, left to right. */
    readonly rowEnd: number
    readonly rows: number
  } | null
}

const NONE: Edges = { composer: null, pills: null }

const same = (a: Edges, b: Edges) =>
  JSON.stringify({ ...a, pills: a.pills && { ...a.pills, element: 0 } }) ===
    JSON.stringify({ ...b, pills: b.pills && { ...b.pills, element: 0 } }) && a.pills?.element === b.pills?.element

export const useEdges = (within: HTMLElement | null): Edges => {
  const [edges, setEdges] = useState<Edges>(NONE)
  useEffect(() => {
    const measure = () => {
      const area = within?.getBoundingClientRect()
      const host = screenComposer()
      const box = host?.getBoundingClientRect()
      if (area === undefined || host === undefined || box === undefined || box.height === 0)
        return setEdges((was) => (same(was, NONE) ? was : NONE))
      // The composer's form, not the stack: the pills hang above the stack's top.
      const form = host.querySelector('form')?.getBoundingClientRect() ?? box
      const composer = { left: form.left - area.left, right: form.right - area.left, top: area.bottom - form.top }
      const element = host.querySelector<HTMLElement>(':scope > [class*="above"]')
      const own = element === null ? [] : [...element.children].filter((child) => !child.hasAttribute('data-overlay'))
      const boxes = own.map((child) => child.getBoundingClientRect()).filter((one) => one.width > 0)
      const lowest = Math.max(...boxes.map((one) => one.bottom))
      const pills =
        element === null || boxes.length === 0
          ? null
          : {
              element,
              top: area.bottom - Math.min(...boxes.map((one) => one.top)),
              rowEnd: Math.max(...boxes.filter((one) => Math.abs(one.bottom - lowest) < 2).map((one) => one.right)) - area.left,
              rows: new Set(boxes.map((one) => Math.round(one.bottom))).size,
            }
      const next = { composer, pills }
      setEdges((was) => (same(was, next) ? was : next))
    }
    measure()
    const id = window.setInterval(measure, 200)
    window.addEventListener('resize', measure)
    return () => {
      window.clearInterval(id)
      window.removeEventListener('resize', measure)
    }
  }, [within])
  return edges
}
