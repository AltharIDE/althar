import type { ReactNode } from 'react'

import { cx } from '../../lib/cx'
import { dotControls, type WindowControls, WindowButtons, type WindowButtonsText } from '../WindowButtons/WindowButtons'
import s from './TitleBar.module.css'

/*
 * The window's own bar. On macOS the system draws the traffic lights over
 * it, so the bar keeps their space clear; `lights="drawn"` draws the
 * window's own buttons, wired to the window through `window`, for the
 * screens that have no tabs above them, in the manner, the order and at the
 * end `controls` says (the desktop's, ADR-096; Althar's dots at the start
 * where it says nothing); without `window` — in stories and prototypes —
 * they stand in, inert. What the bar holds is the
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
  /** With lights="drawn": which buttons, whose manner, at which end. */
  controls?: WindowControls
  /** The window buttons' own words (`WindowButtons`). */
  text?: Partial<WindowButtonsText>
  className?: string
}

export function TitleBar({ children, end, lights = 'space', window, controls = dotControls, text, className }: TitleBarProps) {
  const drawn = lights === 'drawn'
  // Althar's dots with no window to work keep their old placeholder: the dots alone, coloured as the bar is pointed at.
  const placeholder = drawn && window === undefined && controls.look === 'dots'
  const buttons = (side: 'start' | 'end') => {
    const names = controls[side]
    if (!drawn || placeholder || names.length === 0) return null
    return (
      <WindowButtons
        look={controls.look}
        {...(controls.tone === undefined ? {} : { tone: controls.tone })}
        buttons={names}
        side={side}
        {...(window === undefined
          ? {}
          : {
              onClose: window.onClose,
              onMinimize: window.onMinimize,
              onToggleMaximize: window.onToggleMaximize,
              ...(window.maximized === undefined ? {} : { maximized: window.maximized }),
            })}
        {...(text === undefined ? {} : { text })}
      />
    )
  }
  const endButtons = buttons('end')
  return (
    <header className={cx(s.bar, endButtons !== null && s[`end-${controls.look}`], className)} data-drag="">
      {lights === 'space' || placeholder ? (
        <span className={cx(s.lights, placeholder && s.drawn)} aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      ) : (
        buttons('start')
      )}
      <div className={s.start}>{children}</div>
      {end && <div className={s.end}>{end}</div>}
      {endButtons}
    </header>
  )
}

/** A thin rule between groups in the bar. */
export const TitleBarRule = () => <span className={s.rule} aria-hidden="true" />
