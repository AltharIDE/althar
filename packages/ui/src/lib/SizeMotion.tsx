import { useLayoutEffect, useRef, type ReactNode } from 'react'

import { MOTION, reducedMotion } from './motion'

/*
 * What holds content that changes size as it changes: a card going from its
 * rows to a walk in, a walk from its ways to a step. Its height glides from
 * where it was to where it is on the move spring, as what is on screen and
 * goes elsewhere does (ADR-069), and what arrives under a new `step` fades
 * in as an arrival does. The content is laid out at its new size at once;
 * only what holds it is drawn at the old height for the length of the
 * glide, clipped, with room for its shadows. With reduced motion it is its
 * new size at once, and nothing fades.
 */

export interface SizeMotionProps {
  /** What is on show, by name: a new one fades in. */
  step?: string
  className?: string
  children: ReactNode
}

/** Room past the edge, while it glides, for the shadows of what it holds. */
const SHADOWS = '12px'

export function SizeMotion({ step, className, children }: SizeMotionProps) {
  const outer = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const box = outer.current
    const content = inner.current
    if (!box || !content || typeof ResizeObserver === 'undefined') return
    let was: number | null = null
    let glide: Animation | null = null
    // Told after layout and before paint, so the old height is what is drawn first.
    const observer = new ResizeObserver(() => {
      const to = content.offsetHeight
      // Mid-glide, from where it is drawn now.
      const from = glide === null ? was : box.offsetHeight
      was = to
      if (from === null || Math.abs(from - to) < 1 || reducedMotion() || typeof box.animate !== 'function') return
      glide?.cancel()
      box.style.overflow = 'clip'
      box.style.setProperty('overflow-clip-margin', SHADOWS)
      const run = box.animate([{ height: `${from}px` }, { height: `${to}px` }], MOTION.move)
      glide = run
      const done = () => {
        if (glide !== run) return
        glide = null
        box.style.removeProperty('overflow')
        box.style.removeProperty('overflow-clip-margin')
      }
      run.addEventListener('finish', done)
      run.addEventListener('cancel', done)
    })
    observer.observe(content)
    return () => {
      observer.disconnect()
      glide?.cancel()
    }
  }, [])

  // A new step fades in where it is, before it is first drawn.
  const shown = useRef(step)
  useLayoutEffect(() => {
    if (shown.current === step) return
    shown.current = step
    const content = inner.current
    if (!content || reducedMotion() || typeof content.animate !== 'function') return
    content.animate(
      [
        { opacity: 0, transform: 'translateY(4px)' },
        { opacity: 1, transform: 'none' },
      ],
      MOTION.enter,
    )
  }, [step])

  return (
    <div ref={outer} className={className}>
      <div ref={inner}>{children}</div>
    </div>
  )
}
