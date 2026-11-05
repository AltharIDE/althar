import { type ReactNode, useRef } from 'react'

import { cx } from '../../lib/cx'
import { Get, OtherMac } from '../../shared/Close'
import { useGrain } from '../../shared/grain'
import { AskOnce } from '../bodies/desktop/AskOnce'
import { AtWork } from '../bodies/desktop/AtWork'
import { TILES } from '../bodies/desktop/Bento'
import { END, SCENE } from '../bodies/desktop/DesktopBody'
import { Review } from '../bodies/desktop/Review'
import { EdgeTour } from '../bodies/kit/EdgeTour'
import t from '../bodies/kit/type.module.css'
import d from './D.module.css'
import { Clouds } from './d/clouds'

/*
 * Prototype, D: the cloud sea. Calm, on the footer's paper. The first screen
 * ends with the cloud far below; here the app's pictures come down into it,
 * each on a plate of cobalt sky, sinking into a sea of cloud painted in the
 * footer's two inks, a bank of it passing in front of its foot. What keeps
 * you in flow is a quiet ruled index on the paper, and the notch is on it too. The last plate is under
 * the cloud's base, its sky giving way to the paper the footer's engraving
 * is printed on. The cloud is painted in code (d/clouds.tsx) until the
 * painted plates come. Nothing moves but the pictures rising a little out
 * of the cloud as they come up the screen, and not with reduced motion.
 */

type Id = keyof typeof SCENE

function Head({ id }: { id: Id }) {
  return (
    <div className={d.head}>
      <h2 id={`${id}-h`} className={cx(t.title, d.title)}>
        {SCENE[id].title}
      </h2>
      <p className={cx(t.lead, d.lead)}>{SCENE[id].lead}</p>
    </div>
  )
}

/** A plate of sky: the cloud sea behind the picture, the picture coming down into it, a bank of cloud in front of its foot, the paint's grain over all. */
function Plate({ seed, horizon = 0.6, className, children }: { seed: number; horizon?: number; className?: string; children: ReactNode }) {
  const grain = useRef<HTMLDivElement>(null)
  useGrain(grain, seed)
  return (
    <div className={cx(d.plate, className)}>
      <Clouds className={d.sea} sea={{ seed, horizon, rows: 9, near: 58 }} />
      <div className={d.picture}>{children}</div>
      <Clouds className={d.bank} sea={{ seed: seed + 101, horizon: 0.3, rows: 2, near: 92 }} />
      <div ref={grain} className={d.grain} aria-hidden="true" />
    </div>
  )
}

/** What keeps you in flow, as an index on the paper: two columns of ruled entries, each its drawing, its name and its words; the wide one across. */
function Index() {
  let side = 0
  return (
    <ul className={d.index}>
      {TILES.map((tile) => {
        const wide = tile.span === 6
        const at = wide ? 'wide' : side === 0 ? 'left' : 'right'
        side = wide ? 0 : 1 - side
        return (
          <li key={tile.id} className={cx(d.item, d[at])} data-drawn={tile.drawn ? '' : undefined} data-small={tile.small ? '' : undefined}>
            <div className={d.drawing}>{tile.piece('light')}</div>
            <h3 className={d.itemTitle}>{tile.title}</h3>
            <p className={d.itemLead}>{tile.lead}</p>
          </li>
        )
      })}
    </ul>
  )
}

export function CloudBody() {
  const grain = useRef<HTMLDivElement>(null)
  useGrain(grain, 41)
  return (
    <main id="main" tabIndex={-1} className={d.body}>
      <section id="independent" className={d.section} aria-labelledby="independent-h">
        <Head id="independent" />
        <Plate seed={3} className={d.board}>
          <AtWork />
        </Plate>
      </section>

      <section id="coordinator" className={cx(d.section, d.split)} aria-labelledby="coordinator-h">
        <Head id="coordinator" />
        <Plate seed={17} horizon={0.5} className={d.talk}>
          <AskOnce />
        </Plate>
      </section>

      <section id="review" className={d.section} aria-labelledby="review-h">
        <Head id="review" />
        <Plate seed={29} className={d.review}>
          <Review />
        </Plate>
      </section>

      <section id="flow" className={d.section} aria-labelledby="flow-h">
        <Head id="flow" />
        <Index />
      </section>

      <section id="edge" className={d.section} aria-labelledby="edge-h">
        <Head id="edge" />
        <div className={d.tour}>
          <EdgeTour tone="paper" />
        </div>
      </section>

      {/* Under the cloud's base: the sky giving way to the footer's paper, and the download. */}
      <section id="end" className={d.end} aria-label="Download Althar">
        <Clouds className={d.base} sea={{ seed: 71, horizon: 0.18, rows: 6, near: 110, under: true }} />
        <div ref={grain} className={d.grain} aria-hidden="true" />
        <div className={d.endWords}>
          <p className={d.endLine}>
            {END[0]} <br />
            <b>{END[1]}</b>
          </p>
          <div className={d.endGet}>
            <Get tone="blue" />
            <OtherMac tone="blue" />
          </div>
        </div>
      </section>
    </main>
  )
}
