import { useId, useState } from 'react'

import { Button } from '../../primitives/Button/Button'
import { Dialog } from '../../primitives/Dialog/Dialog'
import { Field, FieldError } from '../../primitives/Field/Field'
import s from './RenameProject.module.css'

/*
 * A project's new name. The tab, the home and the mark's label take it;
 * the mark itself stays, as it was drawn for the project, and so do the
 * folders its tasks' worktrees are in.
 */

export interface RenameProjectText {
  title: string
  field: string
  note: string
  empty: string
  rename: string
  cancel: string
}

export const renameProjectText: RenameProjectText = {
  title: 'Rename the project',
  field: 'Name',
  note: 'Its mark and its tasks’ folders stay as they are.',
  empty: 'Name the project first',
  rename: 'Rename',
  cancel: 'Cancel',
}

export interface RenameProjectProps {
  /** Its name now, to start from. */
  name: string
  onRename: (name: string) => void
  onClose: () => void
  /** Renaming it now. */
  busy?: boolean
  /** Why it couldn't be renamed. */
  error?: string
  text?: Partial<RenameProjectText>
}

export function RenameProject({ name, onRename, onClose, busy = false, error, text }: RenameProjectProps) {
  const t = { ...renameProjectText, ...text }
  const [value, setValue] = useState(name)
  const [empty, setEmpty] = useState(false)
  const errorId = useId()
  const noteId = useId()
  const said = empty ? t.empty : error
  return (
    <Dialog
      title={t.title}
      onClose={onClose}
      onSubmit={() => {
        if (busy) return
        const trimmed = value.trim()
        if (trimmed === '') return setEmpty(true)
        if (trimmed === name) return onClose()
        onRename(trimmed)
      }}
      actions={
        <>
          <Button variant="quiet" onClick={onClose}>
            {t.cancel}
          </Button>
          <Button type="submit" busy={busy}>
            {t.rename}
          </Button>
        </>
      }
    >
      <div className={s.field}>
        <Field
          size="large"
          aria-label={t.field}
          value={value}
          invalid={said !== undefined}
          aria-describedby={said === undefined ? noteId : `${errorId} ${noteId}`}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => {
            setValue(event.target.value)
            setEmpty(false)
          }}
        />
        {said !== undefined && <FieldError id={errorId}>{said}</FieldError>}
        <p id={noteId} className={s.note}>
          {t.note}
        </p>
      </div>
    </Dialog>
  )
}
