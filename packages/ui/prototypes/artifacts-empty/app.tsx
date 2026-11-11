// Scrappy: the real project header over the real Artifacts screen, empty in each direction, or with its first canvas.
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '../../src/styles/global.css'

import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

import { ProjectHeader } from '../../src/chrome/ProjectHeader/ProjectHeader'
import { ProjectInk } from '../../src/foundations/ProjectMark/drawing'
import { Room } from '../../src/foundations/vocabulary'
import { Segmented } from '../../src/primitives/Segmented/Segmented'
import { type ArtifactRow, Artifacts } from '../../src/screens/Artifacts/Artifacts'
import s from './app.module.css'
import { ask, DIRECTIONS, type Direction, set, type Shown, useAsked, useProto } from './state'

/** The first canvas, as a lead would publish it. */
const FIRST: ArtifactRow = {
  id: 'cnv_a',
  name: 'sign-in',
  title: 'Sign-in, three directions',
  kind: 'markdown',
  version: 1,
  by: 'Lead of Redesign sign-in',
  when: '2m ago',
  at: '2026-11-11T10:02:00.000Z',
  openComments: 0,
}

const NAMES: Readonly<Record<Direction, string>> = {
  now: 'Today',
  D1: '1 · Tiles',
  D2: '2 · A stack',
  D3: '3 · A wall',
  D4: '4 · One canvas',
}

function Window({ rows, label }: { rows: ReadonlyArray<ArtifactRow>; label?: string }) {
  const [chosen, setChosen] = useState(Room.Artifacts)
  const asked = useAsked()
  // Asking from the empty state opens the coordinator's conversation.
  const room = asked !== null ? Room.Talk : chosen
  const setRoom = (to: Room) => (setChosen(to), ask(null))
  return (
    <section className={s.window} aria-label={label}>
      {label !== undefined && <span className={s.label}>{label}</span>}
      <div className={s.frame}>
        <ProjectHeader name="althar" seed="althar" ink={ProjectInk.Clay} inProgress={2} room={room} onRoom={setRoom} />
        <div className={s.body}>
          {room === Room.Artifacts ? (
            <Artifacts canvases={rows} onOpen={() => {}} />
          ) : (
            <div className={s.elsewhere}>
              {room === Room.Talk && asked !== null ? (
                <>
                  The coordinator’s conversation opens here
                  {asked === '' ? ', its composer focused.' : <>, “{asked}” in its composer.</>}
                </>
              ) : (
                'Not in this prototype.'
              )}
              <button type="button" onClick={() => setRoom(Room.Artifacts)}>
                Back to Artifacts
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

function Bar() {
  const p = useProto()
  return (
    <nav className={s.bar} aria-label="Prototype">
      <strong className={s.name}>Artifacts, empty</strong>
      <Segmented
        label="Direction"
        value={p.d}
        onChange={(d: Direction) => set({ d })}
        options={DIRECTIONS.map((one) => ({ value: one, label: NAMES[one] }))}
      />
      <Segmented
        label="Shown"
        value={p.s}
        onChange={(v: Shown) => set({ s: v })}
        options={[
          { value: 'empty', label: 'Empty' },
          { value: 'one', label: 'One canvas' },
          { value: 'both', label: 'Side by side' },
        ]}
      />
      <Segmented
        label="Width"
        value={p.w}
        onChange={(w) => set({ w })}
        options={[
          { value: 'wide', label: 'Wide' },
          { value: 'narrow', label: 'Narrow' },
        ]}
      />
      <Segmented
        label="Theme"
        value={p.t}
        onChange={(t) => set({ t })}
        options={[
          { value: 'light', label: 'Light' },
          { value: 'dark', label: 'Dark' },
        ]}
      />
      <span className={s.keys}>N 1 2 3 4 · E O S · W · T</span>
    </nav>
  )
}

function App() {
  const p = useProto()
  useEffect(() => {
    document.documentElement.dataset.theme = p.t
  }, [p.t])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const at = e.target as HTMLElement | null
      if (e.metaKey || e.ctrlKey || e.altKey || at?.closest('input, textarea, [contenteditable="true"]')) return
      const k = e.key.toLowerCase()
      const now = { n: 'now', 1: 'D1', 2: 'D2', 3: 'D3', 4: 'D4' } as const
      if (k in now) set({ d: now[k as keyof typeof now] })
      else if (k === 'e') set({ s: 'empty' })
      else if (k === 'o') set({ s: 'one' })
      else if (k === 's') set({ s: 'both' })
      else if (k === 'w') set({ w: p.w === 'wide' ? 'narrow' : 'wide' })
      else if (k === 't') set({ t: p.t === 'light' ? 'dark' : 'light' })
      else if (['arrowright', 'arrowleft'].includes(k)) {
        const i = DIRECTIONS.indexOf(p.d) + (k === 'arrowright' ? 1 : -1)
        set({ d: DIRECTIONS[(i + DIRECTIONS.length) % DIRECTIONS.length]! })
      }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [p])
  return (
    <div className={s.page} data-bare={p.bare || undefined}>
      {!p.bare && <Bar />}
      <main className={s.stage} data-width={p.w} data-shown={p.s}>
        {p.s === 'both' ? (
          <>
            <Window key={`${p.d}-e`} rows={[]} label={`${NAMES[p.d]}, empty`} />
            <Window key={`${p.d}-o`} rows={[FIRST]} label="Its first canvas" />
          </>
        ) : (
          <Window key={`${p.d}-${p.s}`} rows={p.s === 'one' ? [FIRST] : []} />
        )}
      </main>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
