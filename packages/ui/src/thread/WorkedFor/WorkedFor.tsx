import type { ReactNode } from 'react'

import { Caret, Disclosure, DisclosureTrigger, Fold, type Disclosable } from '../../primitives/Fold/Fold'
import { Spinner } from '../../primitives/Spinner/Spinner'
import { Rhythm } from '../../lib/rhythm'
import s from './WorkedFor.module.css'

export interface WorkedForText {
  took: (duration: string) => string
  /** While the turn runs: how long it has worked so far. */
  working: (duration: string) => string
}

export const workedForText: WorkedForText = { took: (d) => `Worked for ${d}`, working: (d) => `Working for ${d}` }

export interface WorkedForProps extends Disclosable {
  /** How long the turn took, or has taken so far. */
  took: string
  /** What happened, in a few words; while it runs, what it is doing now. */
  summary?: string
  /** The turn is still running: the line says it is working, and what it does now. */
  live?: boolean
  children: ReactNode
  text?: Partial<WorkedForText>
}

/**
 * How a turn got to its answer rarely matters: the work folds into one line
 * and the answer stands under it. Open it to see every step, in order. While
 * the turn runs, its work folds too, under how long it has worked so far and
 * what it is doing now, so the thread shows what was said, not every read.
 */
export function WorkedFor({ took, summary, live = false, children, text, ...disclosure }: WorkedForProps) {
  const t = { ...workedForText, ...text }
  return (
    <Disclosure {...disclosure} rhythm={Rhythm.Fold}>
      <DisclosureTrigger>
        <button type="button" className={s.row} aria-busy={live || undefined}>
          {live && <Spinner size="small" />}
          <span className={s.took}>{live ? t.working(took) : t.took(took)}</span>
          {summary && <span className={s.summary}>{summary}</span>}
          <span className={s.rule} aria-hidden="true" />
          <Caret />
        </button>
      </DisclosureTrigger>
      <Fold>
        <div className={s.body}>{children}</div>
      </Fold>
    </Disclosure>
  )
}
