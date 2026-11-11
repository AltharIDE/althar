import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@althar/ui/styles.css'
import '../../src/renderer/app.css'

import { type KeyboardEvent as ReactKeyboardEvent, StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

import { BoardLane, type BoardFolds, ChromeButton, Heading, NO_FOLDS, ResizeHandle, Room, Segmented } from '@althar/ui'

import { ServicesProvider } from '../../src/renderer/data/services'
import { useBoard } from '../../src/renderer/features/board/useBoard'
import { useConnections } from '../../src/renderer/features/connections/useConnections'
import { type HomeParts, ProjectView } from '../../src/renderer/features/project/ProjectView'
import { useProject } from '../../src/renderer/features/project/useProject'
import p from '../../src/renderer/features/project/Project.module.css'
import { fakeClient, fakeHost } from '../../tests/fixtures'
import { servicesFor, useSettingsOf } from '../../tests/render'
import { board, coordinator } from './data'
import s from './lab.module.css'

/*
 * The home lab (README.md): a project's real home, its header, conversation,
 * composer and board, laid out four ways for closing either pane. 1–4, or
 * the bar along the bottom, swap the direction; c and b close and open the
 * conversation and the board, or switch between them where only one fits;
 * w switches wide and narrow, t light and dark. What each direction leaves
 * open is kept per project, as the app would.
 */

const directions = [
  { key: 'a', letter: 'A', label: 'Close buttons on the split' },
  { key: 'b', letter: 'B', label: 'Toggles in the header' },
  { key: 'c', letter: 'C', label: 'Board opens beside the conversation' },
  { key: 'd', letter: 'D', label: 'Conversation is a drawer' },
  { key: 'e', letter: 'E', label: 'One at a time' },
] as const
type Direction = (typeof directions)[number]['key']

const params = new URLSearchParams(location.search)
const NARROW = 760

const services = servicesFor(fakeClient({ getBoard: async () => board, getCoordinator: async () => coordinator }).client, fakeHost())

/** What a direction leaves open, kept per project (here, the one): each direction its own, so they don't clobber. */
interface Layout {
  readonly talk: boolean
  readonly board: boolean
  /** The conversation on the right of the board. */
  readonly swapped: boolean
  /** Where only one pane fits: the one showing. */
  readonly one: 'talk' | 'board'
  /** D: the drawer pinned open beside the board. */
  readonly pinned: boolean
  readonly width: number
}
const START: Record<Direction, Layout> = {
  a: { talk: true, board: true, swapped: false, one: 'talk', pinned: false, width: 520 },
  b: { talk: true, board: true, swapped: false, one: 'talk', pinned: false, width: 520 },
  c: { talk: true, board: false, swapped: false, one: 'talk', pinned: false, width: 640 },
  d: { talk: false, board: true, swapped: false, one: 'board', pinned: false, width: 480 },
  e: { talk: true, board: false, swapped: false, one: 'talk', pinned: false, width: 520 },
}
const PROJECT = 'p1'
const keyOf = (d: Direction) => `lab.home.${d}.${PROJECT}`
/** What the address asks open, for a screenshot: talk=0, board=1, pinned=1, swapped=1, one=board. */
const asked = (): Partial<Layout> => {
  const flag = (name: string) => (params.has(name) ? { [name]: params.get(name) === '1' } : {})
  const one = params.get('one')
  return { ...flag('talk'), ...flag('board'), ...flag('pinned'), ...flag('swapped'), ...(one === 'talk' || one === 'board' ? { one } : {}) }
}
const read = (d: Direction): Layout => {
  if (params.get('d') === d && Object.keys(asked()).length > 0) return { ...START[d], ...asked() }
  try {
    const raw = localStorage.getItem(keyOf(d))
    return raw === null ? START[d] : { ...START[d], ...(JSON.parse(raw) as Partial<Layout>) }
  } catch {
    return START[d]
  }
}

const LANES = Object.values(BoardLane)
const ALL_FOLDED: BoardFolds = { collapsed: LANES, opened: [] }

/** Whether a key was pressed while typing, where c and b are letters. */
const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || target.closest('input, textarea, select, [role="textbox"], [role="dialog"]') !== null)

/** Enter in a composer outside the conversation: once it has sent, the conversation opens to show the answer. */
const onSend = (open: () => void) => (event: ReactKeyboardEvent) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) setTimeout(open, 0)
}

/** The project's other views, with Home in place of Home, Conversation and Board. */
const ROOMS = [Room.Both, Room.Automations, Room.Artifacts, Room.Settings] as const

function Arranged({
  parts,
  direction,
  narrow,
  layout,
  change,
}: {
  parts: HomeParts
  direction: Direction
  narrow: boolean
  layout: Layout
  change: (next: Partial<Layout>) => void
}) {
  const [folds, setFolds] = useState<BoardFolds>(NO_FOLDS)
  const { glance } = parts
  // Never both closed: closing the one open opens the other.
  const toggle = (pane: 'talk' | 'board') => {
    if (narrow || direction === 'e') return change({ one: pane })
    const other = pane === 'talk' ? 'board' : 'talk'
    const open = !layout[pane]
    change(open || layout[other] ? { [pane]: open } : { [pane]: false, [other]: true })
  }
  const openTalk = () => (narrow ? change({ one: 'talk' }) : change({ talk: true }))

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || typing(event.target)) return
      if (event.key === 'Escape' && direction === 'd' && layout.talk && !layout.pinned) return change({ talk: false })
      if (event.key !== 'c' && event.key !== 'b') return
      event.preventDefault()
      const pane = event.key === 'c' ? 'talk' : 'board'
      if (direction === 'c' && pane === 'talk') return parts.focusComposer()
      if (direction === 'd' && pane === 'board') return
      toggle(pane)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const boardOf = (place?: 'rails') =>
    parts.board({
      folds: place === 'rails' ? ALL_FOLDED : folds,
      // Folded to its rails, a rail pressed opens the board again.
      onFoldsChange: place === 'rails' ? () => change({ board: true }) : setFolds,
      onTalk: () => {
        openTalk()
        parts.focusComposer()
      },
    })

  // Where only one fits, a switch between them in the header, its dot saying something waits on the board.
  const one = ((narrow && (direction === 'a' || direction === 'b')) || direction === 'e') && (
    <Segmented
      label="Pane"
      value={layout.one}
      onChange={(one) => change({ one })}
      options={[
        { value: 'talk', label: 'Conversation', tooltip: { label: 'Conversation', kbd: 'C' } },
        {
          value: 'board',
          label: 'Board',
          tooltip: { label: 'Board', kbd: 'B' },
          ...(glance.yours > 0 && layout.one !== 'board' ? { dot: 'yours' as const, dotLabel: `${glance.yours} need you` } : {}),
        },
      ]}
    />
  )

  if (direction === 'a' || direction === 'e') {
    const header = parts.header({ rooms: ROOMS, ...(one === false ? {} : { actions: one }) })
    if (narrow || direction === 'e')
      return (
        <>
          {header}
          <div className={p.rooms}>
            {layout.one === 'talk' ? (
              <div className={p.talk}>{parts.conversation(false, true)}</div>
            ) : direction === 'e' ? (
              <div className={s.boardWithComposer}>
                {boardOf()}
                <div className={s.docked} onKeyDownCapture={onSend(openTalk)}>
                  {parts.composer}
                </div>
              </div>
            ) : (
              boardOf()
            )}
          </div>
        </>
      )
    const talk = layout.talk ? (
      <div className={`${p.talk} ${s.pane}`} style={layout.board ? { width: layout.width } : undefined}>
        <ChromeButton className={s.close} icon="close" label="Close the conversation" compact kbd="C" onClick={() => toggle('talk')} />
        {parts.conversation(layout.board, true)}
        {layout.board && (
          <ResizeHandle
            value={layout.width}
            min={340}
            max={900}
            edge={layout.swapped ? 'start' : 'end'}
            onChange={(width) => change({ width })}
            label="Width of the conversation"
          />
        )}
      </div>
    ) : (
      <div className={s.edge}>
        <ChromeButton icon="comment" label="Open the conversation" compact kbd="C" onClick={() => toggle('talk')} />
      </div>
    )
    const work = layout.board ? (
      <div className={s.boardPane}>
        <ChromeButton className={s.close} icon="close" label="Close the board" compact kbd="B" onClick={() => toggle('board')} />
        {boardOf()}
      </div>
    ) : (
      <div className={s.rails}>{boardOf('rails')}</div>
    )
    return (
      <>
        {header}
        <div className={`${p.rooms} ${layout.talk && layout.board ? p.both : ''}`}>
          {talk}
          {work}
        </div>
      </>
    )
  }

  if (direction === 'b') {
    const toggles = narrow ? (
      one
    ) : (
      <>
        <ChromeButton
          icon="comment"
          label="Conversation"
          compact
          kbd="C"
          aria-pressed={layout.talk}
          className={layout.talk ? s.on : undefined}
          onClick={() => toggle('talk')}
        />
        <ChromeButton
          icon="work"
          label={glance.yours > 0 && !layout.board ? `Board, ${glance.yours} need you` : 'Board'}
          compact
          kbd="B"
          aria-pressed={layout.board}
          className={layout.board ? s.on : undefined}
          {...(layout.board ? {} : { count: glance.yours })}
          onClick={() => toggle('board')}
        />
        {layout.talk && layout.board && (
          <ChromeButton icon="move" label="Swap sides" compact onClick={() => change({ swapped: !layout.swapped })} />
        )}
        <span className={s.divider} />
      </>
    )
    const header = parts.header({ rooms: ROOMS, ...(toggles === false ? {} : { actions: toggles }) })
    const talkOn = narrow ? layout.one === 'talk' : layout.talk
    const boardOn = narrow ? layout.one === 'board' : layout.board
    const both = talkOn && boardOn
    return (
      <>
        {header}
        <div className={`${p.rooms} ${both ? p.both : ''} ${layout.swapped && both ? s.swapped : ''}`}>
          {talkOn && (
            <div className={p.talk} style={both ? { width: layout.width } : undefined}>
              {parts.conversation(both, true)}
              {both && (
                <ResizeHandle
                  value={layout.width}
                  min={340}
                  max={900}
                  edge={layout.swapped ? 'start' : 'end'}
                  onChange={(width) => change({ width })}
                  label="Width of the conversation"
                />
              )}
            </div>
          )}
          {boardOn && (
            <div className={s.boardWithComposer}>
              {boardOf()}
              {/* The conversation closed, its composer stays under the board; sent, the conversation opens for the answer. */}
              {!talkOn && (
                <div className={s.docked} onKeyDownCapture={onSend(openTalk)}>
                  {parts.composer}
                </div>
              )}
            </div>
          )}
        </div>
      </>
    )
  }

  if (direction === 'c') {
    const open = layout.board
    const header = parts.header({
      rooms: ROOMS,
      actions: (
        <>
          <ChromeButton
            icon="work"
            label={open ? 'Board' : glance.yours > 0 ? `Board, ${glance.yours} need you` : 'Board'}
            kbd="B"
            aria-pressed={open}
            className={open ? s.on : undefined}
            {...(open ? {} : { count: glance.yours })}
            onClick={() => change({ board: !open })}
          />
          <span className={s.divider} />
        </>
      ),
    })
    return (
      <>
        {header}
        <div className={p.rooms}>
          <div className={p.talk}>{parts.conversation(open, true)}</div>
          {open && (
            <div className={`${s.beside} ${narrow ? s.sheet : ''}`} style={narrow ? undefined : { width: layout.width }}>
              {!narrow && (
                <ResizeHandle
                  value={layout.width}
                  min={420}
                  max={1100}
                  edge="start"
                  onChange={(width) => change({ width })}
                  label="Width of the board"
                />
              )}
              <div className={s.besideBar}>
                <Heading level={2} className={s.besideTitle}>
                  Board
                </Heading>
                <ChromeButton icon="close" label="Close the board" compact kbd="B" onClick={() => change({ board: false })} />
              </div>
              {boardOf()}
            </div>
          )}
        </div>
      </>
    )
  }

  // D: the board is home; the conversation slides in over it, or pinned, beside it.
  const drawer = layout.talk
  const pinned = layout.pinned && !narrow
  const header = parts.header({
    rooms: ROOMS,
    actions: (
      <>
        <ChromeButton
          icon="comment"
          label="Conversation"
          kbd="C"
          aria-pressed={drawer}
          className={drawer ? s.on : undefined}
          onClick={() => change({ talk: !drawer })}
        />
        <span className={s.divider} />
      </>
    ),
  })
  return (
    <>
      {header}
      <div className={`${p.rooms} ${s.drawerRoom}`}>
        <div className={s.boardWithComposer}>
          {boardOf()}
          {!drawer && (
            <div className={s.floating} onKeyDownCapture={onSend(() => change({ talk: true }))}>
              {parts.composer}
            </div>
          )}
        </div>
        {drawer && (
          <div
            className={`${s.drawer} ${pinned ? s.pinned : ''} ${narrow ? s.sheet : ''}`}
            style={narrow ? undefined : { width: layout.width }}
          >
            {!narrow && (
              <ResizeHandle
                value={layout.width}
                min={380}
                max={900}
                edge="start"
                onChange={(width) => change({ width })}
                label="Width of the conversation"
              />
            )}
            <div className={s.besideBar}>
              <Heading level={2} className={s.besideTitle}>
                Coordinator
              </Heading>
              {!narrow && (
                <ChromeButton
                  icon="pin"
                  label={pinned ? 'Let it slide over the board' : 'Keep it beside the board'}
                  compact
                  aria-pressed={pinned}
                  className={pinned ? s.on : undefined}
                  onClick={() => change({ pinned: !pinned })}
                />
              )}
              <ChromeButton icon="close" label="Close the conversation" compact kbd="C" onClick={() => change({ talk: false })} />
            </div>
            <div className={s.drawerFace}>{parts.conversation(true, true)}</div>
          </div>
        )}
      </div>
    </>
  )
}

function Home({ direction, narrow }: { direction: Direction; narrow: boolean }) {
  const [layout, setLayout] = useState<Layout>(() => read(direction))
  const change = (next: Partial<Layout>) =>
    setLayout((was) => {
      const now = { ...was, ...next }
      localStorage.setItem(keyOf(direction), JSON.stringify(now))
      return now
    })
  return (
    <ProjectView
      model={useProject(PROJECT)}
      board={useBoard(PROJECT)}
      connections={useConnections()}
      settings={useSettingsOf(PROJECT)}
      onTask={() => undefined}
      room={Room.Both}
      arrange={(parts) => <Arranged parts={parts} direction={direction} narrow={narrow} layout={layout} change={change} />}
    />
  )
}

function Lab() {
  const [direction, setDirection] = useState<Direction>((params.get('d') as Direction | null) ?? 'a')
  const [narrow, setNarrow] = useState(params.get('narrow') === '1')
  const [theme, setTheme] = useState(params.get('theme') === 'dark' ? 'dark' : 'light')
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || typing(event.target)) return
      const picked = directions[Number(event.key) - 1]
      if (picked !== undefined) setDirection(picked.key)
      if (event.key === 'w') setNarrow((was) => !was)
      if (event.key === 't') setTheme((was) => (was === 'dark' ? 'light' : 'dark'))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => {
    const url = new URL(location.href)
    url.searchParams.set('d', direction)
    url.searchParams.set('narrow', narrow ? '1' : '0')
    url.searchParams.set('theme', theme)
    history.replaceState(null, '', url)
  }, [direction, narrow, theme])
  return (
    <div className={s.lab}>
      <main className={s.stage}>
        <div className={s.window} style={narrow ? { width: NARROW } : undefined}>
          <Home key={direction} direction={direction} narrow={narrow} />
        </div>
      </main>
      <nav className={s.bar} aria-label="Directions" hidden={params.get('shot') === '1'}>
        {directions.map((one, index) => (
          <button key={one.key} type="button" aria-pressed={direction === one.key} onClick={() => setDirection(one.key)}>
            <kbd>{index + 1}</kbd> {one.letter} · {one.label}
          </button>
        ))}
        <span className={s.gap} />
        <button type="button" aria-pressed={narrow} onClick={() => setNarrow((was) => !was)}>
          <kbd>w</kbd> {narrow ? 'Narrow' : 'Wide'}
        </button>
        <button type="button" onClick={() => setTheme((was) => (was === 'dark' ? 'light' : 'dark'))}>
          <kbd>t</kbd> {theme === 'dark' ? 'Dark' : 'Light'}
        </button>
        <span className={s.hint}>
          <kbd>c</kbd> conversation · <kbd>b</kbd> board
        </span>
      </nav>
    </div>
  )
}

const root = document.getElementById('root')
if (root !== null)
  createRoot(root).render(
    <StrictMode>
      <ServicesProvider value={services}>
        <Lab />
      </ServicesProvider>
    </StrictMode>,
  )
