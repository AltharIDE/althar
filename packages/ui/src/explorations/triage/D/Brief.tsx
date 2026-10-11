import { useId, type ReactNode } from 'react'

import { Rhythm } from '../../../lib/rhythm'
import { VisuallyHidden } from '../../../primitives/VisuallyHidden/VisuallyHidden'
import { CheckpointLine, type CheckpointLineProps, type CheckpointLineText } from '../B/CheckpointLine'
import { things } from '../model'
import { markOf } from '../parts/Assumptions'
import s from './Brief.module.css'

/*
 * D. The assumptions on the brief. Most of what a lead assumes is a reading
 * of what you asked for, so it is shown there: the words it read into are
 * marked in the brief, and its readings are under it, each with the words
 * it reads, or the file it is about, and No. The clock and Hold are B's
 * line, under the brief. Pointing at a reading marks its words.
 */

/** The brief, as written: plain words, and words a reading can mark, by the assumption's id. */
export type BriefPart = string | { readonly id: string; readonly text: string }

export interface BriefText {
  kicker: (task: string) => string
  /** For a screen reader, after marked words: which reading they have. */
  marked: (n: number) => string
  line: Partial<CheckpointLineText>
}

export const briefText: BriefText = {
  kicker: (task) => `What you asked · Task ${task}`,
  marked: (n) => ` (reading ${n})`,
  line: {
    assuming: (n) => `Taking it to mean ${things(n)}`,
    assumed: (n) => `Took it to mean ${things(n)}`,
    also: (n) => `Also taking it to mean ${things(n)}`,
  },
}

export type BriefProps = Omit<CheckpointLineProps, 'anchored' | 'text'> & {
  task: string
  brief: readonly BriefPart[]
  /** Before the lead has read it: no marks yet, and no readings. */
  unread?: boolean
  text?: Partial<BriefText>
}

export function Brief({ task, brief, unread = false, text, ...line }: BriefProps) {
  const t = { ...briefText, ...text }
  const kicker = useId()
  const assumptions = unread ? [] : line.assumptions
  const words: ReactNode[] = brief.map((part, i) => {
    if (typeof part === 'string') return part
    const n = assumptions.some((a) => a.id === part.id) ? markOf(assumptions, part.id) : undefined
    if (n === undefined) return part.text
    return (
      <mark key={i} className={s.mark} data-mark={n}>
        {part.text}
        <sup className={s.n} aria-hidden="true">
          {n}
        </sup>
        <VisuallyHidden>{t.marked(n)}</VisuallyHidden>
      </mark>
    )
  })
  return (
    <section className={s.brief} aria-labelledby={kicker} data-rhythm={Rhythm.Card}>
      <span id={kicker} className={s.kicker}>
        {t.kicker(task)}
      </span>
      <p className={s.text}>{words}</p>
      {assumptions.length > 0 && (
        <div className={s.readings}>
          <CheckpointLine {...line} assumptions={assumptions} anchored text={{ ...briefText.line, ...t.line }} />
        </div>
      )}
    </section>
  )
}
