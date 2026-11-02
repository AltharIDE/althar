import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'

import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { Button } from '../../primitives/Button/Button'
import { FieldArea, FieldError } from '../../primitives/Field/Field'
import { IconButton } from '../../primitives/IconButton/IconButton'
import { Markdown } from '../../thread/Markdown/Markdown'
import s from './ProjectNotes.module.css'

/*
 * A project's notes, in its settings: the decisions the person made in
 * conversation with the coordinator that the code doesn't show, each a
 * card as tall as its words, set to be read (its code, links and emphasis
 * as markdown has them), and under it who kept it and when. They come in
 * the order they are given, as many across as the width holds. Every
 * session of the coordinator starts with them, so one is said in other
 * words where it is, with its pencil (Enter keeps it, Escape puts it back),
 * and one that no longer holds is taken out with its ×; focus goes on to
 * the next one's ×, or to the line saying there are none. Nothing here adds
 * one: the coordinator keeps them as the person decides.
 */

export interface ProjectNotesText {
  /** With none kept yet. */
  none: string
  /** The pencil that changes one, by what it says. */
  edit: (note: string) => string
  /** The × that takes one out, by what it says. */
  remove: (note: string) => string
  /** The field a note is changed in. */
  field: string
  save: string
  cancel: string
  /** Close to how long a note may be: how many characters are left. */
  left: (n: number) => string
}

export const projectNotesText: ProjectNotesText = {
  none: 'None yet',
  edit: (note) => `Edit “${note}”`,
  remove: (note) => `Remove “${note}”`,
  field: 'Note',
  save: 'Save',
  cancel: 'Cancel',
  left: (n) => (n === 1 ? '1 character left' : `${n} characters left`),
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
    /** Says a note in other words, the person's, on one line. Without it, notes aren't changed here. */
    onEdit?: (id: string, body: string) => void
    /** Takes a note out: it no longer holds. */
    onRemove: (id: string) => void
    /** How long a note may be, in characters. */
    limit?: number
    /** Why the last change to one didn't hold. */
    error?: string
    text?: Partial<ProjectNotesText>
  }
>

/** How close to the limit the characters left are said. */
const NEAR = 40

/** A note's words as they are kept: on one line, without space at either end. */
const said = (draft: string) => draft.trim().replace(/\s+/g, ' ')

/** A project's notes, a card each, each changed with its pencil and taken out with its ×. */
export function ProjectNotes({ notes, onEdit, onRemove, limit, error, text, className, ...rest }: ProjectNotesProps) {
  const t = { ...projectNotesText, ...text }
  const errorId = useId()
  const root = useRef<HTMLDivElement>(null)
  const [editing, setEditing] = useState<string | null>(null)
  // Where focus goes next: after one is taken out, the × of the one that took its place, or the last, or the line saying
  // none is left; after one is changed or put back, its own pencil.
  const refocus = useRef<{ readonly removed: number } | { readonly edited: string } | null>(null)
  useEffect(() => {
    const next = refocus.current
    if (next === null) return
    refocus.current = null
    const here = root.current
    if (here === null) return
    if ('edited' in next) {
      here.querySelector<HTMLElement>(`[data-edit="${CSS.escape(next.edited)}"]`)?.focus()
      return
    }
    const removes = here.querySelectorAll<HTMLElement>('[data-remove]')
    ;(removes[Math.min(next.removed, removes.length - 1)] ?? here.querySelector<HTMLElement>('[data-none]'))?.focus()
  })
  const done = (id: string) => {
    refocus.current = { edited: id }
    setEditing(null)
  }
  return (
    <div ref={root} className={cx(s.notes, className)} {...rest}>
      {notes.length === 0 ? (
        <p tabIndex={-1} className={s.none} data-none="">
          {t.none}
        </p>
      ) : (
        <ul className={s.list}>
          {notes.map((note, index) => (
            <li key={note.id} className={s.note}>
              {editing === note.id && onEdit !== undefined ? (
                <Editor
                  body={note.body}
                  limit={limit}
                  t={t}
                  onSave={(body) => {
                    if (body !== note.body) onEdit(note.id, body)
                    done(note.id)
                  }}
                  onCancel={() => done(note.id)}
                />
              ) : (
                <>
                  <Markdown source={note.body} className={s.body} />
                  <div className={s.foot}>
                    {note.kept !== undefined && <p className={s.kept}>{note.kept}</p>}
                    <span className={s.actions}>
                      {onEdit !== undefined && (
                        <IconButton
                          icon="pencil"
                          size="small"
                          label={t.edit(note.body)}
                          data-edit={note.id}
                          onClick={() => setEditing(note.id)}
                        />
                      )}
                      <IconButton
                        icon="close"
                        size="small"
                        label={t.remove(note.body)}
                        data-remove=""
                        onClick={() => {
                          refocus.current = { removed: index }
                          onRemove(note.id)
                        }}
                      />
                    </span>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {error !== undefined && <FieldError id={errorId}>{error}</FieldError>}
    </div>
  )
}

/** A note's words to change, in a field as tall as they are: Enter keeps them, Escape puts them back. */
function Editor({
  body,
  limit,
  t,
  onSave,
  onCancel,
}: {
  body: string
  limit: number | undefined
  t: ProjectNotesText
  onSave: (body: string) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState(body)
  const field = useRef<HTMLTextAreaElement>(null)
  const words = said(draft)
  const left = limit === undefined ? null : limit - words.length
  useLayoutEffect(() => {
    const at = field.current
    if (at === null) return
    at.focus()
    at.setSelectionRange(at.value.length, at.value.length)
  }, [])
  // As tall as what is in it.
  useLayoutEffect(() => {
    const at = field.current
    if (at === null) return
    at.style.height = 'auto'
    at.style.height = `${at.scrollHeight + 2}px`
  }, [draft])
  const save = () => {
    if (words !== '') onSave(words)
  }
  return (
    <div className={s.editor}>
      <FieldArea
        ref={field}
        aria-label={t.field}
        value={draft}
        rows={2}
        {...(limit === undefined ? {} : { maxLength: limit })}
        data-own-escape=""
        className={s.field}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          // Enter and Escape that finish or cancel what an input method is composing are its own.
          if (event.nativeEvent.isComposing) return
          if (event.key === 'Enter') {
            event.preventDefault()
            save()
          } else if (event.key === 'Escape') {
            event.preventDefault()
            onCancel()
          }
        }}
      />
      <div className={s.editorFoot}>
        {left !== null && left <= NEAR && <span className={s.left}>{t.left(Math.max(left, 0))}</span>}
        <span className={s.buttons}>
          <Button size="small" variant="quiet" onClick={onCancel}>
            {t.cancel}
          </Button>
          <Button size="small" variant="ink" disabled={words === ''} onClick={save}>
            {t.save}
          </Button>
        </span>
      </div>
    </div>
  )
}
