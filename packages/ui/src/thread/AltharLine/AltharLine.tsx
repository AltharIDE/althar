import type { ReactNode } from 'react'

import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import s from './AltharLine.module.css'

export interface AltharLineText {
  /** Who says it. */
  name: string
}

export const altharLineText: AltharLineText = { name: 'Althar' }

export type AltharLineProps = RootProps<
  'p',
  {
    children: ReactNode
    /** Something gone wrong that is now the person's: a conflict its lead couldn't settle. */
    tone?: 'info' | 'warning'
    text?: Partial<AltharLineText>
  }
>

/**
 * Althar saying something the person should know, in a task's thread: a
 * conflict with the default branch, checks that failed, a pull request
 * opened. One plain line with its name, so it reads as someone speaking.
 */
export function AltharLine({ children, tone = 'info', text, className, ...rest }: AltharLineProps) {
  const t = { ...altharLineText, ...text }
  return (
    <p className={cx(s.line, tone === 'warning' && s.warning, className)} {...rest}>
      <span className={s.name}>{t.name}</span>
      <span>{children}</span>
    </p>
  )
}
