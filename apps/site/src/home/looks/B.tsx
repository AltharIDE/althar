import { type ReactNode, useEffect, useRef } from 'react'

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
import { Sheet } from './b/Sheet'

/*
 * Prototype, B: the approach chart. Where the flight chart (A) measures how
 * high you are, this maps where you land. Between the band and the footer
 * the page is one map sheet in the footer's cobalt, inside a graduated
 * neatline (b/Sheet.tsx), its ground the landing site's contours, quiet at
 * the top and closing in toward the foot, where a lake lies under the
 * footer's altar and the landing mark stands on its headland. Each section
 * is the site mapped at a finer scale than the one above it: its head gives
 * where it is and its scale bar. The app's pictures are the map's insets,
 * each in a double neatline with its label; what keeps you in flow is the
 * map's legend.
 */

type Id = keyof typeof SCENE | 'end'

/** Each section's scale: its representative fraction, and its scale bar's figures, a quarter at a time. */
const SCALE: Record<Id, { rf: string; marks: string[]; unit: string }> = {
  independent: { rf: '2 000 000', marks: ['0', '25', '50', '75', '100'], unit: 'km' },
  coordinator: { rf: '400 000', marks: ['0', '5', '10', '15', '20'], unit: 'km' },
  review: { rf: '80 000', marks: ['0', '1', '2', '3', '4'], unit: 'km' },
  flow: { rf: '20 000', marks: ['0', '250', '500', '750', '1000'], unit: 'm' },
  edge: { rf: '4 000', marks: ['0', '50', '100', '150', '200'], unit: 'm' },
  end: { rf: '800', marks: ['0', '10', '20', '30', '40'], unit: 'm' },
}
const ORDER: Id[] = ['independent', 'coordinator', 'review', 'flow', 'edge', 'end']
const no = (id: Id) => String(ORDER.indexOf(id) + 1).padStart(2, '0')

/** A map's scale bar: four segments, filled and open in turn, drawing in once they come into view; its fraction under it. */
function Scale({ id }: { id: Id }) {
  const { rf, marks, unit } = SCALE[id]
  return (
    <div className={b.scale} data-scale="" data-clear="" aria-hidden="true">
      <div className={b.bar}>
        {[0, 1, 2, 3].map((i) => (
          <i key={i} style={{ transitionDelay: `${120 + i * 110}ms` }} />
        ))}
      </div>
      <div className={b.marks}>
        {marks.map((m, i) => (
          <span key={i}>
            {m}
            {i === marks.length - 1 && <em>{unit}</em>}
          </span>
        ))}
      </div>
      <span className={b.rf}>1 : {rf}</span>
    </div>
  )
}

/** A section's head: its number and where it is along a line, then its claim, its lead and its scale. */
function Head({ id }: { id: keyof typeof SCENE }) {
  return (
    <div className={b.head}>
      <p className={b.line} data-clear="" aria-hidden="true">
        <b>{no(id)}</b>
        <i />
        <span data-coord="" />
      </p>
      <h2 id={`${id}-h`} className={cx(t.title, b.title)} data-clear="">
        {SCENE[id].title}
      </h2>
      <p className={cx(t.lead, b.lead)} data-clear="">
        {SCENE[id].lead}
      </p>
      <Scale id={id} />
    </div>
  )
}

function Section({ id, split, children }: { id: keyof typeof SCENE; split?: boolean; children: ReactNode }) {
  return (
    <section id={id} className={cx(b.section, split && b.split)} aria-labelledby={`${id}-h`}>
      <div className={b.box}>
        <Head id={id} />
        {children}
      </div>
    </section>
  )
}

/** An inset: a picture of the app in a double neatline, its label breaking the frame at the top left. */
function Inset({ n, name, className, children }: { n: number; name: string; className?: string; children: ReactNode }) {
  return (
    <figure className={cx(b.inset, className)}>
      <figcaption className={b.cartouche} aria-hidden="true">
        <b>Inset {n}</b>
        <span>{name}</span>
      </figcaption>
      <div className={b.mount}>{children}</div>
    </figure>
  )
}

/** The legend's symbols, one for each thing that keeps you in flow. */
const GLYPHS: Record<string, ReactNode> = {
  accounts: <path d="M9 3.2 15 14.2H3Z" className={b.solid} />,
  away: (
    <>
      <circle cx="9" cy="9" r="5.6" />
      <circle cx="9" cy="9" r="1.9" className={b.solid} />
    </>
  ),
  automations: <path d="M3.6 3.6h10.8v10.8H3.6Z" />,
  conflicts: (
    <>
      <circle cx="9" cy="9" r="6" />
      <path d="M5.6 5.6l6.8 6.8M12.4 5.6l-6.8 6.8" />
    </>
  ),
  home: <path d="M3.5 8.2 9 3.6l5.5 4.6v6.4h-11Z" className={b.solid} />,
  worktrees: <path d="M2 7h14M2 11h14M5 5v8M9 5v8M13 5v8" />,
  workspaces: <path d="M9 2.6 15.4 9 9 15.4 2.6 9Z" />,
}

/** What keeps you in flow, as the map's legend: each thing by its symbol, its words, and its drawing as its swatch. */
function Legend() {
  return (
    <figure className={b.legendFrame}>
      <figcaption className={b.cartouche} aria-hidden="true">
        <b>Legend</b>
      </figcaption>
      <ul className={b.legend}>
        {TILES.map((tile) => (
          <li
            key={tile.id}
            className={cx(b.entry, tile.span === 6 && b.wide)}
            data-drawn={tile.drawn ? '' : undefined}
            data-small={tile.small ? '' : undefined}
          >
            <svg className={b.glyph} viewBox="0 0 18 18" aria-hidden="true" focusable="false">
              {GLYPHS[tile.id]}
            </svg>
            <div className={b.entryWords}>
              <h3 className={b.entryTitle}>{tile.title}</h3>
              <p className={b.entryLead}>{tile.lead}</p>
            </div>
            <div className={b.swatch}>{tile.piece('light')}</div>
          </li>
        ))}
      </ul>
    </figure>
  )
}

export function ApproachBody() {
  const main = useRef<HTMLElement>(null)
  // The scale bars draw in once each comes into view; with reduced motion they are drawn already.
  useEffect(() => {
    const root = main.current
    if (!root) return
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue
          e.target.setAttribute('data-seen', '')
          io.unobserve(e.target)
        }
      },
      { rootMargin: '0px 0px -12% 0px' },
    )
    for (const el of root.querySelectorAll('[data-scale]')) io.observe(el)
    return () => io.disconnect()
  }, [])
  return (
    <main ref={main} id="main" tabIndex={-1} className={b.body}>
      <Sheet />
      <Section id="independent">
        <Inset n={1} name="The board" className={b.board}>
          <AtWork />
        </Inset>
      </Section>
      <Section id="coordinator" split>
        <Inset n={2} name="The coordinator" className={b.talk}>
          <AskOnce />
        </Inset>
      </Section>
      <Section id="review">
        <Inset n={3} name="A review" className={b.review}>
          <Review />
        </Inset>
      </Section>
      <Section id="flow">
        <Legend />
      </Section>
      <Section id="edge">
        <Inset n={4} name="The notch" className={b.tour}>
          <EdgeTour tone="paper" />
        </Inset>
      </Section>
      {/* The landing site: the last line and the download on one side, the lake and the mark on the other. */}
      <section id="end" className={b.end} aria-label="Download Althar">
        <div className={b.box}>
          <p className={b.line} data-clear="" aria-hidden="true">
            <b>{no('end')}</b>
            <i />
            <span data-coord="" />
          </p>
          <div className={b.endWords}>
            <p className={b.endLine} data-clear="">
              {END[0]} <br />
              <b>{END[1]}</b>
            </p>
            <div className={b.endGet} data-clear="">
              <Get tone="paper" />
              <OtherMac tone="paper" />
            </div>
            <Scale id="end" />
          </div>
        </div>
      </section>
    </main>
  )
}
