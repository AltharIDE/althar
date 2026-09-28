import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import s from './LiveDot.module.css'

export type LiveDotProps = RootProps<
  'span',
  {
    /** ping: a ring goes out from it, slowly. For something listening or running. */
    ping?: boolean
    /** Faster, for a moment: something just arrived. */
    urgent?: boolean
    /** Breathing and a size smaller: new things waiting, below. */
    pulse?: boolean
  }
>

/** Something live: running, or listening. Cobalt, and decoration only: the words beside it say what is live. */
export function LiveDot({ ping = false, urgent = false, pulse = false, className, ...rest }: LiveDotProps) {
  return <span className={cx(s.dot, ping && s.ping, urgent && s.urgent, pulse && s.pulse, className)} aria-hidden="true" {...rest} />
}
