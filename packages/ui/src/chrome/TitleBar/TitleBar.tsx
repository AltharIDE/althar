import type { ReactNode } from 'react'

import { cx } from '../../lib/cx'
import s from './TitleBar.module.css'

/*
 * The window's own bar. On macOS the system draws the traffic lights over
 * it, so the bar keeps their space clear; `lights="drawn"` draws stand-ins,
 * for stories and prototypes that run in a browser. What the bar holds is
 * the consumer's: the project, the rooms, the work's status, the panels.
 * Its empty stretches drag the window.
 */

export interface TitleBarProps {
  /** From the left, after the lights. */
  children: ReactNode
  /** At the right end. */
  end?: ReactNode
  /** space: leave room for the system's lights. drawn: draw stand-ins. none: no room. */
  lights?: 'space' | 'drawn' | 'none'
  className?: string
}

export function TitleBar({ children, end, lights = 'space', className }: TitleBarProps) {
  return (
    <header className={cx(s.bar, className)} data-drag="">
      {lights !== 'none' && (
        <span className={cx(s.lights, lights === 'drawn' && s.drawn)} aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      )}
      <div className={s.start}>{children}</div>
      {end && <div className={s.end}>{end}</div>}
    </header>
  )
}

/** A thin rule between groups in the bar. */
export const TitleBarRule = () => <span className={s.rule} aria-hidden="true" />
