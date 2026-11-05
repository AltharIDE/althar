import { CopyButton } from '@althar/ui'
import { type ReactNode, useEffect, useRef, useState } from 'react'

import { AGENTS } from '../../../content/agents'
import { INSTALL } from '../../../content/facts'
import { HERO } from '../../../content/home'
import { useHydrated } from '../../../lib/browser'
import { cx } from '../../../lib/cx'
import { AgentMark } from '../../../shared/AgentMark'
import { Get, OtherMac } from '../../../shared/Close'
import { useGrain } from '../../../shared/grain'
import { LightUnder } from '../../../shared/lightUnder'
import { addDisplay } from '../../display'
import { altitudeAt, AT, velocityAt } from '../../hero/journey'
import s from './Night.module.css'
import { type Framing, makeSky, type Sky } from './night/sky'

/*
 * Prototype, Night: the first screen seen from orbit, at rest. The night
 * side of the planet curves across the lower part of the frame, towns in
 * gold under faint cloud, the thin cobalt line of the air along its edge,
 * the stars deep over it. Low along the edge, a faint ember wisp where the
 * capsule came through; at the edge's far end, the faintest dawn. The
 * headline stands in the space over the edge, the flight deck's readouts in
 * the top corners, the lead and the console on the night side under it.
 *
 * The view is drawn once on the graphics card (night/sky.ts), and again only
 * when the size changes; without it, or without scripts, the edge as the
 * night pages draw it. It fades in once; then only a few stars twinkle.
 */

addDisplay()

/** The most px the view is drawn in, and the finest: drawn once, but a large screen needn't draw five million. */
const MOST_PIXELS = 3.2e6
const FINEST = 2
/** The width at which the view is framed as a phone's. */
const PHONE = '(max-width: 760px)'

/** How the camera frames the view: the edge's crest where the stylesheet has it (--edge), the wisp low along it from the left. */
const frame = (width: number, height: number, phone: boolean): Omit<Framing, 'dpr'> =>
  phone
    ? { width, height, edge: 0.49, fov: 66, turn: 0.31, dawn: 1, wisp: { from: 0.0, to: 0.78, under: [14, 22], glow: 1 } }
    : { width, height, edge: 0.58, fov: 44, turn: 0.31, dawn: 1, wisp: { from: 0.04, to: 0.74, under: [9, 18], glow: 1 } }

/** The flight deck's readouts, as they read at rest. */
const km = (n: number, places: number, unit: string) => `${n.toFixed(places)} ${unit}`
const VELOCITY = km(velocityAt(AT.settled), 3, 'km/s')
const ALTITUDE = km(altitudeAt(AT.settled), 2, 'km')

/** Every agent Althar runs, as its mark, named on hover and to a screen reader. */
function Agents() {
  return (
    <ul className={s.agents} aria-label={HERO.agentsName}>
      {AGENTS.map((agent) => (
        <li key={agent.id} title={agent.name}>
          <AgentMark agent={agent.id} size={17} />
          <span className={s.sr}>{agent.name}</span>
        </li>
      ))}
    </ul>
  )
}

/** The first screen, the planet seen from orbit. */
export function NightHero({ nav }: { nav?: ReactNode }) {
  const root = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const grain = useRef<HTMLDivElement>(null)
  // How the view is shown: drawn on the canvas, or the stylesheet's edge without the graphics card.
  const [shown, setShown] = useState<'drawn' | 'flat' | null>(null)
  const hydrated = useHydrated()

  useGrain(grain, 11)

  useEffect(() => {
    const el = root.current
    const cv = canvas.current
    if (!el || !cv) return
    const phone = window.matchMedia(PHONE)
    let sky: Sky | null = makeSky(cv, () => {
      sky = null
      setShown('flat')
    })

    /** Draws the view for the frame's size, if it changed. */
    let size = ''
    const draw = () => {
      const w = el.clientWidth
      const h = el.clientHeight
      const dpr = Math.min(window.devicePixelRatio || 1, FINEST, Math.sqrt(MOST_PIXELS / Math.max(1, w * h)))
      const next = `${w}x${h}@${dpr.toFixed(3)}${phone.matches ? 'p' : ''}`
      if (!sky || next === size || w < 10 || h < 10) return
      size = next
      sky.draw({ ...frame(w, h, phone.matches), dpr })
    }

    draw()
    setShown(sky ? 'drawn' : 'flat')

    // Off screen, the stars' twinkling stops (data-away).
    const io = new IntersectionObserver(([e]) => {
      if (e?.isIntersecting ?? true) delete el.dataset.away
      else el.dataset.away = ''
    })
    io.observe(el)

    let timer = 0
    const ro = new ResizeObserver(() => {
      clearTimeout(timer)
      timer = window.setTimeout(draw, 120)
    })
    ro.observe(el)

    return () => {
      delete el.dataset.away
      clearTimeout(timer)
      io.disconnect()
      ro.disconnect()
      sky?.dispose()
      sky = null
    }
  }, [])

  return (
    <div
      ref={root}
      className={s.hero}
      data-ready={hydrated || undefined}
      data-shown={shown ? '' : undefined}
      data-drawn={shown === 'drawn' || undefined}
    >
      {/* Dark under the nav: it turns to smoked glass over the view. */}
      <LightUnder tone="ink" className={s.under} />
      <div className={s.view} aria-hidden="true">
        {/* Without the graphics card, or scripts: the planet's edge as the night pages draw it. */}
        <div className={s.edge} />
        <canvas ref={canvas} className={s.canvas} />
        <div className={s.stars}>
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
        </div>
      </div>
      <div ref={grain} className={s.grain} aria-hidden="true" />
      <div className={s.vignette} aria-hidden="true" />
      <div className={s.words}>
        <h1 className={s.h1}>
          <span className={s.line}>{HERO.title}</span> <span className={s.fast}>{HERO.last}</span>
        </h1>
        {/* The flight deck's readouts, at rest. */}
        <div className={s.hud} aria-hidden="true">
          <span>
            <i>{HERO.velocity}</i>
            <b>{VELOCITY}</b>
          </span>
          <span>
            <i>{HERO.altitude}</i>
            <b>{ALTITUDE}</b>
          </span>
        </div>
      </div>
      <footer className={s.deck}>
        <p className={s.lead}>{HERO.lead}</p>
        <div className={s.console}>
          <div className={s.cell}>
            <span className={s.label}>{HERO.agents}</span>
            <Agents />
          </div>
          <div className={cx(s.cell, s.install)}>
            <span className={s.label}>{HERO.install}</span>
            <div className={s.command}>
              <code>
                <span aria-hidden="true">$ </span>
                {INSTALL.brew}
              </code>
              {/* The kit's button, under the kit's own reset. */}
              <span className="ch-root">
                <CopyButton value={INSTALL.brew} tone="onDark" ghost />
              </span>
            </div>
          </div>
          <div className={cx(s.cell, s.ways)}>
            <Get tone="blue" />
            <OtherMac tone="blue" />
          </div>
        </div>
      </footer>
      {nav}
    </div>
  )
}
