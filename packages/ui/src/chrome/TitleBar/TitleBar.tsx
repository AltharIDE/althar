import type { ReactNode } from 'react'

import { cx } from '../../lib/cx'
import { WindowButtons, type WindowButtonsText } from '../WindowButtons/WindowButtons'
import s from './TitleBar.module.css'

/*
 * The window's own bar. On macOS the system draws the traffic lights over
 * it, so the bar keeps their space clear; `lights="drawn"` draws the
 * window's own buttons there, wired to the window through `window`, for the
 * screens that have no tabs above them; without `window` — in stories and
 * prototypes — the same dots stand in, inert. What the bar holds is the
 * consumer's: the project, the rooms, the work's status, the panels. Its
 * empty stretches drag the window.
 */

export interface TitleBarWindow {
  readonly onClose: () => void
  readonly onMinimize: () => void
  readonly onToggleMaximize: () => void
  /** The window is maximized: the third button restores it. */
  readonly maximized?: boolean
}

export interface TitleBarProps {
  /** From the left, after the lights. */
  children: ReactNode
  /** At the right end. */
  end?: ReactNode
  /** space: leave room for the system's lights. drawn: draw the window's own buttons. none: no room. */
  lights?: 'space' | 'drawn' | 'none'
  /** With lights="drawn": the window's own buttons, wired to the window; without it, inert placeholders. */
  window?: TitleBarWindow
  /** The window buttons' own words (`WindowButtons`). */
  text?: Partial<WindowButtonsText>
  className?: string
}

export function TitleBar({ children, end, lights = 'space', window, text, className }: TitleBarProps) {
  return (
    <header className={cx(s.bar, className)} data-drag="">
      {lights === 'drawn' && window !== undefined ? (
        <WindowButtons
          onClose={window.onClose}
          onMinimize={window.onMinimize}
          onToggleMaximize={window.onToggleMaximize}
          {...(window.maximized === undefined ? {} : { maximized: window.maximized })}
          {...(text === undefined ? {} : { text })}
        />
      ) : (
        lights !== 'none' && (
          <span className={cx(s.lights, lights === 'drawn' && s.drawn)} aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        )
      )}
      <div className={s.start}>{children}</div>
      {end && <div className={s.end}>{end}</div>}
    </header>
  )
}

/** A thin rule between groups in the bar. */
export const TitleBarRule = () => <span className={s.rule} aria-hidden="true" />
