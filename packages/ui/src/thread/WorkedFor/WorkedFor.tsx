import type { ReactNode } from 'react'

import { Caret, Disclosure, DisclosureTrigger, Fold, type Disclosable } from '../../primitives/Fold/Fold'
import { Rhythm } from '../../lib/rhythm'
import s from './WorkedFor.module.css'

export interface WorkedForText {
  took: (duration: string) => string
}

export const workedForText: WorkedForText = { took: (d) => `Worked for ${d}` }

export interface WorkedForProps extends Disclosable {
  /** How long the turn took. */
  took: string
  /** What happened, in a few words. */
  summary?: string
  children: ReactNode
  text?: Partial<WorkedForText>
}

/**
 * Once a turn is over, how it got there rarely matters: the work folds into
 * one line and the answer stands under it. Open it to see every step, in
 * order. While the turn is live, nothing is folded.
 */
export function WorkedFor({ took, summary, children, text, ...disclosure }: WorkedForProps) {
  const t = { ...workedForText, ...text }
  return (
    <Disclosure {...disclosure} rhythm={Rhythm.Fold}>
      <DisclosureTrigger>
        <button type="button" className={s.row}>
          <span className={s.took}>{t.took(took)}</span>
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
