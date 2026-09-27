import { useEffect, useRef, useState } from 'react'

import { cx } from '../../lib/cx'
import { Button } from '../Button/Button'
import { Field } from '../Field/Field'
import s from './NoteForm.module.css'

/*
 * A one-line note sent with an action: sending a change back, saying why.
 * It takes focus when it appears. Enter or the button sends it, only when
 * there is something to send; Escape or Cancel puts it away.
 */

export interface NoteFormProps {
  /** What to write, as the field's placeholder and name. */
  placeholder: string
  /** The button that sends it: Send back. */
  submit: string
  cancel: string
  onSubmit: (note: string) => void
  onCancel: () => void
  className?: string
}

export function NoteForm({ placeholder, submit, cancel, onSubmit, onCancel, className }: NoteFormProps) {
  const [draft, setDraft] = useState('')
  const field = useRef<HTMLInputElement>(null)
  useEffect(() => {
    field.current?.focus()
  }, [])
  return (
    <form
      className={cx(s.form, className)}
      onSubmit={(e) => {
        e.preventDefault()
        const said = draft.trim()
        if (said) onSubmit(said)
      }}
    >
      <Field
        ref={field}
        className={s.field}
        value={draft}
        aria-label={placeholder}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return
          /* the form's Escape, not the panel's around it */
          e.preventDefault()
          e.stopPropagation()
          onCancel()
        }}
      />
      <Button variant="quiet" onClick={onCancel}>
        {cancel}
      </Button>
      <Button type="submit" disabled={!draft.trim()}>
        {submit}
      </Button>
    </form>
  )
}
