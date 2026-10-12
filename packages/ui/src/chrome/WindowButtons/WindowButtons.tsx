import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import s from './WindowButtons.module.css'

/*
 * The window's own three buttons, where the system draws none: close,
 * minimize, and maximize or restore. At rest they are the same grey dots a
 * Mac shows; the glyph and the colour come on hover, and on focus or
 * focus-within, so they never say what they do by colour alone (WCAG 1.4.1)
 * and a keyboard reaches them too.
 */

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

export type WindowButtonsProps = RootProps<
  'span',
  {
    onClose?: () => void
    onMinimize?: () => void
    onToggleMaximize?: () => void
    /** The window is maximized: the third button restores it. */
    maximized?: boolean
    text?: Partial<WindowButtonsText>
  }
>

export function WindowButtons({ onClose, onMinimize, onToggleMaximize, maximized = false, text, className, ...rest }: WindowButtonsProps) {
  const t = { ...windowButtonsText, ...text }
  return (
    <span className={cx(s.lights, className)} {...rest}>
      <button type="button" className={s.close} aria-label={t.close} onClick={onClose}>
        <svg className={s.glyph} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path d="m4 4 8 8M12 4l-8 8" />
        </svg>
      </button>
      <button type="button" className={s.minimize} aria-label={t.minimize} onClick={onMinimize}>
        <svg className={s.glyph} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path d="M3 8h10" />
        </svg>
      </button>
      <button type="button" className={s.maximize} aria-label={maximized ? t.restore : t.maximize} onClick={onToggleMaximize}>
        <svg className={s.glyph} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          {maximized ? <path d="M5 3h8v8M3 5v8h8" /> : <rect x="3.5" y="3.5" width="9" height="9" rx="0.7" />}
        </svg>
      </button>
    </span>
  )
}
