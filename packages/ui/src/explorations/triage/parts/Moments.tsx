import type { ReactNode } from 'react'

import { boardText } from '../../../board/Board/Board'
import { BoardLane } from '../../../foundations/vocabulary'
import { cx } from '../../../lib/cx'
import { LiveDot } from '../../../primitives/LiveDot/LiveDot'
import { Thread } from '../../../thread/Thread/Thread'
import { useCheckpoint, type Checkpoint, type CheckpointActions } from '../model'
import { Scheme } from './Scheme'
import s from './Moments.module.css'

/*
 * One direction, moment by moment: what the board shows and what the thread
 * shows at the same time, side by side, so a direction is judged by both.
 * Each moment holds its own checkpoint, so every one can be tried; its
 * clock stands still unless the sheet is live.
 */

/** What a moment shows, from its checkpoint. */
export interface Shown {
  /** The task's card in the Running lane. */
  running?: ReactNode
  /** What the Needs you lane holds for it, if anything. */
  yours?: ReactNode
  /** The task's thread at that moment. */
  thread: ReactNode
}

export interface Moment {
  id: string
  /** The moment's name: Counting down, Held. */
  state: string
  /** What to look at in it. */
  note?: string
  start: Checkpoint
  show: (c: Checkpoint, on: CheckpointActions) => Shown
}

export interface MomentsProps {
  moments: readonly Moment[]
  dark?: boolean
  /** Clocks run. */
  live?: boolean
  /** Narrower, for a page: each moment's name over its board and thread rather than beside them. */
  narrow?: boolean
}

export function Moments({ moments, dark = false, live = false, narrow = false }: MomentsProps) {
  return (
    <Scheme dark={dark}>
      <div className={cx(s.sheet, narrow && s.narrow)}>
        <div className={s.columns} aria-hidden="true">
          <span>Moment</span>
          <span>Board</span>
          <span>Thread</span>
        </div>
        {moments.map((m) => (
          <Row key={m.id} moment={m} live={live} />
        ))}
      </div>
    </Scheme>
  )
}

function Row({ moment: m, live }: { moment: Moment; live: boolean }) {
  const [c, on] = useCheckpoint(m.start, live)
  const shown = m.show(c, on)
  return (
    <section className={s.moment} aria-label={m.state}>
      <div className={s.head}>
        <p className={s.state}>{m.state}</p>
        {m.note && <p className={s.note}>{m.note}</p>}
      </div>
      <div className={s.board}>
        <span className={s.lane}>
          <LiveDot />
          {boardText.lane[BoardLane.Running]}
        </span>
        {shown.running ?? <p className={s.nothing}>{boardText.empty[BoardLane.Running]}</p>}
        {shown.yours && (
          <>
            <span className={cx(s.lane, s.you)}>{boardText.lane[BoardLane.Yours]}</span>
            {shown.yours}
          </>
        )}
      </div>
      <div className={s.thread}>
        <Thread label={`Thread · ${m.state}`}>{shown.thread}</Thread>
      </div>
    </section>
  )
}

export interface Page {
  id: string
  state: string
  note?: string
  node: ReactNode
}

/** Moments with no board: a conversation alone, such as the coordinator's. */
export function Pages({ pages, label, dark = false }: { pages: readonly Page[]; label: string; dark?: boolean }) {
  return (
    <Scheme dark={dark}>
      <div className={s.sheet}>
        <div className={cx(s.columns, s.single)} aria-hidden="true">
          <span>Moment</span>
          <span>{label}</span>
        </div>
        {pages.map((p) => (
          <section key={p.id} className={cx(s.moment, s.single)} aria-label={p.state}>
            <div className={s.head}>
              <p className={s.state}>{p.state}</p>
              {p.note && <p className={s.note}>{p.note}</p>}
            </div>
            <div className={s.thread}>
              <Thread label={`${label} · ${p.state}`}>{p.node}</Thread>
            </div>
          </section>
        ))}
      </div>
    </Scheme>
  )
}
