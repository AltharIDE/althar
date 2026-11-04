import { type ReactNode, useEffect, useRef } from 'react'

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
 * Prototype, C: the ruler. The page's paper, ruled as the Runs on band and
 * the download's strip are, and every rule a scale, graduated as a ruler
 * is, in the footer's cobalt. Down the window's left edge the paper carries
 * the flight deck's altimeter tape, from the first screen's 38 km to the
 * ground at the download, and its needle reads where you are. Each claim
 * hangs from its rule beside a large numeral, its heavy words in the
 * cobalt; the app's pictures stand on the paper inside crop marks, as a
 * plate does before it is cut.
 */

type Id = keyof typeof SCENE

const NUMBER: Record<Id, string> = { independent: '01', coordinator: '02', review: '03', flow: '04', edge: '05' }

/** Where the tape starts: the first screen's altitude at rest. */
const TOP_KM = 38
/** Each tick, a tenth of a kilometre: longer every kilometre, longest every five. */
const TICKS = Array.from({ length: TOP_KM * 10 + 1 }, (_, k) => {
  const y = ((TOP_KM * 10 - k) / (TOP_KM * 10)) * 1000
  const length = k % 50 === 0 ? 18 : k % 10 === 0 ? 11 : 5
  return `M0 ${y.toFixed(2)}H${length}`
}).join('')
const LABELS = Array.from({ length: TOP_KM / 2 + 1 }, (_, i) => i * 2)

/** The altimeter's tape, printed down the paper, and its needle, held in the middle of the window, reading the height where it points. */
function Altimeter() {
  const column = useRef<HTMLDivElement>(null)
  const needle = useRef<HTMLDivElement>(null)
  const read = useRef<HTMLElement>(null)
  useEffect(() => {
    let frame = 0
    const update = () => {
      frame = 0
      const col = column.current?.getBoundingClientRect()
      const at = needle.current?.getBoundingClientRect()
      if (!col || !at || !read.current) return
      const along = Math.min(1, Math.max(0, (at.top + at.height / 2 - col.top) / col.height))
      const text = (TOP_KM * (1 - along)).toFixed(2)
      if (read.current.textContent !== text) read.current.textContent = text
    }
    const later = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', later, { passive: true })
    window.addEventListener('resize', later)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', later)
      window.removeEventListener('resize', later)
    }
  }, [])
  return (
    <div ref={column} className={c.altimeter} aria-hidden="true">
      <svg className={c.ticks} viewBox="0 0 18 1000" preserveAspectRatio="none" focusable="false">
        <path d={TICKS} vectorEffect="non-scaling-stroke" />
      </svg>
      {LABELS.map((km) => (
        <span key={km} className={c.km} style={{ top: `${((TOP_KM - km) / TOP_KM) * 100}%` }}>
          {km}
        </span>
      ))}
      <div ref={needle} className={c.needle}>
        <b ref={read}>{TOP_KM.toFixed(2)}</b>
        <i>km</i>
      </div>
    </div>
  )
}

function Scene({ id, className, children }: { id: Id; className?: string; children: ReactNode }) {
  return (
    <section id={id} className={cx(c.scene, className)} aria-labelledby={`${id}-h`}>
      <div className={c.rule} />
      <div className={c.head}>
        <span className={c.no} aria-hidden="true">
          {NUMBER[id]}
        </span>
        <h2 id={`${id}-h`} className={cx(t.title, c.title)}>
          {SCENE[id].title}
        </h2>
        <p className={cx(t.lead, c.lead)}>{SCENE[id].lead}</p>
      </div>
      {children}
    </section>
  )
}

/** A picture of the app on the paper, inside the crop marks of a plate. */
function Plate({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cx(c.plate, className)}>
      <div className={c.crop}>{children}</div>
    </div>
  )
}

/** What keeps you in flow, as ruled cells: the bento's widths, its cards gone, the rules running to the window's edges, a register mark where they cross. */
function Cells() {
  return (
    <ul className={c.cells}>
      {TILES.map((tile) => (
        <li key={tile.id} className={cx(c.cell, c[`span${tile.span}`])} data-drawn={tile.drawn ? '' : undefined}>
          <i className={c.cross} aria-hidden="true" />
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

export function RulerBody() {
  return (
    <main id="main" tabIndex={-1} className={c.body}>
      {/* The flight, from the first claim down to the ground at the download, with the altimeter beside it. */}
      <div className={c.flight}>
        <Altimeter />
        <Scene id="independent">
          <Plate>
            <AtWork />
          </Plate>
        </Scene>
        <Scene id="coordinator" className={c.split}>
          <Plate className={c.talk}>
            <AskOnce />
          </Plate>
        </Scene>
        <Scene id="review">
          <Plate className={c.review}>
            <Review />
          </Plate>
        </Scene>
        <Scene id="flow">
          <Cells />
        </Scene>
        <Scene id="edge">
          <EdgeTour tone="paper" />
        </Scene>
      </div>
      {/* The ground: the download's strip, its top rule the scale's zero. */}
      <section id="end" className={cx(today.end, c.end)} aria-label="Download Althar">
        <div className={today.endRow}>
          <p className={cx(today.endLine, c.endLine)}>
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
