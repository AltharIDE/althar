// Scrappy: the Artifacts screen's empty branch, as each direction draws it. The seam in vite.config.mjs hands it today's.
import { type ReactNode, useState } from 'react'

import { Composer } from '../../src/composer/Composer/Composer'
import { Icon } from '../../src/foundations/Icon/Icon'
import { Button } from '../../src/primitives/Button/Button'
import type { ArtifactsText } from '../../src/screens/Artifacts/Artifacts'
import { ask, useProto } from './state'
import s from './empty.module.css'

/* ——— A · Quiet: the empty ground, one mark and two lines, in the middle ——— */

function Quiet() {
  return (
    <div className={s.middle}>
      <span className={s.round} aria-hidden="true">
        <Icon name="canvas" size={20} />
      </span>
      <h2 className={s.title}>No artifacts yet</h2>
      <p className={s.line}>Ask a lead or the coordinator for a mockup, a diagram or a chart.</p>
    </div>
  )
}

/* ——— B · Waiting rows: the table's first row is where the first canvas will be ——— */

function Waiting({ t }: { t: ArtifactsText }) {
  return (
    <div className={s.waiting}>
      <div className={s.heads} aria-hidden="true">
        <span>{t.columns.title}</span>
        <span className={s.headsRight}>{t.columns.updated}</span>
      </div>
      <div className={s.slot}>
        <span className={s.slotGlyph} aria-hidden="true">
          <Icon name="canvas" size={14} />
        </span>
        <span className={s.slotWords}>
          <span className={s.slotTitle}>No artifacts yet</span>
          <span className={s.slotLine}>What a lead or the coordinator draws for you lands here.</span>
        </span>
      </div>
      <div className={s.ghost} aria-hidden="true">
        <span className={s.ghostGlyph} />
        <span className={s.ghostBar} style={{ width: 180 }} />
        <span className={s.ghostWhen} />
      </div>
      <div className={s.ghost} aria-hidden="true" style={{ opacity: 0.5 }}>
        <span className={s.ghostGlyph} />
        <span className={s.ghostBar} style={{ width: 132 }} />
        <span className={s.ghostWhen} />
      </div>
    </div>
  )
}

/* ——— C · Ask for one: the coordinator's composer, here, with a few to start from ——— */

const STARTERS = ['Diagram how the app fits together', 'Chart what merged this week', 'Mock up a better empty board']

function Ask() {
  const [words, setWords] = useState('')
  return (
    <div className={s.middle}>
      <h2 className={s.title}>Nothing drawn yet</h2>
      <p className={s.line}>Ask the coordinator for something to look at.</p>
      <div className={s.composer}>
        <Composer
          value={words}
          onChange={setWords}
          onSubmit={(text) => text.trim() !== '' && ask(text.trim())}
          placeholder="A mockup, a diagram, a chart…"
        />
      </div>
      <div className={s.starters}>
        {STARTERS.map((one) => (
          <button key={one} type="button" className={s.starter} onClick={() => setWords(one)}>
            {one}
          </button>
        ))}
      </div>
    </div>
  )
}

/* ——— D · What they look like: three kinds, drawn small, and one way to ask ——— */

const Page = () => (
  <svg viewBox="0 0 120 84" aria-hidden="true">
    <rect x="10" y="10" width="100" height="8" rx="2" className={s.ink2} />
    <rect x="10" y="26" width="46" height="48" rx="3" className={s.ink1} />
    <rect x="64" y="26" width="46" height="6" rx="2" className={s.ink2} />
    <rect x="64" y="38" width="38" height="6" rx="2" className={s.ink2} />
    <rect x="64" y="60" width="28" height="12" rx="3" className={s.ink3} />
  </svg>
)
const Diagram = () => (
  <svg viewBox="0 0 120 84" aria-hidden="true">
    <rect x="8" y="14" width="32" height="18" rx="4" className={s.ink1} />
    <rect x="80" y="14" width="32" height="18" rx="4" className={s.ink1} />
    <rect x="44" y="54" width="32" height="18" rx="4" className={s.ink3} />
    <path d="M40 23 H80 M24 32 L52 54 M96 32 L68 54" className={s.stroke} />
  </svg>
)
const Chart = () => (
  <svg viewBox="0 0 120 84" aria-hidden="true">
    <path d="M12 74 H108" className={s.stroke} />
    <rect x="18" y="46" width="12" height="28" rx="2" className={s.ink1} />
    <rect x="38" y="34" width="12" height="40" rx="2" className={s.ink1} />
    <rect x="58" y="50" width="12" height="24" rx="2" className={s.ink1} />
    <rect x="78" y="22" width="12" height="52" rx="2" className={s.ink3} />
    <rect x="98" y="30" width="12" height="44" rx="2" className={s.ink1} />
  </svg>
)

const KINDS: ReadonlyArray<{ readonly word: string; readonly drawing: ReactNode }> = [
  { word: 'Mockups', drawing: <Page /> },
  { word: 'Diagrams', drawing: <Diagram /> },
  { word: 'Charts', drawing: <Chart /> },
]

function Kinds() {
  return (
    <div className={s.middle}>
      <div className={s.tiles}>
        {KINDS.map((one) => (
          <figure key={one.word} className={s.tile}>
            <div className={s.tileArt}>{one.drawing}</div>
            <figcaption>{one.word}</figcaption>
          </figure>
        ))}
      </div>
      <h2 className={s.title}>No artifacts yet</h2>
      <p className={s.line}>What your agents draw for you is kept here, for every task.</p>
      <div className={s.actions}>
        <Button size="small" icon="canvas" onClick={() => ask('')}>
          Ask the coordinator
        </Button>
      </div>
    </div>
  )
}

export function Empty({ t, today }: { t: ArtifactsText; today: ReactNode }) {
  const { d } = useProto()
  switch (d) {
    case 'now':
      return today
    case 'A':
      return <Quiet />
    case 'B':
      return <Waiting t={t} />
    case 'C':
      return <Ask />
    case 'D':
      return <Kinds />
  }
}
