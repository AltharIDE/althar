import type { CSSProperties, ReactNode } from 'react'

import { cx } from '../../lib/cx'
import { Get, OtherMac } from '../../shared/Close'
import { LightUnder } from '../../shared/lightUnder'
import { AskOnce } from '../bodies/desktop/AskOnce'
import { AtWork } from '../bodies/desktop/AtWork'
import { TILES } from '../bodies/desktop/Bento'
import { END, SCENE } from '../bodies/desktop/DesktopBody'
import { Review } from '../bodies/desktop/Review'
import { EdgeTour } from '../bodies/kit/EdgeTour'
import t from '../bodies/kit/type.module.css'
import a from './A.module.css'
import { starsUrl } from './sky'

/*
 * Prototype, A: the night, carried down. The first screen leaves the capsule
 * at 38 km; under the band the descent goes on in one night, with no panels:
 * stars over the planet's edge, its atmosphere a thin blue line the board
 * hangs across, then the dark of the night side, lifting a little as it
 * nears the ground. The flight deck keeps reading the altitude over each
 * claim. The app's pictures are what is seen on the way down, lit by the
 * planet's glow; the drawings melt into the night. At the end it is dawn,
 * and the light comes up into the footer's paper.
 */

type Id = keyof typeof SCENE

/** What the flight deck reads at each claim, on the way down from the first screen's 38 km. */
const ALTITUDE: Record<Id, string> = {
  independent: '31.40',
  coordinator: '24.06',
  review: '16.52',
  flow: '9.18',
  edge: '2.64',
}

function Scene({ id, className, children }: { id: Id; className?: string; children: ReactNode }) {
  return (
    <section id={id} className={cx(a.scene, className)} aria-labelledby={`${id}-h`}>
      <div className={a.head}>
        <p className={a.hud} aria-hidden="true">
          <i>Altitude</i>
          <b>{ALTITUDE[id]} km</b>
        </p>
        <h2 id={`${id}-h`} className={cx(t.title, a.title)}>
          {SCENE[id].title}
        </h2>
        <p className={cx(t.lead, a.lead)}>{SCENE[id].lead}</p>
      </div>
      {children}
    </section>
  )
}

/** What keeps you in flow, seen on the way down: no cards, each picture loose in the night with its words under it, every drawing in its dark. */
function Seen() {
  return (
    <ul className={a.seen}>
      {TILES.map((tile) => (
        <li key={tile.id} className={cx(a.thing, a[tile.id])} data-drawn={tile.drawn ? '' : undefined}>
          <div className={a.pic}>{tile.piece('dark')}</div>
          <div>
            <h3 className={a.thingTitle}>{tile.title}</h3>
            <p className={a.thingLead}>{tile.lead}</p>
          </div>
        </li>
      ))}
    </ul>
  )
}

export function NightBody() {
  return (
    <main id="main" tabIndex={-1} className={a.body} style={{ '--stars': `url("${starsUrl()}")` } as CSSProperties}>
      <LightUnder tone="ink" className={a.under} />
      <Scene id="independent" className={a.first}>
        <div className={a.stars} aria-hidden="true" />
        {/* The board hangs across the planet's edge: space and its stars over it, the night side under. */}
        <div className={a.over}>
          <div className={a.limb} aria-hidden="true" />
          <AtWork />
        </div>
      </Scene>
      <Scene id="coordinator" className={a.split}>
        <AskOnce />
      </Scene>
      <Scene id="review">
        <Review />
      </Scene>
      <Scene id="flow">
        <Seen />
      </Scene>
      <Scene id="edge">
        <EdgeTour />
      </Scene>
      <section id="end" className={a.end} aria-label="Download Althar">
        <p className={a.endLine}>
          {END[0]} <br className={a.phoneBreak} />
          <b>{END[1]}</b>
        </p>
        <div className={a.endGet}>
          <Get tone="blue" />
          <OtherMac tone="blue" />
        </div>
        <div className={a.dawn} aria-hidden="true" />
      </section>
    </main>
  )
}
