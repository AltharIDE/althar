import { type ReactNode, useEffect, useRef, useState } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { Field } from '../../primitives/Field/Field'
import { Heading, type HeadingLevel } from '../../primitives/Heading/Heading'
import { Tooltip } from '../../primitives/HoverCard/HoverCard'
import { VisuallyHidden } from '../../primitives/VisuallyHidden/VisuallyHidden'
import s from './BackCrumb.module.css'

/*
 * When a task takes the whole window, the way out sits where the eye
 * starts, like a breadcrumb: back to the project, with its key, then which
 * task this is. Given a way to rename it, the title is a button that turns
 * into a field in place: Enter keeps what was typed, Escape puts it back,
 * and leaving the field keeps it too, as a project's name does. A title
 * emptied is not kept.
 */

export interface BackCrumbText {
  label: string
  back: (to: string) => string
  /** The title's button and field, which rename it. */
  rename: string
  /** Why an emptied title isn't kept. */
  empty: string
}

export const backCrumbText: BackCrumbText = {
  label: 'Where you are',
  back: (to) => `Back to ${to}`,
  rename: 'Rename',
  empty: 'Give the task a title.',
}

export interface BackCrumbProps {
  /** Where back goes: the project's name. */
  to: string
  onBack: () => void
  /** The key that goes back, said in the way back's tooltip; the consumer binds it. */
  kbd?: string
  /** Where you are now: the task's number. */
  task?: string
  title?: string
  /** The title as the page's heading, at this rank, where the bar is all the head the page has. */
  titleLevel?: HeadingLevel
  /** Renames it to a new title, trimmed and different from the one it has. Without it, the title is only read. */
  onRename?: (title: string) => void
  /** How long a title may be. */
  maxLength?: number
  /** Whether the title is being edited, where the consumer starts that too (its menu); otherwise the crumb keeps track. */
  editing?: boolean
  onEditingChange?: (editing: boolean) => void
  text?: Partial<BackCrumbText>
}

export function BackCrumb({
  to,
  onBack,
  kbd,
  task,
  title,
  titleLevel,
  onRename,
  maxLength,
  editing: editingProp,
  onEditingChange,
  text,
}: BackCrumbProps) {
  const t = { ...backCrumbText, ...text }
  const [own, setOwn] = useState(false)
  const editing = (editingProp ?? own) && onRename !== undefined && title !== undefined
  const setEditing = (next: boolean) => {
    setOwn(next)
    onEditingChange?.(next)
  }
  // What is typed while editing; the title itself until then.
  const [draft, setDraft] = useState('')
  const [problem, setProblem] = useState(false)
  const field = useRef<HTMLInputElement>(null)
  // Set once the edit is over, so the blur of a field taken away doesn't keep it a second time.
  const finished = useRef(false)
  useEffect(() => {
    if (!editing) return
    finished.current = false
    setDraft(title ?? '')
    setProblem(false)
    field.current?.focus()
    field.current?.select()
    // Only as it opens: the title changing under a field being typed in doesn't take the typing away.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing])

  /** Keeps what was typed: a new title goes out; an emptied one stays to be fixed after Enter, and goes back when focus leaves. */
  const keep = (leaving: boolean) => {
    if (finished.current) return
    const trimmed = draft.trim()
    if (trimmed === '') {
      if (leaving) {
        finished.current = true
        setEditing(false)
      } else setProblem(true)
      return
    }
    finished.current = true
    setEditing(false)
    if (trimmed !== title) onRename?.(trimmed)
  }
  const heading = (inside: ReactNode) =>
    titleLevel === undefined ? (
      <span className={s.title}>{inside}</span>
    ) : (
      // One line, however long it was written: the whole of it on hover.
      <Heading level={titleLevel} className={s.title} title={title}>
        {inside}
      </Heading>
    )
  // Back to the project, by its name; its key says itself in a tooltip, not as a chip on the bar.
  const back = (
    <button type="button" className={s.back} onClick={onBack} aria-label={t.back(to)}>
      <Icon name="arrow" size={12} className={s.arrow} />
      {to}
    </button>
  )
  return (
    <nav className={s.crumb} aria-label={t.label}>
      {kbd === undefined ? (
        back
      ) : (
        <Tooltip label={t.back(to)} kbd={kbd} placement="below">
          {back}
        </Tooltip>
      )}
      {(task || title) && (
        <>
          <span className={s.sep} aria-hidden="true">
            /
          </span>
          <span className={s.here} aria-current="page">
            {task && <span className={s.task}>{task}</span>}
            {title &&
              (editing ? (
                <span className={s.edit}>
                  <Field
                    ref={field}
                    value={draft}
                    maxLength={maxLength}
                    invalid={problem}
                    aria-label={t.rename}
                    className={s.field}
                    // Escape puts the title back before it closes anything.
                    data-own-escape=""
                    onChange={(event) => {
                      setDraft(event.target.value)
                      setProblem(false)
                    }}
                    onKeyDown={(event) => {
                      // Enter and Escape that finish or cancel what an input method is composing are its own.
                      if (event.nativeEvent.isComposing) return
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        keep(false)
                      } else if (event.key === 'Escape') {
                        event.preventDefault()
                        finished.current = true
                        setEditing(false)
                      }
                    }}
                    onBlur={() => keep(true)}
                  />
                  {problem && (
                    <span role="alert">
                      <VisuallyHidden>{t.empty}</VisuallyHidden>
                    </span>
                  )}
                </span>
              ) : onRename === undefined ? (
                heading(title)
              ) : (
                heading(
                  <button
                    type="button"
                    className={s.rename}
                    aria-label={`${t.rename}: ${title}`}
                    title={title}
                    onClick={() => setEditing(true)}
                  >
                    {title}
                  </button>,
                )
              ))}
          </span>
        </>
      )}
    </nav>
  )
}
