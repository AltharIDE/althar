import { Icon } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { type CanvasKind, canvasKindWords } from './canvas'
import s from './Canvas.module.css'

/*
 * The project's canvases (ADR-104), as one list: each a card with what it is,
 * its name in the project, its latest version and who published it, and the
 * comments still open on it. Pressed, it opens beside the conversation. The
 * list is the project's, so every lead's canvases and the coordinator's are
 * here together; empty, it says how one gets here.
 */

export interface CanvasListText {
  label: string
  version: (n: number) => string
  open: (n: number) => string
  emptyTitle: string
  empty: string
  kinds: Readonly<Record<CanvasKind, string>>
}

export const canvasListText: CanvasListText = {
  label: 'The project’s canvases',
  version: (n) => `v${n}`,
  open: (n) => (n === 1 ? '1 open comment' : `${n} open comments`),
  emptyTitle: 'No canvases yet',
  empty:
    'When a lead or the coordinator draws something for you to look at and iterate on (a mockup, a diagram, a chart, a page), it is kept here for the whole project.',
  kinds: canvasKindWords,
}

/** A canvas as its card shows it. */
export interface CanvasCard {
  readonly id: string
  readonly name: string
  readonly title: string
  readonly kind: CanvasKind
  readonly version: number
  /** Who published the latest, and when, in words. */
  readonly by: string
  readonly openComments: number
}

export type CanvasListProps = RootProps<
  'div',
  {
    canvases: ReadonlyArray<CanvasCard>
    onOpen: (canvas: CanvasCard) => void
    /** The one open beside the conversation, by its id. */
    opened?: string | null
    text?: Partial<CanvasListText>
  }
>

export function CanvasList({ canvases, onOpen, opened = null, text, className, ...rest }: CanvasListProps) {
  const t = { ...canvasListText, ...text }
  if (canvases.length === 0)
    return (
      <div className={className} {...rest}>
        <p className={s.empty}>
          <span className={s.emptyTitle}>{t.emptyTitle}</span>
          {t.empty}
        </p>
      </div>
    )
  return (
    <div className={className} {...rest}>
      <ul className={s.list} aria-label={t.label}>
        {canvases.map((canvas) => (
          <li key={canvas.id} className={s.card}>
            <button type="button" className={s.cardButton} aria-pressed={opened === canvas.id} onClick={() => onOpen(canvas)}>
              <span className={s.cardHead}>
                <span className={s.lineTile} aria-hidden="true">
                  <Icon name="canvas" size={14} />
                </span>
                <span className={s.cardTitle}>{canvas.title}</span>
              </span>
              <span className={s.cardName}>
                {canvas.name} · {t.version(canvas.version)}
              </span>
              <span className={s.cardFacts}>
                <span>
                  {t.kinds[canvas.kind]} · {canvas.by}
                </span>
                {canvas.openComments > 0 && <span className={cx(s.cardOpen)}>{t.open(canvas.openComments)}</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
