import { Icon } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { useThreadShell } from '../Shell/Shell'
import { type CanvasKind, canvasKindWords, type CanvasRef } from './canvas'
import s from './Canvas.module.css'

/*
 * A canvas an agent drew or opened, in its turn (ADR-104): one quiet line, its
 * title the way in. Pressed, it opens that version beside the conversation,
 * where the host can; where it can't, the line is its words alone. The canvas
 * is the project's, so the line only says where it was drawn.
 */

export interface CanvasLineText {
  published: string
  opened: string
  version: (n: number) => string
  open: (title: string) => string
  kinds: Readonly<Record<CanvasKind, string>>
}

export const canvasLineText: CanvasLineText = {
  published: 'Drew',
  opened: 'Opened',
  version: (n) => `v${n}`,
  open: (title) => `Open ${title} beside the conversation`,
  kinds: canvasKindWords,
}

export type CanvasLineProps = RootProps<
  'div',
  {
    canvas: CanvasRef & { readonly version: number }
    /** What the agent did: published this version, or opened it. */
    action: 'published' | 'opened'
    /** What the version changed, in the agent's own line. */
    note?: string | null
    text?: Partial<CanvasLineText>
  }
>

export function CanvasLine({ canvas, action, note, text, className, ...rest }: CanvasLineProps) {
  const t = { ...canvasLineText, ...text }
  const { openCanvas, openedCanvas } = useThreadShell()
  const open = openedCanvas === canvas.canvasId
  const title = (
    <>
      <span className={s.lineTitle}>{canvas.title}</span>
      <span className={s.lineFacts}>
        {t.version(canvas.version)} · {t.kinds[canvas.kind]}
      </span>
    </>
  )
  return (
    <div className={cx(s.line, className)} {...rest}>
      <span className={s.lineTile} aria-hidden="true">
        <Icon name="canvas" size={14} />
      </span>
      <span className={s.lineMain}>
        <span className={s.lineHead}>
          <span className={s.lineVerb}>{action === 'published' ? t.published : t.opened}</span>
          {openCanvas === undefined ? (
            <span className={s.lineName}>{title}</span>
          ) : (
            <button
              type="button"
              className={cx(s.lineName, s.lineButton)}
              aria-label={t.open(canvas.title)}
              aria-pressed={open}
              onClick={() => openCanvas(canvas)}
            >
              {title}
            </button>
          )}
        </span>
        {note !== undefined && note !== null && note !== '' && <span className={s.lineNote}>{note}</span>}
      </span>
    </div>
  )
}
