import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@althar/ui/styles.css'
import '../../src/renderer/app.css'
import './morph.css'

import { StrictMode, useEffect, useState } from 'react'

import { createRoot } from 'react-dom/client'

import { TaskFace, Thread, Turn, You } from '@althar/ui'

import { type DirectionProps, Morph, OneCard } from './Directions'
import { Columns, MapTake, Relay, Roster } from './Takes'
import { AT, draftAt, type Spec, THREE, useElapsed, VAT } from './timeline'
import s from './lab.module.css'

/*
 * The drafting lab (README.md): a task's card from the moment the coordinator
 * starts drafting it. Keys 1–6 swap the take on C, R plays it again, S its
 * speed, N a narrow window, T three tasks from one message.
 */

const params = new URLSearchParams(location.search)
document.documentElement.dataset.theme = 'light'

type Key = (typeof directions)[number]['key']
const directions = [
  { key: '1', label: 'C1 · morph', Card: Morph },
  { key: '2', label: 'C2 · as before', Card: OneCard },
  { key: '3', label: 'Columns', Card: Columns },
  { key: '4', label: 'Relay', Card: Relay },
  { key: '5', label: 'Roster', Card: Roster },
  { key: '6', label: 'Map', Card: MapTake },
] as const
const SPEEDS = [1, 2, 4] as const

/** Three drafted one after another, as the coordinator does: each starts as the last's plan is proposed, less a little. */
const STAGGER = AT.ready - 6000

/** One task's card in the conversation, drafting and then planned. */
function Drafting({ spec, ms, Card }: { spec: Spec; ms: number; Card: (props: DirectionProps) => React.ReactNode }) {
  const [held, setHeld] = useState(false)
  if (ms < 0) return null
  const draft = draftAt(spec, ms)
  return (
    <div className={s.cardIn} data-ready={draft.ready}>
      <Card draft={draft} held={held} onHold={setHeld} />
    </div>
  )
}

function Lab() {
  const [key, setKey] = useState<Key>((params.get('d') as Key | null) ?? '3')
  const [run, setRun] = useState(0)
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(Number(params.get('speed') ?? 2) as 1 | 2 | 4)
  const [narrow, setNarrow] = useState(params.get('narrow') === '1')
  const [three, setThree] = useState(params.get('three') === '1')
  // Frozen at a moment, for a screenshot: ?at=9000.
  const frozen = params.get('at')
  const live = useElapsed(run, speed, (three ? STAGGER * 2 : 0) + AT.ready + 1000)
  // Started part-way in, to see one moment play: ?from=26000.
  const ms = frozen === null ? Number(params.get('from') ?? 0) + live : Number(frozen)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.target instanceof HTMLInputElement) return
      const k = event.key.toLowerCase()
      const picked = directions.find((one) => one.key === k)
      if (picked !== undefined) {
        setKey(picked.key)
        setRun((n) => n + 1)
      } else if (k === 'r') setRun((n) => n + 1)
      else if (k === 's') setSpeed((now) => SPEEDS[(SPEEDS.indexOf(now) + 1) % SPEEDS.length] ?? 2)
      else if (k === 'n') setNarrow((now) => !now)
      else if (k === 't') {
        setThree((now) => !now)
        setRun((n) => n + 1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => {
    const url = new URL(location.href)
    url.searchParams.set('d', key)
    url.searchParams.set('speed', String(speed))
    url.searchParams.set('narrow', narrow ? '1' : '0')
    url.searchParams.set('three', three ? '1' : '0')
    history.replaceState(null, '', url)
  }, [key, speed, narrow, three])

  const { Card } = directions.find((one) => one.key === key) ?? directions[0]
  const specs = three ? THREE : [VAT]
  return (
    <div className={s.lab}>
      <main className={s.scene}>
        <div className={narrow ? s.narrow : s.wide}>
          <TaskFace className={s.face} composer={<div className={s.composer}>Ask the coordinator</div>}>
            <Thread label="Conversation">
              {three ? (
                <You at="10:42">
                  Three things. The card appears as you write it: prototype a loading state for it, or something playful, like a team being
                  assembled. Keep your briefs as short as you can; the leads can do the research. And get rid of every raw MCP name in the
                  UI.
                </You>
              ) : (
                <You at="10:42">EU customers are seeing the wrong VAT rate on their invoice PDFs since Monday. Can you fix it?</You>
              )}
              <Turn voice="Coordinator" at="10:42">
                <div className={s.cards} data-dir={key}>
                  {specs.map((spec, i) => (
                    <Drafting key={`${run}-${key}-${spec.slug}`} spec={spec} ms={ms - i * STAGGER} Card={Card} />
                  ))}
                </div>
              </Turn>
            </Thread>
          </TaskFace>
        </div>
      </main>
      <nav className={s.bar} aria-label="Directions">
        {directions.map((one) => (
          <button
            key={one.key}
            type="button"
            aria-pressed={key === one.key}
            onClick={() => {
              setKey(one.key)
              setRun((n) => n + 1)
            }}
          >
            <kbd>{one.key}</kbd> {one.label}
          </button>
        ))}
        <span className={s.gap} />
        <button type="button" onClick={() => setRun((n) => n + 1)}>
          <kbd>R</kbd> Play again
        </button>
        <button type="button" onClick={() => setSpeed((now) => SPEEDS[(SPEEDS.indexOf(now) + 1) % SPEEDS.length] ?? 2)}>
          <kbd>S</kbd> {speed}×
        </button>
        <button type="button" aria-pressed={narrow} onClick={() => setNarrow((now) => !now)}>
          <kbd>N</kbd> Narrow
        </button>
        <button
          type="button"
          aria-pressed={three}
          onClick={() => {
            setThree((now) => !now)
            setRun((n) => n + 1)
          }}
        >
          <kbd>T</kbd> Three at once
        </button>
        <span className={s.clock}>{(Math.min(ms, (three ? STAGGER * 2 : 0) + AT.ready) / 1000).toFixed(1)} s</span>
      </nav>
    </div>
  )
}

const root = document.getElementById('root')
if (root !== null)
  createRoot(root).render(
    <StrictMode>
      <Lab />
    </StrictMode>,
  )
