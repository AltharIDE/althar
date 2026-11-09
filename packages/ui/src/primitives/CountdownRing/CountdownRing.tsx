import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import s from './CountdownRing.module.css'

export type CountdownRingProps = RootProps<
  'svg',
  {
    /** How much of the wait is left, from 1 (all of it) to 0 (none). */
    left: number
  }
>

/**
 * A wait as a ring that empties: a plan's time before it starts on its own.
 * Decoration only: the words beside it carry the time. It moves from one
 * share to the next over a second, and jumps there with reduced motion.
 */
export function CountdownRing({ left, className, style, ...rest }: CountdownRingProps) {
  const r = 6.5
  const round = 2 * Math.PI * r
  const share = Math.min(1, Math.max(0, left))
  return (
    <svg
      className={cx(s.ring, className)}
      viewBox="0 0 16 16"
      width="16"
      height="16"
      aria-hidden="true"
      focusable="false"
      style={style}
      {...rest}
    >
      <circle cx="8" cy="8" r={r} className={s.track} />
      <circle cx="8" cy="8" r={r} className={s.left} style={{ strokeDasharray: round, strokeDashoffset: round * (1 - share) }} />
    </svg>
  )
}
