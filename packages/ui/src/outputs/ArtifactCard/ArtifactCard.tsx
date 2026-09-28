import type { ReactNode } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { Severity } from '../../foundations/vocabulary'
import { cx } from '../../lib/cx'
import s from './ArtifactCard.module.css'

/*
 * A document a task wrote, drawn as one: a review, an audit, a plan. Its
 * kind, its title, where it came from, and for findings, how many of each
 * severity, heaviest first. Opening it is the consumer's: the side panel,
 * or the document's own page.
 */

export interface ArtifactCardText {
  severity: Record<Severity, (n: number) => string>
  open: (title: string) => string
}

export const artifactCardText: ArtifactCardText = {
  severity: {
    [Severity.High]: (n) => `${n} high`,
    [Severity.Medium]: (n) => `${n} medium`,
    [Severity.Low]: (n) => `${n} low`,
  },
  open: (title) => `Open ${title}`,
}

const ORDER = [Severity.High, Severity.Medium, Severity.Low] as const

export interface ArtifactCardProps {
  /** What kind of document: Review, Audit, Plan. */
  kind: string
  title: string
  /** Where it came from, in a line: task 418 · 3 findings. May name models with WithModels. */
  meta?: ReactNode
  /** Findings in it, by severity. */
  findings?: Partial<Record<Severity, number>>
  onOpen?: () => void
  className?: string
  text?: Partial<ArtifactCardText>
}

export function ArtifactCard({ kind, title, meta, findings, onOpen, className, text }: ArtifactCardProps) {
  const t = { ...artifactCardText, ...text }
  const counts = ORDER.filter((sev) => (findings?.[sev] ?? 0) > 0)
  return (
    <article className={cx(s.card, onOpen && s.opens, className)}>
      <span className={s.sheet} aria-hidden="true">
        <Icon name="artifact" size={18} />
      </span>
      <span className={s.main}>
        <span className={s.kind}>{kind}</span>
        {onOpen ? (
          <button type="button" className={cx(s.title, s.open)} onClick={onOpen} aria-label={t.open(title)}>
            {title}
          </button>
        ) : (
          <span className={s.title}>{title}</span>
        )}
        {meta && <span className={s.meta}>{meta}</span>}
      </span>
      {counts.length > 0 && (
        <span className={s.counts}>
          {counts.map((sev) => (
            <span key={sev} className={s[sev]}>
              {t.severity[sev](findings?.[sev] ?? 0)}
            </span>
          ))}
        </span>
      )}
    </article>
  )
}
