import { springEasing } from '@althar/ui/opening'
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from 'react'

import { useSeen } from '../home/bodies/kit/seen'
import { cx } from '../lib/cx'
import s from './parts.module.css'

/* What the about page's sections share: holding still when asked, a clock in steps, words that rise in once seen, and the light's columns. */

/** With reduced motion, or `?t` in the address for a still frame, everything stands where it ends. */
export const still = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia('(prefers-reduced-motion: reduce)').matches || new URLSearchParams(window.location.search).has('t'))

/** How many of `times` (ms after opening) have passed: a sequence's clock. Held still, all of them at once. */
export function useSteps(times: readonly number[]) {
  const [step, setStep] = useState(() => (still() ? times.length : 0))
  useEffect(() => {
    if (still()) return
    const timers = times.map((t, i) => window.setTimeout(() => setStep(i + 1), t))
    return () => timers.forEach((t) => window.clearTimeout(t))
  }, [times])
  return step
}

/** Its children rise into place once a quarter of it has been seen, each `[data-rise]` a step after the last. */
export function Rise({
  children,
  className,
  as: Tag = 'div',
  step = 90,
}: {
  children: ReactNode
  className?: string
  as?: 'div' | 'section'
  step?: number
}) {
  const box = useRef<HTMLDivElement>(null)
  const seen = useSeen(box, 0.25)
  useEffect(() => {
    const el = box.current
    if (!el || !seen) return
    const rise = springEasing(0.8, 0.86)
    el.querySelectorAll<HTMLElement>('[data-rise]').forEach((piece, i) => {
      if (still()) return void (piece.style.opacity = '1')
      piece.animate(
        [
          { opacity: 0, transform: 'translateY(26px)', filter: 'blur(6px)' },
          { opacity: 1, transform: 'none', filter: 'blur(0)' },
        ],
        { duration: rise.duration + 200, easing: rise.easing, delay: i * step, fill: 'both' },
      )
    })
  }, [seen, step])
  return (
    <Tag ref={box} className={cx(s.rise, className)}>
      {children}
    </Tag>
  )
}

export type Tones = readonly [string, string, string]

/** The light's colours, bottom to top, as the site's light grades them (shared/light.ts): the deep heart, sky, pale and warm. */
export const TONES = {
  heart: ['#2b3bff', '#3042ff', '#6372ff'],
  sky: ['#5aa2ff', '#a2cfff', '#e6f1ff'],
  pale: ['#9fc6ff', '#d4e6ff', '#f3f7ff'],
  warm: ['#ffc4a6', '#ffdeca', '#fff5ee'],
} as const satisfies Record<string, Tones>

/**
 * One column of the light, drawn in CSS: soft, round at its top, standing on
 * its floor. It rises once `risen`, after `--after`, to `--h` of its box, and
 * then breathes. Decoration.
 */
export function Column({ tones, risen, style }: { tones: Tones; risen: boolean; style?: CSSProperties }) {
  return (
    <span
      className={cx(s.column, risen && s.columnUp)}
      style={{ '--c0': tones[0], '--c1': tones[1], '--c2': tones[2], ...style } as CSSProperties}
      aria-hidden="true"
    />
  )
}
