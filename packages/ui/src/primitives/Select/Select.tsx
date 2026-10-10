import { Select as S } from 'radix-ui'
import { type KeyboardEvent, useId, useRef, useState } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import { Field } from '../Field/Field'
import { useControlName } from '../FormRow/FormRow'
import { Popover } from '../Popover/Popover'
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
  /** A long list: it opens with a field to find a value by what it is called. */
  searchable?: boolean
  text?: Partial<SelectText>
}

export interface SelectText {
  search: string
  none: string
}

export const selectText: SelectText = { search: 'Search', none: 'Nothing matches' }

/**
 * One value from a list, in a field that opens the list. Built on Radix's
 * select: the list opens over the field with the value in place, arrows and
 * typeahead move in it, and it stays on screen. A long list is `searchable`:
 * it opens with a field above it, as a combobox, where typing narrows the
 * list, arrows move in what is left, and Return chooses.
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
  searchable = false,
  text,
}: SelectProps<V>) {
  const name = useControlName(label)
  if (searchable)
    return (
      <Searchable
        name={name}
        options={options}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        disabled={disabled}
        variant={variant}
        width={width}
        id={id}
        className={className}
        {...(open === undefined ? {} : { open })}
        {...(defaultOpen === undefined ? {} : { defaultOpen })}
        {...(onOpenChange === undefined ? {} : { onOpenChange })}
        t={{ ...selectText, ...text }}
      />
    )
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

interface SearchableProps<V extends string> extends Pick<
  SelectProps<V>,
  'options' | 'value' | 'onChange' | 'placeholder' | 'disabled' | 'width' | 'id' | 'className' | 'open' | 'defaultOpen' | 'onOpenChange'
> {
  name: ReturnType<typeof useControlName>
  variant: 'quiet' | 'filled'
  t: SelectText
}

/* The list behind a field that finds in it: a combobox over a listbox. */
function Searchable<V extends string>({
  name,
  options,
  value,
  onChange,
  placeholder,
  disabled,
  variant,
  width,
  id,
  className,
  open: given,
  defaultOpen = false,
  onOpenChange,
  t,
}: SearchableProps<V>) {
  // Open as the consumer says where it says, else as the person leaves it; either way the consumer hears of each change.
  const [own, setOwn] = useState(defaultOpen)
  const open = given ?? own
  const setOpen = (next: boolean) => {
    setOwn(next)
    onOpenChange?.(next)
  }
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listId = useId()
  const list = useRef<HTMLDivElement>(null)
  const found = options.filter((option) => option.label.toLowerCase().includes(query.trim().toLowerCase()))
  const chosen = options.find((option) => option.value === value)
  const at = Math.min(active, Math.max(found.length - 1, 0))
  const optionId = (index: number) => `${listId}-${index}`
  const choose = (option: SelectOption<V> | undefined) => {
    if (option === undefined || option.disabled === true) return
    onChange(option.value)
    setOpen(false)
  }
  const move = (to: number) => {
    setActive(to)
    list.current?.querySelector(`#${CSS.escape(optionId(to))}`)?.scrollIntoView({ block: 'nearest' })
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') move(Math.min(at + 1, found.length - 1))
    else if (event.key === 'ArrowUp') move(Math.max(at - 1, 0))
    else if (event.key === 'Enter') choose(found[at])
    else return
    event.preventDefault()
  }
  const accessibleName = name['aria-label']
  return (
    <Popover
      label={accessibleName ?? t.search}
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) return
        // Opens on the value chosen, with nothing typed.
        setQuery('')
        setActive(chosen === undefined ? 0 : options.indexOf(chosen))
      }}
      padded={false}
      className={s.searchable}
      trigger={
        <button
          type="button"
          id={id}
          {...name}
          disabled={disabled}
          data-state={open ? 'open' : 'closed'}
          className={cx(s.trigger, s[variant], className)}
          style={width ? { width } : undefined}
        >
          <span className={chosen === undefined ? s.placeholder : undefined}>{chosen?.label ?? placeholder}</span>
          <span className={s.chev}>
            <Icon name="chevronD" size={9} />
          </span>
        </button>
      }
    >
      <div className={s.find}>
        <Field
          role="combobox"
          aria-label={t.search}
          placeholder={t.search}
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={found.length === 0 ? undefined : optionId(at)}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setActive(0)
          }}
          onKeyDown={onKeyDown}
        />
      </div>
      <div ref={list} id={listId} role="listbox" aria-label={accessibleName ?? t.search} className={s.options}>
        {found.length === 0 && <div className={s.none}>{t.none}</div>}
        {found.map((option, index) => (
          // A press chooses; focus stays in the field, which owns the keys.
          <div
            key={option.value}
            id={optionId(index)}
            role="option"
            aria-selected={option.value === value}
            aria-disabled={option.disabled === true || undefined}
            data-active={index === at || undefined}
            className={s.item}
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => setActive(index)}
            onClick={() => choose(option)}
          >
            {option.label}
            {option.value === value && (
              <span className={s.check}>
                <Icon name="check" size={11} />
              </span>
            )}
          </div>
        ))}
      </div>
    </Popover>
  )
}
