// Scrappy: the Artifacts screen's empty branch, as each variation draws it. The seam in vite.config.mjs hands it today's.
// Nothing here is pressed: the drawings only show what will be kept here.
import type { ReactNode } from 'react'

import type { ArtifactsText } from '../../src/screens/Artifacts/Artifacts'
import { useProto } from './state'
import s from './empty.module.css'

/* ——— What agents draw, small ——— */

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
    <rect x="96" y="30" width="12" height="44" rx="2" className={s.ink1} />
  </svg>
)
const Doc = () => (
  <svg viewBox="0 0 120 84" aria-hidden="true">
    <rect x="14" y="12" width="56" height="8" rx="2" className={s.ink3} />
    <rect x="14" y="28" width="92" height="5" rx="2" className={s.ink2} />
    <rect x="14" y="38" width="84" height="5" rx="2" className={s.ink2} />
    <rect x="14" y="48" width="90" height="5" rx="2" className={s.ink2} />
    <rect x="14" y="62" width="60" height="5" rx="2" className={s.ink2} />
  </svg>
)
const Picture = () => (
  <svg viewBox="0 0 120 84" aria-hidden="true">
    <rect x="10" y="10" width="100" height="64" rx="4" className={s.ink1} />
    <circle cx="86" cy="28" r="7" className={s.ink3} />
    <path d="M10 74 L44 40 L66 60 L80 48 L110 74 Z" className={s.ink2} />
  </svg>
)
const Flow = () => (
  <svg viewBox="0 0 120 84" aria-hidden="true">
    <path d="M30 12 V72 M90 12 V72" className={s.stroke} />
    <path d="M30 26 H88 M90 44 H32 M30 60 H88" className={s.stroke} />
    <rect x="20" y="8" width="20" height="8" rx="2" className={s.ink3} />
    <rect x="80" y="8" width="20" height="8" rx="2" className={s.ink1} />
  </svg>
)

const THREE: ReadonlyArray<{ readonly word: string; readonly drawing: ReactNode }> = [
  { word: 'Mockups', drawing: <Page /> },
  { word: 'Diagrams', drawing: <Diagram /> },
  { word: 'Charts', drawing: <Chart /> },
]

const ALL = [Page, Diagram, Chart, Doc, Picture, Flow]

const Words = ({ line }: { line: string }) => (
  <>
    <h2 className={s.title}>No artifacts yet</h2>
    <p className={s.line}>{line}</p>
  </>
)

/* ——— 1 · Tiles: three captioned drawings over the words, in the middle ——— */

function Tiles() {
  return (
    <div className={s.middle}>
      <div className={s.tiles} aria-hidden="true">
        {THREE.map((one) => (
          <figure key={one.word} className={s.tile}>
            <div className={s.art}>{one.drawing}</div>
            <figcaption>{one.word}</figcaption>
          </figure>
        ))}
      </div>
      <Words line="What your agents draw for you to look at is kept here." />
    </div>
  )
}

/* ——— 2 · A stack: the three fanned like a hand of cards, one picture ——— */

function Stack() {
  return (
    <div className={s.middle}>
      <div className={s.stack} aria-hidden="true">
        {THREE.map((one) => (
          <div key={one.word} className={s.card}>
            {one.drawing}
          </div>
        ))}
      </div>
      <Words line="Mockups, diagrams and charts your agents draw are kept here." />
    </div>
  )
}

/* ——— 3 · A wall: many drawings fill the ground and fade out, the words where they thin ——— */

function Wall() {
  return (
    <div className={s.wallView}>
      <div className={s.wall} aria-hidden="true">
        {Array.from({ length: 18 }, (_, i) => {
          const Drawing = ALL[(i * 5 + Math.floor(i / 6) * 2) % ALL.length]!
          return (
            <div key={i} className={s.art}>
              <Drawing />
            </div>
          )
        })}
      </div>
      <div className={s.wallWords}>
        <Words line="Mockups, diagrams and charts your agents draw are kept here." />
      </div>
    </div>
  )
}

/* ——— 4 · One canvas: a single one, larger, with what being kept means: its versions behind it, a comment on it ——— */

function One() {
  return (
    <div className={s.middle}>
      <div className={s.kept} aria-hidden="true">
        <div className={s.sheet} />
        <div className={s.sheet} />
        <div className={s.keptCard}>
          <div className={s.keptBar}>
            <span className={s.keptName} />
            <span className={s.keptVersion}>v3</span>
          </div>
          <div className={s.keptArt}>
            <Page />
          </div>
          <span className={s.pin}>1</span>
        </div>
      </div>
      <Words line="Every version of what your agents draw is kept here." />
    </div>
  )
}

export function Empty({ today }: { t: ArtifactsText; today: ReactNode }) {
  const { d } = useProto()
  switch (d) {
    case 'now':
      return today
    case 'D1':
      return <Tiles />
    case 'D2':
      return <Stack />
    case 'D3':
      return <Wall />
    case 'D4':
      return <One />
  }
}
