import { CopyButton } from '@althar/ui'
import { type ReactNode, useEffect, useRef, useState } from 'react'

import { AGENTS } from '../../../content/agents'
import { INSTALL } from '../../../content/facts'
import { HERO } from '../../../content/home'
import { askedSecond, useHydrated } from '../../../lib/browser'
import { cx } from '../../../lib/cx'
import { AgentMark } from '../../../shared/AgentMark'
import { Get, OtherMac } from '../../../shared/Close'
import { useGrain } from '../../../shared/grain'
import { LightUnder } from '../../../shared/lightUnder'
import { addDisplay } from '../../display'
import { altitudeAfter, altitudeAt, AT, velocityAfter, velocityAt } from '../../hero/journey'
import { inOut, smooth } from '../../hero/motion'
import s from './Night.module.css'
import { type Framing, makeSky, type Sky } from './night/sky'

/*
 * Prototype, Night: the first screen's re-entry seen from outside, from
 * orbit. The night side of the planet curves across the lower part of the
 * frame, towns in gold under faint cloud, the thin cobalt line of the air
 * along its edge, the stars deep over it. Low over the edge a point of light
 * catches: the capsule coming in. It brightens and lengthens as it runs
 * along the edge, its trail glowing orange-white; at its height the
 * headline's last word is forged in its light, "fast."; then it breaks, a
 * flash and pieces thrown on, going out, and the trail cools to a faint
 * ember wisp as the word cools to white. The faintest dawn comes up at the
 * edge's far end, and everything is still: from then on nothing is drawn,
 * and only a few stars, the browser's, go on twinkling.
 *
 * The same clock as today's (hero/journey.ts), the same flight deck in the
 * top corners, the same console under the lead. The view is drawn on the
 * graphics card (night/sky.ts); without it, or without scripts, the edge as
 * the night pages draw it. With reduced motion it is the last frame, at
 * rest; `?t=` in the address holds it at that second.
 */

addDisplay()

/** The most px the view is drawn in, and the finest: a large screen keeps its frame rate, the stars stay sharp. */
const MOST_PIXELS = 3.2e6
const FINEST = 2
/** The width at which the view is framed as a phone's. */
const PHONE = '(max-width: 760px)'

/** The second to hold at, if any: `?t=`, or the last frame with reduced motion. */
const heldAt = () => {
  const t = askedSecond()
  if (t !== null) return t
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? AT.settled : null
}

/** How the camera frames the view: the edge's crest a little under the middle, the fire running along under it from the left, under the word. */
const frame = (width: number, height: number, phone: boolean): Omit<Framing, 'dpr'> =>
  phone
    ? { width, height, edge: 0.49, fov: 66, path: { from: 0.04, speed: 0.17, under: [16, 26] } }
    : { width, height, edge: 0.6, fov: 44, path: { from: 0.06, speed: 0.159, under: [9, 20] } }

/** Quick out, long settle: an expo out. */
const EXPO = 'cubic-bezier(0.19, 1, 0.22, 1)'

/** A line's words, each in a mask it rises out of. */
function Words({ text }: { text: string }) {
  const words = text.split(' ')
  return (
    <>
      {words.map((word, i) => (
        <span key={i}>
          <span className={s.mask}>
            <span className={s.word} data-word>
              {word}
            </span>
          </span>
          {i < words.length - 1 ? ' ' : ''}
        </span>
      ))}
    </>
  )
}

/** The headline's words rise out of their masks one after another; then the rest. */
const arrive = (within: HTMLElement) => {
  const animate = (el: Element, frames: Keyframe[], options: KeyframeAnimationOptions) =>
    el.animate(frames, { fill: 'backwards', ...options })
  return [
    ...[...within.querySelectorAll('[data-word]')].map((word, i) =>
      animate(word, [{ transform: 'translateY(108%) rotate(5deg)' }, { transform: 'none' }], {
        duration: 1050,
        delay: AT.words * 1000 + i * 55,
        easing: EXPO,
      }),
    ),
    ...[...within.querySelectorAll<HTMLElement>('[data-arrive]')].flatMap((el) => {
      const delay = AT.rest * 1000 + Number(el.dataset.arrive || 0)
      return [
        animate(el, [{ transform: 'translateY(14px)' }, { transform: 'none' }], { duration: 1000, delay, easing: EXPO }),
        animate(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 500, delay, easing: 'ease-out' }),
      ]
    }),
  ]
}

/** Writes a style only when it changes: the frame runs sixty times a second. */
const put = (el: HTMLElement | null, name: string, value: string) => {
  if (el && el.style.getPropertyValue(name) !== value) el.style.setProperty(name, value)
}

/** Writes a readout only when it changes. */
const say = (el: HTMLElement | null, text: string) => {
  if (el && el.textContent !== text) el.textContent = text
}

/** The flight deck's readouts, as they read: at the journey's second `t`, and `s` seconds after rest. */
const km = (n: number, places: number, unit: string) => `${n.toFixed(places)} ${unit}`
const READ = {
  velocity: (t: number) => km(velocityAt(t), 3, 'km/s'),
  altitude: (t: number) => km(altitudeAt(t), 2, 'km'),
  velocityAfter: (s: number) => km(velocityAfter(s), 3, 'km/s'),
  altitudeAfter: (s: number) => km(altitudeAfter(s), 2, 'km'),
}
/** How often the instruments read at rest, in ms. */
const READING = 250

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

/** The first screen, the re-entry seen from orbit. */
export function NightHero({ nav }: { nav?: ReactNode }) {
  const root = useRef<HTMLDivElement>(null)
  const view = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const fast = useRef<HTMLSpanElement>(null)
  const grain = useRef<HTMLDivElement>(null)
  const velocity = useRef<HTMLElement>(null)
  const altitude = useRef<HTMLElement>(null)
  const [drawn, setDrawn] = useState(false)
  const hydrated = useHydrated()

  useGrain(grain, 11)

  useEffect(() => {
    const el = root.current
    const cv = canvas.current
    const word = fast.current
    if (!el || !cv || !word) return
    const held = heldAt()
    const phone = window.matchMedia(PHONE)
    let sky: Sky | null = makeSky(cv, () => {
      sky = null
      setDrawn(false)
    })

    /** Sets the canvas to the frame's size; false if nothing changed. */
    let size = ''
    const place = () => {
      const w = el.clientWidth
      const h = el.clientHeight
      const dpr = Math.min(window.devicePixelRatio || 1, FINEST, Math.sqrt(MOST_PIXELS / Math.max(1, w * h)))
      const next = `${w}x${h}@${dpr.toFixed(3)}${phone.matches ? 'p' : ''}`
      if (next === size || w < 10 || h < 10) return false
      size = next
      sky?.place({ ...frame(w, h, phone.matches), dpr })
      return true
    }

    /** Everything for second `t`; after the last frame, the last frame. */
    const draw = (at: number) => {
      const t = Math.min(at, AT.settled)
      // Up out of the dark as it sets off, drawing back a little as it comes.
      put(el, '--dark', (1 - smooth(AT.open, AT.opened, t)).toFixed(3))
      put(view.current, 'transform', t >= AT.settled ? 'none' : `scale(${(1 + 0.035 * (1 - inOut(t / 3.2))).toFixed(4)})`)
      sky?.draw({ t, dawn: smooth(AT.break, AT.settled, t) })
      // "fast.", forged in the fire's light at its height, slammed in; cooling to white as the fire breaks.
      put(word, 'opacity', smooth(AT.peak + 0.1, AT.peak + 0.4, t).toFixed(3))
      put(word, '--cool', smooth(AT.break, AT.broken + 0.7, t).toFixed(3))
      put(word, '--punch', (1 - smooth(AT.peak + 0.1, AT.peak + 0.55, t)).toFixed(3))
      say(velocity.current, READ.velocity(t))
      say(altitude.current, READ.altitude(t))
    }

    let frameId = 0
    let start = performance.now()
    let pausedAt: number | null = null
    let seen = true
    let runs: Animation[] = []
    let settled = false
    const now = () => (performance.now() - start) / 1000

    // At rest the readouts go on reading, a few times a second while on screen.
    let after = 0
    let reading = 0
    const read = () => {
      reading = window.setInterval(() => {
        if (!seen) return
        after += READING / 1000
        say(velocity.current, READ.velocityAfter(after))
        say(altitude.current, READ.altitudeAfter(after))
      }, READING)
    }
    /** At rest, nothing more is drawn: the canvas keeps its last frame, and the scene's picture is let go. */
    const rest = () => {
      settled = true
      el.dataset.settled = ''
      sky?.rest()
    }
    const settle = () => {
      cancelAnimationFrame(frameId)
      draw(AT.settled)
      rest()
      read()
    }
    const tick = () => {
      const t = now()
      if (t >= AT.settled) return settle()
      draw(t)
      frameId = requestAnimationFrame(tick)
    }

    place()
    if (sky) setDrawn(true)
    el.dataset.begun = ''
    start = performance.now()
    runs = arrive(el)
    if (held !== null) {
      for (const run of runs) {
        run.pause()
        run.currentTime = held * 1000
      }
      draw(held)
      if (held >= AT.settled) rest()
    } else frameId = requestAnimationFrame(tick)

    // Off screen it stops, and takes up where it left off when it's back; at rest, the stars' twinkling stops with it (data-away).
    const io = new IntersectionObserver(([e]) => {
      const was = seen
      seen = e?.isIntersecting ?? true
      if (seen) delete el.dataset.away
      else el.dataset.away = ''
      if (held !== null || settled) return
      if (was && !seen) {
        pausedAt = now()
        cancelAnimationFrame(frameId)
        runs.forEach((run) => run.pause())
      } else if (!was && seen) {
        if (pausedAt !== null) start = performance.now() - pausedAt * 1000
        pausedAt = null
        runs.forEach((run) => run.play())
        cancelAnimationFrame(frameId)
        frameId = requestAnimationFrame(tick)
      }
    })
    io.observe(el)

    let timer = 0
    const ro = new ResizeObserver(() => {
      clearTimeout(timer)
      timer = window.setTimeout(() => {
        if (!place()) return
        const t = held ?? (settled ? AT.settled : (pausedAt ?? now()))
        draw(t)
        if (settled) sky?.rest()
      }, 120)
    })
    ro.observe(el)

    return () => {
      delete el.dataset.begun
      delete el.dataset.settled
      delete el.dataset.away
      cancelAnimationFrame(frameId)
      clearTimeout(timer)
      clearInterval(reading)
      io.disconnect()
      ro.disconnect()
      runs.forEach((run) => run.cancel())
      sky?.dispose()
      sky = null
    }
  }, [])

  return (
    <div ref={root} className={s.hero} data-ready={hydrated || undefined} data-drawn={drawn || undefined}>
      {/* Dark under the nav: it turns to smoked glass over the view. */}
      <LightUnder tone="ink" className={s.under} />
      <div ref={view} className={s.view} aria-hidden="true">
        {/* Without the graphics card, or scripts: the planet's edge as the night pages draw it. */}
        <div className={s.edge} />
        <canvas ref={canvas} className={s.canvas} />
        {/* At rest, a few stars the browser keeps twinkling. */}
        <div className={s.stars}>
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
        </div>
      </div>
      <div className={s.curtain} aria-hidden="true" />
      <div ref={grain} className={s.grain} aria-hidden="true" />
      <div className={s.vignette} aria-hidden="true" />
      <div className={s.words}>
        <h1 className={s.h1}>
          <span className={s.line}>
            <Words text={HERO.title} />
          </span>{' '}
          <span ref={fast} className={s.fast}>
            {HERO.last}
          </span>
        </h1>
        {/* The flight deck's readouts, at rest until the clock runs them. */}
        <div className={s.hud} aria-hidden="true">
          <span>
            <i>{HERO.velocity}</i>
            <b ref={velocity}>{READ.velocity(AT.settled)}</b>
          </span>
          <span>
            <i>{HERO.altitude}</i>
            <b ref={altitude}>{READ.altitude(AT.settled)}</b>
          </span>
        </div>
      </div>
      <footer className={s.deck}>
        <p className={s.lead} data-arrive={0}>
          {HERO.lead}
        </p>
        <div className={s.console} data-arrive={120}>
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
