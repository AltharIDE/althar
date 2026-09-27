import type { ReactNode } from 'react'

import { cx } from '../../lib/cx'
import s from './Thread.module.css'

/**
 * A conversation's column: a new turn is 30px from the last, and everything
 * inside a turn is 14px from what comes before it. Turns and messages are
 * articles in a feed, so a screen reader can move between them.
 */
export function Thread({ children, label, busy, className }: { children: ReactNode; label: string; busy?: boolean; className?: string }) {
  return (
    <div role="feed" aria-label={label} aria-busy={busy || undefined} className={cx(s.thread, className)}>
      {children}
    </div>
  )
}

/** The column's width and gutters, shared by the thread and its composer so they line up. */
export function Measure({ children, wide, className }: { children: ReactNode; wide?: boolean; className?: string }) {
  return <div className={cx(s.measure, wide && s.wide, className)}>{children}</div>
}
