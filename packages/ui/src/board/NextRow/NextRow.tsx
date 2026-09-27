import { Icon, type IconName } from '../../foundations/Icon/Icon'
import { Wait, unreachable } from '../../foundations/vocabulary'
import { cx } from '../../lib/cx'
import b from '../Board/Board.module.css'
import s from './NextRow.module.css'

/*
 * A task handed out but not started, in the order it will start. It has no
 * track yet: its steps are decided when it starts. What it can honestly say
 * is where it is in line and what it waits for: another task, a free worker,
 * or a call of yours, which is violet like every call.
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
}

export const nextRowText: NextRowText = {
  place: (n) => `${n}.`,
  task: (task) => `Task ${task}`,
}

export interface NextRowProps {
  /** Its place in line, from 1. */
  place: number
  task: string
  /** What kind of work, in a word. */
  kind?: string
  title: string
  wait: Wait
  /** What it waits for, in a line: Starts when 419 merges. */
  reason: string
  current?: boolean
  onOpen?: () => void
  text?: Partial<NextRowText>
}

/** One row of the queue up next. Put it in a BoardList. */
export function NextRow({ place, task, kind, title, wait, reason, current, onOpen, text }: NextRowProps) {
  const t = { ...nextRowText, ...text }
  return (
    <li>
      <article className={cx(b.row, s.next)} aria-current={current || undefined}>
        <div className={b.top}>
          <span className={s.place}>{t.place(place)}</span>
          <span className={b.ref}>{t.task(task)}</span>
          {kind && <span>{kind}</span>}
        </div>
        <button type="button" className={cx(b.open, s.title)} onClick={onOpen}>
          {title}
        </button>
        <span className={cx(s.wait, wait === Wait.You && s.you)}>
          <Icon name={glyph(wait)} size={11} />
          {reason}
        </span>
      </article>
    </li>
  )
}
