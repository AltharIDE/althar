import type { ReactNode } from 'react'

import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { Problem } from '../../primitives/Problem/Problem'
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
    /** Something that failed and is now the person's: a turn that couldn't go on, a conflict its lead couldn't settle. Said as a Problem. */
    tone?: 'info' | 'warning'
    text?: Partial<AltharLineText>
  }
>

/**
 * Althar saying something the person should know, in a task's thread: a
 * conflict with the default branch, checks that failed, a pull request
 * opened. One plain line with its name, so it reads as someone speaking;
 * what failed is said as a problem, in the danger colour with its mark.
 */
export function AltharLine({ children, tone = 'info', text, className, ...rest }: AltharLineProps) {
  const t = { ...altharLineText, ...text }
  return (
    <p className={cx(s.line, className)} {...rest}>
      <span className={s.name}>{t.name}</span>
      {tone === 'warning' ? (
        <Problem as="span" className={s.problem}>
          {children}
        </Problem>
      ) : (
        <span>{children}</span>
      )}
    </p>
  )
}
