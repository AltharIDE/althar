import type { ReactNode } from 'react'

import { type Tile, TILES } from '../home/bodies/desktop/Bento'
import { Console, type Scene, Station } from '../home/bodies/desktop/DesktopBody'
import { cx } from '../lib/cx'
import type { Direction } from './direction'
import s from './flow.module.css'
import { ALL_WORDS, BROWSER, CANVAS, MORE, type Piece, SMALL } from './pieces'

/*
 * What keeps you in flow, with the features it doesn't show yet. The canvas
 * and the browser come in as big ones; voice, merge queues, skills, MCP
 * servers, the machine's load and disk space as small ones, drawn (flat or
 * in 3D) or as words alone. Each direction puts them together another way.
 */

export interface Flow {
  scene?: Scene
  body: ReactNode
  /** A station of its own after the flow, where a direction gives one. */
  after?: ReactNode
}

/** A big feature as a drawn tile of the console, in its dark. */
const big = (piece: Piece): Tile => ({
  id: piece.id,
  span: 3,
  drawn: true,
  tone: 'dark',
  title: piece.title,
  lead: piece.lead,
  piece: () => piece.draw(),
})

const OLD = TILES
/** The console as it is, the canvas and the browser in its second row. */
const EIGHT: Tile[] = [OLD[0]!, OLD[1]!, big(CANVAS), big(BROWSER), ...OLD.slice(2)]

const AND = (
  <>
    And the small things, <b>done right.</b>
  </>
)

/** The small ones on a panel of their own: three across, each drawn, flat or laid back. */
function SmallPanel({ tilt }: { tilt?: boolean }) {
  return (
    <div className={s.after}>
      <h3 className={s.subhead}>{AND}</h3>
      <ol className={s.panel} data-light="">
        {SMALL.map((p, i) => (
          <li key={p.id} className={s.small}>
            <span className={s.plate}>
              <b>{String(i + 1).padStart(2, '0')}</b>
              <i className={s.led} />
            </span>
            <h4 className={s.smallTitle}>{p.title}</h4>
            <p className={s.smallLead}>{p.lead}</p>
            <div className={s.smallPiece}>{p.draw(tilt)}</div>
          </li>
        ))}
      </ol>
    </div>
  )
}

/** Features as words alone, in a row between hairlines. */
function Words({ words, label }: { words: readonly string[]; label: string }) {
  return (
    <div className={s.words}>
      <span className={s.wordsLabel}>{label}</span>
      <ul className={s.wordList}>
        {words.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>
    </div>
  )
}

/** The canvas and the browser, a station of their own after the flow, side by side. */
function Making() {
  return (
    <Station
      id="making"
      layout="bank"
      stamp={{ no: '04b', name: 'Canvas', km: 13.5 }}
      scene={{
        title: (
          <>
            See what it’s making.
            <br />
            <b>Before it’s merged.</b>
          </>
        ),
        lead: 'Pages and diagrams on the project’s canvas, the page it’s building in a browser beside the task. Comment on either, and the lead picks it up.',
      }}
    >
      <ol className={s.pair} data-light="">
        {[CANVAS, BROWSER].map((p) => (
          <li key={p.id} className={s.pairItem}>
            <h3 className={s.pairTitle}>{p.title}</h3>
            <p className={s.smallLead}>{p.lead}</p>
            <div className={cx(s.pairPiece)}>{p.draw()}</div>
          </li>
        ))}
      </ol>
    </Station>
  )
}

export const FLOW: Direction<Flow>[] = [
  {
    key: 'a',
    name: 'Canvas and browser in the console; the small ones drawn, flat',
    value: {
      body: (
        <>
          <Console tiles={EIGHT} className={s.eight} />
          <SmallPanel />
        </>
      ),
    },
  },
  {
    key: 'b',
    name: 'Canvas and browser in the console; the small ones drawn in 3D',
    value: {
      body: (
        <>
          <Console tiles={EIGHT} className={s.eight} />
          <SmallPanel tilt />
        </>
      ),
    },
  },
  {
    key: 'c',
    name: 'Canvas and browser in the console; the small ones as a row of words',
    value: {
      body: (
        <>
          <Console tiles={EIGHT} className={s.eight} />
          <Words words={ALL_WORDS} label="And also" />
        </>
      ),
    },
  },
  {
    key: 'd',
    name: 'Canvas and browser a station of their own; the small ones as words',
    value: {
      body: (
        <>
          <Console />
          <Words words={ALL_WORDS} label="And also" />
        </>
      ),
      after: <Making />,
    },
  },
  {
    key: 'e',
    name: 'In 3D, and the rest as a row of words under them',
    value: {
      body: (
        <>
          <Console tiles={EIGHT} className={s.eight} />
          <SmallPanel tilt />
          <Words words={MORE} label="And also" />
        </>
      ),
    },
  },
]
