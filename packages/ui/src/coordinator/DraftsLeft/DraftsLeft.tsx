import { type ReactNode, useId } from 'react'

import { cx } from '../../lib/cx'
import { Heading, type HeadingLevel } from '../../primitives/Heading/Heading'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import s from './DraftsLeft.module.css'

/*
 * The issue drafts a project's finished tasks left, at the end of its
 * coordinator's conversation. A task done, merged or abandoned doesn't wait
 * in Needs you on an issue its lead drafted: its drafts wait here instead,
 * each its card, to file, change or discard, under the task it came from. The
 * same card is in the task's own thread: filed or discarded in either, it is
 * gone from both.
 */

export interface DraftsLeftText {
  heading: (count: number) => string
  about: (count: number) => string
  from: string
}

export const draftsLeftText: DraftsLeftText = {
  heading: (count) => (count === 1 ? '1 issue draft from a finished task' : `${count} issue drafts from finished tasks`),
  about: (count) =>
    count === 1
      ? 'Its task is settled. File it if you still want it, or discard it.'
      : 'Their tasks are settled. File each one you still want, or discard it.',
  from: 'From',
}

export interface DraftLeftEntry {
  readonly key: string
  /** The task it came from, by its title. */
  readonly task: string
  /** Opens that task. */
  readonly onOpenTask: () => void
  /** The draft's card, as its task's thread shows it. */
  readonly card: ReactNode
}

export interface DraftsLeftProps {
  drafts: ReadonlyArray<DraftLeftEntry>
  headingLevel?: HeadingLevel
  className?: string
  text?: Partial<DraftsLeftText>
}

export function DraftsLeft({ drafts, headingLevel = 2, className, text }: DraftsLeftProps) {
  const t = { ...draftsLeftText, ...text }
  const titleId = useId()
  if (drafts.length === 0) return null
  return (
    <section aria-labelledby={titleId} className={cx(s.left, className)}>
      <Heading level={headingLevel} id={titleId} className={s.title}>
        {t.heading(drafts.length)}
      </Heading>
      <p className={s.about}>{t.about(drafts.length)}</p>
      <ul className={s.list}>
        {drafts.map((draft) => (
          <li key={draft.key} className={s.entry}>
            <span className={s.from}>
              {t.from} <LinkButton onClick={draft.onOpenTask}>{draft.task}</LinkButton>
            </span>
            {draft.card}
          </li>
        ))}
      </ul>
    </section>
  )
}
