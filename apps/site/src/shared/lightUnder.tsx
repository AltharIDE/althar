import { type RefObject, useEffect, useState, useSyncExternalStore } from 'react'

import { cx } from '../lib/cx'
import s from './lightUnder.module.css'

/*
 * Where the page is dark enough for the nav to turn to smoked glass over
 * it, with white words. A dark section (the homepage's first screen, its
 * dark bodies, the night window the other pages open on) lays a LightUnder
 * of tone `ink` over itself; one standing in Althar's light lays one of tone
 * `light`. The nav asks useLightUnder
 * what is under it: the light, ink, or (where there is neither) nothing,
 * and over paper it stays clear.
 */

/** What is under the nav where it is dark: Althar's light, or a dark section. */
export type Under = 'light' | 'ink'

const marks = new Set<HTMLElement>()
const listeners = new Set<() => void>()
let version = 0
const changed = () => {
  version++
  for (const on of listeners) on()
}
const subscribe = (on: () => void) => {
  listeners.add(on)
  return () => void listeners.delete(on)
}

/**
 * The part of its head the light stands strong in. The head places it (its
 * `top`, in the head's own CSS) and clips it: it reaches far below, and the
 * head's `overflow: hidden` ends it at the head's foot. A dark section gives
 * it `tone="ink"` and places it over the whole of itself.
 */
export function LightUnder({ tone = 'light', className }: { tone?: Under; className?: string }) {
  return (
    <span
      data-under={tone}
      ref={(node) => {
        if (!node) return
        marks.add(node)
        changed()
        return () => {
          marks.delete(node)
          changed()
        }
      }}
      className={cx(s.under, className)}
      aria-hidden="true"
    />
  )
}

/**
 * What LightUnder is under `ref`, if any: its tone. The bar asks about a line
 * through its middle. The phone's menu passes `span`, and asks about the
 * whole of its card, so it takes the ground it actually covers. None in the
 * prerender and while the page hydrates.
 */
export function useLightUnder(ref: RefObject<HTMLElement | null>, span = false) {
  const known = useSyncExternalStore(
    subscribe,
    () => version,
    () => 0,
  )
  const [lit, setLit] = useState<Under | null>(null)
  useEffect(() => {
    const bar = ref.current
    if (!bar || !marks.size) return setLit(null)
    let watch: IntersectionObserver | undefined
    const cover = new Map<Element, number>()
    const start = () => {
      watch?.disconnect()
      cover.clear()
      const box = bar.getBoundingClientRect()
      // The bar: a line one pixel tall across its middle. The menu: its own box, so a card hanging into the light is the light even while the bar is still on paper.
      const top = span ? Math.max(0, Math.round(box.top)) : Math.round(box.top + box.height / 2)
      const bottom = span ? Math.min(window.innerHeight, Math.round(box.bottom)) : top + 1
      if (bottom - top < 1) return setLit(null)
      watch = new IntersectionObserver(
        (entries) => {
          for (const e of entries) cover.set(e.target, e.isIntersecting ? e.intersectionRect.height : 0)
          let best: Element | undefined
          let most = 0
          for (const [el, h] of cover)
            if (h > most) {
              most = h
              best = el
            }
          setLit(best ? ((best as HTMLElement).dataset.under as Under) : null)
        },
        { rootMargin: `${-top}px 0px ${-(window.innerHeight - bottom)}px 0px` },
      )
      for (const mark of marks) watch.observe(mark)
    }
    start()
    window.addEventListener('resize', start)
    return () => {
      watch?.disconnect()
      window.removeEventListener('resize', start)
    }
  }, [ref, known, span])
  return lit
}
