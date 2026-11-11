import { type ReactNode, useMemo, useState } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import type { IconName } from '../../foundations/Icon/icons'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { Heading, type HeadingLevel } from '../../primitives/Heading/Heading'
import { Segmented } from '../../primitives/Segmented/Segmented'
import { type CanvasKind, canvasKindWords } from '../../thread/Canvas/canvas'
import s from './Artifacts.module.css'

/*
 * A project's Artifacts view (ADR-104): what its agents made to keep, every
 * lead's and the coordinator's together, as one table. Canvases are its first
 * kind; more join later, and the table holds them as it holds many. A filter
 * by kind, where there is more than one, and a search narrow it; its columns
 * sort it, by when each was last updated unless the person says. A row
 * opens its artifact in the view's place, and its Close comes back to the
 * table. Empty, a wall of faint drawings of what agents draw stands where
 * the table will be and fades out, with what will be here where it thins.
 */

export interface ArtifactsText {
  title: string
  line: string
  table: string
  kind: string
  all: string
  search: string
  shown: (shown: number, of: number) => string
  columns: Readonly<Record<SortKey, string>>
  none: string
  noMatch: (words: string) => string
  emptyTitle: string
  empty: string
  kinds: Readonly<Record<CanvasKind, string>>
}

export const artifactsText: ArtifactsText = {
  title: 'Artifacts',
  line: 'What the project’s agents made to keep, every lead’s and the coordinator’s.',
  table: 'The project’s artifacts',
  kind: 'Kind',
  all: 'All',
  search: 'Find an artifact',
  shown: (shown, of) => (shown === of ? String(of) : `${shown} of ${of}`),
  columns: { title: 'Name', kind: 'Kind', versions: 'Versions', comments: 'Comments', by: 'Made by', updated: 'Updated' },
  none: 'none',
  noMatch: (words) => `Nothing matches “${words}”.`,
  emptyTitle: 'No artifacts yet',
  empty: 'Mockups, diagrams and charts your agents draw are kept here.',
  kinds: canvasKindWords,
}

/** An artifact as its row shows it. Today every one is a canvas. */
export interface ArtifactRow {
  readonly id: string
  readonly name: string
  readonly title: string
  /** How a canvas is drawn: a document, a diagram, a drawing, a picture or a page. */
  readonly kind: CanvasKind
  /** Its latest version, which is how many it has. */
  readonly version: number
  /** Who made its latest version: “Lead of Redesign sign-in”, “Coordinator”. */
  readonly by: string
  /** When, in a few words: “4m ago”; and as a time, to sort by. */
  readonly when: string
  readonly at: string
  readonly openComments: number
}

/** What the table sorts by: a column. */
export type SortKey = 'title' | 'kind' | 'versions' | 'comments' | 'by' | 'updated'

interface Sort {
  readonly key: SortKey
  readonly descending: boolean
}

/** Each kind's glyph, so a column of them is read at a glance. */
const GLYPHS: Readonly<Record<CanvasKind, IconName>> = {
  markdown: 'file',
  mermaid: 'canvas',
  svg: 'canvas',
  picture: 'image',
  html: 'globe',
}

/* ——— None yet: what agents draw, small and faint, a wall of them ——— */

const Mockup = () => (
  <svg viewBox="0 0 120 84">
    <rect x="10" y="10" width="100" height="8" rx="2" className={s.ink2} />
    <rect x="10" y="26" width="46" height="48" rx="3" className={s.ink1} />
    <rect x="64" y="26" width="46" height="6" rx="2" className={s.ink2} />
    <rect x="64" y="38" width="38" height="6" rx="2" className={s.ink2} />
    <rect x="64" y="60" width="28" height="12" rx="3" className={s.ink3} />
  </svg>
)
const Diagram = () => (
  <svg viewBox="0 0 120 84">
    <rect x="8" y="14" width="32" height="18" rx="4" className={s.ink1} />
    <rect x="80" y="14" width="32" height="18" rx="4" className={s.ink1} />
    <rect x="44" y="54" width="32" height="18" rx="4" className={s.ink3} />
    <path d="M40 23 H80 M24 32 L52 54 M96 32 L68 54" className={s.stroke} />
  </svg>
)
const Chart = () => (
  <svg viewBox="0 0 120 84">
    <path d="M12 74 H108" className={s.stroke} />
    <rect x="18" y="46" width="12" height="28" rx="2" className={s.ink1} />
    <rect x="38" y="34" width="12" height="40" rx="2" className={s.ink1} />
    <rect x="58" y="50" width="12" height="24" rx="2" className={s.ink1} />
    <rect x="78" y="22" width="12" height="52" rx="2" className={s.ink3} />
    <rect x="96" y="30" width="12" height="44" rx="2" className={s.ink1} />
  </svg>
)
const Document = () => (
  <svg viewBox="0 0 120 84">
    <rect x="14" y="12" width="56" height="8" rx="2" className={s.ink3} />
    <rect x="14" y="28" width="92" height="5" rx="2" className={s.ink2} />
    <rect x="14" y="38" width="84" height="5" rx="2" className={s.ink2} />
    <rect x="14" y="48" width="90" height="5" rx="2" className={s.ink2} />
    <rect x="14" y="62" width="60" height="5" rx="2" className={s.ink2} />
  </svg>
)
const Picture = () => (
  <svg viewBox="0 0 120 84">
    <rect x="10" y="10" width="100" height="64" rx="4" className={s.ink1} />
    <circle cx="86" cy="28" r="7" className={s.ink3} />
    <path d="M10 74 L44 40 L66 60 L80 48 L110 74 Z" className={s.ink2} />
  </svg>
)
const Sequence = () => (
  <svg viewBox="0 0 120 84">
    <path d="M30 12 V72 M90 12 V72" className={s.stroke} />
    <path d="M30 26 H88 M90 44 H32 M30 60 H88" className={s.stroke} />
    <rect x="20" y="8" width="20" height="8" rx="2" className={s.ink3} />
    <rect x="80" y="8" width="20" height="8" rx="2" className={s.ink1} />
  </svg>
)

const DRAWINGS = [Mockup, Diagram, Chart, Document, Picture, Sequence]

/** Three rows of six, each row shifted two along, so no column repeats down the wall. */
const WALL = Array.from({ length: 18 }, (_, i) => DRAWINGS[(i * 5 + Math.floor(i / 6) * 2) % DRAWINGS.length]!)

/** The order the kinds are offered in, where the project has them. */
const KINDS: ReadonlyArray<CanvasKind> = ['markdown', 'mermaid', 'svg', 'picture', 'html']

/** Numbers and times start newest or largest first; words start at A. */
const FIRST_DESCENDING: ReadonlySet<SortKey> = new Set(['versions', 'comments', 'updated'])

/** The rows the table shows: of the kind chosen, matching the words, in the order asked. */
export const shownRows = (
  rows: ReadonlyArray<ArtifactRow>,
  kind: CanvasKind | 'all',
  words: string,
  sort: Sort,
  kinds: Readonly<Record<CanvasKind, string>> = canvasKindWords,
): ReadonlyArray<ArtifactRow> => {
  const asked = words.trim().toLowerCase()
  const value = (row: ArtifactRow): string | number => {
    switch (sort.key) {
      case 'title':
        return row.title.toLowerCase()
      case 'kind':
        return kinds[row.kind]
      case 'versions':
        return row.version
      case 'comments':
        return row.openComments
      case 'by':
        return row.by.toLowerCase()
      case 'updated':
        return row.at
    }
  }
  return rows
    .filter((row) => kind === 'all' || row.kind === kind)
    .filter(
      (row) => asked === '' || row.title.toLowerCase().includes(asked) || row.name.includes(asked) || row.by.toLowerCase().includes(asked),
    )
    .toSorted((a, b) => {
      const x = value(a)
      const y = value(b)
      const order = x < y ? -1 : x > y ? 1 : 0
      return sort.descending ? -order : order
    })
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
  const [kind, setKind] = useState<CanvasKind | 'all'>('all')
  const [words, setWords] = useState('')
  const [sort, setSort] = useState<Sort>({ key: 'updated', descending: true })
  const present = useMemo(() => KINDS.filter((one) => canvases.some((row) => row.kind === one)), [canvases])
  // A kind no artifact has any longer shows nothing: back to all of them.
  const chosen = kind === 'all' || present.includes(kind) ? kind : 'all'
  const rows = useMemo(() => shownRows(canvases, chosen, words, sort, t.kinds), [canvases, chosen, words, sort, t.kinds])

  if (open !== undefined && open !== null && open !== false)
    return (
      <div className={cx(s.view, s.opened, className)} {...rest}>
        {open}
      </div>
    )
  const none = canvases.length === 0
  const sortBy = (key: SortKey) =>
    setSort((was) => (was.key === key ? { key, descending: !was.descending } : { key, descending: FIRST_DESCENDING.has(key) }))
  const header = (key: SortKey, numeric = false, className?: string) => (
    <th
      scope="col"
      className={cx(numeric && s.num, className)}
      aria-sort={sort.key === key ? (sort.descending ? 'descending' : 'ascending') : 'none'}
    >
      <button type="button" className={cx(s.sort, sort.key === key && s.sorted)} onClick={() => sortBy(key)}>
        {t.columns[key]}
        <span className={s.arrow} aria-hidden="true">
          {sort.key === key ? (sort.descending ? '↓' : '↑') : ''}
        </span>
      </button>
    </th>
  )
  return (
    <div className={cx(s.view, className)} {...rest}>
      <div className={s.column}>
        <header className={s.head}>
          <div className={s.headWords}>
            <Heading level={headingLevel} className={s.title}>
              {t.title}
            </Heading>
            <p className={s.line}>{t.line}</p>
          </div>
          {present.length > 1 && (
            <Segmented
              label={t.kind}
              value={chosen}
              onChange={setKind}
              options={[{ value: 'all' as const, label: t.all }, ...present.map((one) => ({ value: one, label: t.kinds[one] }))]}
            />
          )}
        </header>
        {error !== undefined && <p className={s.error}>{error}</p>}
        {none ? (
          <div className={s.empty}>
            <div className={s.wall} aria-hidden="true">
              {WALL.map((Drawing, i) => (
                <span key={i} className={s.tile}>
                  <Drawing />
                </span>
              ))}
            </div>
            <p className={s.emptyWords}>
              <span className={s.emptyTitle}>{t.emptyTitle}</span>
              {t.empty}
            </p>
          </div>
        ) : (
          <>
            <div className={s.tools}>
              <label className={s.search}>
                <Icon name="search" size={13} />
                <input
                  type="search"
                  value={words}
                  onChange={(e) => setWords(e.target.value)}
                  placeholder={t.search}
                  aria-label={t.search}
                />
              </label>
              <span className={s.count}>{t.shown(rows.length, canvases.length)}</span>
            </div>
            <table className={s.table} aria-label={t.table}>
              <thead>
                <tr>
                  {header('title')}
                  {header('kind', false, s.wide)}
                  {header('versions', true, s.wide)}
                  {header('comments', true)}
                  {header('by', false, s.wide)}
                  {header('updated', true)}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className={s.noMatch}>
                      {t.noMatch(words.trim())}
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr key={row.id} className={s.row} onClick={() => onOpen(row)}>
                      <td>
                        <span className={s.name}>
                          <span className={s.glyph} aria-hidden="true">
                            <Icon name={GLYPHS[row.kind]} size={14} />
                          </span>
                          <span className={s.words}>
                            {/* The row opens it; this is its way in from the keyboard, and its name to assistive technology. */}
                            <button type="button" className={s.open} onClick={(e) => (e.stopPropagation(), onOpen(row))}>
                              {row.title}
                            </button>
                            <span className={s.slug}>{row.name}</span>
                          </span>
                        </span>
                      </td>
                      <td className={s.wide}>{t.kinds[row.kind]}</td>
                      <td className={cx(s.num, s.wide)}>{row.version}</td>
                      <td className={s.num}>
                        {row.openComments === 0 ? (
                          <span className={s.zero} aria-label={t.none}>
                            —
                          </span>
                        ) : (
                          <span className={s.comments}>{row.openComments}</span>
                        )}
                      </td>
                      <td className={cx(s.by, s.wide)}>{row.by}</td>
                      <td className={cx(s.num, s.when)}>{row.when}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  )
}
