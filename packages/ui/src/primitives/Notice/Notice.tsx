import type { ReactNode } from 'react'

import { Icon, type IconName } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import s from './Notice.module.css'

/*
 * A short note at the head of a dialog or a section, about what is there as a
 * whole rather than any one field: that something is still experimental, or
 * not out yet. A quiet wash with a glyph, a line in ink and, where it helps, a
 * line under it. Not a problem: a problem says what went wrong (`Problem`).
 */

export interface NoticeProps {
  /** What it is about, in a line. */
  title: ReactNode
  /** What the person can do with it, where they need more than the line. */
  children?: ReactNode
  icon?: IconName
  className?: string
}

export function Notice({ title, children, icon = 'info', className }: NoticeProps) {
  return (
    <div className={cx(s.notice, className)} role="note">
      <Icon name={icon} size={14} className={s.mark} />
      <span className={s.words}>
        <span className={s.title}>{title}</span>
        {children !== undefined && <span className={s.body}>{children}</span>}
      </span>
    </div>
  )
}
