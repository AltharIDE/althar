import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { VisuallyHidden } from '../VisuallyHidden/VisuallyHidden'
import s from './Spinner.module.css'

export type SpinnerProps = RootProps<
  'span',
  {
    size?: 'small' | 'medium' | 'large'
    /** onFill: white, on a violet or ink surface. */
    tone?: 'live' | 'onFill'
    /** Say what is in progress when nothing next to the spinner does. Without it the spinner is decoration. */
    label?: string
  }
>

/** Work in motion, in cobalt. With a label it is a status, and the label is its text. */
export function Spinner({ size = 'medium', tone = 'live', label, className, ...rest }: SpinnerProps) {
  const wheel = (
    <span className={cx(s.spin, s[size], tone === 'onFill' && s.onFill, className)} aria-hidden="true" {...(label ? {} : rest)} />
  )
  if (!label) return wheel
  return (
    <span role="status" {...rest}>
      {wheel}
      <VisuallyHidden>{label}</VisuallyHidden>
    </span>
  )
}
