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
import skyUrl from '../hero/plate/sky.webp'
import d from './D.module.css'

/*
 * Prototype, D: above the clouds, in daylight. The first screen ends on the
 * sky through the capsule's window, the cloud far below. Under the band the
 * window is gone and it is that sky, wide: the same photograph, the board
 * hanging over the planet's edge and the cloud under it. Then down through
 * the cloud into the pale daylight under it, which warms as the ground
 * nears, until it is the footer's paper. One sky, no panels; the app's
 * pictures stand in it with daylight's soft, cool shadow.
 */

type Id = keyof typeof SCENE

function Scene({ id, className, children }: { id: Id; className?: string; children: ReactNode }) {
  return (
    <section id={id} className={cx(d.scene, className)} aria-labelledby={`${id}-h`}>
      <div className={d.head}>
        <h2 id={`${id}-h`} className={cx(t.title, d.title)}>
          {SCENE[id].title}
        </h2>
        <p className={cx(t.lead, d.lead)}>{SCENE[id].lead}</p>
      </div>
      {children}
    </section>
  )
}

/** What keeps you in flow, under the cloud: no cards, each picture in the daylight with its words under it, every drawing in its own light. */
function Seen() {
  return (
    <ul className={d.seen}>
      {TILES.map((tile) => (
        <li key={tile.id} className={cx(d.thing, d[tile.id])} data-drawn={tile.drawn ? '' : undefined}>
          <div className={d.pic}>{tile.piece(tile.tone ?? 'light')}</div>
          <div>
            <h3 className={d.thingTitle}>{tile.title}</h3>
            <p className={d.thingLead}>{tile.lead}</p>
          </div>
        </li>
      ))}
    </ul>
  )
}

export function CloudsBody() {
  return (
    <main id="main" tabIndex={-1} className={d.body}>
      <Scene id="independent" className={d.above}>
        {/* The sky the window showed, without the window: space over the words, the cloud under the board, fading into the haze below. */}
        <div className={d.sky} style={{ '--sky': `url(${skyUrl})` } as CSSProperties} aria-hidden="true" />
        <LightUnder tone="ink" className={d.under} />
        <AtWork />
      </Scene>
      <Scene id="coordinator" className={d.split}>
        <AskOnce />
      </Scene>
      <Scene id="review">
        <Review />
      </Scene>
      <Scene id="flow">
        <Seen />
      </Scene>
      <Scene id="edge">
        <EdgeTour tone="paper" />
      </Scene>
      <section id="end" className={d.end} aria-label="Download Althar">
        <p className={d.endLine}>
          {END[0]} <br className={d.phoneBreak} />
          <b>{END[1]}</b>
        </p>
        <div className={d.endGet}>
          <Get tone="paper" />
          <OtherMac tone="paper" />
        </div>
      </section>
    </main>
  )
}
