import { cx } from '../../lib/cx'
import s from './Switch.module.css'

export interface SwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  /** Its name, when nothing on screen names it. */
  label?: string
  /** The id of the words that name it, when they are on screen. */
  labelledBy?: string
  /** The id of the line under its name. */
  describedBy?: string
  disabled?: boolean
  className?: string
}

/** On or off, for a setting that takes effect at once: ink when on, a well when off. */
export function Switch({ checked, onChange, label, labelledBy, describedBy, disabled, className }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={labelledBy === undefined ? label : undefined}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      disabled={disabled}
      className={cx(s.switch, className)}
      onClick={() => onChange(!checked)}
    >
      <span className={s.knob} aria-hidden="true" />
    </button>
  )
}
