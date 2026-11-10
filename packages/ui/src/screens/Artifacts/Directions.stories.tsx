import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'
import { type ReactNode, useState } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import type { IconName } from '../../foundations/Icon/icons'
import { Segmented } from '../../primitives/Segmented/Segmented'
import type { CanvasKind } from '../../thread/Canvas/canvas'
import { Artifacts } from './Artifacts'
import s from './Directions.module.css'

/*
 * Design directions for a project's Artifacts view (ADR-104): prototypes to
 * choose between, each with the same artifacts, beside the view as built.
 * None is wired to the app.
 *
 * - Built: the quiet list, a section for each kind.
 * - A, Shelf: what each looks like first, a miniature without a box.
 * - B, Ledger: dense, with a kind filter, search and sortable columns.
 * - C, By work: under the task each came from, with where that task stands.
 * - D, Timeline: every version, newest first, by day, with what it changed.
 */

interface Sample {
  readonly id: string
  readonly name: string
  readonly title: string
  readonly kind: CanvasKind
  readonly version: number
  readonly versions: ReadonlyArray<{ readonly n: number; readonly at: string; readonly day: string; readonly note: string | null }>
  readonly task: string | null
  readonly taskState: string
  readonly when: string
  readonly openComments: number
}

const SAMPLES: ReadonlyArray<Sample> = [
  {
    id: 'a',
    name: 'sign-in',
    title: 'Sign-in, three directions',
    kind: 'markdown',
    version: 3,
    versions: [
      { n: 3, at: '14:32', day: 'Today', note: 'Tighter spacing, as asked' },
      { n: 2, at: '11:05', day: 'Today', note: 'The picture on the left' },
      { n: 1, at: '17:40', day: 'Yesterday', note: 'First directions' },
    ],
    task: 'Redesign sign-in',
    taskState: 'Working',
    when: '4m ago',
    openComments: 1,
  },
  {
    id: 'b',
    name: 'sign-in-page',
    title: 'Sign-in page',
    kind: 'html',
    version: 2,
    versions: [
      { n: 2, at: '13:50', day: 'Today', note: 'Providers under the field' },
      { n: 1, at: '18:02', day: 'Yesterday', note: 'Direction A, as a page' },
    ],
    task: 'Build sign-in',
    taskState: 'In review',
    when: '46m ago',
    openComments: 0,
  },
  {
    id: 'c',
    name: 'architecture',
    title: 'How the runtime fits together',
    kind: 'mermaid',
    version: 5,
    versions: [{ n: 5, at: '12:20', day: 'Today', note: 'Canvases in the runtime' }],
    task: null,
    taskState: '',
    when: '2h ago',
    openComments: 0,
  },
  {
    id: 'd',
    name: 'checkout-funnel',
    title: 'Checkout funnel',
    kind: 'svg',
    version: 1,
    versions: [{ n: 1, at: '09:12', day: '8 Nov', note: null }],
    task: 'Funnel report',
    taskState: 'Done',
    when: '8 Nov',
    openComments: 2,
  },
  {
    id: 'e',
    name: 'empty-states',
    title: 'Empty states, before and after',
    kind: 'picture',
    version: 1,
    versions: [{ n: 1, at: '16:44', day: 'Yesterday', note: null }],
    task: 'Redesign sign-in',
    taskState: 'Working',
    when: 'Yesterday',
    openComments: 0,
  },
]

const KIND_WORDS: Readonly<Record<CanvasKind, string>> = {
  markdown: 'Document',
  mermaid: 'Diagram',
  svg: 'Drawing',
  picture: 'Picture',
  html: 'Page',
}

const GLYPHS: Readonly<Record<CanvasKind, IconName>> = {
  markdown: 'file',
  mermaid: 'canvas',
  svg: 'canvas',
  picture: 'image',
  html: 'globe',
}

const by = (one: Sample) => (one.task === null ? 'Coordinator' : `Lead of ${one.task}`)

function Glyph({ kind }: { kind: CanvasKind }) {
  return (
    <span className={s.glyph} aria-hidden="true">
      <Icon name={GLYPHS[kind]} size={14} />
    </span>
  )
}

function Page({ title, line, tools, children }: { title: string; line: string; tools?: ReactNode; children: ReactNode }) {
  return (
    <div className={s.view}>
      <div className={s.column}>
        <header className={s.head}>
          <div className={s.headWords}>
            <h1 className={s.title}>{title}</h1>
            <p className={s.line}>{line}</p>
          </div>
          {tools}
        </header>
        {children}
      </div>
    </div>
  )
}

const LINE = 'What the project’s agents made to keep, every lead’s and the coordinator’s.'

/* ——— the miniatures A draws ——— */

function Miniature({ kind }: { kind: CanvasKind }) {
  switch (kind) {
    case 'markdown':
      return (
        <div className={s.miniDoc}>
          <b>Sign in</b>
          Three directions for the sign-in page. Each keeps the email first.
          <div className={s.miniLine} style={{ width: '88%' }} />
          <div className={s.miniLine} style={{ width: '72%' }} />
          <div className={s.miniLine} style={{ width: '80%' }} />
          <div className={s.miniLine} style={{ width: '54%' }} />
        </div>
      )
    case 'html':
      return (
        <div className={s.miniPage}>
          <div className={s.miniCard}>
            <div className={s.miniLine} style={{ width: '70%', background: '#141417', height: 6 }} />
            <div className={s.miniField} />
            <div className={s.miniButton} />
          </div>
        </div>
      )
    case 'mermaid':
      return (
        <svg className={s.miniSvg} viewBox="0 0 240 150" aria-hidden="true">
          <rect width="240" height="150" fill="#fff" />
          {[
            [20, 62, 'Window'],
            [96, 30, 'Runtime'],
            [96, 94, 'Main'],
            [172, 62, 'Store'],
          ].map(([x, y, label]) => (
            <g key={String(label)}>
              <rect x={Number(x)} y={Number(y)} width="52" height="24" rx="3" fill="#f4f2ec" stroke="#d6d1c6" />
              <text x={Number(x) + 26} y={Number(y) + 15.5} fontSize="8" textAnchor="middle" fill="#45454c" fontFamily="Inter, sans-serif">
                {label}
              </text>
            </g>
          ))}
          <path d="M72 74 L96 42 M72 74 L96 106 M148 42 L172 74 M148 106 L172 74" stroke="#a8a295" fill="none" />
        </svg>
      )
    case 'svg':
      return (
        <svg className={s.miniSvg} viewBox="0 0 240 150" aria-hidden="true">
          <rect width="240" height="150" fill="#fff" />
          {[200, 140, 88, 52].map((width, at) => (
            <rect
              key={width}
              x="20"
              y={22 + at * 28}
              width={width}
              height="18"
              rx="4"
              fill={['#2b3bff', '#5563ff', '#8a94ff', '#bcc2ff'][at]}
            />
          ))}
        </svg>
      )
    case 'picture':
      return (
        <svg className={s.miniSvg} viewBox="0 0 240 150" aria-hidden="true">
          <rect width="240" height="150" fill="#f4f2ec" />
          <rect x="18" y="22" width="96" height="106" rx="6" fill="#fff" stroke="#e7e3da" />
          <rect x="126" y="22" width="96" height="106" rx="6" fill="#fff" stroke="#e7e3da" />
          <circle cx="66" cy="66" r="12" fill="#e7e3da" />
          <circle cx="174" cy="66" r="12" fill="#bcc2ff" />
          <rect x="40" y="88" width="52" height="5" rx="2" fill="#e7e3da" />
          <rect x="148" y="88" width="52" height="5" rx="2" fill="#141417" />
        </svg>
      )
  }
}

/* ——— the stories ——— */

const meta = {
  title: 'Prototypes/Artifacts directions',
  parameters: { layout: 'fullscreen' },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const rows = SAMPLES.map((one) => ({
  id: one.id,
  name: one.name,
  title: one.title,
  kind: one.kind,
  version: one.version,
  by: by(one),
  when: one.when,
  openComments: one.openComments,
}))

/** As built: the quiet list, a section for each kind. */
export const Built: Story = {
  render: () => (
    <div style={{ height: '100vh', background: 'var(--n-2)' }}>
      <Artifacts canvases={rows} onOpen={fn()} />
    </div>
  ),
}

/** A, Shelf: what each looks like first. A miniature of its latest version, on the page with no box, its title and facts under it. */
export const A_Shelf: Story = {
  render: () => (
    <Page title="Artifacts" line={LINE}>
      <ul className={s.shelf}>
        {SAMPLES.map((one) => (
          <li key={one.id}>
            <button type="button" className={s.shelfItem}>
              <span className={s.preview}>
                <Miniature kind={one.kind} />
              </span>
              <span className={s.shelfWords}>
                <span className={s.shelfTitle}>{one.title}</span>
                <span className={s.shelfFacts}>
                  {KIND_WORDS[one.kind]} · v{one.version} · {one.when}
                  {one.openComments > 0 && (
                    <>
                      {' · '}
                      <span className={s.strong}>{one.openComments === 1 ? '1 comment' : `${one.openComments} comments`}</span>
                    </>
                  )}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Page>
  ),
}

type Filter = 'all' | 'documents' | 'diagrams' | 'pages' | 'pictures'
const FILTER_KINDS: Readonly<Record<Filter, ReadonlyArray<CanvasKind>>> = {
  all: ['markdown', 'mermaid', 'svg', 'picture', 'html'],
  documents: ['markdown'],
  diagrams: ['mermaid', 'svg'],
  pages: ['html'],
  pictures: ['picture'],
}

function Ledger() {
  const [filter, setFilter] = useState<Filter>('all')
  const shown = SAMPLES.filter((one) => FILTER_KINDS[filter].includes(one.kind))
  return (
    <Page
      title="Artifacts"
      line={LINE}
      tools={
        <Segmented
          label="Kind"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'documents', label: 'Documents' },
            { value: 'diagrams', label: 'Diagrams' },
            { value: 'pages', label: 'Pages' },
            { value: 'pictures', label: 'Pictures' },
          ]}
        />
      }
    >
      <div className={s.tools}>
        <span className={s.search}>
          <Icon name="search" size={13} />
          Find an artifact
        </span>
        <span className={s.muted} style={{ fontSize: 12 }}>
          {shown.length} of {SAMPLES.length}
        </span>
      </div>
      <table className={s.table}>
        <thead>
          <tr>
            <th>Name</th>
            <th>Kind</th>
            <th className={s.num}>Versions</th>
            <th className={s.num}>Comments</th>
            <th>Made by</th>
            <th className={`${s.num} ${s.sorted}`}>Updated</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((one) => (
            <tr key={one.id}>
              <td>
                <span className={s.cellName}>
                  <Glyph kind={one.kind} />
                  <span>
                    {one.title}
                    <br />
                    <span className={s.mono}>{one.name}</span>
                  </span>
                </span>
              </td>
              <td>{KIND_WORDS[one.kind]}</td>
              <td className={s.num}>{one.version}</td>
              <td className={s.num}>
                {one.openComments === 0 ? <span className={s.muted}>—</span> : <span className={s.strong}>{one.openComments}</span>}
              </td>
              <td>{by(one)}</td>
              <td className={s.num}>{one.when}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Page>
  )
}

/** B, Ledger: dense, for a project with many. A kind filter, search, and columns to sort by, comments and versions counted. */
export const B_Ledger: Story = { render: () => <Ledger /> }

/** C, By work: under the task each came from, with where that task stands; the coordinator's on their own. */
export const C_ByWork: Story = {
  render: () => {
    const groups = [...new Set(SAMPLES.map((one) => one.task))]
    return (
      <Page title="Artifacts" line={LINE}>
        {groups.map((task) => {
          const mine = SAMPLES.filter((one) => one.task === task)
          const state = mine[0]?.taskState ?? ''
          return (
            <section key={task ?? 'coordinator'} className={s.work}>
              <div className={s.workHead}>
                <Icon name={task === null ? 'agents' : 'branch'} size={13} />
                <h2 className={s.workTitle}>{task ?? 'The coordinator'}</h2>
                {state !== '' && <span className={s.workState}>{state}</span>}
                {task !== null && <span className={s.workOpen}>Open task →</span>}
              </div>
              <ul className={s.rows}>
                {mine.map((one) => (
                  <li key={one.id} className={s.row}>
                    <Glyph kind={one.kind} />
                    <span className={s.words}>
                      <span className={s.name}>{one.title}</span>
                      <span className={s.facts}>
                        {KIND_WORDS[one.kind]} · v{one.version}
                        {one.openComments > 0 && (
                          <span className={s.strong}>
                            {' '}
                            · {one.openComments === 1 ? '1 open comment' : `${one.openComments} open comments`}
                          </span>
                        )}
                      </span>
                    </span>
                    <span className={s.when}>{one.when}</span>
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
      </Page>
    )
  },
}

/** D, Timeline: every version, newest first, by day, with who made it and what it changed: the iteration shows. */
export const D_Timeline: Story = {
  render: () => {
    const events = SAMPLES.flatMap((one) => one.versions.map((version) => ({ one, version })))
    const days = [...new Set(events.map((event) => event.version.day))]
    return (
      <Page title="Artifacts" line={LINE}>
        {days.map((day) => (
          <section key={day} className={s.day}>
            <h2 className={s.dayHead}>{day}</h2>
            {events
              .filter((event) => event.version.day === day)
              .toSorted((a, b) => (a.version.at < b.version.at ? 1 : -1))
              .map(({ one, version }) => (
                <div key={`${one.id}-${version.n}`} className={s.event}>
                  <span className={s.eventTime}>{version.at}</span>
                  <Glyph kind={one.kind} />
                  <span className={s.eventSaid}>
                    <span className={s.muted}>{by(one)}</span> {version.n === 1 ? 'drew' : 'changed'} <b>{one.title}</b>{' '}
                    <span className={s.mono}>v{version.n}</span>
                    {version.note !== null && <span className={s.note}>{version.note}</span>}
                  </span>
                </div>
              ))}
          </section>
        ))}
      </Page>
    )
  },
}
