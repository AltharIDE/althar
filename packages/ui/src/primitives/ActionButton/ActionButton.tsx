import type { ComponentProps, ReactNode } from 'react'

import { Icon, type IconName } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import { Kbd } from '../Kbd/Kbd'
import s from './ActionButton.module.css'

interface ActionButtonBase extends Omit<ComponentProps<'button'>, 'children'> {
  icon?: IconName
  /** A glyph after the label, such as the chevron of something that opens a menu. */
  trailingIcon?: IconName
  kbd?: string
  /** strong: the one action on a row that matters most, in violet. onDark: on an ink surface. */
  tone?: 'default' | 'strong' | 'onDark'
  /** small: inside a line of 11–12px text, such as a step's row or a card's foot. */
  size?: 'medium' | 'small'
  /** Pulls the button out by its padding, so its label lines up with the edge of the text beside it. */
  flush?: 'start' | 'end'
}

/** With a label it names itself; with only an icon it must be given an aria-label. */
export type ActionButtonProps = ActionButtonBase & ({ children: ReactNode } | { children?: undefined; 'aria-label': string })

/**
 * A small action on a message, a block or a row: copy, quote, open. With
 * only an icon it must be given an aria-label, and the type says so.
 */
export function ActionButton({
  icon,
  trailingIcon,
  kbd,
  tone = 'default',
  size = 'medium',
  flush,
  className,
  children,
  type = 'button',
  ...rest
}: ActionButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        s.action,
        s[tone],
        size === 'small' && s.small,
        !children && s.iconOnly,
        flush === 'start' && s.flushStart,
        flush === 'end' && s.flushEnd,
        className,
      )}
      {...rest}
    >
      {icon && <Icon name={icon} size={12} />}
      {children && <span>{children}</span>}
      {trailingIcon && <Icon name={trailingIcon} size={10} />}
      {kbd && <Kbd onFill={tone === 'onDark'}>{kbd}</Kbd>}
    </button>
  )
}
