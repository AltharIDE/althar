import type { ComponentProps } from 'react'

import { Icon, type IconName } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import { Kbd } from '../../primitives/Kbd/Kbd'
import s from './ChromeButton.module.css'

/*
 * A button in the window's chrome that opens something beside the work, or
 * over it: knowledge, artifacts, a task's graph. It stays pressed while what
 * it opened is open. In a narrow window it can drop its label and keep only
 * its glyph, still named for assistive technology.
 */

export interface ChromeButtonProps extends Omit<ComponentProps<'button'>, 'children'> {
  icon: IconName
  label: string
  /** What it opened is open. */
  pressed?: boolean
  /** Only the glyph shows. */
  compact?: boolean
  /** Its shortcut, shown after the label. */
  kbd?: string
}

export function ChromeButton({ icon, label, pressed, compact, kbd, className, type = 'button', ...rest }: ChromeButtonProps) {
  return (
    <button
      type={type}
      className={cx(s.button, compact && s.compact, className)}
      aria-pressed={pressed ?? undefined}
      aria-label={compact ? label : undefined}
      {...rest}
    >
      <Icon name={icon} size={13} />
      {!compact && <span>{label}</span>}
      {!compact && kbd && <Kbd>{kbd}</Kbd>}
    </button>
  )
}
