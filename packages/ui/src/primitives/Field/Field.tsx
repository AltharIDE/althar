import type { ComponentProps } from 'react'

import { cx } from '../../lib/cx'
import s from './Field.module.css'

export interface FieldProps extends Omit<ComponentProps<'input'>, 'size'> {
  /** large: a name you are giving something, set like a title. */
  size?: 'default' | 'large'
}

/**
 * One line of text to type: a note, a URL, a name. Paper with a hairline,
 * and violet while you type in it. It needs a name: a label pointing at
 * it, or an aria-label.
 */
export function Field({ size = 'default', className, type = 'text', ...rest }: FieldProps) {
  return <input type={type} className={cx(s.field, s[size], className)} {...rest} />
}
