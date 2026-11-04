import type { ReactNode } from 'react'

import { cx } from '../../lib/cx'
import { Get, OtherMac } from '../../shared/Close'
import { AskOnce } from '../bodies/desktop/AskOnce'
import { AtWork } from '../bodies/desktop/AtWork'
import { TILES } from '../bodies/desktop/Bento'
import { END, SCENE } from '../bodies/desktop/DesktopBody'
import today from '../bodies/desktop/DesktopBody.module.css'
import { Review } from '../bodies/desktop/Review'
import { EdgeTour } from '../bodies/kit/EdgeTour'
import t from '../bodies/kit/type.module.css'
import c from './C.module.css'

/*
 * Prototype, C: ruled paper. The first screen and the footer are the page's
 * two pictures; between them it is the paper both stand on, ruled the way
 * the Runs on band and the download's strip already are. Every claim is a
 * band of its own: a hairline across the whole width with its number on it,
 * as the band carries its label, the claim large at the left and its lead
 * beside it at the right, as the footer sets its words and its links; then
 * the picture, standing on the paper with no panel round it. What keeps you
 * in flow is the same paper ruled into cells, the rules running out to the
 * window's edges, each drawing in its own tone.
 */

type Id = keyof typeof SCENE

const NUMBER: Record<Id, string> = { independent: '01', coordinator: '02', review: '03', flow: '04', edge: '05' }

function Scene({ id, className, children }: { id: Id; className?: string; children: ReactNode }) {
  return (
    <section id={id} className={cx(c.scene, className)} aria-labelledby={`${id}-h`}>
      <div className={c.rule}>
        <span className={c.no} aria-hidden="true">
          {NUMBER[id]}
        </span>
      </div>
      <div className={c.head}>
        <h2 id={`${id}-h`} className={cx(t.title, c.title)}>
          {SCENE[id].title}
        </h2>
        <p className={cx(t.lead, c.lead)}>{SCENE[id].lead}</p>
      </div>
      {children}
    </section>
  )
}

/** What keeps you in flow, as ruled cells: the bento's widths, its cards gone, the rules running to the window's edges. */
function Cells() {
  return (
    <ul className={c.cells}>
      {TILES.map((tile) => (
        <li key={tile.id} className={cx(c.cell, c[`span${tile.span}`])} data-drawn={tile.drawn ? '' : undefined}>
          <div className={c.cellHead}>
            <h3 className={c.cellTitle}>{tile.title}</h3>
            <p className={c.cellLead}>{tile.lead}</p>
          </div>
          <div className={c.pic}>{tile.piece(tile.tone ?? 'light')}</div>
        </li>
      ))}
    </ul>
  )
}

export function RuledBody() {
  return (
    <main id="main" tabIndex={-1} className={c.body}>
      <Scene id="independent">
        <AtWork />
      </Scene>
      <Scene id="coordinator" className={c.split}>
        <AskOnce />
      </Scene>
      <Scene id="review">
        <Review />
      </Scene>
      <Scene id="flow">
        <Cells />
      </Scene>
      <Scene id="edge">
        <EdgeTour tone="paper" />
      </Scene>
      {/* The download's strip is already ruled as this look is: it stays as it is today. */}
      <section id="end" className={cx(today.end, c.end)} aria-label="Download Althar">
        <div className={today.endRow}>
          <p className={today.endLine}>
            {END[0]} <br className={today.phoneBreak} />
            <b>{END[1]}</b>
          </p>
          <div className={today.endGet}>
            <Get tone="paper" />
            <OtherMac tone="paper" />
          </div>
        </div>
      </section>
    </main>
  )
}
