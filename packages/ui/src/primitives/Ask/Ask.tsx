import { useEffect, useRef, type ReactNode } from 'react'

import { Icon, type IconName } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { LinkButton } from '../LinkButton/LinkButton'
import s from './Ask.module.css'

/*
 * Something that waits on a person: a permission or a graph change beyond
 * what the run was given, as a card in the thread, or a call on the home.
 * Violet, like every ask. Once answered it folds to one line saying what was
 * said, with Undo when the consumer can take the answer back.
 */

export type AskCardProps = RootProps<
  'div',
  {
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
  }
>

export function AskCard({ icon, kicker, kickerId, who, what, children, className, ...rest }: AskCardProps) {
  return (
    <div className={cx(s.card, className)} {...rest}>
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

export type AskAnsweredProps = RootProps<
  'div',
  {
    /** A no is drawn with a cross, anything else with a check. */
    denied?: boolean
    /** What was said, first and weighted. */
    said: ReactNode
    /** What follows it, quieter: a scope, a note, who answered. */
    children?: ReactNode
    /** Take the answer back. Without it, no Undo: an answer someone else gave, or one already acted on, stays. */
    onUndo?: () => void
    /** Undo's words. */
    undo?: string
    /**
     * You just answered here: focus moves to this line, so it is not lost
     * with the button you pressed, and a screen reader reads what was said.
     */
    focusOnMount?: boolean
  }
>

/** An ask once answered: one line, with Undo. */
export function AskAnswered({
  denied = false,
  said,
  children,
  onUndo,
  undo = 'Undo',
  focusOnMount = false,
  className,
  ...rest
}: AskAnsweredProps) {
  const line = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (focusOnMount) line.current?.focus()
  }, [focusOnMount])
  return (
    <div ref={line} className={cx(s.answered, className)} tabIndex={focusOnMount ? -1 : undefined} {...rest}>
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
