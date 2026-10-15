import { Icon } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import { Evidence, type EvidencePiece, type EvidenceText } from '../Evidence/Evidence'
import s from './Finished.module.css'

/*
 * A task's closing card, at the end of its thread once its work is done:
 * what it built, as its lead last said it, then the proof and what is still
 * the person's to check, as one finished view (Evidence, which the Outputs
 * face shows too). What a later round changed is said again, so it never
 * describes an earlier version. In the task card's language: a quiet card.
 */

export interface FinishedText {
  kicker: string
  label: string
  evidence: Partial<EvidenceText>
}

export const finishedText: FinishedText = { kicker: 'Finished', label: 'What the task built', evidence: {} }

export interface FinishedProps {
  /** What the task built, in markdown. */
  built: string
  pieces: readonly EvidencePiece[]
  unverified?: readonly string[]
  className?: string
  text?: Partial<FinishedText>
}

export function Finished({ built, pieces, unverified = [], className, text }: FinishedProps) {
  const t = { ...finishedText, ...text }
  return (
    <article className={cx(s.card, className)} aria-label={t.label}>
      <span className={s.kicker}>
        <Icon name="check" size={11} className={s.done} />
        {t.kicker}
      </span>
      <Evidence built={built} pieces={pieces} unverified={unverified} headingLevel={3} text={t.evidence} />
    </article>
  )
}
