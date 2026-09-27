import { cx } from '../../lib/cx'
import s from './LiveDot.module.css'

export interface LiveDotProps {
  /** ping: a ring goes out from it, slowly. For something listening or running. */
  ping?: boolean
  /** Faster, for a moment: something just arrived. */
  urgent?: boolean
  /** Breathing and a size smaller: new things waiting, below. */
  pulse?: boolean
  className?: string
}

/** Something live: running, or listening. Cobalt, and decoration only. */
export function LiveDot({ ping = false, urgent = false, pulse = false, className }: LiveDotProps) {
  return <span className={cx(s.dot, ping && s.ping, urgent && s.urgent, pulse && s.pulse, className)} aria-hidden="true" />
}
