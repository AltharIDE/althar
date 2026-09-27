import type { ReactNode } from 'react'

import { cx } from '../../lib/cx'
import s from './FormRow.module.css'

export interface FormRowProps {
  /** What the row sets. */
  label: string
  /** A line on what it covers, under the label. */
  note?: ReactNode
  /** The id of the control the label names, when it is one field. */
  htmlFor?: string
  children: ReactNode
  className?: string
}

/**
 * One setting in a panel of settings: its name and a line on what it
 * covers on the left, the control on the right, a rule above. Below 560px
 * of its container, the two stack.
 */
export function FormRow({ label, note, htmlFor, children, className }: FormRowProps) {
  const Label = htmlFor ? 'label' : 'div'
  return (
    <div className={cx(s.row, className)}>
      <Label className={s.label} htmlFor={htmlFor}>
        <span className={s.title}>{label}</span>
        {note && <span className={s.note}>{note}</span>}
      </Label>
      <div className={s.control}>{children}</div>
    </div>
  )
}
