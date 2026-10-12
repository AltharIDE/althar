import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '../../src/styles/global.css'
import './proto.css'

import { type ReactNode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

import { ChromeButton } from '../../src/chrome/ChromeButton/ChromeButton'
import { LoadMeter } from '../../src/chrome/LoadMeter/LoadMeter'
import { ProjectTabs } from '../../src/chrome/ProjectTabs/ProjectTabs'
import { LOAD_BUSY } from '../../src/fixtures/load'
import { MARKED } from '../../src/fixtures/marks'
import { Icon } from '../../src/foundations/Icon/Icon'
import { IconButton } from '../../src/primitives/IconButton/IconButton'
import {
  ControlDetail,
  ControlGrid,
  ControlLine,
  ControlModule,
  ControlSheet,
  ControlToggle,
} from '../../src/setup/ControlCenter/ControlCenter'
import { KeepAwake, SettingList, SettingSwitch } from '../../src/setup/Preferences/Preferences'

/* ---- the directions ---------------------------------------------------------------- */

type Id = 'a' | 'b' | 'c' | 'd' | 'e'

interface Direction {
  id: Id
  letter: string
  name: string
  pitch: string
  /** What the peek's switch says under it, pointing at the way back. */
  showNote: string
  good: string[]
  costs: string[]
}

const DIRECTIONS: Direction[] = [
  {
    id: 'a',
    letter: 'A',
    name: 'Its own tile',
    pitch:
      'A round switch of its own in the Settings grid, “CPU & memory”, right under Keep awake. Its line is the current load when on, “Hidden from the bar” when off. The circle brings it back in one press; its name opens a sheet of its own.',
    showNote: 'Settings → CPU & memory brings it back.',
    good: ['The tile names the thing: nothing to guess.', 'One press to bring it back, no sheet to open.', 'Glance of the load even while hidden from the bar.'],
    costs: ['A whole row of the grid for a minor setting; Agents moves down.','Sets a precedent: every bar item wants its own tile.'],
  },
  {
    id: 'b',
    letter: 'B',
    name: 'A “This Mac” tile',
    pitch:
      'Keep awake stops being a round switch and becomes a “This Mac” module that says both things at a glance: awake while work runs, and whether CPU & memory shows in the bar. It opens the same sheet as today.',
    showNote: 'Settings → This Mac brings it back.',
    good: ['The tile is named for the place it opens: the mismatch goes away.', 'Room for more Mac things later (open files in, battery).', 'No new switch; the sheet already exists.'],
    costs: ['Keep awake loses its one-press circle: two presses now.', 'Bringing the meter back is still two steps (tile, then switch).'],
  },
  {
    id: 'c',
    letter: 'C',
    name: 'A trace in the bar',
    pitch:
      'Hiding leaves a faint glyph where the meter was; hovering says “Show CPU & memory”, a click brings it back. Right-clicking the bar’s empty stretch also lists what it can show, with a check.',
    showNote: 'A faint mark stays in its place; click it to bring it back.',
    good: ['The way back is exactly where it went.', 'No Settings trip at all.', 'Right-click is the Mac’s own idiom for toolbar items.'],
    costs: ['Hidden isn’t fully hidden: some will want it gone.', 'Right-click is invisible to most people; it can only be a second way.'],
  },
  {
    id: 'd',
    letter: 'D',
    name: 'Say where, as it hides',
    pitch:
      'Hiding from the peek shows a short note under the bar: “CPU & memory hidden. Settings → This Mac brings it back.” with Undo and a button that opens the exact sheet, the switch highlighted.',
    showNote: 'You’ll be told where to turn it back on.',
    good: ['Teaches the place at the moment it matters.', 'Undo covers the mis-click.', 'No change to the grid; cheap to build.'],
    costs: ['Only helps the person who reads it then; a week later they’ve forgotten.', 'Still sends them to a tile called “Keep awake”, unless paired with A or B.'],
  },
  {
    id: 'e',
    letter: 'E',
    name: 'Search and ⌘K',
    pitch:
      'Settings gets a search field over the grid: “cpu”, “memory”, “meter”, “load” all find the switch, in place. ⌘K offers “Show CPU & memory” as a command.',
    showNote: 'Search Settings or press ⌘K to bring it back.',
    good: ['Finds anything, not just this; scales as Settings grows.', 'Works for whatever word the person thinks of.'],
    costs: ['They have to think to search; the person here looked at the grid.', 'Most work to build (an index of settings, a palette).'],
  },
]

const byId = (id: Id) => DIRECTIONS.find((d) => d.id === id) as Direction

/* ---- shared state of a scene ------------------------------------------------------- */

type View = 'all' | 'mac'

interface Scene {
  shown: boolean
  setShown: (on: boolean) => void
  awake: boolean
  setAwake: (on: boolean) => void
  view: View
  setView: (v: View) => void
  /** A setting row to flash, when something sends the person straight to it. */
  flash: boolean
  setFlash: (on: boolean) => void
}

function useScene(shown0 = true): Scene {
  const [shown, setShown] = useState(shown0)
  const [awake, setAwake] = useState(true)
  const [view, setView] = useState<View>('all')
  const [flash, setFlash] = useState(false)
  return { shown, setShown, awake, setAwake, view, setView, flash, setFlash }
}

const still = (shown: boolean, view: View = 'all'): Scene => ({
  shown,
  setShown: () => {},
  awake: true,
  setAwake: () => {},
  view,
  setView: () => {},
  flash: false,
  setFlash: () => {},
})

const pct = (n: number) => `${Math.round(n * 100)}%`
const glance = `CPU ${pct(LOAD_BUSY.cpu)} · MEM ${pct(LOAD_BUSY.memory)}`

/* ---- the bar ----------------------------------------------------------------------- */

const tabs = MARKED.slice(0, 3).map((p) => ({ id: p.id, name: p.name, seed: p.id, ink: p.ink, running: p.running, yours: 0 }))
const noop = () => {}

function Bar({ dir, scene, live, onHidden }: { dir: Direction; scene: Scene; live: boolean; onHidden?: () => void }) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  useEffect(() => {
    if (menu === null) return
    const close = () => setMenu(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [menu])

  const meter = scene.shown ? (
    <LoadMeter
      load={LOAD_BUSY}
      onOpen={noop}
      onHide={
        live
          ? () => {
              scene.setShown(false)
              onHidden?.()
            }
          : noop
      }
      text={{ showNote: dir.showNote }}
    />
  ) : dir.id === 'c' ? (
    <button type="button" className="trace" title="Show CPU & memory" aria-label="Show CPU & memory" onClick={() => scene.setShown(true)}>
      <Icon name="load" size={14} />
      <span className="traceTip">Show CPU &amp; memory</span>
    </button>
  ) : null

  return (
    <div
      className="barWrap"
      onContextMenu={
        dir.id === 'c' && live
          ? (e) => {
              e.preventDefault()
              const box = e.currentTarget.getBoundingClientRect()
              setMenu({ x: e.clientX - box.left, y: e.clientY - box.top })
            }
          : undefined
      }
    >
      <ProjectTabs
        lights="drawn"
        tabs={tabs}
        current={MARKED[0]?.id ?? null}
        yours={0}
        others={[]}
        onSelect={noop}
        onClose={noop}
        onOpen={noop}
        onNewProject={noop}
        end={
          <>
            {meter}
            <ChromeButton icon="plus" label="New task" onClick={noop} />
            <IconButton icon="gear" label="Settings" size="small" />
          </>
        }
      />
      {menu !== null && (
        <div className="ctxMenu" style={{ left: menu.x, top: menu.y }} role="menu">
          <div className="ctxHead">Show in the bar</div>
          <button type="button" role="menuitemcheckbox" aria-checked={scene.shown} onClick={() => scene.setShown(!scene.shown)}>
            <span className="tick">{scene.shown ? '✓' : ''}</span>CPU &amp; memory
          </button>
          <button type="button" role="menuitemcheckbox" aria-checked={true} disabled>
            <span className="tick">✓</span>New task
          </button>
          <hr />
          <button type="button" role="menuitem" onClick={noop}>
            <span className="tick" />
            Settings…
          </button>
        </div>
      )}
      {dir.id === 'c' && live && <p className="hint">Right-click the bar’s empty stretch for its menu.</p>}
    </div>
  )
}

/* ---- Settings ---------------------------------------------------------------------- */

const SETTINGS_INDEX = [
  { key: 'load', words: 'cpu memory meter load usage how hard this mac works bar activity performance', where: 'This Mac' },
  { key: 'awake', words: 'keep awake sleep caffeine battery', where: 'This Mac' },
  { key: 'notify', words: 'notifications sound alerts bell', where: 'Notifications' },
]

function Rest({ agentsRows = [3, 9] as const, hostsCol = [3, 4] as const, skipEdge = false }) {
  return (
    <>
      <ControlModule title="Agents" aside="3 accounts" onClick={noop} place={{ column: [1, 3], row: agentsRows }}>
        <ControlLine>Claude Code, Codex</ControlLine>
      </ControlModule>
      <ControlModule title="Code hosts" onClick={noop} place={{ column: hostsCol, row: [3, 9] }}>
        <ControlLine>GitHub</ControlLine>
      </ControlModule>
      {!skipEdge && (
        <ControlModule title="Menu bar" onClick={noop} place={{ column: [4, 5], row: [3, 9] }}>
          <ControlLine>Glance</ControlLine>
        </ControlModule>
      )}
    </>
  )
}

function AwakeToggle({ scene, place }: { scene: Scene; place: { column: readonly [number, number]; row: readonly [number, number] } }) {
  return (
    <ControlToggle
      title="Keep awake"
      line={scene.awake ? 'While work runs' : 'Off'}
      on={scene.awake}
      onChange={scene.setAwake}
      glyph={<Icon name="cup" size={16} />}
      onOpen={() => scene.setView('mac')}
      place={place}
    />
  )
}

function NotifyToggle({ place }: { place: { column: readonly [number, number]; row: readonly [number, number] } }) {
  const [on, setOn] = useState(true)
  return (
    <ControlToggle
      title="Notifications"
      line={on ? 'With sound' : 'Off'}
      on={on}
      onChange={setOn}
      glyph={<Icon name="bell" size={16} />}
      onOpen={noop}
      place={place}
    />
  )
}

function Grid({ dir, scene }: { dir: Direction; scene: Scene }) {
  if (dir.id === 'a')
    return (
      <ControlGrid row={28}>
        <AwakeToggle scene={scene} place={{ column: [1, 3], row: [1, 3] }} />
        <NotifyToggle place={{ column: [3, 5], row: [1, 3] }} />
        <ControlToggle
          title="CPU & memory"
          line={scene.shown ? glance : 'Hidden from the bar'}
          on={scene.shown}
          onChange={scene.setShown}
          glyph={<Icon name="load" size={16} />}
          onOpen={() => scene.setView('mac')}
          place={{ column: [1, 3], row: [3, 5] }}
        />
        <ControlModule title="Code hosts" onClick={noop} place={{ column: [3, 5], row: [3, 5] }}>
          <ControlLine>GitHub</ControlLine>
        </ControlModule>
        <ControlModule title="Agents" aside="3 accounts" onClick={noop} place={{ column: [1, 4], row: [5, 10] }}>
          <ControlLine>Claude Code, Codex</ControlLine>
        </ControlModule>
        <ControlModule title="Menu bar" onClick={noop} place={{ column: [4, 5], row: [5, 10] }}>
          <ControlLine>Glance</ControlLine>
        </ControlModule>
      </ControlGrid>
    )
  if (dir.id === 'b')
    return (
      <ControlGrid row={28}>
        <ControlModule title="This Mac" onClick={() => scene.setView('mac')} place={{ column: [1, 3], row: [1, 5] }}>
          <span className="macLines">
            <span className={scene.awake ? 'macLine' : 'macLine off'}>
              <Icon name="cup" size={13} /> {scene.awake ? 'Awake while work runs' : 'May sleep'}
            </span>
            <span className={scene.shown ? 'macLine' : 'macLine off'}>
              <Icon name="load" size={13} /> {scene.shown ? glance : 'CPU & memory hidden'}
            </span>
          </span>
        </ControlModule>
        <NotifyToggle place={{ column: [3, 5], row: [1, 3] }} />
        <ControlModule title="Code hosts" onClick={noop} place={{ column: [3, 5], row: [3, 5] }}>
          <ControlLine>GitHub</ControlLine>
        </ControlModule>
        <ControlModule title="Agents" aside="3 accounts" onClick={noop} place={{ column: [1, 4], row: [5, 9] }}>
          <ControlLine>Claude Code, Codex</ControlLine>
        </ControlModule>
        <ControlModule title="Menu bar" onClick={noop} place={{ column: [4, 5], row: [5, 9] }}>
          <ControlLine>Glance</ControlLine>
        </ControlModule>
      </ControlGrid>
    )
  // Today's grid, for C, D and E.
  return (
    <ControlGrid row={28}>
      <AwakeToggle scene={scene} place={{ column: [1, 3], row: [1, 3] }} />
      <NotifyToggle place={{ column: [3, 5], row: [1, 3] }} />
      <Rest />
    </ControlGrid>
  )
}

function MacSheet({ dir, scene }: { dir: Direction; scene: Scene }) {
  return (
    <ControlDetail title={dir.id === 'a' ? 'CPU & memory' : 'This Mac'} onBack={() => scene.setView('all')}>
      <ControlSheet>
        <SettingList>
          {dir.id === 'a' ? null : (
            <KeepAwake
              on={scene.awake}
              onChange={scene.setAwake}
              onBattery={false}
              onBatteryChange={noop}
              text={{ title: 'Keep this Mac awake while work runs', note: 'Work stops when the Mac sleeps. The display can still sleep.' }}
            />
          )}
          <div className={scene.flash ? 'flash' : undefined}>
            <SettingSwitch
              title={dir.id === 'a' ? 'Show CPU & memory in the bar' : 'Show how hard this Mac works'}
              note="CPU and memory in the bar, and how much of each Althar’s work uses."
              glyph={<Icon name="load" size={15} />}
              checked={scene.shown}
              onChange={scene.setShown}
            />
          </div>
        </SettingList>
      </ControlSheet>
    </ControlDetail>
  )
}

function SearchResults({ query, scene }: { query: string; scene: Scene }) {
  const q = query.trim().toLowerCase()
  const hits = SETTINGS_INDEX.filter((s) => q.split(/\s+/).every((w) => s.words.includes(w)))
  if (hits.length === 0) return <p className="empty">Nothing in Settings matches “{query}”.</p>
  return (
    <ControlSheet>
      <SettingList>
        {hits.map((h) =>
          h.key === 'load' ? (
            <SettingSwitch
              key={h.key}
              title="Show how hard this Mac works"
              note={<>In This Mac · CPU and memory in the bar</>}
              glyph={<Icon name="load" size={15} />}
              checked={scene.shown}
              onChange={scene.setShown}
            />
          ) : h.key === 'awake' ? (
            <SettingSwitch
              key={h.key}
              title="Keep this Mac awake while work runs"
              note="In This Mac"
              glyph={<Icon name="cup" size={15} />}
              checked={scene.awake}
              onChange={scene.setAwake}
            />
          ) : (
            <SettingSwitch key={h.key} title="Notifications" note="In Notifications" glyph={<Icon name="bell" size={15} />} checked onChange={noop} />
          ),
        )}
      </SettingList>
    </ControlSheet>
  )
}

function Settings({ dir, scene, query: query0 = '' }: { dir: Direction; scene: Scene; query?: string }) {
  const [query, setQuery] = useState(query0)
  return (
    <div className="panel">
      {dir.id === 'e' && scene.view === 'all' && (
        <label className="search">
          <Icon name="search" size={13} />
          <input placeholder="Search Settings" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
      )}
      {scene.view === 'mac' ? (
        <MacSheet dir={dir} scene={scene} />
      ) : dir.id === 'e' && query.trim() !== '' ? (
        <SearchResults query={query} scene={scene} />
      ) : (
        <Grid dir={dir} scene={scene} />
      )}
    </div>
  )
}

/* ---- D's note, E's palette ----------------------------------------------------------- */

function Toast({ onUndo, onOpen, onClose }: { onUndo: () => void; onOpen: () => void; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 9000)
    return () => clearTimeout(t)
  }, [onClose])
  return (
    <div className="toast" role="status">
      <Icon name="load" size={14} />
      <span>
        <b>CPU &amp; memory hidden.</b> Settings → This Mac brings it back.
      </span>
      <button type="button" onClick={onUndo}>
        Undo
      </button>
      <button type="button" onClick={onOpen}>
        Open Settings
      </button>
    </div>
  )
}

function Palette({ scene, onClose, query: query0 = '' }: { scene: Scene; onClose: () => void; query?: string }) {
  const [query, setQuery] = useState(query0)
  const items = [
    { label: scene.shown ? 'Hide CPU & memory' : 'Show CPU & memory', hint: 'In the bar', run: () => scene.setShown(!scene.shown), words: 'cpu memory meter load show hide' },
    { label: scene.awake ? 'Let this Mac sleep' : 'Keep this Mac awake', hint: 'This Mac', run: () => scene.setAwake(!scene.awake), words: 'keep awake sleep' },
    { label: 'New task', hint: '⌘N', run: noop, words: 'new task' },
    { label: 'Open Settings', hint: '⌘,', run: noop, words: 'settings preferences' },
  ].filter((i) => query.trim() === '' || query.toLowerCase().split(/\s+/).every((w) => (i.words + ' ' + i.label.toLowerCase()).includes(w)))
  return (
    <div className="palette" role="dialog" aria-label="Commands">
      <input autoFocus placeholder="Type a command" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && onClose()} />
      {items.map((i, n) => (
        <button
          key={i.label}
          type="button"
          className={n === 0 ? 'on' : undefined}
          onClick={() => {
            i.run()
            onClose()
          }}
        >
          <span>{i.label}</span>
          <span className="hintR">{i.hint}</span>
        </button>
      ))}
    </div>
  )
}

/* ---- a direction's page -------------------------------------------------------------- */

function Window({ dir, scene, live, toast, palette }: { dir: Direction; scene: Scene; live: boolean; toast?: ReactNode; palette?: ReactNode }) {
  return (
    <div className="window">
      <Bar dir={dir} scene={scene} live={live} onHidden={live && dir.id === 'd' ? () => window.dispatchEvent(new Event('proto-hidden')) : undefined} />
      <div className="body">
        {toast}
        {palette}
        <div className="panelSpot">
          <Settings dir={dir} scene={scene} />
        </div>
      </div>
    </div>
  )
}

function Live({ dir }: { dir: Direction }) {
  const scene = useScene()
  const [toast, setToast] = useState(false)
  const [palette, setPalette] = useState(false)
  useEffect(() => {
    const on = () => setToast(true)
    window.addEventListener('proto-hidden', on)
    return () => window.removeEventListener('proto-hidden', on)
  }, [])
  useEffect(() => {
    if (dir.id !== 'e') return
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setPalette((p) => !p)
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [dir.id])
  return (
    <Window
      dir={dir}
      scene={scene}
      live
      toast={
        toast ? (
          <Toast
            onUndo={() => {
              scene.setShown(true)
              setToast(false)
            }}
            onOpen={() => {
              scene.setView('mac')
              scene.setFlash(true)
              setTimeout(() => scene.setFlash(false), 2400)
              setToast(false)
            }}
            onClose={() => setToast(false)}
          />
        ) : undefined
      }
      palette={palette ? <Palette scene={scene} onClose={() => setPalette(false)} /> : undefined}
    />
  )
}

function Frame({ label, children }: { label: string; children: ReactNode }) {
  return (
    <figure className="frame">
      <figcaption>{label}</figcaption>
      <div className="frameInner">{children}</div>
    </figure>
  )
}

function Frames({ dir }: { dir: Direction }) {
  const on = still(true)
  const off = still(false)
  return (
    <div className="frames">
      <Frame label="Bar · meter shown">
        <Bar dir={dir} scene={on} live={false} />
      </Frame>
      <Frame label="Bar · after hiding">
        <Bar dir={dir} scene={off} live={false} />
        {dir.id === 'd' && (
          <div className="toastStill">
            <Toast onUndo={noop} onOpen={noop} onClose={noop} />
          </div>
        )}
        {dir.id === 'c' && (
          <div className="ctxStill">
            <div className="ctxMenu static">
              <div className="ctxHead">Show in the bar</div>
              <button type="button">
                <span className="tick" />
                CPU &amp; memory
              </button>
              <button type="button" disabled>
                <span className="tick">✓</span>New task
              </button>
            </div>
            <span className="ctxCap">…and right-click on the bar</span>
          </div>
        )}
      </Frame>
      <Frame label="Settings · meter shown">
        <Settings dir={dir} scene={on} />
      </Frame>
      <Frame label={dir.id === 'e' ? 'Settings · after hiding, searching “cpu”' : 'Settings · after hiding'}>
        <Settings dir={dir} scene={off} query={dir.id === 'e' ? 'cpu' : ''} />
        {dir.id === 'e' && (
          <div className="paletteStill">
            <span className="ctxCap">…or ⌘K anywhere</span>
            <Palette scene={off} onClose={noop} query="cpu" />
          </div>
        )}
      </Frame>
      {(dir.id === 'b' || dir.id === 'a' || dir.id === 'd') && (
        <Frame label={dir.id === 'a' ? 'Settings · the tile’s name opens the sheet' : 'Settings · the sheet it opens'}>
          <Settings dir={dir} scene={still(false, 'mac')} />
        </Frame>
      )}
    </div>
  )
}

function DirectionPage({ dir }: { dir: Direction }) {
  return (
    <>
      <header className="head">
        <span className="letter">{dir.letter}</span>
        <div>
          <h1>{dir.name}</h1>
          <p className="pitch">{dir.pitch}</p>
        </div>
      </header>
      <section>
        <h2>Try it</h2>
        <p className="how">
          Click the meter, turn off “Show in the bar”, then find the way back.
          {dir.id === 'e' && ' Press ⌘K, or type in Settings’ search.'}
        </p>
        <Live key={dir.id} dir={dir} />
      </section>
      <section>
        <h2>Before and after hiding</h2>
        <Frames dir={dir} />
      </section>
      <section className="pc">
        <div>
          <h3>Good</h3>
          <ul>{dir.good.map((g) => <li key={g}>{g}</li>)}</ul>
        </div>
        <div>
          <h3>Costs</h3>
          <ul>{dir.costs.map((g) => <li key={g}>{g}</li>)}</ul>
        </div>
      </section>
    </>
  )
}

/* ---- comparison ---------------------------------------------------------------------- */

const ROWS: { q: string; a: Record<Id, string> }[] = [
  { q: 'Tile names where the switch is', a: { a: 'Yes', b: 'Yes', c: '—', d: 'No (still “Keep awake”)', e: 'No, search hides it' } },
  { q: 'Steps back from hidden', a: { a: '2: gear, circle', b: '3: gear, tile, switch', c: '1: the glyph', d: '1 (Undo) or 2 (Open Settings)', e: '3: ⌘K, type, Enter' } },
  { q: 'Works a week later', a: { a: 'Yes', b: 'Yes', c: 'Yes', d: 'No', e: 'If they think to search' } },
  { q: 'Bar fully clean when hidden', a: { a: 'Yes', b: 'Yes', c: 'No, a faint mark', d: 'Yes', e: 'Yes' } },
  { q: 'Cost to build', a: { a: 'Small', b: 'Small', c: 'Small (glyph), medium (menu)', d: 'Small', e: 'Large' } },
]

function Compare() {
  const off = still(false)
  return (
    <>
      <header className="head">
        <div>
          <h1>Where the CPU &amp; memory switch lives</h1>
          <p className="pitch">
            Today: hide the meter from its peek, and the only way back is Settings → <b>Keep awake</b>’s name → “Show how hard this Mac works”. The tile says
            keep awake, not This Mac, so nobody finds it. Five directions, each shown after hiding.
          </p>
        </div>
      </header>
      <section className="rec">
        <h2>Pick</h2>
        <p>
          <b>B, with D’s note.</b> Renaming the tile to “This Mac” fixes the actual mismatch (the tile names the place it opens, and Keep awake still reads at
          a glance), and the note at hide time teaches that place once, with Undo for the slip.
        </p>
        <p className="quiet">Runner-up: A, if a one-press way back matters more than a calm grid. C’s right-click is a cheap extra for either.</p>
      </section>
      <section>
        <h2>After hiding, side by side</h2>
        <div className="compareGrid">
          {DIRECTIONS.map((d) => (
            <a key={d.id} href={`#${d.id}`} className="card">
              <div className="cardHead">
                <span className="letter small">{d.letter}</span> {d.name}
              </div>
              <div className="mini">
                <div className="miniBar">
                  <Bar dir={d} scene={off} live={false} />
                </div>
                <div className="miniPanel">
                  <Settings dir={d} scene={off} query={d.id === 'e' ? 'cpu' : ''} />
                </div>
                {d.id === 'd' && (
                  <div className="miniToast">
                    <Toast onUndo={noop} onOpen={noop} onClose={noop} />
                  </div>
                )}
              </div>
              <p className="quiet">{d.pitch}</p>
            </a>
          ))}
        </div>
      </section>
      <section>
        <h2>How they compare</h2>
        <table className="table">
          <thead>
            <tr>
              <th />
              {DIRECTIONS.map((d) => (
                <th key={d.id}>
                  <a href={`#${d.id}`}>
                    {d.letter} · {d.name}
                  </a>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.q}>
                <th>{r.q}</th>
                {DIRECTIONS.map((d) => (
                  <td key={d.id}>{r.a[d.id]}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  )
}

/* ---- the app ------------------------------------------------------------------------ */

function App() {
  const read = () => (window.location.hash.slice(1) || 'compare') as Id | 'compare'
  const [page, setPage] = useState(read)
  useEffect(() => {
    const on = () => {
      setPage(read())
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return (
    <div className="app">
      <nav className="nav">
        <span className="brand">Meter switch · prototype</span>
        <a href="#compare" className={page === 'compare' ? 'on' : undefined}>
          Compare
        </a>
        {DIRECTIONS.map((d) => (
          <a key={d.id} href={`#${d.id}`} className={page === d.id ? 'on' : undefined}>
            {d.letter} · {d.name}
          </a>
        ))}
      </nav>
      <main className="main">{page === 'compare' ? <Compare /> : <DirectionPage dir={byId(page)} />}</main>
    </div>
  )
}

createRoot(document.getElementById('root') as HTMLElement).render(<App />)
