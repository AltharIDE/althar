import type { ReactNode } from 'react'

import { Icon, type IconName } from '../../foundations/Icon/Icon'
import { Wait, unreachable } from '../../foundations/vocabulary'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import b from '../Board/Board.module.css'
import { CardTitle } from '../Board/CardTitle'
import s from './NextRow.module.css'

/*
 * A task handed out but not started, in the order it will start. It has no
 * track yet: its steps are decided when it starts. What it can honestly say
 * is where it is in line and what it waits for: another task, a free worker,
 * or a call of yours, which is violet like every call. One already under way,
 * waiting to go on, says it continues, and with what: Continues · Review.
 */

const glyph = (wait: Wait): IconName => {
  switch (wait) {
    case Wait.After:
      return 'after'
    case Wait.Workers:
      return 'clock'
    case Wait.You:
      return 'hold'
    default:
      return unreachable(wait)
  }
}

export interface NextRowText {
  place: (n: number) => string
  task: (task: string) => string
  /** Under way, it goes on: with the step it goes on with, where it has one. */
  continues: (step?: string) => string
}

export const nextRowText: NextRowText = {
  place: (n) => `${n}.`,
  task: (task) => `Task ${task}`,
  continues: (step) => (step === undefined || step === '' ? 'Continues' : `Continues · ${step}`),
}

export type NextRowProps = RootProps<
  'article',
  {
    /** Its place in line, from 1. */
    place: number
    task: string
    /** What kind of work, in a word. */
    kind?: string
    /**
     * It is under way and goes on, rather than starts: the step it goes on
     * with (Review, Follow-up), or an empty string for none worth naming.
     */
    continues?: string
    title: string
    wait: Wait
    /** What it waits for, in a line: Starts when 419 merges. */
    reason: string
    current?: boolean
    /** One fact, at its foot, as on a card. */
    foot?: ReactNode
    onOpen?: () => void
    text?: Partial<NextRowText>
  }
>

/** One row of the queue up next. Put it in a BoardList. */
export function NextRow({
  place,
  task,
  kind,
  continues,
  title,
  wait,
  reason,
  current,
  foot,
  onOpen,
  text,
  className,
  ...rest
}: NextRowProps) {
  const t = { ...nextRowText, ...text }
  return (
    <article className={cx(b.row, s.next, className)} aria-current={current || undefined} {...rest}>
      <div className={b.top}>
        <span className={s.place}>{t.place(place)}</span>
        <span className={b.ref}>{t.task(task)}</span>
        {kind && <span>{kind}</span>}
        {continues !== undefined && <span className={s.continues}>{t.continues(continues)}</span>}
      </div>
      <CardTitle className={s.title} onOpen={onOpen}>
        {title}
      </CardTitle>
      <span className={cx(s.wait, wait === Wait.You && s.you)}>
        <Icon name={glyph(wait)} size={11} />
        {reason}
      </span>
      {foot !== undefined && foot !== null && <div className={b.foot}>{foot}</div>}
    </article>
  )
}
