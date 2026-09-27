import type { ReactNode } from 'react'

import { Icon, type IconName } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import s from './Ask.module.css'

/*
 * Something that waits on a person, as a card in the thread: a permission,
 * a graph change beyond what the run was given. Violet, like every ask. Once
 * answered it folds to one line saying what was said, with Undo.
 */

export interface AskCardProps {
  icon: IconName
  /** What kind of ask it is: Needs your permission. */
  kicker: ReactNode
  /** An id for the kicker, so a form inside can be named by it. */
  kickerId?: string
  /** Who asks, at the right of the head. */
  who?: ReactNode
  /** What it asks for, in a sentence. */
  what: ReactNode
  children?: ReactNode
  className?: string
}

export function AskCard({ icon, kicker, kickerId, who, what, children, className }: AskCardProps) {
  return (
    <div className={cx(s.card, className)}>
      <div className={s.head}>
        <Icon name={icon} size={12} />
        <span className={s.kicker} id={kickerId}>
          {kicker}
        </span>
        {who && <span className={s.who}>{who}</span>}
      </div>
      <p className={s.what}>{what}</p>
      {children}
    </div>
  )
}

/** The row of answers at the foot of an ask. */
export function AskFoot({ children }: { children: ReactNode }) {
  return <div className={s.foot}>{children}</div>
}

export interface AskAnsweredProps {
  /** A no is drawn with a cross, anything else with a check. */
  denied?: boolean
  /** What was said, first and weighted. */
  said: ReactNode
  /** What follows it, quieter: a scope, a note, who answered. */
  children?: ReactNode
  /** Without it, no Undo: an answer someone else gave is theirs to change. */
  onUndo?: () => void
  undo?: string
}

/** An ask once answered: one line, announced, with Undo. */
export function AskAnswered({ denied = false, said, children, onUndo, undo = 'Undo' }: AskAnsweredProps) {
  return (
    <div className={s.answered} role="status">
      <Icon name={denied ? 'close' : 'check'} size={11} />
      <span className={s.said}>{said}</span>
      {children}
      {onUndo && (
        <LinkButton className={s.undo} onClick={onUndo}>
          {undo}
        </LinkButton>
      )}
    </div>
  )
}

/** Quieter words after what was said. */
export function AskNote({ children, code }: { children: ReactNode; code?: boolean }) {
  return <span className={code ? s.noteCode : s.note}>{children}</span>
}
