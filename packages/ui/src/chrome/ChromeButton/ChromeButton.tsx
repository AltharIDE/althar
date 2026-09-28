import type { ComponentProps } from 'react'

import { Icon, type IconName } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import { Tooltip } from '../../primitives/HoverCard/HoverCard'
import { Kbd } from '../../primitives/Kbd/Kbd'
import s from './ChromeButton.module.css'

/*
 * A button in the window's chrome that opens something beside the work, or
 * over it: knowledge, artifacts, a task's graph. While what it opened is open
 * it says so (aria-expanded) and stays lit. In a narrow window it can drop its
 * label and keep only its glyph; the label and key then show in a tooltip,
 * and still name it for assistive technology.
 */

export interface ChromeButtonProps extends Omit<ComponentProps<'button'>, 'children' | 'title'> {
  icon: IconName
  label: string
  /** What it opened is open. A menu or popover it triggers sets this itself. */
  expanded?: boolean
  /** Only the glyph shows. */
  compact?: boolean
  /** Its shortcut, shown after the label, or in the tooltip when compact. */
  kbd?: string
}

export function ChromeButton({ icon, label, expanded, compact, kbd, className, type = 'button', ...rest }: ChromeButtonProps) {
  const button = (
    <button
      type={type}
      className={cx(s.button, compact && s.compact, className)}
      aria-expanded={expanded}
      aria-label={compact ? label : undefined}
      {...rest}
    >
      <Icon name={icon} size={13} />
      {!compact && <span>{label}</span>}
      {!compact && kbd && <Kbd>{kbd}</Kbd>}
    </button>
  )
  if (!compact) return button
  return (
    <Tooltip label={label} kbd={kbd} placement="below">
      {button}
    </Tooltip>
  )
}
