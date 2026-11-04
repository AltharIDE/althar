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
import { toothUrl } from './brush'
import f from './F.module.css'

/*
 * Prototype, F: a cyanotype. The first screen is a photograph, the footer
 * an engraving printed in its blue on paper; between them the page is a
 * sun print, the photograph's kind of picture in the engraving's blue: one
 * sheet of paper brushed with the blue from under the band to over the
 * footer, its edges the brush's dry strokes, the paper's tooth showing
 * through. The words are the paper left white. The app's pictures are laid
 * on the print as they are. Going down, you come out of the blue onto the
 * paper the footer prints its blue on.
 */

type Id = keyof typeof SCENE

/**
 * A brushed edge of the print, the foot's turned over: the blue's edge torn
 * into the brush's dry strokes, by noise that runs long across the sheet
 * and short down it, as bristles drag.
 */
function Brushed({ seed, className }: { seed: number; className?: string }) {
  const dry = `dry-${seed}`
  return (
    <svg className={className} viewBox="0 0 1600 120" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <filter id={dry} x="-0.05" y="-0.8" width="1.1" height="2.6">
        <feTurbulence type="fractalNoise" baseFrequency="0.0028 0.11" numOctaves="3" seed={seed} />
        <feDisplacementMap in="SourceGraphic" scale="125" xChannelSelector="R" yChannelSelector="G" />
        <feGaussianBlur stdDeviation="0.5" />
      </filter>
      <rect x="-90" y="80" width="1780" height="120" filter={`url(#${dry})`} />
    </svg>
  )
}

function Scene({ id, className, children }: { id: Id; className?: string; children: ReactNode }) {
  return (
    <section id={id} className={cx(f.scene, className)} aria-labelledby={`${id}-h`}>
      <div className={f.head}>
        <h2 id={`${id}-h`} className={cx(t.title, f.title)}>
          {SCENE[id].title}
        </h2>
        <p className={cx(t.lead, f.lead)}>{SCENE[id].lead}</p>
      </div>
      {children}
    </section>
  )
}

/** What keeps you in flow: the pictures laid on the print in two staggered files, each with its words under it, every drawing in its own light. */
function Laid() {
  return (
    <ul className={f.laid}>
      {TILES.map((tile) => (
        <li key={tile.id} className={cx(f.thing, f[tile.id])} data-drawn={tile.drawn ? '' : undefined}>
          <div className={f.pic}>{tile.piece(tile.tone ?? 'light')}</div>
          <h3 className={f.thingTitle}>{tile.title}</h3>
          <p className={f.thingLead}>{tile.lead}</p>
        </li>
      ))}
    </ul>
  )
}

export function CyanotypeBody() {
  return (
    <main id="main" tabIndex={-1} className={f.body} style={{ '--tooth': toothUrl() } as CSSProperties}>
      {/* The print: the brushed edge, the blue, the brushed edge turned over; the paper's tooth over all of it. */}
      <div className={f.print} aria-hidden="true">
        <Brushed seed={11} className={f.edge} />
        <div className={f.wash} />
        <Brushed seed={29} className={cx(f.edge, f.foot)} />
      </div>
      <LightUnder tone="ink" className={f.under} />
      <Scene id="independent" className={f.first}>
        <AtWork />
      </Scene>
      <Scene id="coordinator" className={f.split}>
        <AskOnce />
      </Scene>
      <Scene id="review">
        <Review />
      </Scene>
      <Scene id="flow">
        <Laid />
      </Scene>
      <Scene id="edge">
        <EdgeTour />
      </Scene>
      <section id="end" className={f.end} aria-label="Download Althar">
        <p className={f.endLine}>
          {END[0]} <br />
          <b>{END[1]}</b>
        </p>
        <div className={f.endGet}>
          <Get tone="blue" />
          <OtherMac tone="blue" />
        </div>
      </section>
    </main>
  )
}
