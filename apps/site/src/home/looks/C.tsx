import { type ReactNode, useLayoutEffect, useRef } from 'react'

import { cx } from '../../lib/cx'
import { Get, OtherMac } from '../../shared/Close'
import { AskOnce } from '../bodies/desktop/AskOnce'
import { AtWork } from '../bodies/desktop/AtWork'
import { TILES } from '../bodies/desktop/Bento'
import { END, SCENE } from '../bodies/desktop/DesktopBody'
import { Review } from '../bodies/desktop/Review'
import { EdgeTour } from '../bodies/kit/EdgeTour'
import t from '../bodies/kit/type.module.css'
import c from './C.module.css'
import { Chart } from './c/Chart'

/*
 * Prototype, C: the flight chart. Between the band and the footer the page
 * is the descent's chart, drawn on the paper in the footer's cobalt: the
 * altitude scale down its left margin from the first screen's 38 km to the
 * ground at the download, the path of the descent sweeping down through it
 * (c/Chart.tsx), and each claim a sheet of it: a top rule graduated as a
 * ruler, its number, its claim and its title block with the heights it
 * spans. The app's pictures are mounted on the sheets as exhibits, inside
 * crop marks, their width dimensioned over them as a drawing's are. What
 * keeps you in flow is a parts sheet: ruled cells, each part with its
 * balloon. At the download the path touches down on the zero line, the
 * ground the footer's lake lies on.
 */

type Id = keyof typeof SCENE
const SHEETS: Id[] = ['independent', 'coordinator', 'review', 'flow', 'edge']
const no = (i: number) => String(i).padStart(2, '0')

/** A sheet of the chart: its graduated top rule with its title block, then its number, its claim and its lead. */
function Sheet({ id, split, children }: { id: Id; split?: boolean; children: ReactNode }) {
  const n = SHEETS.indexOf(id) + 1
  return (
    <section id={id} className={cx(c.sheet, split && c.split)} aria-labelledby={`${id}-h`} data-sheet="">
      <div className={c.rule} aria-hidden="true" />
      <div className={c.box}>
        {/* The title block, hanging from the rule at the sheet's right edge: its number of the five, and the heights it spans. */}
        <span className={c.block} aria-hidden="true">
          <span>
            <b>{no(n)}</b>
            <i>/{no(SHEETS.length)}</i>
          </span>
          <span>
            <b data-span="" />
            <i>km</i>
          </span>
        </span>
        <div className={c.head} data-box="">
          <span className={c.no} aria-hidden="true">
            {no(n)}
          </span>
          <h2 id={`${id}-h`} className={cx(t.title, c.title)}>
            {SCENE[id].title}
          </h2>
          <p className={cx(t.lead, c.lead)}>{SCENE[id].lead}</p>
        </div>
        {children}
      </div>
    </section>
  )
}

/** An exhibit: a picture of the app mounted on the sheet inside crop marks, its width dimensioned over it, its figure number under it. */
function Exhibit({ fig, className, children }: { fig: number; className?: string; children: ReactNode }) {
  const mount = useRef<HTMLDivElement>(null)
  const width = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    const el = mount.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const text = `${Math.round(el.getBoundingClientRect().width)}`
      if (width.current && width.current.textContent !== text) width.current.textContent = text
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return (
    <figure className={cx(c.exhibit, className)}>
      <div className={c.dim} aria-hidden="true">
        <svg className={c.arrowL} viewBox="0 0 9 7" focusable="false">
          <path d="M0 3.5L9 0.5V6.5Z" />
        </svg>
        <span>
          <b ref={width} />
          <i>px</i>
        </span>
        <svg className={c.arrowR} viewBox="0 0 9 7" focusable="false">
          <path d="M9 3.5L0 0.5V6.5Z" />
        </svg>
      </div>
      <div ref={mount} className={c.mount}>
        {children}
      </div>
      <span className={c.fig} aria-hidden="true">
        <i>Fig</i> {no(fig)}
      </span>
    </figure>
  )
}

/** What keeps you in flow, as a parts sheet: the seven in ruled cells, each part with its balloon on a leader to its piece. */
function Parts() {
  return (
    <ol className={c.parts}>
      {TILES.map((tile, i) => (
        <li
          key={tile.id}
          className={cx(c.part, c[`span${tile.span}`])}
          data-drawn={tile.drawn ? '' : undefined}
          data-small={tile.small ? '' : undefined}
        >
          <i className={c.cross} aria-hidden="true" />
          <span className={c.balloon} aria-hidden="true">
            {i + 1}
          </span>
          <i className={c.leader} aria-hidden="true" />
          <div className={c.partHead}>
            <h3 className={c.partTitle}>{tile.title}</h3>
            <p className={c.partLead}>{tile.lead}</p>
          </div>
          <div className={c.piece}>{tile.piece('light')}</div>
        </li>
      ))}
    </ol>
  )
}

export function ChartBody() {
  return (
    <main id="main" tabIndex={-1} className={c.body}>
      <Chart />
      <Sheet id="independent">
        <Exhibit fig={1}>
          <AtWork />
        </Exhibit>
      </Sheet>
      <Sheet id="coordinator" split>
        <Exhibit fig={2} className={c.talk}>
          <AskOnce />
        </Exhibit>
      </Sheet>
      <Sheet id="review">
        <Exhibit fig={3} className={c.review}>
          <Review />
        </Exhibit>
      </Sheet>
      <Sheet id="flow">
        <Parts />
      </Sheet>
      <Sheet id="edge">
        <Exhibit fig={5} className={c.tour}>
          <EdgeTour tone="paper" />
        </Exhibit>
      </Sheet>
      {/* The ground: the scale's zero, where the path touches down; the last line and the download stand on it. */}
      <section id="end" className={c.end} aria-label="Download Althar">
        <div className={c.zero} aria-hidden="true" />
        <div className={c.endRow}>
          <p className={c.endLine}>
            {END[0]} <br className={c.phoneBreak} />
            <b>{END[1]}</b>
          </p>
          <div className={c.endGet} data-land="">
            <Get tone="paper" />
            <OtherMac tone="paper" />
          </div>
        </div>
      </section>
    </main>
  )
}
