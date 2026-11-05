import { type CSSProperties, type ReactNode, type RefObject, useEffect, useLayoutEffect, useRef } from 'react'

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
import { AT, altitudeAfter, velocityAfter } from '../hero/journey'
import c from './C.module.css'
import { stars, WALL } from './c/wall'

/*
 * Prototype, C: the cabin. Past the band you are back inside the capsule the
 * first screen looks out of, at its instrument wall: warm dark, its skin
 * milled isogrid, the ribs caught where a screen's light falls on them. The
 * app's pictures are the wall's screens, set in it behind their bezels;
 * each claim is stamped beside its screen as the changelog stamps its
 * releases, on a rail that runs down the wall, its light on where you are
 * reading. The sections open and close on a window: first the night side of
 * the planet, its edge lit cobalt, with the flight deck's readouts going on
 * from the first screen's; last the same edge flatter and lower, the dawn
 * coming up along it, over the download. What keeps you in flow is one
 * console, its modules seamed into it. With reduced motion the readouts read
 * once, and nothing else moves but what the pictures do.
 */

type Id = keyof typeof SCENE

/** Each station: its number, its name on the wall, and the height it stands at on the way down. */
const STATIONS: Record<Id, { no: string; name: string; km: number }> = {
  independent: { no: '01', name: 'Board', km: 38 },
  coordinator: { no: '02', name: 'Coordinator', km: 30 },
  review: { no: '03', name: 'Review', km: 22 },
  flow: { no: '04', name: 'Flow', km: 14 },
  edge: { no: '05', name: 'Notch', km: 6 },
}

const quiet = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
const two = (n: number) => String(Math.floor(n)).padStart(2, '0')

/** A station's stamp, on the rail: its node, its number and name, a rule, and the height it stands at. */
function Stamp({ id }: { id: Id }) {
  const station = STATIONS[id]
  return (
    <p className={c.stamp} aria-hidden="true">
      <span className={c.node} />
      <b>{station.no}</b>
      <span>{station.name}</span>
      <span className={c.rule} />
      <span className={c.alt}>
        Alt <b>{station.km.toFixed(1)}</b> km
      </span>
    </p>
  )
}

/** A station on the wall: its stamp, then its head and its screen, laid out as `layout` says. */
function Station({ id, layout, children }: { id: Id; layout: 'split' | 'wide' | 'bank' | 'notch'; children: ReactNode }) {
  return (
    <section id={id} className={cx(c.station, c[layout])} aria-labelledby={`${id}-h`} data-station="">
      <Stamp id={id} />
      <div className={c.head}>
        <h2 id={`${id}-h`} className={cx(t.title, c.title)}>
          {SCENE[id].title}
        </h2>
        <p className={cx(t.lead, c.lead)}>{SCENE[id].lead}</p>
      </div>
      {children}
    </section>
  )
}

/** A screen set in the wall: its bezel, its glass, and the light it throws on the ribs round it. */
function Screen({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cx(c.screen, className)} data-light="">
      <div className={c.glass}>{children}</div>
    </div>
  )
}

/** The flight deck's readouts, going on from the first screen's: its velocity and altitude as it sinks, and the time since the page opened. */
function Deck() {
  const velocity = useRef<HTMLElement>(null)
  const altitude = useRef<HTMLElement>(null)
  const elapsed = useRef<HTMLElement>(null)
  const self = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const say = (el: HTMLElement | null, text: string) => {
      if (el && el.textContent !== text) el.textContent = text
    }
    const read = () => {
      const now = performance.now() / 1000
      const after = Math.max(0, now - AT.settled)
      say(velocity.current, velocityAfter(after).toFixed(3))
      say(altitude.current, altitudeAfter(after).toFixed(2))
      say(elapsed.current, `T+${two(now / 3600)}:${two((now / 60) % 60)}:${two(now % 60)}`)
    }
    read()
    if (quiet() || !self.current) return
    let seen = false
    const io = new IntersectionObserver(([e]) => (seen = e?.isIntersecting ?? false))
    io.observe(self.current)
    const timer = window.setInterval(() => seen && read(), 250)
    return () => {
      io.disconnect()
      window.clearInterval(timer)
    }
  }, [])
  return (
    <div ref={self} className={c.deck} aria-hidden="true">
      <span>
        <i>Velocity</i>
        <span>
          <b ref={velocity}>0.931</b> km/s
        </span>
      </span>
      <span className={c.mid}>
        <i>Mission elapsed</i>
        <b ref={elapsed} className={c.clock}>
          T+00:00:00
        </b>
      </span>
      <span className={c.end}>
        <i>Altitude</i>
        <span>
          <b ref={altitude}>38.00</b> km
        </span>
      </span>
    </div>
  )
}

/** A window in the wall: its bezel, the sky in it (stars, the air, the planet's lit edge, the glass's grain), then what stands in it. */
function Window({ className, seed, children }: { className?: string; seed: number; children: ReactNode }) {
  const sky = useRef<HTMLDivElement>(null)
  const grain = useRef<HTMLDivElement>(null)
  useGrain(grain, seed)
  useLayoutEffect(() => {
    if (sky.current) sky.current.style.setProperty('--stars', stars(seed))
  }, [seed])
  return (
    <div className={cx(c.window, className)}>
      <div ref={sky} className={c.sky} aria-hidden="true">
        <div className={c.stars} />
        <div className={c.haze} />
        <div className={c.limb} />
        <div className={c.sun} />
        <div ref={grain} className={c.grain} />
      </div>
      {children}
    </div>
  )
}

/** What keeps you in flow: one console, its modules seamed into it, each with its number and its light. */
function Console() {
  return (
    <ol className={c.console} data-light="">
      {TILES.map((tile, i) => (
        <li
          key={tile.id}
          className={cx(c.module, c[`span${tile.span}`])}
          data-drawn={tile.drawn ? '' : undefined}
          data-small={tile.small ? '' : undefined}
        >
          <span className={c.plate} aria-hidden="true">
            <b>{String(i + 1).padStart(2, '0')}</b>
            <i className={c.led} />
          </span>
          <div className={c.moduleHead}>
            <h3 className={c.moduleTitle}>{tile.title}</h3>
            <p className={c.moduleLead}>{tile.lead}</p>
          </div>
          <div className={c.piece}>{tile.piece(tile.drawn ? 'dark' : 'light')}</div>
        </li>
      ))}
    </ol>
  )
}

/** Where the screens' light falls on the wall: the lit ribs, masked to a pool round each screen; measured again whenever anything changes size. */
function useLights(main: RefObject<HTMLElement | null>, lit: RefObject<HTMLDivElement | null>) {
  useLayoutEffect(() => {
    const body = main.current
    const layer = lit.current
    if (!body || !layer) return
    let frame = 0
    let last = ''
    const measure = () => {
      frame = 0
      const box = body.getBoundingClientRect()
      const pools = [...body.querySelectorAll<HTMLElement>('[data-light]')].map((el) => {
        const r = el.getBoundingClientRect()
        const x = Math.round(r.left - box.left + r.width / 2)
        const y = Math.round(r.top - box.top + r.height / 2)
        const rx = Math.round(r.width / 2 + Math.min(240, r.width * 0.22))
        const ry = Math.round(r.height / 2 + Math.min(160, r.height * 0.2))
        return `radial-gradient(${rx}px ${ry}px at ${x}px ${y}px, #000 40%, rgba(0,0,0,0.45) 72%, transparent)`
      })
      const mask = pools.join(', ')
      if (mask === last) return
      last = mask
      layer.style.maskImage = mask
      layer.style.webkitMaskImage = mask
    }
    const later = () => {
      if (!frame) frame = requestAnimationFrame(measure)
    }
    measure()
    const ro = new ResizeObserver(later)
    ro.observe(body)
    window.addEventListener('resize', later)
    void document.fonts?.ready.then(later)
    return () => {
      cancelAnimationFrame(frame)
      ro.disconnect()
      window.removeEventListener('resize', later)
    }
  }, [main, lit])
}

/** The rail's light: on at the station you are reading, the one across the window's middle. */
function useRail(main: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const body = main.current
    if (!body) return
    const stations = [...body.querySelectorAll<HTMLElement>('[data-station]')]
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) for (const one of stations) one.toggleAttribute('data-on', one === e.target)
        }
      },
      { rootMargin: '-48% 0px -48% 0px' },
    )
    for (const one of stations) io.observe(one)
    return () => io.disconnect()
  }, [main])
}

export function CabinBody() {
  const main = useRef<HTMLElement>(null)
  const lit = useRef<HTMLDivElement>(null)
  const grain = useRef<HTMLDivElement>(null)
  useGrain(grain, 23)
  useLights(main, lit)
  useRail(main)
  return (
    <main ref={main} id="main" tabIndex={-1} className={c.body} style={{ '--wall': WALL.dark, '--wall-lit': WALL.lit } as CSSProperties}>
      {/* Dark under the nav, all the way down: it turns to smoked glass over the cabin. */}
      <LightUnder tone="ink" className={c.under} />
      <div className={c.wall} aria-hidden="true">
        <div ref={lit} className={c.wallLit} />
        <div ref={grain} className={c.wallGrain} />
      </div>

      <section id="independent" className={cx(c.station, c.first)} aria-labelledby="independent-h" data-station="">
        <Stamp id="independent" />
        <Window seed={7} className={c.opening}>
          <Deck />
          <div className={c.head}>
            <h2 id="independent-h" className={cx(t.title, c.title)}>
              {SCENE.independent.title}
            </h2>
            <p className={cx(t.lead, c.lead)}>{SCENE.independent.lead}</p>
          </div>
          <div className={c.board}>
            <AtWork />
          </div>
        </Window>
      </section>

      <Station id="coordinator" layout="split">
        <Screen className={c.talk}>
          <AskOnce />
        </Screen>
      </Station>

      <Station id="review" layout="wide">
        <Screen className={c.review}>
          <Review />
        </Screen>
      </Station>

      <Station id="flow" layout="bank">
        <Console />
      </Station>

      <Station id="edge" layout="notch">
        <div className={c.tour}>
          <EdgeTour />
        </div>
      </Station>

      {/* The last window: the planet's edge lower and flatter, the dawn coming up along it, and the download. */}
      <section id="end" className={c.endStation} aria-label="Download Althar">
        <Window seed={11} className={c.closing}>
          <div className={c.endRow}>
            <p className={c.endLine}>
              {END[0]} <br />
              <b>{END[1]}</b>
            </p>
            <div className={c.endGet}>
              <Get tone="blue" />
              <OtherMac tone="blue" />
            </div>
          </div>
        </Window>
      </section>
    </main>
  )
}
