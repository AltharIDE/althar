import type { CSSProperties, ReactNode } from 'react'

import { cx } from '../../lib/cx'
import { ResizeHandle } from '../../primitives/ResizeHandle/ResizeHandle'
import s from './Workbench.module.css'

/*
 * The conversation's right side: one column for what opens beside the
 * thread, whatever it is (a document a lead wrote, a file an agent named;
 * later a page of what runs), one at a time, beside the thread and never
 * over it. It is raised off the page in the page's own tone, as the
 * conversation beside the board is, and as wide as the person drags its
 * edge; the width is the host's to keep. What opens from inside it goes on
 * top of what was there, which stays under it, hidden, until Back.
 */

export interface WorkbenchText {
  /** Its edge's name. */
  width: string
}

export const workbenchText: WorkbenchText = { width: 'Width of the panel' }

export interface WorkbenchProps {
  /** What is open on it: a SidePanel, with what it was opened from under it, hidden. */
  children: ReactNode
  /** Its width now, in px, as the host keeps it. */
  width: number
  min: number
  /** The widest it may be, leaving the conversation its measure. */
  max: number
  onWidth: (width: number) => void
  /** Where a move ended, to keep. */
  onCommit?: (width: number) => void
  /** Back to its first width, on a double click of its edge. */
  onReset?: () => void
  /** The edge it is dragged by: its start, beside the conversation; its end where it opens to the conversation's right over something else. */
  edge?: 'start' | 'end'
  text?: Partial<WorkbenchText>
  className?: string
  style?: CSSProperties
}

export function Workbench({
  children,
  width,
  min,
  max,
  onWidth,
  onCommit,
  onReset,
  edge = 'start',
  text,
  className,
  style,
}: WorkbenchProps) {
  const t = { ...workbenchText, ...text }
  return (
    <div className={cx(s.bench, className)} style={style} data-workbench="">
      {children}
      <ResizeHandle
        value={Math.min(width, max)}
        min={min}
        max={max}
        onChange={onWidth}
        label={t.width}
        edge={edge}
        {...(onCommit === undefined ? {} : { onCommit })}
        {...(onReset === undefined ? {} : { onReset })}
      />
    </div>
  )
}
