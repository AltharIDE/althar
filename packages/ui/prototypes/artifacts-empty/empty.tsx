// Scrappy: the Artifacts screen's empty branch, as each variation of D draws it. The seam in vite.config.mjs hands it today's.
import type { ReactNode } from 'react'

import { Icon } from '../../src/foundations/Icon/Icon'
import { Button } from '../../src/primitives/Button/Button'
import type { ArtifactsText } from '../../src/screens/Artifacts/Artifacts'
import { ask, useProto } from './state'
import s from './empty.module.css'

/* ——— Three kinds, drawn small ——— */

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

interface Kind {
  readonly word: string
  readonly one: string
  readonly draft: string
  readonly drawing: ReactNode
}

const KINDS: ReadonlyArray<Kind> = [
  { word: 'Mockups', one: 'A mockup', draft: 'Mock up ', drawing: <Page /> },
  { word: 'Diagrams', one: 'A diagram', draft: 'Draw a diagram of ', drawing: <Diagram /> },
  { word: 'Charts', one: 'A chart', draft: 'Chart ', drawing: <Chart /> },
]

const Title = () => <h2 className={s.title}>No artifacts yet</h2>

const AskButton = () => (
  <Button size="small" icon="canvas" onClick={() => ask('')}>
    Ask the coordinator
  </Button>
)

/* ——— D1 · Tiles: as shown first; three tiles over two lines and one button, in the middle ——— */

function Tiles() {
  return (
    <div className={s.middle}>
      <div className={s.tiles}>
        {KINDS.map((one) => (
          <figure key={one.word} className={s.tile}>
            <div className={s.art}>{one.drawing}</div>
            <figcaption>{one.word}</figcaption>
          </figure>
        ))}
      </div>
      <Title />
      <p className={s.line}>What your agents draw for you is kept here, for every task.</p>
      <div className={s.actions}>
        <AskButton />
      </div>
    </div>
  )
}

/* ——— D2 · Tiles that ask: each tile is the way to ask for one of its kind; no other button ——— */

function Asking() {
  return (
    <div className={s.middle}>
      <Title />
      <p className={s.line}>Ask the coordinator for one.</p>
      <div className={s.tiles} style={{ marginTop: 22, marginBottom: 0 }}>
        {KINDS.map((one) => (
          <button key={one.word} type="button" className={s.tileButton} onClick={() => ask(one.draft)}>
            <span className={s.art}>{one.drawing}</span>
            <span className={s.tileWord}>
              {one.one}
              <Icon name="arrow" size={12} />
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

/* ——— D3 · A stack: the three fanned like a hand of cards, one picture over the words ——— */

function Stack() {
  return (
    <div className={s.middle}>
      <div className={s.stack} aria-hidden="true">
        {KINDS.map((one) => (
          <div key={one.word} className={s.card}>
            {one.drawing}
          </div>
        ))}
      </div>
      <Title />
      <p className={s.line}>Mockups, diagrams and charts your agents draw are kept here.</p>
      <div className={s.actions}>
        <AskButton />
      </div>
    </div>
  )
}

/* ——— D4 · A shelf: where the table will be, at the top and left-aligned, the tiles beside the words ——— */

function Shelf() {
  return (
    <div className={s.shelf}>
      <div className={s.shelfTiles}>
        {KINDS.map((one) => (
          <figure key={one.word} className={s.tile}>
            <div className={s.art}>{one.drawing}</div>
            <figcaption>{one.word}</figcaption>
          </figure>
        ))}
      </div>
      <div className={s.shelfWords}>
        <Title />
        <p className={s.line}>What a lead or the coordinator draws for you lands here.</p>
        <div className={s.actions}>
          <AskButton />
        </div>
      </div>
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
      return <Asking />
    case 'D3':
      return <Stack />
    case 'D4':
      return <Shelf />
  }
}
