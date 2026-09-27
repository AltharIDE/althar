import { Checkbox } from 'radix-ui'
import { useId } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import { VisuallyHidden } from '../VisuallyHidden/VisuallyHidden'
import s from './CheckList.module.css'

export interface CheckItem {
  id: string
  label: string
}

export interface CheckListProps {
  /** What the list is, for a screen reader. */
  label: string
  items: readonly CheckItem[]
  /** The ids that are on. */
  value: readonly string[]
  onChange: (value: readonly string[]) => void
  /** The whole list, while something else overrides it. */
  disabled?: boolean
  className?: string
}

/** A few independent switches, each a row you can click anywhere on. Radix checkboxes in a fieldset, so disabling the list disables each one. */
export function CheckList({ label, items, value, onChange, disabled, className }: CheckListProps) {
  const base = useId()
  return (
    <fieldset disabled={disabled} className={cx(s.list, disabled && s.off, className)}>
      <VisuallyHidden as="legend">{label}</VisuallyHidden>
      {items.map((item) => {
        const id = `${base}-${item.id}`
        const on = value.includes(item.id)
        return (
          <label key={item.id} htmlFor={id} className={s.row}>
            <Checkbox.Root
              id={id}
              checked={on}
              onCheckedChange={(next) => onChange(next === true ? [...value, item.id] : value.filter((x) => x !== item.id))}
              className={s.box}
            >
              <Checkbox.Indicator className={s.tick}>
                <Icon name="check" size={10} />
              </Checkbox.Indicator>
            </Checkbox.Root>
            <span>{item.label}</span>
          </label>
        )
      })}
    </fieldset>
  )
}
