import type { ComponentProps, MouseEvent, ReactNode } from 'react'

import { Icon, type IconName } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import { Kbd } from '../Kbd/Kbd'
import { Spinner } from '../Spinner/Spinner'
import s from './Button.module.css'

export interface ButtonProps extends ComponentProps<'button'> {
  /**
   * default: raised paper. signal: violet, and only for answering something
   * that waits on a person. quiet: text only, for the lesser choice beside another.
   */
  variant?: 'default' | 'signal' | 'quiet'
  /** small: inside a row of a thread or a card, beside 11–12px text. */
  size?: 'medium' | 'small'
  icon?: IconName
  /** A shortcut shown after the label. */
  kbd?: string
  /** Working on it: stays focusable and says so, but ignores presses. */
  busy?: boolean
  children: ReactNode
}

export function Button({
  variant = 'default',
  size = 'medium',
  icon,
  kbd,
  busy = false,
  className,
  children,
  onClick,
  type = 'button',
  ...rest
}: ButtonProps) {
  const press = (e: MouseEvent<HTMLButtonElement>) => {
    if (busy) {
      e.preventDefault()
      return
    }
    onClick?.(e)
  }
  return (
    <button
      type={type}
      className={cx(s.button, s[variant], size === 'small' && s.small, busy && s.busy, className)}
      aria-busy={busy || undefined}
      aria-disabled={busy || undefined}
      onClick={press}
      {...rest}
    >
      {busy ? <Spinner size="small" tone={variant === 'signal' ? 'onFill' : 'live'} /> : icon && <Icon name={icon} size={12} />}
      <span>{children}</span>
      {kbd && <Kbd onFill={variant === 'signal'}>{kbd}</Kbd>}
    </button>
  )
}
