import type { ReactNode } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { Verdict } from '../../foundations/vocabulary'
import { cx } from '../../lib/cx'
import { Rhythm } from '../../lib/rhythm'
import { Disclosure, DisclosureTrigger, Fold, type Disclosable } from '../../primitives/Fold/Fold'
import { Model, type ModelInfo } from '../../primitives/Model/Model'
import { Spinner } from '../../primitives/Spinner/Spinner'
import s from './ReviewLine.module.css'

export interface ReviewLineText {
  review: string
  passed: string
  notes: (count: number) => string
  findings: (count: number) => string
  changes: string
}

export const reviewLineText: ReviewLineText = {
  review: 'Review',
  passed: 'Passed',
  notes: (count) => (count === 1 ? '1 note' : `${count} notes`),
  findings: (count) => (count === 1 ? '1 finding' : `${count} findings`),
  changes: 'Needs changes',
}

export interface ReviewLineProps extends Disclosable {
  /** Who reviewed. */
  model: ModelInfo
  /** What it found, once it reported: its verdict and how many findings. Absent while it reviews. */
  verdict?: Verdict
  findings?: number
  /** What became of its findings, in words, once the lead settled them: "2 fixed, 1 declined". */
  settled?: string
  /** It is reviewing now: the line turns, and says how long it has been, as a round's work does. */
  live?: boolean
  /** While it reviews, how long it has been at it. */
  took?: string
  /** Its verdict, findings and words, and the lead settling them, shown when opened. Without them, the line doesn't open. */
  children?: ReactNode
  className?: string
  /** The thread item it stands for, and those folded into it (the lead's settling, by its report), for what takes the person to them. */
  'data-item'?: string
  'data-items'?: string
  text?: Partial<ReviewLineText>
}

/**
 * A round of review, in one quiet line of the task's thread: who reviewed,
 * what it found and what became of it ("Review · GPT-5.2 · 3 findings · 2
 * fixed, 1 declined"). Most of the time that is all the person needs; it
 * opens to the findings and what the reviewer said. While the review runs,
 * the line says so, and nothing of the reviewer's thinking shows.
 */
export function ReviewLine({
  model,
  verdict,
  findings = 0,
  settled,
  live = false,
  took = '',
  children,
  className,
  text,
  ...disclosure
}: ReviewLineProps) {
  const t = { ...reviewLineText, ...text }
  const found = live
    ? took
    : verdict === Verdict.Pass
      ? findings === 0
        ? t.passed
        : `${t.passed} · ${t.notes(findings)}`
      : findings === 0
        ? t.changes
        : t.findings(findings)
  const line = (
    <>
      <span className={s.mark}>
        {live ? <Spinner size="small" /> : children !== undefined && <Icon name="chevron" size={11} className={s.chevron} />}
      </span>
      <span className={s.what}>{t.review}</span>
      <Model model={model} className={s.who} />
      {found !== '' && <span className={s.found}>{found}</span>}
      {!live && settled !== undefined && settled !== '' && <span className={s.settled}>{settled}</span>}
    </>
  )
  const items = { 'data-item': disclosure['data-item'], 'data-items': disclosure['data-items'] }
  if (children === undefined || live)
    return (
      <div className={cx(s.review, className)} data-review="" data-rhythm={Rhythm.Line} {...items}>
        <div className={s.row} aria-busy={live || undefined}>
          {line}
        </div>
      </div>
    )
  return (
    <Disclosure {...disclosure} rhythm={Rhythm.Line} className={cx(s.review, className)} data-review="">
      <DisclosureTrigger>
        <button type="button" className={s.row}>
          {line}
        </button>
      </DisclosureTrigger>
      <Fold bleed={false}>
        <div className={s.body}>{children}</div>
      </Fold>
    </Disclosure>
  )
}
