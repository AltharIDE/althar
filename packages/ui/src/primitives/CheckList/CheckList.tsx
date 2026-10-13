import { Checkbox } from 'radix-ui'
import { type ReactNode, useId } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import { useControlName } from '../FormRow/FormRow'
import { VisuallyHidden } from '../VisuallyHidden/VisuallyHidden'
import s from './CheckList.module.css'

export interface CheckItem {
  id: string
  /** What it is: its box's name. */
  label: ReactNode
  /** Under it, quieter: where it comes from, or what it means. It describes the box. */
  detail?: ReactNode
}

export interface CheckListProps {
  /** What the list is, for a screen reader. Leave it out inside a FormRow, which names it. */
  label?: string
  items: readonly CheckItem[]
  /** The ids that are on. */
  value: readonly string[]
  onChange: (value: readonly string[]) => void
  /** The whole list, while something else overrides it. */
  disabled?: boolean
  /** At least one stays on: the last one on can't be turned off. */
  keepOne?: boolean
  className?: string
}

/** A few independent switches, each a row you can click anywhere on. Radix checkboxes in a fieldset, so disabling the list disables each one. */
export function CheckList({ label, items, value, onChange, disabled, keepOne = false, className }: CheckListProps) {
  const base = useId()
  const name = useControlName(label)
  /* the ids come back in the list's order, whatever order they were switched on in */
  const toggle = (id: string, on: boolean) => {
    const next = new Set(value)
    if (on) next.add(id)
    else next.delete(id)
    onChange(items.filter((i) => next.has(i.id)).map((i) => i.id))
  }
  return (
    <fieldset
      disabled={disabled}
      className={cx(s.list, disabled && s.off, className)}
      aria-labelledby={label === undefined ? name['aria-labelledby'] : undefined}
      aria-describedby={name['aria-describedby']}
    >
      {label !== undefined && <VisuallyHidden as="legend">{label}</VisuallyHidden>}
      {items.map((item) => {
        const id = `${base}-${item.id}`
        const on = value.includes(item.id)
        const labelId = `${id}-label`
        const detailId = `${id}-detail`
        return (
          <label key={item.id} htmlFor={id} className={cx(s.row, item.detail != null && s.two)}>
            <Checkbox.Root
              id={id}
              checked={on}
              disabled={keepOne && on && value.length === 1}
              onCheckedChange={(next) => toggle(item.id, next === true)}
              className={s.box}
              {...(item.detail == null ? {} : { 'aria-labelledby': labelId, 'aria-describedby': detailId })}
            >
              <Checkbox.Indicator className={s.tick}>
                <Icon name="check" size={10} />
              </Checkbox.Indicator>
            </Checkbox.Root>
            {item.detail == null ? (
              <span>{item.label}</span>
            ) : (
              <span className={s.text}>
                <span id={labelId}>{item.label}</span>
                <span id={detailId} className={s.detail}>
                  {item.detail}
                </span>
              </span>
            )}
          </label>
        )
      })}
    </fieldset>
  )
}
