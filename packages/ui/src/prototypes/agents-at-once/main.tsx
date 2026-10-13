// Scrappy: "Agents at once" as a notched slider that warms past the default, on one plain page, no Storybook.
import { type CSSProperties, type KeyboardEvent, type PointerEvent, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'

import { Icon } from '../../foundations/Icon/Icon'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { KeepAwake, SettingList, SettingRow } from '../../setup/Preferences/Preferences'
import '../../styles/global.css'
import './prototype.css'

const MOST = 16
/* A 16 GB Mac with 10 cores: four by default. */
const MACHINE = { count: 4, memory: 16, cores: 10 }

/* What the note says as the number moves. */
const noteFor = (n: number) => {
  const { count, memory, cores } = MACHINE
  if (n === count) return `${n}: this Mac has ${memory} GB and ${cores} cores. More tasks than that wait their turn.`
  if (n === 1) return '1: one at a time. The calmest this Mac can be.'
  if (n < count) return `${n}: fewer than this Mac could carry.`
  if (n <= count + 2) return `${n}: a little more than this Mac’s ${memory} GB suggests. Tests may slow down.`
  return `${n}: well past what this Mac’s ${memory} GB suggests. Expect it to run hot.`
}

/* Past the default, how far toward the most, 0 to 1. */
const heatOf = (n: number) => Math.max(0, Math.min(1, (n - MACHINE.count) / (MOST - MACHINE.count)))
const at = (n: number) => `${((n - 1) / (MOST - 1)) * 100}%`

/** A stepped track from 1 to MOST, the default marked on it: the thumb clicks into it as it passes, and past it the track warms. */
function AgentsAtOnce({ start = MACHINE.count }: { start?: number }) {
  const [n, setN] = useState(start)
  const [clicks, setClicks] = useState(0)
  const [held, setHeld] = useState(false)
  const track = useRef<HTMLDivElement>(null)
  const set = (next: number) => {
    if (next === MACHINE.count && n !== MACHINE.count) setClicks((c) => c + 1)
    setN(next)
  }
  const from = (x: number) => {
    const box = track.current?.getBoundingClientRect()
    if (box === undefined) return n
    const raw = 1 + ((x - box.left) / box.width) * (MOST - 1)
    // The default pulls the thumb in as it passes.
    if (Math.abs(raw - MACHINE.count) < 0.6) return MACHINE.count
    return Math.max(1, Math.min(MOST, Math.round(raw)))
  }
  const heat = heatOf(n)
  const own = n !== MACHINE.count
  return (
    <SettingRow
      title="Agents at once"
      note={
        <>
          {noteFor(n)}
          {own && (
            <>
              {' '}
              <LinkButton className="back" onClick={() => set(MACHINE.count)}>
                Use the default
              </LinkButton>
            </>
          )}
        </>
      }
      glyph={
        <span className="breathe" style={{ '--heat': heat, '--speed': `${2.8 - heat * 2.1}s` } as CSSProperties}>
          <Icon name="agents" size={15} />
        </span>
      }
      under={
        <div className="slider" style={{ '--heat': heat } as CSSProperties}>
          <div
            ref={track}
            className="track"
            role="slider"
            tabIndex={0}
            aria-label="Agents at once"
            aria-valuemin={1}
            aria-valuemax={MOST}
            aria-valuenow={n}
            onPointerDown={(e: PointerEvent<HTMLDivElement>) => {
              e.currentTarget.setPointerCapture(e.pointerId)
              setHeld(true)
              set(from(e.clientX))
            }}
            onPointerMove={(e: PointerEvent<HTMLDivElement>) => held && set(from(e.clientX))}
            onPointerUp={() => setHeld(false)}
            onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
              const step = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key] ?? 0
              if (step === 0) return
              e.preventDefault()
              set(Math.max(1, Math.min(MOST, n + step)))
            }}
          >
            <div className="rail">
              <div className="fill" style={{ width: at(n) }} />
            </div>
            <span className="notch" style={{ left: at(MACHINE.count) }} />
            <span
              key={clicks}
              className={['thumb', held && 'held', !own && clicks > 0 && 'clicked'].filter(Boolean).join(' ')}
              style={{ left: at(n) }}
            />
          </div>
          <div className="scale">
            <span>1</span>
            <span className="mark" style={{ left: at(MACHINE.count) }}>
              {MACHINE.count} · this Mac
            </span>
            <span>{MOST}</span>
          </div>
        </div>
      }
    >
      {() => (
        <span className="value" style={{ '--heat': heat } as CSSProperties}>
          {n}
        </span>
      )}
    </SettingRow>
  )
}

/* As it sits in Settings: under Keep awake. */
function InPlace({ start }: { start?: number }) {
  const [awake, setAwake] = useState(true)
  return (
    <div className="sheet">
      <SettingList>
        <KeepAwake on={awake} onChange={setAwake} onBattery={false} onBatteryChange={() => {}} />
        <AgentsAtOnce {...(start === undefined ? {} : { start })} />
      </SettingList>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <div className="ch-root page">
    <header>
      <h1>Agents at once</h1>
      <p className="lede">This Mac: 16 GB and 10 cores, so 4 by default. Drag, click or use the arrow keys.</p>
    </header>
    <section>
      <h2>At the default</h2>
      <InPlace />
    </section>
    <section>
      <h2>Raised to 11</h2>
      <InPlace start={11} />
    </section>
  </div>,
)
