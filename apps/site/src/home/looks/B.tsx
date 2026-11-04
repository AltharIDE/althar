import { type ReactNode, useId } from 'react'

import { cx } from '../../lib/cx'
import { Get, OtherMac } from '../../shared/Close'
import { AskOnce } from '../bodies/desktop/AskOnce'
import { AtWork } from '../bodies/desktop/AtWork'
import { TILES } from '../bodies/desktop/Bento'
import { END, SCENE } from '../bodies/desktop/DesktopBody'
import { Review } from '../bodies/desktop/Review'
import { EdgeTour } from '../bodies/kit/EdgeTour'
import t from '../bodies/kit/type.module.css'
import b from './B.module.css'

/*
 * Prototype, B: the footer's engraving, carried up the page. Everything is
 * printed in its cobalt on its paper, as plates in a book: each claim a
 * chapter's opening, its numeral between rules, and the app's picture set
 * in a plate mark, the double rule a copper plate presses round its print,
 * its shadow cut in hatching. Between the plates, the altar with its light,
 * as a printer's ornament. What keeps you in flow is one plate of figures,
 * ruled and numbered, every drawing in its light. The end is the colophon.
 */

type Id = keyof typeof SCENE

const NUMERAL: Record<Id, string> = { independent: 'I', coordinator: 'II', review: 'III', flow: 'IV', edge: 'V' }

/** The altar with its light, engraved: a printer's ornament between the plates. */
function Altar({ className }: { className?: string }) {
  const fade = `light-${useId().replace(/[^\w-]/g, '')}`
  return (
    <svg className={cx(b.altar, className)} viewBox="0 0 120 84" aria-hidden="true" focusable="false">
      {/* The light fades as it climbs, as the footer's does. */}
      <defs>
        <linearGradient id={fade} gradientUnits="userSpaceOnUse" x1="0" y1="44" x2="0" y2="0">
          <stop offset="0" stopColor="#1f35c8" stopOpacity="0.9" />
          <stop offset="0.3" stopColor="#1f35c8" stopOpacity="0.5" />
          <stop offset="1" stopColor="#1f35c8" stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* The light: fine lines rising from the table, whole low down, breaking up as they climb. */}
      <g className={b.light} stroke={`url(#${fade})`}>
        <path d="M52 44V6M56 44V14M60 44V2M64 44V12M68 44V8" />
        <path d="M54 44V26M58 44V20M62 44V18M66 44V24" />
        <path d="M52 3v-1M56 9v-2M64 7v-3M68 4v-2" />
      </g>
      {/* The table, the cornice, the block hatched on its shaded side, two steps. */}
      <path className={b.stone} d="M44 44h32v3H44zM42 47h36v4H42zM46 51h28v20H46zM40 71h40v5H40zM34 76h52v5H34z" />
      <path className={b.hatch} d="M62 53v16M65 53v16M68 53v16M71 53v16M49 53v16" />
      {/* The ground it stands on, in a few strokes. */}
      <path className={b.ground} d="M4 82h112M18 84h20M82 84h24" />
    </svg>
  )
}

function Scene({ id, children }: { id: Id; children: ReactNode }) {
  return (
    <section id={id} className={b.scene} aria-labelledby={`${id}-h`}>
      <header className={b.head}>
        <p className={b.numeral} aria-hidden="true">
          {NUMERAL[id]}
        </p>
        <h2 id={`${id}-h`} className={cx(t.title, b.title)}>
          {SCENE[id].title}
        </h2>
        <p className={cx(t.lead, b.lead)}>{SCENE[id].lead}</p>
      </header>
      {children}
    </section>
  )
}

/** The plate mark: the picture pressed into the paper, with its hatched shadow. */
function Plate({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx(b.plate, className)}>{children}</div>
}

/** What keeps you in flow, as one plate of figures: ruled into cells, each figure numbered, its caption under it. */
function Figures() {
  return (
    <Plate className={b.figuresPlate}>
      <ol className={b.figures}>
        {TILES.map((tile, i) => (
          <li key={tile.id} className={cx(b.figure, b[tile.id])} data-drawn={tile.drawn ? '' : undefined}>
            <div className={b.pic}>{tile.piece('light')}</div>
            <div className={b.caption}>
              <span className={b.fig} aria-hidden="true">
                Fig. {i + 1}
              </span>
              <h3 className={b.figTitle}>{tile.title}</h3>
              <p className={b.figLead}>{tile.lead}</p>
            </div>
          </li>
        ))}
      </ol>
    </Plate>
  )
}

export function PlatesBody() {
  return (
    <main id="main" tabIndex={-1} className={b.body}>
      <Scene id="independent">
        <Plate className={b.wide}>
          <AtWork />
        </Plate>
      </Scene>
      <Altar />
      <Scene id="coordinator">
        <Plate className={b.narrow}>
          <AskOnce />
        </Plate>
      </Scene>
      <Altar />
      <Scene id="review">
        <Plate className={b.wide}>
          <Review />
        </Plate>
      </Scene>
      <Altar />
      <Scene id="flow">
        <Figures />
      </Scene>
      <Altar />
      <Scene id="edge">
        <Plate className={cx(b.wide, b.edge)}>
          <EdgeTour tone="paper" />
        </Plate>
      </Scene>
      <section id="end" className={b.end} aria-label="Download Althar">
        <Altar className={b.endAltar} />
        <p className={b.endLine}>
          {END[0]} <br />
          <b>{END[1]}</b>
        </p>
        <div className={b.endGet}>
          <Get tone="paper" />
          <OtherMac tone="paper" />
        </div>
        <div className={b.water} aria-hidden="true" />
      </section>
    </main>
  )
}
