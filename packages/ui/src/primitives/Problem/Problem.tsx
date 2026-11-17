import type { ReactNode } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import s from './Problem.module.css'

export interface ProblemProps {
  /** What went wrong, in plain words: "Claude Code is signed out.", not "Authentication required". */
  children: ReactNode
  /** What fixes it, beside the words: Sign in again, Try again, Choose another folder. */
  action?: ReactNode
  /** small: in a row, a card or under a field. */
  size?: 'default' | 'small'
  /** Standing on its own, where it is the only thing to say: on a faint wash of the danger colour. */
  banner?: boolean
  /** p by default; span inside a line of other words. */
  as?: 'p' | 'div' | 'span'
  id?: string
  className?: string
}

/**
 * Something that failed, said where it failed: a mark and the words in the
 * danger colour, so it reads as an error by its shape as well as its colour,
 * and what fixes it beside them. Announced as it appears.
 */
export function Problem({ children, action, size = 'default', banner = false, as: As = 'p', id, className }: ProblemProps) {
  return (
    <As id={id} role="alert" className={cx(s.problem, size === 'small' && s.small, banner && s.banner, className)}>
      <Icon name="problem" size={size === 'small' ? 12 : 13} className={s.mark} />
      <span className={s.words}>{children}</span>
      {/* A space between, so what is read aloud doesn't run the words into the action. */}
      {action !== undefined && (
        <>
          {' '}
          <span className={s.action}>{action}</span>
        </>
      )}
    </As>
  )
}
