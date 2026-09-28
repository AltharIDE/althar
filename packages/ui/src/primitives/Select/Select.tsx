import { Select as S } from 'radix-ui'

import { Icon } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import { useControlName } from '../FormRow/FormRow'
import s from './Select.module.css'

export interface SelectOption<V extends string> {
  value: V
  label: string
  disabled?: boolean
}

export interface SelectProps<V extends string> {
  /** What is being chosen; the trigger's accessible name. Leave it out inside a FormRow, which names it. */
  label?: string
  options: readonly SelectOption<V>[]
  /** The value chosen, or null for none yet, which shows the placeholder. */
  value: V | null
  onChange: (value: V) => void
  /** Shown while nothing is chosen. */
  placeholder?: string
  disabled?: boolean
  /** quiet: text until hovered, for a value in a row. filled: a field, for a choice inside a card. */
  variant?: 'quiet' | 'filled'
  /** The trigger's width; it does not grow with the value. */
  width?: number
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  id?: string
  className?: string
}

/**
 * One value from a short list, in a field that opens the list. Built on
 * Radix's select: the list opens over the field with the value in place,
 * arrows and typeahead move in it, and it stays on screen.
 */
export function Select<V extends string>({
  label,
  options,
  value,
  onChange,
  placeholder,
  disabled,
  variant = 'quiet',
  width,
  open,
  defaultOpen,
  onOpenChange,
  id,
  className,
}: SelectProps<V>) {
  const name = useControlName(label)
  return (
    <S.Root
      /* Radix shows the placeholder for an empty string, never for a value */
      value={value ?? ''}
      onValueChange={(v) => {
        const picked = options.find((o) => o.value === v)
        if (picked) onChange(picked.value)
      }}
      disabled={disabled}
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
    >
      <S.Trigger id={id} {...name} className={cx(s.trigger, s[variant], className)} style={width ? { width } : undefined}>
        <S.Value placeholder={placeholder} />
        <S.Icon className={s.chev}>
          <Icon name="chevronD" size={9} />
        </S.Icon>
      </S.Trigger>
      <S.Portal>
        <S.Content className={cx('ch-root', s.content)} position="popper" sideOffset={4} collisionPadding={8}>
          <S.Viewport>
            {options.map((o) => (
              <S.Item key={o.value} value={o.value} disabled={o.disabled} className={s.item}>
                <S.ItemText>{o.label}</S.ItemText>
                <S.ItemIndicator className={s.check}>
                  <Icon name="check" size={11} />
                </S.ItemIndicator>
              </S.Item>
            ))}
          </S.Viewport>
        </S.Content>
      </S.Portal>
    </S.Root>
  )
}
