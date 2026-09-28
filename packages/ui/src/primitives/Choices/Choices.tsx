import { RadioGroup } from 'radix-ui'

import { cx } from '../../lib/cx'
import { useControlName } from '../FormRow/FormRow'
import s from './Choices.module.css'

export interface ChoiceOption<V extends string> {
  value: V
  title: string
  /** What choosing it means, under the title. */
  note?: string
  disabled?: boolean
}

export interface ChoicesProps<V extends string> {
  /** What is being chosen. Leave it out inside a FormRow, which names it. */
  label?: string
  options: readonly ChoiceOption<V>[]
  /** The value chosen, or null for none yet. */
  value: V | null
  onChange: (value: V) => void
  id?: string
  /** More that describes the group, such as an error under it; joined to what a FormRow gives. */
  'aria-describedby'?: string
  className?: string
}

/**
 * One of a few choices, each with a line on what it means, stacked. A radio
 * group from Radix, like Segmented: one tab stop, arrows move and choose.
 * For a setting that is read once and changed rarely; Segmented is for a
 * choice made in passing.
 */
export function Choices<V extends string>({
  label,
  options,
  value,
  onChange,
  id,
  'aria-describedby': describedBy,
  className,
}: ChoicesProps<V>) {
  const name = useControlName(label)
  const described = [name['aria-describedby'], describedBy].filter(Boolean).join(' ') || undefined
  return (
    <RadioGroup.Root
      id={id}
      {...name}
      aria-describedby={described}
      value={value ?? ''}
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
