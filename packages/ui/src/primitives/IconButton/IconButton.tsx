import type { ComponentProps } from 'react'

import { Icon, type IconName } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import s from './IconButton.module.css'

export interface IconButtonProps extends Omit<ComponentProps<'button'>, 'children'> {
  icon: IconName
  /** Required: an icon alone does not say what the button does. */
  label: string
  size?: 'small' | 'medium'
  /** fill: the one strong button in a bar, in ink, like send. */
  tone?: 'default' | 'fill' | 'danger'
}

export function IconButton({
  icon,
  label,
  size = 'medium',
  tone = 'default',
  className,
  type = 'button',
  title,
  ...rest
}: IconButtonProps) {
  return (
    <button type={type} aria-label={label} title={title ?? label} className={cx(s.button, s[size], s[tone], className)} {...rest}>
      <Icon name={icon} size={size === 'small' ? 11 : 14} />
    </button>
  )
}
