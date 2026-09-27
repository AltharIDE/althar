import { RadioGroup } from 'radix-ui'

import { cx } from '../../lib/cx'
import { Kbd } from '../Kbd/Kbd'
import { VisuallyHidden } from '../VisuallyHidden/VisuallyHidden'
import s from './Segmented.module.css'

export interface SegmentedOption<V extends string> {
  value: V
  label: string
  disabled?: boolean
  /** Its shortcut, shown after the label; the consumer binds it. */
  kbd?: string
  /** A tooltip, like a shortcut the option doesn't show. */
  title?: string
  /** A dot after the label: something new there, or something there waits on you (violet). */
  dot?: 'new' | 'yours'
  /** What the dot means, for assistive technology. */
  dotLabel?: string
}

export interface SegmentedProps<V extends string> {
  /** What is being chosen. */
  label: string
  options: SegmentedOption<V>[]
  value: V
  onChange: (value: V) => void
  className?: string
}

/**
 * A few choices side by side, one of them on. A radio group, from Radix: one
 * stop in the tab order, arrows move and choose, Home and End go to either
 * end, disabled choices are passed over.
 */
export function Segmented<V extends string>({ label, options, value, onChange, className }: SegmentedProps<V>) {
  return (
    <RadioGroup.Root
      aria-label={label}
      value={value}
      onValueChange={(v) => {
        const picked = options.find((o) => o.value === v)
        if (picked) onChange(picked.value)
      }}
      orientation="horizontal"
      loop
      className={cx(s.group, className)}
    >
      {options.map((o) => (
        <RadioGroup.Item key={o.value} value={o.value} disabled={o.disabled} className={s.option} title={o.title}>
          {o.label}
          {o.dot && <span className={cx(s.dot, s[o.dot])} aria-hidden="true" />}
          {o.dotLabel && <VisuallyHidden>, {o.dotLabel}</VisuallyHidden>}
          {o.kbd && <Kbd className={s.kbd}>{o.kbd}</Kbd>}
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  )
}
