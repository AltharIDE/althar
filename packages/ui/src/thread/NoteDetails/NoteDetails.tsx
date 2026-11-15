import type { ReactNode } from 'react'

import { Caret, Disclosure, DisclosureTrigger, Fold } from '../../primitives/Fold/Fold'
import s from './NoteDetails.module.css'

export interface NoteDetailsText {
  label: string
}

export const noteDetailsText: NoteDetailsText = { label: 'Details' }

/**
 * What a line of the thread is built on, kept under it: a host's raw answer. Folded until asked for; open, it is wrapped at the
 * column and scrolls up and down inside a limit, never sideways.
 */
export function NoteDetails({ children, text }: { children: ReactNode; text?: Partial<NoteDetailsText> }) {
  const t = { ...noteDetailsText, ...text }
  return (
    <Disclosure className={s.details}>
      <DisclosureTrigger>
        <button type="button" className={s.trigger}>
          {t.label}
          <Caret />
        </button>
      </DisclosureTrigger>
      <Fold bleed={false}>
        <pre className={s.body}>{children}</pre>
      </Fold>
    </Disclosure>
  )
}
