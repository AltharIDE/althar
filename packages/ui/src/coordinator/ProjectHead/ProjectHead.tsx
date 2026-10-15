import type { ReactNode } from 'react'

import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import s from './ProjectHead.module.css'

/*
 * The head of a project's conversation, over the thread in its column: what
 * the project is (its intent, or its name) and a quiet line under it, as the
 * prototype has it: two lines, nothing under them. The project's menu is on
 * the window's bar. The title is the screen's heading. `side` is the narrow
 * head of the conversation beside the board, on its raised column.
 */

export type ProjectHeadProps = RootProps<
  'header',
  {
    title: string
    /** The quiet line under the title: where the project is, or when its intent was set. */
    meta?: ReactNode
    /** Beside the board, in a narrow column. */
    side?: boolean
  }
>

export function ProjectHead({ title, meta, side = false, className, ...rest }: ProjectHeadProps) {
  return (
    <header className={cx(s.head, side && s.side, className)} {...rest}>
      <div className={s.measure}>
        <h1 className={s.title}>{title}</h1>
        {meta != null && <p className={s.meta}>{meta}</p>}
      </div>
    </header>
  )
}
