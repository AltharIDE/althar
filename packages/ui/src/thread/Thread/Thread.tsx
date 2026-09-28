import type { ReactNode } from 'react'

import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import s from './Thread.module.css'

export type ThreadProps = RootProps<
  'section',
  {
    children: ReactNode
    /** The conversation's name, for assistive technology. */
    label: string
    /** More is arriving (aria-busy). */
    busy?: boolean
  }
>

/**
 * A conversation's column: a new turn is 30px from the last, and everything
 * inside a turn is 14px from what comes before it. Turns and messages are
 * named articles, so a screen reader can move between them.
 */
export function Thread({ children, label, busy, className, ...rest }: ThreadProps) {
  return (
    <section aria-label={label} aria-busy={busy || undefined} className={cx(s.thread, className)} {...rest}>
      {children}
    </section>
  )
}

export type ThreadMeasureProps = RootProps<'div', { children: ReactNode; wide?: boolean }>

/** The column's width and gutters, shared by the thread and its composer so they line up. */
export function ThreadMeasure({ children, wide, className, ...rest }: ThreadMeasureProps) {
  return (
    <div className={cx(s.measure, wide && s.wide, className)} {...rest}>
      {children}
    </div>
  )
}
