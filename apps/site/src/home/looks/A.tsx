import { type ReactNode, type RefObject, useEffect, useRef } from 'react'

import { HERO } from '../../content/home'
import { askedSecond } from '../../lib/browser'
import { cx } from '../../lib/cx'
import { Get, OtherMac } from '../../shared/Close'
import { useGrain } from '../../shared/grain'
import { LightUnder } from '../../shared/lightUnder'
import { AskOnce } from '../bodies/desktop/AskOnce'
import { AtWork } from '../bodies/desktop/AtWork'
import { TILES } from '../bodies/desktop/Bento'
import { END, SCENE } from '../bodies/desktop/DesktopBody'
import { Review } from '../bodies/desktop/Review'
import { EdgeTour } from '../bodies/kit/EdgeTour'
import t from '../bodies/kit/type.module.css'
import { altitudeAfter, AT, velocityAfter } from '../hero/journey'
import a from './A.module.css'

/*
 * Prototype, A: the flight deck. The first screen is the capsule's cabin, and
 * under the band the page stays in it: the cabin's warm dark, its grain, the
 * walls lit amber at the sides and the window's blue faint overhead. Each
 * claim is set as the first screen's words are, in the middle of the window,
 * with the flight deck's readouts in its corners reading on as the first
 * screen's do; each picture of the app is a screen mounted in the console's smoked glass,
 * labelled as the console labels the agents and the install. What keeps you
 * in flow is one console, its cells ruled by hairlines, and the download is
 * the first screen's console again.
 */

type Id = keyof typeof SCENE

/** The readouts as the first screen's read them, `s` seconds after its rest. */
const VELOCITY = (s: number) => `${velocityAfter(s).toFixed(3)} km/s`
const ALTITUDE = (s: number) => `${altitudeAfter(s).toFixed(2)} km`

/** The flight deck's readouts, in the claim's top corners, as in the first screen's window. */
function Hud() {
  return (
    <div className={a.hud} aria-hidden="true">
      <span>
        <i>{HERO.velocity}</i>
        <b data-read="velocity">{VELOCITY(0)}</b>
      </span>
      <span>
        <i>{HERO.altitude}</i>
        <b data-read="altitude">{ALTITUDE(0)}</b>
      </span>
    </div>
  )
}

/** Every readout reads on, a few times a second, as the first screen's do from its rest; held, or with reduced motion, they stay at rest's. */
function useReading(within: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (askedSecond() !== null || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const reading = window.setInterval(() => {
      const after = Math.max(0, performance.now() / 1000 - AT.settled)
      const velocity = VELOCITY(after)
      const altitude = ALTITUDE(after)
      for (const el of within.current?.querySelectorAll<HTMLElement>('[data-read]') ?? []) {
        const text = el.dataset.read === 'velocity' ? velocity : altitude
        if (el.textContent !== text) el.textContent = text
      }
    }, 250)
    return () => window.clearInterval(reading)
  }, [within])
}

function Scene({ id, className, children }: { id: Id; className?: string; children: ReactNode }) {
  return (
    <section id={id} className={cx(a.scene, className)} aria-labelledby={`${id}-h`}>
      <Hud />
      <div className={a.head}>
        <h2 id={`${id}-h`} className={cx(t.title, a.title)}>
          {SCENE[id].title}
        </h2>
        <p className={cx(t.lead, a.lead)}>{SCENE[id].lead}</p>
      </div>
      {children}
    </section>
  )
}

/** A picture of the app as a screen in the console: the glass round it, its label over it. */
function Mount({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div className={cx(a.mount, className)}>
      <div className={a.glass}>
        <span className={a.label} aria-hidden="true">
          {label}
        </span>
        <div className={a.screen}>{children}</div>
      </div>
    </div>
  )
}

/** What keeps you in flow, as one console: the bento's widths, its cells ruled by hairlines, every drawing in the dark. */
function Console() {
  return (
    <div className={a.mount}>
      <ul className={a.console}>
        {TILES.map((tile) => (
          <li key={tile.id} className={cx(a.cell, a[`span${tile.span}`])} data-drawn={tile.drawn ? '' : undefined}>
            <div className={a.cellHead}>
              <h3 className={a.cellTitle}>{tile.title}</h3>
              <p className={a.cellLead}>{tile.lead}</p>
            </div>
            <div className={a.pic}>{tile.piece('dark')}</div>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function FlightDeckBody() {
  const grain = useRef<HTMLDivElement>(null)
  useGrain(grain, 7)
  const main = useRef<HTMLElement>(null)
  useReading(main)
  return (
    <main ref={main} id="main" tabIndex={-1} className={a.body}>
      <LightUnder tone="ink" className={a.under} />
      <div ref={grain} className={a.grain} aria-hidden="true" />
      <Scene id="independent" className={a.first}>
        <Mount label="Board">
          <AtWork />
        </Mount>
      </Scene>
      <Scene id="coordinator">
        <Mount label="Coordinator" className={a.narrow}>
          <AskOnce />
        </Mount>
      </Scene>
      <Scene id="review">
        <Mount label="Review" className={a.review}>
          <Review />
        </Mount>
      </Scene>
      <Scene id="flow">
        <Console />
      </Scene>
      <Scene id="edge">
        <EdgeTour />
      </Scene>
      {/* The first screen's console again: the last line in its first cell, the download in its last. */}
      <section id="end" className={a.end} aria-label="Download Althar">
        <div className={a.endConsole}>
          <div className={a.endCell}>
            <p className={a.endLine}>
              {END[0]} <br className={a.phoneBreak} />
              <b>{END[1]}</b>
            </p>
          </div>
          <div className={cx(a.endCell, a.endGet)}>
            <Get tone="blue" />
            <OtherMac tone="blue" />
          </div>
        </div>
      </section>
    </main>
  )
}
