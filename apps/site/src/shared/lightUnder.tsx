import { type RefObject, useEffect, useState, useSyncExternalStore } from 'react'

import { cx } from '../lib/cx'
import s from './lightUnder.module.css'

/*
 * Where the light is strong enough for the nav to turn to smoked glass over
 * it. A head that stands in the light (the homepage's first screen, a Lit
 * head) lays a LightUnder over that part of itself, from just above its
 * words down past its foot, clipped by the head; the nav asks
 * useLightUnder whether one is under it. A page with no light has none, and
 * its nav stays clear.
 */

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
 * head's `overflow: hidden` ends it at the head's foot.
 */
export function LightUnder({ className }: { className?: string }) {
  return (
    <span
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

/** Whether a LightUnder is under the middle of `ref`'s box. False in the prerender and while the page hydrates. */
export function useLightUnder(ref: RefObject<HTMLElement | null>) {
  const known = useSyncExternalStore(
    subscribe,
    () => version,
    () => 0,
  )
  const [lit, setLit] = useState(false)
  useEffect(() => {
    const bar = ref.current
    if (!bar || !marks.size) return setLit(false)
    // A line one pixel tall across the window at the bar's middle; the observer says when a mark crosses it.
    let watch: IntersectionObserver | undefined
    const under = new Map<Element, boolean>()
    const start = () => {
      watch?.disconnect()
      under.clear()
      const box = bar.getBoundingClientRect()
      const middle = Math.round(box.top + box.height / 2)
      watch = new IntersectionObserver(
        (entries) => {
          for (const e of entries) under.set(e.target, e.isIntersecting)
          setLit([...under.values()].some(Boolean))
        },
        { rootMargin: `${-middle}px 0px ${-(window.innerHeight - middle - 1)}px 0px` },
      )
      for (const mark of marks) watch.observe(mark)
    }
    start()
    window.addEventListener('resize', start)
    return () => {
      watch?.disconnect()
      window.removeEventListener('resize', start)
    }
  }, [ref, known])
  return lit
}
