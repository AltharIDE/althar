import { useEffect, useId, useRef } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { FieldError } from '../../primitives/Field/Field'
import { IconButton } from '../../primitives/IconButton/IconButton'
import s from './ProjectNotes.module.css'

/*
 * A project's notes, in its settings: the decisions the person made in
 * conversation with the coordinator that the code doesn't show, each a
 * card of its own, the sentence the coordinator kept set to be read, and
 * under it who kept it and when. They come in the order they are given.
 * Every session of the coordinator starts with them, so one that no longer
 * holds is taken out with its ×, and focus goes on to the next one's, or
 * back to the words above them once none is left. Nothing here adds one:
 * the coordinator keeps them as the person decides.
 */

export interface ProjectNotesText {
  /** What they are, above them. */
  line: string
  /** With none kept yet. */
  none: string
  /** The × that takes one out, by what it says. */
  remove: (note: string) => string
}

export const projectNotesText: ProjectNotesText = {
  line: 'Decisions you made in conversation that the code doesn’t show. The coordinator keeps them, and starts each session with them.',
  none: 'None yet. When you decide how something should go, the coordinator keeps it here.',
  remove: (note) => `Remove “${note}”`,
}

/** A note as it is shown: its id, what it says, and who kept it and when. */
export interface KeptNote {
  id: string
  body: string
  /** Who kept it and when, in a line under it: Kept by the coordinator · 12 Oct. */
  kept?: string
}

export type ProjectNotesProps = RootProps<
  'div',
  {
    notes: ReadonlyArray<KeptNote>
    /** Takes a note out: it no longer holds. */
    onRemove: (id: string) => void
    /** Why the last one taken out is still there. */
    error?: string
    text?: Partial<ProjectNotesText>
  }
>

/** A project's notes, a card each, each taken out with its ×. */
export function ProjectNotes({ notes, onRemove, error, text, className, ...rest }: ProjectNotesProps) {
  const t = { ...projectNotesText, ...text }
  const errorId = useId()
  const list = useRef<HTMLUListElement>(null)
  const line = useRef<HTMLParagraphElement>(null)
  // Where focus goes once a note is gone: to the × of the one that took its place, or the last; with none left, the words above.
  const refocus = useRef<number | null>(null)
  useEffect(() => {
    const at = refocus.current
    if (at === null) return
    refocus.current = null
    const removes = list.current?.querySelectorAll<HTMLElement>('[data-remove]') ?? []
    const next = removes[Math.min(at, removes.length - 1)]
    ;(next ?? line.current)?.focus()
  })
  return (
    <div className={cx(s.notes, className)} {...rest}>
      <p ref={line} tabIndex={-1} className={s.line}>
        {notes.length === 0 ? t.none : t.line}
      </p>
      {notes.length > 0 && (
        <ul ref={list} className={s.list}>
          {notes.map((note, index) => (
            <li key={note.id} className={s.note}>
              <Icon name="quote" size={14} className={s.mark} />
              <p className={s.body}>{note.body}</p>
              {note.kept !== undefined && <p className={s.kept}>{note.kept}</p>}
              <IconButton
                icon="close"
                size="small"
                label={t.remove(note.body)}
                className={s.remove}
                data-remove=""
                onClick={() => {
                  refocus.current = index
                  onRemove(note.id)
                }}
              />
            </li>
          ))}
        </ul>
      )}
      {error !== undefined && <FieldError id={errorId}>{error}</FieldError>}
    </div>
  )
}
