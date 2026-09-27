import { RadioGroup } from 'radix-ui'

import { cx } from '../../lib/cx'
import s from './Choices.module.css'

export interface ChoiceOption<V extends string> {
  value: V
  title: string
  /** What choosing it means, under the title. */
  note?: string
  disabled?: boolean
}

export interface ChoicesProps<V extends string> {
  /** What is being chosen. */
  label: string
  options: readonly ChoiceOption<V>[]
  value: V
  onChange: (value: V) => void
  className?: string
}

/**
 * One of a few choices, each with a line on what it means, stacked. A radio
 * group from Radix, like Segmented: one tab stop, arrows move and choose.
 * For a setting that is read once and changed rarely; Segmented is for a
 * choice made in passing.
 */
export function Choices<V extends string>({ label, options, value, onChange, className }: ChoicesProps<V>) {
  return (
    <RadioGroup.Root
      aria-label={label}
      value={value}
      onValueChange={(v) => {
        const picked = options.find((o) => o.value === v)
        if (picked) onChange(picked.value)
      }}
      orientation="vertical"
      loop
      className={cx(s.group, className)}
    >
      {options.map((o) => (
        <RadioGroup.Item key={o.value} value={o.value} disabled={o.disabled} className={s.option}>
          <span className={s.dot} aria-hidden="true" />
          <span className={s.title}>{o.title}</span>
          {o.note && <span className={s.note}>{o.note}</span>}
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  )
}
