import type { ReactNode } from 'react'

import { Caret, Disclosure, DisclosureTrigger, Fold } from '../../primitives/Fold/Fold'
import s from './NoteDetails.module.css'

export interface NoteDetailsText {
  label: string
}

export const noteDetailsText: NoteDetailsText = { label: 'Details' }

/**
 * What a line of the thread is built on, kept under it: a host's raw answer, or failed checks' logs. Folded until asked for;
 * open, raw text is wrapped at the column and scrolls up and down inside a limit, never sideways. `drawn` content, such as
 * FailedLogs, lays itself out.
 */
export function NoteDetails({ children, text, drawn = false }: { children: ReactNode; text?: Partial<NoteDetailsText>; drawn?: boolean }) {
  const t = { ...noteDetailsText, ...text }
  return (
    <Disclosure className={s.details}>
      <DisclosureTrigger>
        <button type="button" className={s.trigger}>
          {t.label}
          <Caret />
        </button>
      </DisclosureTrigger>
      <Fold bleed={false}>{drawn ? <div className={s.drawn}>{children}</div> : <pre className={s.body}>{children}</pre>}</Fold>
    </Disclosure>
  )
}
