import { cx } from '../../lib/cx'
import s from './Spinner.module.css'

export interface SpinnerProps {
  size?: 'small' | 'medium' | 'large'
  /** onFill: white, on a violet or ink surface. */
  tone?: 'live' | 'onFill'
  /** Say what is in progress when nothing next to the spinner does. Without it the spinner is decoration. */
  label?: string
  className?: string
}

/** Work in motion, in cobalt. */
export function Spinner({ size = 'medium', tone = 'live', label, className }: SpinnerProps) {
  return (
    <span
      className={cx(s.spin, s[size], tone === 'onFill' && s.onFill, className)}
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  )
}
