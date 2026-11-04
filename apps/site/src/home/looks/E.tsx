import type { CSSProperties, ReactNode } from 'react'

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
import e from './E.module.css'

/*
 * Prototype, E: the horizon. The closest to today: its paper, its order and
 * its claims set in the middle, with the dark panels and the cards gone.
 * What carries the first screen down is the planet's edge. Under each claim
 * the horizon runs across the window, a fine line of atmosphere with the
 * sky's faint blue over it, and the picture stands over it: curved hard
 * under the first claim, flatter under each after, as the flight deck's
 * altitude falls, until at the download it is level, the hairline the
 * download already stands between, and under it the footer's land.
 */

type Id = keyof typeof SCENE

/** What the flight deck reads at each horizon, on the way down from the first screen's 38 km. */
const ALTITUDE: Record<Id, string> = {
  independent: '31.40',
  coordinator: '24.06',
  review: '16.52',
  flow: '9.18',
  edge: '2.64',
}

/** How wide the planet is at each horizon, in windows: the wider, the flatter its edge. */
const WIDTH: Record<Id, number> = {
  independent: 1.3,
  coordinator: 1.7,
  review: 2.3,
  flow: 3.4,
  edge: 5.2,
}

/** The planet's edge across the window, its apex under the readout; it runs behind the picture that follows. */
function Horizon({ id }: { id: Id }) {
  return (
    <div className={e.horizon} style={{ '--k': WIDTH[id] } as CSSProperties} aria-hidden="true">
      <p className={e.hud}>
        <i>Altitude</i>
        <b>{ALTITUDE[id]} km</b>
      </p>
      <div className={e.planet}>
        <div className={e.glow} />
        <svg className={e.limb} viewBox="0 0 1000 1000" preserveAspectRatio="none" focusable="false">
          <ellipse cx="500" cy="500" rx="500" ry="500" vectorEffect="non-scaling-stroke" />
        </svg>
      </div>
    </div>
  )
}

function Scene({ id, className, children }: { id: Id; className?: string; children: ReactNode }) {
  return (
    <section id={id} className={cx(e.scene, className)} aria-labelledby={`${id}-h`}>
      <div className={e.head}>
        <h2 id={`${id}-h`} className={cx(t.title, e.title)}>
          {SCENE[id].title}
        </h2>
        <p className={cx(t.lead, e.lead)}>{SCENE[id].lead}</p>
      </div>
      <Horizon id={id} />
      {children}
    </section>
  )
}

/** What keeps you in flow: the bento's widths and order, its cards gone; each picture stands on the paper, its words over it. */
function Tiles() {
  return (
    <ul className={e.tiles}>
      {TILES.map((tile) => (
        <li key={tile.id} className={cx(e.tile, e[`span${tile.span}`], e[tile.id])} data-drawn={tile.drawn ? '' : undefined}>
          <div className={e.tileHead}>
            <h3 className={e.tileTitle}>{tile.title}</h3>
            <p className={e.tileLead}>{tile.lead}</p>
          </div>
          <div className={e.pic}>{tile.piece(tile.tone ?? 'light')}</div>
        </li>
      ))}
    </ul>
  )
}

export function HorizonBody() {
  return (
    <main id="main" tabIndex={-1} className={e.body}>
      <Scene id="independent">
        <AtWork />
      </Scene>
      <Scene id="coordinator">
        <AskOnce />
      </Scene>
      <Scene id="review">
        <Review />
      </Scene>
      <Scene id="flow">
        <Tiles />
      </Scene>
      <Scene id="edge">
        <EdgeTour tone="paper" />
      </Scene>
      {/* The download's strip as it is today: its top hairline the horizon, level at last, the sky's blue faint over it. */}
      <section id="end" className={cx(today.end, e.end)} aria-label="Download Althar">
        <p className={cx(e.hud, e.ground)} aria-hidden="true">
          <i>Altitude</i>
          <b>0.00 km</b>
        </p>
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
