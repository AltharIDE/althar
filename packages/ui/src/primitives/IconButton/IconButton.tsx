import type { ComponentProps } from 'react'

import { Icon, type IconName } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import type { OverlayPlacement } from '../../lib/overlay'
import { Tooltip } from '../HoverCard/HoverCard'
import s from './IconButton.module.css'

export interface IconButtonProps extends Omit<ComponentProps<'button'>, 'children' | 'title'> {
  icon: IconName
  /** Required: an icon alone does not say what the button does. It is the button's name and its tooltip. */
  label: string
  /** A shortcut shown in the tooltip; the consumer binds it. */
  kbd?: string
  /** Where the tooltip opens. */
  tooltip?: OverlayPlacement
  size?: 'small' | 'medium'
  /** fill: the one strong button in a bar, in ink, like send. */
  tone?: 'default' | 'fill' | 'danger'
}

/** A button that shows only a glyph. Its label is its accessible name, and shows as a tooltip on hover or focus. */
export function IconButton({
  icon,
  label,
  kbd,
  tooltip = 'above',
  size = 'medium',
  tone = 'default',
  className,
  type = 'button',
  ...rest
}: IconButtonProps) {
  return (
    <Tooltip label={label} kbd={kbd} placement={tooltip}>
      <button type={type} aria-label={label} className={cx(s.button, s[size], s[tone], className)} {...rest}>
        <Icon name={icon} size={size === 'small' ? 11 : 14} />
      </button>
    </Tooltip>
  )
}
