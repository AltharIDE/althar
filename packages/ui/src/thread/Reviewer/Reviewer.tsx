import { Verdict } from '../../foundations/vocabulary'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { Markdown } from '../Markdown/Markdown'
import { findingHead, heavyWeight } from './FindingNote'
import s from './Reviewer.module.css'

export type FindingWeight = 'blocking' | 'major' | 'minor' | 'nit'

/** Something a review found: how much it matters, where, and what. */
export interface ReviewerFinding {
  readonly id: string
  readonly weight: FindingWeight
  /** The file and line, where it says: packages/runtime/src/Runs.ts:770. */
  readonly at?: string
  /** What is wrong in a line, as the reviewer titled it. */
  readonly title?: string | null
  /** What is wrong, as markdown. */
  readonly claim: string
}

export interface ReviewerText {
  pass: string
  passWith: (count: number) => string
  changes: (count: number) => string
  weight: Record<FindingWeight, string>
}

export const reviewerText: ReviewerText = {
  pass: 'Looks good to me.',
  passWith: (count) => `Looks good, with ${count === 1 ? 'one note' : `${count} notes`}:`,
  changes: (count) => (count === 0 ? 'Needs changes.' : `Needs changes: ${count === 1 ? 'one finding' : `${count} findings`}.`),
  weight: { blocking: 'Blocking', major: 'Major', minor: 'Minor', nit: 'Nit' },
}

export type ReviewerProps = RootProps<
  'div',
  {
    verdict: Verdict
    findings: ReadonlyArray<ReviewerFinding>
    /** Opens a finding where it is in the code, by where it is in the list: each finding is then a line, its words there. */
    onOpen?: (index: number) => void
    text?: Partial<ReviewerText>
  }
>

/** A file's name and line, without its folders: `Runs.ts:770`. */
const shortAt = (at: string) => at.slice(at.lastIndexOf('/') + 1)

/**
 * A reviewer in its own voice, in a task's thread: its verdict in a
 * sentence, then each finding as how much it matters, what in a line, and
 * where. Where the code can show them, each is that line alone, opening
 * the finding there; else its full words follow. What it says besides goes
 * under it, as any message does.
 */
export function Reviewer({ verdict, findings, onOpen, text, className, ...rest }: ReviewerProps) {
  const t = { ...reviewerText, ...text }
  const n = findings.length
  return (
    <div className={cx(s.verdict, className)} {...rest}>
      <p className={s.said}>{verdict === Verdict.Pass ? (n === 0 ? t.pass : t.passWith(n)) : t.changes(n)}</p>
      {n > 0 && onOpen !== undefined && (
        <ol className={s.lines}>
          {findings.map((finding, index) => (
            <li key={finding.id}>
              <button type="button" className={s.row} onClick={() => onOpen(index)}>
                <span className={heavyWeight(finding.weight) ? s.heavy : s.weight}>{t.weight[finding.weight]}</span>
                <span className={s.head}>{findingHead({ title: finding.title ?? null, claim: finding.claim }).head}</span>
                {finding.at !== undefined && finding.at !== '' && (
                  <code className={s.short} title={finding.at}>
                    {shortAt(finding.at)}
                  </code>
                )}
              </button>
            </li>
          ))}
        </ol>
      )}
      {n > 0 && onOpen === undefined && (
        <ol className={s.findings}>
          {findings.map((finding) => (
            <li key={finding.id} className={s.finding}>
              <span className={s.where}>
                <span className={finding.weight === 'blocking' || finding.weight === 'major' ? s.heavy : s.weight}>
                  {t.weight[finding.weight]}
                </span>
                {finding.at !== undefined && finding.at !== '' && <code className={s.at}>{finding.at}</code>}
              </span>
              {finding.title !== undefined && finding.title !== null && <p className={s.title}>{finding.title}</p>}
              <div className={s.claim}>
                <Markdown source={finding.claim} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
