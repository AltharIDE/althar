import type { ReactNode } from 'react'

import { cx } from '../../lib/cx'
import { VisuallyHidden } from '../../primitives/VisuallyHidden/VisuallyHidden'
import { PeekDetail, PeekSection } from '../Dock/Dock'
import s from './ListPeek.module.css'

/*
 * What the project keeps, in the dock: its notes, its artifacts. A line on
 * what the list is, then its entries by section, each with where it came
 * from. One the project needs you to look at, like two notes that disagree,
 * carries a violet dot. A way to the full view can sit at the top.
 */

export interface ListEntry {
  id: string
  title: string
  /** Where it came from, and how it is used: Decision · 4 Mar · used by 9 tasks. */
  meta?: string
  /** Something about it needs you. */
  flagged?: boolean
}

export interface ListPeekText {
  /** How a flagged entry is read out. */
  flagged: string
}

export const listPeekText: ListPeekText = { flagged: 'needs you' }

export interface ListPeekProps {
  /** What the list is, in a line. */
  about?: string
  /** Entries by section; a section without a label is just the entries. */
  sections: readonly { label?: string; entries: readonly ListEntry[] }[]
  /** Open one entry. Without it, entries are plain. */
  onOpen?: (id: string) => void
  /** A way to the full view, at the top. */
  action?: ReactNode
  text?: Partial<ListPeekText>
}

export function ListPeek({ about, sections, onOpen, action, text }: ListPeekProps) {
  const t = { ...listPeekText, ...text }
  const entry = (e: ListEntry) => {
    const inner = (
      <>
        <span className={s.title}>
          {e.flagged && (
            <>
              <span className={s.flag} aria-hidden="true" />
              <VisuallyHidden>{t.flagged}: </VisuallyHidden>
            </>
          )}
          {e.title}
        </span>
        {e.meta && <span className={s.meta}>{e.meta}</span>}
      </>
    )
    return (
      <li key={e.id}>
        {onOpen ? (
          <button type="button" className={cx(s.entry, s.opens)} onClick={() => onOpen(e.id)}>
            {inner}
          </button>
        ) : (
          <div className={s.entry}>{inner}</div>
        )}
      </li>
    )
  }
  return (
    <>
      {action && <div className={s.action}>{action}</div>}
      {about && <PeekDetail>{about}</PeekDetail>}
      {sections.map((sec, i) =>
        sec.label ? (
          <PeekSection key={sec.label} label={sec.label}>
            <ul className={s.list}>{sec.entries.map(entry)}</ul>
          </PeekSection>
        ) : (
          <ul key={i} className={s.list}>
            {sec.entries.map(entry)}
          </ul>
        ),
      )}
    </>
  )
}
