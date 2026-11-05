import type { ReactNode } from 'react'

import { cx } from '../../lib/cx'
import { Get, OtherMac } from '../../shared/Close'
import { AskOnce } from '../bodies/desktop/AskOnce'
import { AtWork } from '../bodies/desktop/AtWork'
import { TILES } from '../bodies/desktop/Bento'
import { END, SCENE } from '../bodies/desktop/DesktopBody'
import { Review } from '../bodies/desktop/Review'
import { EdgeTour } from '../bodies/kit/EdgeTour'
import t from '../bodies/kit/type.module.css'
import d from './D.module.css'
import bankUrl from './d/art/bank.webp'
import { Dither, dome, type Field, limb } from './e/Dither'

/*
 * Prototype, D: the cloud sea. Calm, on the footer's paper. The first screen
 * ends with the cloud far below; here the app's pictures come down into it,
 * each on a plate of cobalt sky, sinking into a sea of cloud painted in the
 * footer's two inks, a bank of it passing in front of its foot (d/art: the
 * person's painted plates, gouache in cobalt and paper). What keeps
 * you in flow is a quiet ruled index on the paper, and the notch is on it too. The last plate is under
 * the cloud's base, its sky giving way to the paper the footer's engraving
 * is printed on: the lake, the cliffs and the altar with its light, the
 * footer's own landscape, painted before it is engraved. Nothing moves but the pictures rising a little out
 * of the cloud as they come up the screen, and not with reduced motion.
 *
 * E is D with its plates dithered rather than painted (e/Dither.tsx): each
 * the edge of the planet in the first screen's night, cobalt under it, its
 * foot dissolving dot by dot into the page's paper; the close the paper
 * deepening into cobalt over a dome of the altar's light.
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

/** A plate of sky, painted: the cloud sea (or the towering cloud) behind the picture, the picture coming down into it, a bank of cloud in front of its foot. Dithered, its field instead. */
function Plate({ field, className, children }: { field?: Field; className?: string; children: ReactNode }) {
  return (
    <div className={cx(d.plate, className)}>
      {field && <Dither field={field} className={d.dots} />}
      <div className={d.picture}>{children}</div>
      {!field && <img className={d.bank} src={bankUrl} alt="" aria-hidden="true" decoding="async" loading="lazy" />}
    </div>
  )
}

/** E's fields: the edge rising to the right, falling, rising again. */
const FIELDS = {
  board: limb({ from: 0.8, to: 0.14 }),
  talk: limb({ from: 0.16, to: 0.6, bend: 2.2 }),
  review: limb({ from: 0.86, to: 0.3, bend: 2.4 }),
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

export const DitherBody = () => <CloudBody dithered />

export function CloudBody({ dithered = false }: { dithered?: boolean }) {
  const field = (id: keyof typeof FIELDS) => (dithered ? FIELDS[id] : undefined)
  return (
    <main id="main" tabIndex={-1} className={cx(d.body, dithered && d.dithered)}>
      <section id="independent" className={d.section} aria-labelledby="independent-h">
        <Head id="independent" />
        <Plate field={field('board')} className={d.board}>
          <AtWork />
        </Plate>
      </section>

      <section id="coordinator" className={cx(d.section, d.split)} aria-labelledby="coordinator-h">
        <Head id="coordinator" />
        <Plate field={field('talk')} className={d.talk}>
          <AskOnce />
        </Plate>
      </section>

      <section id="review" className={d.section} aria-labelledby="review-h">
        <Head id="review" />
        <Plate field={field('review')} className={d.review}>
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
        {dithered && <Dither field={dome} className={d.dots} />}
        <div className={d.endWords}>
          <p className={d.endLine}>
            {END[0]} <br />
            <b>{END[1]}</b>
          </p>
          <div className={d.endGet}>
            <Get tone={dithered ? 'blue' : 'paper'} />
            <OtherMac tone={dithered ? 'blue' : 'paper'} />
          </div>
        </div>
      </section>
    </main>
  )
}
