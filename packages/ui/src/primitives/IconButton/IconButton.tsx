import type { ComponentProps } from 'react'

import { Icon, type IconName } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import type { OverlayAlign, OverlayPlacement } from '../../lib/overlay'
import { Tooltip } from '../HoverCard/HoverCard'
import { Spinner } from '../Spinner/Spinner'
import s from './IconButton.module.css'

export interface IconButtonProps extends Omit<ComponentProps<'button'>, 'children' | 'title'> {
  icon: IconName
  /** Required: an icon alone does not say what the button does. It is the button's name and its tooltip. */
  label: string
  /** A shortcut shown in the tooltip; the consumer binds it. */
  kbd?: string
  /** Where the tooltip opens. */
  tooltip?: OverlayPlacement
  /** Which of the button's edges the tooltip lines up with: its end, for a button at the end of a row. */
  tooltipAlign?: OverlayAlign
  /** Its tooltip kept shut, as while it is dragged. */
  tooltipShut?: boolean
  size?: 'small' | 'medium'
  /** fill: the one strong button in a bar, in ink, like send. */
  tone?: 'default' | 'fill' | 'danger'
  /** Its work is under way: the glyph turns into a spinner, and the button stays pressable. */
  busy?: boolean
  /** How far something it started has come, from 0 to 1: a hairline ring fills round the glyph. */
  progress?: number
}

/* the ring's radius in a 28-unit box, inside the medium button's edge */
const RING = 12.5

/** A button that shows only a glyph. Its label is its accessible name, and shows as a tooltip on hover or focus. */
export function IconButton({
  icon,
  label,
  kbd,
  tooltip = 'above',
  tooltipAlign = 'start',
  tooltipShut = false,
  size = 'medium',
  tone = 'default',
  className,
  type = 'button',
  busy = false,
  progress,
  ...rest
}: IconButtonProps) {
  const around = 2 * Math.PI * RING
  const done = progress === undefined ? null : Math.max(0, Math.min(1, progress))
  return (
    <Tooltip label={label} kbd={kbd} placement={tooltip} align={tooltipAlign} shut={tooltipShut}>
      <button type={type} aria-label={label} aria-busy={busy || undefined} className={cx(s.button, s[size], s[tone], className)} {...rest}>
        {done !== null && (
          <svg className={s.ring} viewBox="0 0 28 28" aria-hidden="true">
            <circle cx="14" cy="14" r={RING} className={s.ringTrack} />
            <circle cx="14" cy="14" r={RING} className={s.ringFill} strokeDasharray={around} strokeDashoffset={around * (1 - done)} />
          </svg>
        )}
        {busy ? (
          <Spinner size="small" tone={tone === 'fill' ? 'onFill' : 'live'} />
        ) : (
          <Icon name={icon} size={size === 'small' ? 11 : 14} />
        )}
      </button>
    </Tooltip>
  )
}
