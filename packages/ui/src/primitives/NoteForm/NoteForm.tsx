import { useEffect, useId, useRef, useState } from 'react'

import { cx } from '../../lib/cx'
import { Button } from '../Button/Button'
import { Field, FieldError } from '../Field/Field'
import s from './NoteForm.module.css'

/*
 * A one-line note sent with an action: sending a change back, saying why.
 * It takes focus when it appears. Enter or the button sends it; sent empty,
 * it says what is missing rather than greying the button out. Escape or
 * Cancel, from anywhere in the form, puts it away.
 */

export interface NoteFormText {
  /** What to write, as the field's placeholder and name. */
  placeholder: string
  /** The button that sends it: Send back. */
  submit: string
  cancel: string
  /** Said when it is sent empty. */
  empty: string
}

export const noteFormText: NoteFormText = {
  placeholder: 'Add a note',
  submit: 'Send',
  cancel: 'Cancel',
  empty: 'Write a note first',
}

export interface NoteFormProps {
  onSubmit: (note: string) => void
  onCancel: () => void
  /** What the field starts with. */
  defaultValue?: string
  /** Sending: the button says so and ignores presses. */
  pending?: boolean
  className?: string
  text?: Partial<NoteFormText>
}

export function NoteForm({ onSubmit, onCancel, defaultValue = '', pending = false, className, text }: NoteFormProps) {
  const t = { ...noteFormText, ...text }
  const [draft, setDraft] = useState(defaultValue)
  const [missing, setMissing] = useState(false)
  const field = useRef<HTMLInputElement>(null)
  const errorId = useId()
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
        else {
          setMissing(true)
          field.current?.focus()
        }
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return
        /* the form's Escape, not the panel's around it */
        e.preventDefault()
        e.stopPropagation()
        onCancel()
      }}
    >
      <Field
        ref={field}
        className={s.field}
        value={draft}
        aria-label={t.placeholder}
        placeholder={t.placeholder}
        invalid={missing}
        aria-describedby={missing ? errorId : undefined}
        onChange={(e) => {
          setDraft(e.target.value)
          if (e.target.value.trim()) setMissing(false)
        }}
      />
      <Button variant="quiet" onClick={onCancel}>
        {t.cancel}
      </Button>
      <Button type="submit" busy={pending}>
        {t.submit}
      </Button>
      {missing && (
        <span className={s.error}>
          <FieldError id={errorId}>{t.empty}</FieldError>
        </span>
      )}
    </form>
  )
}
