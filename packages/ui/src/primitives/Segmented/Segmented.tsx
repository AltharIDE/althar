import { RadioGroup } from 'radix-ui'
import type { ReactElement } from 'react'

import { cx } from '../../lib/cx'
import { useControlName } from '../FormRow/FormRow'
import { Tooltip } from '../HoverCard/HoverCard'
import { Kbd } from '../Kbd/Kbd'
import { VisuallyHidden } from '../VisuallyHidden/VisuallyHidden'
import s from './Segmented.module.css'

export interface SegmentedOption<V extends string> {
  value: V
  label: string
  disabled?: boolean
  /** Its shortcut, shown after the label; the consumer binds it. */
  kbd?: string
  /** A tooltip: more of the option's name, and a shortcut it doesn't show. */
  tooltip?: { label: string; kbd?: string }
  /** A dot after the label: something new there, or something there waits on you (violet). */
  dot?: 'new' | 'yours'
  /** What the dot means, for assistive technology. */
  dotLabel?: string
}

export interface SegmentedProps<V extends string> {
  /** What is being chosen. Leave it out inside a FormRow, which names it. */
  label?: string
  options: readonly SegmentedOption<V>[]
  /** The one on; null for none yet, where something else has the place the choice is about. */
  value: V | null
  onChange: (value: V) => void
  id?: string
  className?: string
}

/**
 * A few choices side by side, one of them on. A radio group, from Radix: one
 * stop in the tab order, arrows move and choose, Home and End go to either
 * end, disabled choices are passed over.
 */
export function Segmented<V extends string>({ label, options, value, onChange, id, className }: SegmentedProps<V>) {
  const name = useControlName(label)
  return (
    <RadioGroup.Root
      id={id}
      {...name}
      value={value ?? ''}
      onValueChange={(v) => {
        const picked = options.find((o) => o.value === v)
        if (picked) onChange(picked.value)
      }}
      orientation="horizontal"
      loop
      className={cx(s.group, className)}
    >
      {options.map((o) => (
        <Tip key={o.value} tip={o.tooltip}>
          <RadioGroup.Item value={o.value} disabled={o.disabled} className={s.option}>
            {o.label}
            {o.dot && <span className={cx(s.dot, s[o.dot])} aria-hidden="true" />}
            {o.dotLabel && <VisuallyHidden>, {o.dotLabel}</VisuallyHidden>}
            {o.kbd && <Kbd className={s.kbd}>{o.kbd}</Kbd>}
          </RadioGroup.Item>
        </Tip>
      ))}
    </RadioGroup.Root>
  )
}

function Tip({ tip, children }: { tip?: { label: string; kbd?: string }; children: ReactElement }) {
  return tip ? (
    <Tooltip label={tip.label} kbd={tip.kbd}>
      {children}
    </Tooltip>
  ) : (
    children
  )
}
