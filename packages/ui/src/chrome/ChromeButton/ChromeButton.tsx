import { type ComponentProps, useId } from 'react'

import { Icon, type IconName } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import { Tooltip } from '../../primitives/HoverCard/HoverCard'
import { VisuallyHidden } from '../../primitives/VisuallyHidden/VisuallyHidden'
import s from './ChromeButton.module.css'

/*
 * A button in the window's chrome that opens something beside the work, or
 * over it: knowledge, artifacts, a task's graph. While what it opened is open
 * it says so (aria-expanded) and stays lit. In a narrow window it can drop its
 * label and keep only its glyph; the label then shows in a tooltip, and still
 * names it for assistive technology. Its key shows in the tooltip, never as a
 * chip on the bar, as the project's rooms say theirs. Something worth knowing
 * before it opens is a dot on it, said in the tooltip too.
 */

export interface ChromeButtonProps extends Omit<ComponentProps<'button'>, 'children' | 'title'> {
  icon: IconName
  label: string
  /** What it opened is open. A menu or popover it triggers sets this itself. */
  expanded?: boolean
  /** Only the glyph shows. */
  compact?: boolean
  /** Its shortcut, in its tooltip; the consumer binds it. */
  kbd?: string
  /**
   * Something about what it opens worth knowing before it opens, such as a
   * task's menu where the task goes otherwise than its project: a dot on the
   * button, said under its name in the tooltip and as its description.
   */
  mark?: string
  /** A small count after the label, such as what waits: it is for the eye, so the button's aria-label must say it too. */
  count?: number
}

export function ChromeButton({ icon, label, expanded, compact, kbd, mark, count, className, type = 'button', ...rest }: ChromeButtonProps) {
  const markId = useId()
  const button = (
    <button
      type={type}
      className={cx(s.button, compact && s.compact, mark !== undefined && s.marked, className)}
      aria-expanded={expanded}
      aria-label={compact ? label : undefined}
      aria-describedby={mark === undefined ? undefined : markId}
      {...rest}
    >
      <Icon name={icon} size={13} />
      {!compact && <span>{label}</span>}
      {count !== undefined && count > 0 && (
        <span className={s.count} aria-hidden="true">
          {count}
        </span>
      )}
      {mark !== undefined && <VisuallyHidden id={markId}>{mark}</VisuallyHidden>}
    </button>
  )
  // Its words are on it, with nothing more to say: no tooltip.
  if (!compact && kbd === undefined && mark === undefined) return button
  return (
    <Tooltip
      label={
        mark === undefined ? (
          label
        ) : (
          <span className={s.said}>
            <span>{label}</span>
            <span className={s.mark}>{mark}</span>
          </span>
        )
      }
      kbd={kbd}
      placement="below"
    >
      {button}
    </Tooltip>
  )
}
