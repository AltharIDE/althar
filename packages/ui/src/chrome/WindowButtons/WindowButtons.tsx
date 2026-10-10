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
      <button type="button" className={s.close} aria-label={t.close} onClick={onClose} />
      <button type="button" className={s.minimize} aria-label={t.minimize} onClick={onMinimize} />
      <button
        type="button"
        className={s.maximize}
        aria-label={maximized ? t.restore : t.maximize}
        data-restore={maximized ? '' : undefined}
        onClick={onToggleMaximize}
      />
    </span>
  )
}
