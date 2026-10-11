import type { ComponentProps } from 'react'

import { cx } from '../../lib/cx'
import s from './Field.module.css'

export interface FieldProps extends Omit<ComponentProps<'input'>, 'size'> {
  /** large: a name you are giving something, set like a title. */
  size?: 'default' | 'large'
  /** What is in it will not do. Point aria-describedby at the words that say why. */
  invalid?: boolean
}

/**
 * One line of text to type: a note, a URL, a name. Paper with a hairline,
 * and violet while you type in it. It needs a name: a label pointing at
 * it, or an aria-label.
 */
export function Field({ size = 'default', invalid = false, className, type = 'text', ...rest }: FieldProps) {
  return (
    <input type={type} aria-invalid={invalid || undefined} className={cx(s.field, s[size], invalid && s.invalid, className)} {...rest} />
  )
}

export interface TextAreaProps extends ComponentProps<'textarea'> {
  /** What is in it will not do. Point aria-describedby at the words that say why. */
  invalid?: boolean
}

/**
 * Several lines of text to type, as a Field is one: what happened, a longer
 * note. It grows from `rows` as the person drags its corner. It needs a name,
 * as a Field does.
 */
export function TextArea({ invalid = false, className, rows = 4, ...rest }: TextAreaProps) {
  return (
    <textarea rows={rows} aria-invalid={invalid || undefined} className={cx(s.field, s.area, invalid && s.invalid, className)} {...rest} />
  )
}

/** Why a Field's value will not do, under it. Give it an id and point the field's aria-describedby at it. */
export function FieldError({ id, children }: { id: string; children: ComponentProps<'span'>['children'] }) {
  return (
    <span id={id} className={s.error} role="alert">
      {children}
    </span>
  )
}
