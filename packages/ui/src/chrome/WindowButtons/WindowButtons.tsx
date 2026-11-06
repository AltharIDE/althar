import type { ReactNode } from 'react'

import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import s from './WindowButtons.module.css'

/*
 * The window's own buttons, where the system draws none: close, minimize,
 * and maximize or restore, in the manner of the desktop the window sits on
 * (ADR-096). Each look follows its desktop's conventions, its shapes,
 * sizes and hover, with glyphs of Althar's own, never the desktop's
 * artwork:
 *
 * - dots: Althar's own, the grey dots a Mac shows; the glyph and the colour
 *   come on hover and on focus.
 * - gnome: round, flat buttons with a faint disc that deepens on hover, as
 *   GNOME's header bars have.
 * - kde: thin glyphs, a chevron down to minimize and up to maximize, a disc
 *   on hover, red under close, as KDE's Breeze has.
 * - windows: rectangular caption buttons the bar's full height, red under
 *   close on hover, as Windows has.
 *
 * Every look's glyphs show at rest but the dots', which show on hover and on
 * focus; none says what it does by colour alone (WCAG 1.4.1), each is a
 * real button with its name, and a keyboard reaches each.
 */

export type WindowButtonsLook = 'dots' | 'gnome' | 'kde' | 'windows'

export type WindowButtonName = 'close' | 'minimize' | 'maximize'

/** A tuning of the GNOME look for a theme: adwaita (libadwaita's faint discs at rest), legacy (GTK 3's: a disc only as one is pointed at; an unknown desktop's too), yaru (Ubuntu's: an orange close). */
export type WindowButtonsTone = 'adwaita' | 'legacy' | 'yaru'

/** Which buttons a bar draws, whose manner, and at which end: as the desktop says (ADR-096). */
export interface WindowControls {
  readonly look: WindowButtonsLook
  readonly tone?: WindowButtonsTone
  /** At the bar's start, left to right. */
  readonly start: readonly WindowButtonName[]
  /** At the bar's end, left to right. */
  readonly end: readonly WindowButtonName[]
}

/** Althar's own: the dots, at the start, as a Mac has them; what a bar draws where it isn't told. */
export const dotControls: WindowControls = { look: 'dots', start: ['close', 'minimize', 'maximize'], end: [] }

export interface WindowButtonsText {
  close: string
  minimize: string
  maximize: string
  restore: string
}

export const windowButtonsText: WindowButtonsText = {
  close: 'Close the window',
  minimize: 'Minimize the window',
  maximize: 'Maximize the window',
  restore: 'Restore the window',
}

/** Which buttons each look shows where it isn't told: a Mac's order for the dots, close last for the others. */
export const defaultButtons = (look: WindowButtonsLook): readonly WindowButtonName[] =>
  look === 'dots' ? ['close', 'minimize', 'maximize'] : ['minimize', 'maximize', 'close']

export type WindowButtonsProps = RootProps<
  'span',
  {
    onClose?: () => void
    onMinimize?: () => void
    onToggleMaximize?: () => void
    /** The window is maximized: the maximize button restores it. */
    maximized?: boolean
    /** Whose manner they're drawn in. */
    look?: WindowButtonsLook
    /** With the GNOME look, the theme's tuning. */
    tone?: WindowButtonsTone
    /** Which show, in order; the look's own three where not given. */
    buttons?: readonly WindowButtonName[]
    /** Which end of the bar they're at: a look the bar's full height reaches its edge. */
    side?: 'start' | 'end'
    text?: Partial<WindowButtonsText>
  }
>

type Glyphs = Record<'close' | 'minimize' | 'maximize' | 'restore', ReactNode>

/* Drawn for each look on a 16-unit grid, by hand: strokes only, in the button's own colour. */
const GLYPHS: Record<WindowButtonsLook, Glyphs> = {
  dots: {
    close: <path d="m4 4 8 8M12 4l-8 8" />,
    minimize: <path d="M3 8h10" />,
    maximize: <rect x="3.5" y="3.5" width="9" height="9" rx="0.7" />,
    restore: <path d="M5 3h8v8M3 5v8h8" />,
  },
  gnome: {
    close: <path d="m5 5 6 6m0-6-6 6" />,
    minimize: <path d="M5 10.5h6" />,
    maximize: <rect x="4.75" y="4.75" width="6.5" height="6.5" rx="1.25" />,
    restore: (
      <>
        <path d="M6.5 4.25h4a1.25 1.25 0 0 1 1.25 1.25v4" />
        <rect x="4.25" y="6.5" width="5.25" height="5.25" rx="1.25" />
      </>
    ),
  },
  kde: {
    close: <path d="m5 5 6 6m0-6-6 6" />,
    minimize: <path d="m4.5 6.25 3.5 3.5 3.5-3.5" />,
    maximize: <path d="m4.5 9.75 3.5-3.5 3.5 3.5" />,
    restore: <path d="M8 4.25 11.75 8 8 11.75 4.25 8Z" />,
  },
  windows: {
    close: <path d="m3 3 10 10M13 3 3 13" />,
    minimize: <path d="M3 8.5h10" />,
    maximize: <rect x="3.5" y="3.5" width="9" height="9" rx="0.5" />,
    restore: (
      <>
        <path d="M5.5 3.5h7v7" />
        <rect x="3.5" y="5.5" width="7" height="7" rx="0.5" />
      </>
    ),
  },
}

export function WindowButtons({
  onClose,
  onMinimize,
  onToggleMaximize,
  maximized = false,
  look = 'dots',
  tone,
  buttons,
  side,
  text,
  className,
  ...rest
}: WindowButtonsProps) {
  const t = { ...windowButtonsText, ...text }
  const glyphs = GLYPHS[look]
  const shown = buttons ?? defaultButtons(look)
  const button = (name: WindowButtonName) => {
    const { label, onClick, glyph } =
      name === 'close'
        ? { label: t.close, onClick: onClose, glyph: glyphs.close }
        : name === 'minimize'
          ? { label: t.minimize, onClick: onMinimize, glyph: glyphs.minimize }
          : { label: maximized ? t.restore : t.maximize, onClick: onToggleMaximize, glyph: maximized ? glyphs.restore : glyphs.maximize }
    return (
      <button key={name} type="button" className={s[name]} aria-label={label} onClick={onClick}>
        <svg className={s.glyph} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          {glyph}
        </svg>
      </button>
    )
  }
  return (
    <span className={cx(look === 'dots' ? s.lights : s[look], className)} data-side={side} data-tone={tone} {...rest}>
      {shown.map(button)}
    </span>
  )
}
