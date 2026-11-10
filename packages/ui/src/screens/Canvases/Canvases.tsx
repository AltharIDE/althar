import type { ReactNode } from 'react'

import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { Heading, type HeadingLevel } from '../../primitives/Heading/Heading'
import { type CanvasCard, CanvasList, type CanvasListText } from '../../thread/Canvas/CanvasList'
import s from './Canvases.module.css'

/*
 * A project's Canvases view (ADR-104): what its agents drew for the person to
 * look at and iterate on, every lead's and the coordinator's together, as
 * cards down one column. One opened takes the view, at its full width, and
 * its Close comes back to the list; it is the same canvas that opens beside
 * any conversation in the project.
 */

export interface CanvasesText {
  title: string
  line: string
  list?: Partial<CanvasListText>
}

export const canvasesText: CanvasesText = {
  title: 'Canvases',
  line: 'Every lead’s and the coordinator’s, for the whole project. Any of them can open and change one.',
}

export type CanvasesProps = RootProps<
  'div',
  {
    canvases: ReadonlyArray<CanvasCard>
    onOpen: (canvas: CanvasCard) => void
    /** The canvas open, drawn by the host: it takes the view. */
    open?: ReactNode
    error?: string
    headingLevel?: HeadingLevel
    text?: Partial<CanvasesText>
  }
>

export function Canvases({ canvases, onOpen, open, error, headingLevel = 1, text, className, ...rest }: CanvasesProps) {
  const t = { ...canvasesText, ...text }
  if (open !== undefined && open !== null && open !== false)
    return (
      <div className={cx(s.view, s.open, className)} {...rest}>
        {open}
      </div>
    )
  return (
    <div className={cx(s.view, className)} {...rest}>
      <div className={s.column}>
        <header className={s.head}>
          <Heading level={headingLevel} className={s.title}>
            {t.title}
          </Heading>
          {canvases.length > 0 && <p className={s.line}>{t.line}</p>}
        </header>
        {error !== undefined && <p className={s.error}>{error}</p>}
        <CanvasList canvases={canvases} onOpen={onOpen} {...(t.list === undefined ? {} : { text: t.list })} />
      </div>
    </div>
  )
}
