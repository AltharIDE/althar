import type { ComponentProps } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import { Kbd } from '../../primitives/Kbd/Kbd'
import s from './UsageButton.module.css'

/*
 * The way to the usage view, always in the window's bar. With warnings not
 * yet seen it carries a small count, and its name says how many, so a
 * screen reader hears it too. While the view is open it stays lit.
 */

export interface UsageButtonText {
  label: string
  /** Its name with the warnings waiting. */
  waiting: (n: number) => string
}

export const usageButtonText: UsageButtonText = {
  label: 'Usage',
  waiting: (n) => (n === 1 ? 'Usage, 1 warning not seen' : `Usage, ${n} warnings not seen`),
}

export interface UsageButtonProps extends Omit<ComponentProps<'button'>, 'children' | 'title'> {
  /** Warnings the person has not seen. */
  waiting?: number
  /** The view it opens is open. */
  expanded?: boolean
  /** Its shortcut, shown after the label. */
  kbd?: string
  text?: Partial<UsageButtonText>
}

export function UsageButton({ waiting = 0, expanded, kbd, text, className, type = 'button', ...rest }: UsageButtonProps) {
  const t = { ...usageButtonText, ...text }
  return (
    <button
      type={type}
      className={cx(s.button, className)}
      aria-haspopup="dialog"
      aria-expanded={expanded}
      aria-label={waiting > 0 ? t.waiting(waiting) : t.label}
      {...rest}
    >
      <Icon name="load" size={13} />
      <span aria-hidden="true">{t.label}</span>
      {waiting > 0 && (
        <span className={s.count} aria-hidden="true">
          {waiting}
        </span>
      )}
      {kbd && <Kbd>{kbd}</Kbd>}
    </button>
  )
}
