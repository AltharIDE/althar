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
import b from './B.module.css'
import { starsUrl } from './sky'

/*
 * Prototype, B: orbit. The first screen looks out of the capsule's window at
 * the planet; under the band the window is gone and the page is the view
 * itself: the same photograph, the window's width and more, held behind
 * every section while the page passes over it. It turns as you read, the
 * horizon climbing from the window's foot and the cloud coming up, until by
 * the download the sun stands on the planet's edge. The claims are large and
 * white at the left; the pictures float in front of the planet, lit by it.
 * With reduced motion, or a browser that can't tie it to the scroll, the
 * planet holds still.
 */

type Id = keyof typeof SCENE

function Scene({ id, className, children }: { id: Id; className?: string; children: ReactNode }) {
  return (
    <section id={id} className={cx(b.scene, className)} aria-labelledby={`${id}-h`}>
      <div className={b.head}>
        <h2 id={`${id}-h`} className={cx(t.title, b.title)}>
          {SCENE[id].title}
        </h2>
        <p className={cx(t.lead, b.lead)}>{SCENE[id].lead}</p>
      </div>
      {children}
    </section>
  )
}

/** What keeps you in flow, floating: no cards, each picture loose in front of the planet with its words over it, every drawing in its dark. */
function Afloat() {
  return (
    <ul className={b.afloat}>
      {TILES.map((tile) => (
        <li key={tile.id} className={cx(b.thing, b[`span${tile.span}`])} data-drawn={tile.drawn ? '' : undefined}>
          <div className={b.thingHead}>
            <h3 className={b.thingTitle}>{tile.title}</h3>
            <p className={b.thingLead}>{tile.lead}</p>
          </div>
          <div className={b.pic}>{tile.piece('dark')}</div>
        </li>
      ))}
    </ul>
  )
}

export function OrbitBody() {
  return (
    <main id="main" tabIndex={-1} className={b.body}>
      <LightUnder tone="ink" className={b.under} />
      {/* The view, held while the page passes over it: the planet, the stars over it, the sun at the end. */}
      <div className={b.view} aria-hidden="true">
        <div className={b.planet} style={{ '--sky': `url(${skyUrl})`, '--stars': `url("${starsUrl()}")` } as CSSProperties}>
          <div className={b.sun} />
        </div>
      </div>
      <Scene id="independent" className={b.first}>
        <AtWork />
      </Scene>
      <Scene id="coordinator" className={b.split}>
        <AskOnce />
      </Scene>
      <Scene id="review">
        <Review />
      </Scene>
      <Scene id="flow">
        <Afloat />
      </Scene>
      <Scene id="edge">
        <EdgeTour />
      </Scene>
      <section id="end" className={b.end} aria-label="Download Althar">
        <p className={b.endLine}>
          {END[0]} <br />
          <b>{END[1]}</b>
        </p>
        <div className={b.endGet}>
          <Get tone="blue" />
          <OtherMac tone="blue" />
        </div>
      </section>
    </main>
  )
}
