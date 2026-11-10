import { type ReactNode, useId } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import type { IconName } from '../../foundations/Icon/icons'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { Heading, type HeadingLevel } from '../../primitives/Heading/Heading'
import { type CanvasKind, canvasKindWords } from '../../thread/Canvas/canvas'
import s from './Artifacts.module.css'

/*
 * A project's Artifacts view (ADR-104): what its agents made to keep, every
 * lead's and the coordinator's together. Canvases are its first kind; more
 * join later, each a section of its own. Each artifact is a row, as a list
 * of files reads: what it is and its name, then who made its latest
 * version and when, in columns that line up down the list. Pressed, it
 * opens in the view's place, and its Close comes back to the list. Empty,
 * the view says what will be here and how it gets here.
 */

export interface ArtifactsText {
  title: string
  line: string
  canvases: string
  /** What a section's rows are, for assistive technology. */
  list: (section: string) => string
  version: (n: number) => string
  open: (n: number) => string
  emptyTitle: string
  empty: string
  kinds: Readonly<Record<CanvasKind, string>>
}

export const artifactsText: ArtifactsText = {
  title: 'Artifacts',
  line: 'What the project’s agents made to keep, every lead’s and the coordinator’s.',
  canvases: 'Canvases',
  list: (section) => `The project’s ${section.toLowerCase()}`,
  version: (n) => `v${n}`,
  open: (n) => (n === 1 ? '1 open comment' : `${n} open comments`),
  emptyTitle: 'Nothing kept yet',
  empty:
    'When a lead or the coordinator draws something for you to look at and iterate on (a mockup, a diagram, a chart, a page), it is kept here for the whole project.',
  kinds: canvasKindWords,
}

/** An artifact as its row shows it. Today every one is a canvas. */
export interface ArtifactRow {
  readonly id: string
  readonly name: string
  readonly title: string
  /** How a canvas is drawn: a document, a diagram, a drawing, a picture or a page. */
  readonly kind: CanvasKind
  readonly version: number
  /** Who made its latest version: “Lead of Redesign sign-in”, “Coordinator”. */
  readonly by: string
  /** When, in a few words: “4m ago”. */
  readonly when: string
  readonly openComments: number
}

/** Each kind's glyph, so a list of them is read at a glance. */
const GLYPHS: Readonly<Record<CanvasKind, IconName>> = {
  markdown: 'file',
  mermaid: 'canvas',
  svg: 'canvas',
  picture: 'image',
  html: 'globe',
}

export type ArtifactsProps = RootProps<
  'div',
  {
    canvases: ReadonlyArray<ArtifactRow>
    onOpen: (artifact: ArtifactRow) => void
    /** The artifact open, drawn by the host: it takes the view. */
    open?: ReactNode
    error?: string
    headingLevel?: HeadingLevel
    text?: Partial<ArtifactsText>
  }
>

export function Artifacts({ canvases, onOpen, open, error, headingLevel = 1, text, className, ...rest }: ArtifactsProps) {
  const t = { ...artifactsText, ...text }
  const sectionId = useId()
  if (open !== undefined && open !== null && open !== false)
    return (
      <div className={cx(s.view, s.open, className)} {...rest}>
        {open}
      </div>
    )
  const none = canvases.length === 0
  return (
    <div className={cx(s.view, className)} {...rest}>
      <div className={s.column}>
        <header className={s.head}>
          <Heading level={headingLevel} className={s.title}>
            {t.title}
          </Heading>
          <p className={s.line}>{t.line}</p>
        </header>
        {error !== undefined && <p className={s.error}>{error}</p>}
        {none ? (
          <div className={s.empty}>
            <span className={s.emptyGlyph} aria-hidden="true">
              <Icon name="canvas" size={16} />
            </span>
            <p className={s.emptyWords}>
              <span className={s.emptyTitle}>{t.emptyTitle}</span>
              {t.empty}
            </p>
          </div>
        ) : (
          <section className={s.section} aria-labelledby={sectionId}>
            <div className={s.sectionHead}>
              <Heading level={2} id={sectionId} className={s.sectionTitle}>
                {t.canvases}
              </Heading>
              <span className={s.count}>{canvases.length}</span>
            </div>
            <ul className={s.rows} aria-label={t.list(t.canvases)}>
              {canvases.map((canvas) => (
                <li key={canvas.id}>
                  <button type="button" className={s.row} onClick={() => onOpen(canvas)}>
                    <span className={s.glyph} aria-hidden="true">
                      <Icon name={GLYPHS[canvas.kind]} size={14} />
                    </span>
                    <span className={s.words}>
                      <span className={s.name}>{canvas.title}</span>
                      <span className={s.facts}>
                        <span className={s.slug}>{canvas.name}</span>
                        <span>
                          {t.kinds[canvas.kind]} · {t.version(canvas.version)}
                        </span>
                        {canvas.openComments > 0 && <span className={s.comments}>{t.open(canvas.openComments)}</span>}
                      </span>
                    </span>
                    <span className={s.by}>{canvas.by}</span>
                    <span className={s.when}>{canvas.when}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}
