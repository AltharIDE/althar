import { Children, useId, type ReactNode } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { BoardLane, unreachable } from '../../foundations/vocabulary'
import { cx } from '../../lib/cx'
import { Heading, type HeadingLevel } from '../../primitives/Heading/Heading'
import { LiveDot } from '../../primitives/LiveDot/LiveDot'
import s from './Board.module.css'

/*
 * The board: every piece of a project's work, in the order it moves. Up
 * next, running, waiting on you, settled. Each lane holds its own kind of
 * object, because each is read differently: a queue says what it waits for,
 * a running task where it is, a call its choices, and settled work what it
 * came to. There is no held lane: a task held on a call stays in Up next,
 * and the call itself is what waits on you.
 *
 * The board lays the lanes side by side and scrolls them sideways when they
 * don't fit; each lane scrolls on its own.
 */

export interface BoardText {
  lane: Record<BoardLane, string>
  /** An empty lane. */
  empty: Record<BoardLane, string>
}

export const boardText: BoardText = {
  lane: {
    [BoardLane.Next]: 'Up next',
    [BoardLane.Running]: 'Running',
    [BoardLane.Yours]: 'Needs you',
    [BoardLane.Settled]: 'Settled',
  },
  empty: {
    [BoardLane.Next]: 'Nothing is waiting to start.',
    [BoardLane.Running]: 'Nothing is running.',
    [BoardLane.Yours]: 'Nothing is waiting on you.',
    [BoardLane.Settled]: 'Nothing has settled yet.',
  },
}

export interface BoardProps {
  /** Its lanes: BoardLane elements. */
  children: ReactNode
  /** What the board is, for assistive technology. */
  label: string
  className?: string
}

export function Board({ children, label, className }: BoardProps) {
  return (
    <section aria-label={label} className={cx(s.board, className)}>
      {children}
    </section>
  )
}

function Glyph({ lane }: { lane: BoardLane }) {
  switch (lane) {
    case BoardLane.Next:
      return <span className={s.ring} aria-hidden="true" />
    case BoardLane.Running:
      return <LiveDot />
    case BoardLane.Yours:
      return <span className={s.you} aria-hidden="true" />
    case BoardLane.Settled:
      return <Icon name="check" size={11} className={s.settledGlyph} />
    default:
      return unreachable(lane)
  }
}

export interface BoardColumnProps {
  lane: BoardLane
  /** How many it holds. */
  count: number
  children?: ReactNode
  /** The lane's name's rank in the page's outline. */
  headingLevel?: HeadingLevel
  text?: Partial<BoardText>
}

/** One lane: its name and count, then its cards or rows. Empty, it says so. */
export function BoardColumn({ lane, count, children, headingLevel = 2, text }: BoardColumnProps) {
  const t = { ...boardText, ...text }
  const id = useId()
  return (
    <section aria-labelledby={id} className={cx(s.column, s[lane])}>
      <header className={s.head}>
        <Glyph lane={lane} />
        <Heading level={headingLevel} id={id} className={s.title}>
          {t.lane[lane]}
        </Heading>
        <span className={s.count}>{count}</span>
      </header>
      <div className={s.body}>{count > 0 ? children : <p className={s.empty}>{t.empty[lane]}</p>}</div>
    </section>
  )
}

/** A list of rows in a lane: the queue up next, the settled ledger. Each child is one item of the list. */
export function BoardList({ children }: { children: ReactNode }) {
  return (
    <ol className={s.list}>
      {Children.map(children, (row) => (
        <li>{row}</li>
      ))}
    </ol>
  )
}
