import { createContext, useContext, useId, type ReactNode } from 'react'

import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import s from './FormRow.module.css'

/*
 * A row names its control. The control, whatever it is (a Field, a Select, a
 * Choices group), reads the row's label and note from context and points at
 * them, so the name you see is the name a screen reader hears.
 */
interface RowLabel {
  labelId: string
  noteId?: string
}

const Row = createContext<RowLabel | null>(null)

/**
 * The name for a control: its own `label` when it has one, otherwise the
 * FormRow around it. A control with neither is unnamed, which the story's
 * accessibility check catches.
 */
export function useControlName(label?: string): { 'aria-label'?: string; 'aria-labelledby'?: string; 'aria-describedby'?: string } {
  const row = useContext(Row)
  if (label !== undefined) return { 'aria-label': label, 'aria-describedby': row?.noteId }
  if (row) return { 'aria-labelledby': row.labelId, 'aria-describedby': row.noteId }
  return {}
}

export type FormRowProps = RootProps<
  'div',
  {
    /** What the row sets. */
    label: string
    /** A line on what it covers, under the label. It describes the control. */
    note?: ReactNode
    /** The id of a native control the label names (a Field). Controls built on Radix find the row themselves. */
    htmlFor?: string
    children: ReactNode
  }
>

/**
 * One setting in a panel of settings: its name and a line on what it
 * covers on the left, the control on the right, a rule above. Below 560px
 * of its container, the two stack.
 */
export function FormRow({ label, note, htmlFor, children, className, ...rest }: FormRowProps) {
  const base = useId()
  const ids: RowLabel = { labelId: `${base}-label`, noteId: note ? `${base}-note` : undefined }
  const Label = htmlFor ? 'label' : 'div'
  return (
    <div className={cx(s.row, className)} {...rest}>
      <Label className={s.label} htmlFor={htmlFor}>
        <span className={s.title} id={ids.labelId}>
          {label}
        </span>
        {note && (
          <span className={s.note} id={ids.noteId}>
            {note}
          </span>
        )}
      </Label>
      <div className={s.control}>
        <Row.Provider value={ids}>{children}</Row.Provider>
      </div>
    </div>
  )
}
