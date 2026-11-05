import { CopyButton } from '@althar/ui'
import { type ReactNode, useEffect, useRef } from 'react'
import { preload } from 'react-dom'

import { AGENTS } from '../../../content/agents'
import { INSTALL } from '../../../content/facts'
import { HERO } from '../../../content/home'
import { askedSecond, useHydrated } from '../../../lib/browser'
import { cx } from '../../../lib/cx'
import { AgentMark } from '../../../shared/AgentMark'
import { Get, OtherMac } from '../../../shared/Close'
import { LightUnder } from '../../../shared/lightUnder'
import { addDisplay } from '../../display'
import { altitudeAfter, altitudeAt, AT, brokenAt, heatAt, shakeAt, swayAt, velocityAfter, velocityAt } from '../../hero/journey'
import { clamp, flare, inOut, ring, smooth, wobble } from '../../hero/motion'
import fieldUrl from './dither/field.webp'
import s from './Dither.module.css'

/*
 * Prototype: the first screen on the person's own picture, a night with a
 * dithered band of light along its foot, deep blue through cobalt and violet
 * to pink and near-white: the planet's lit edge. The journey is today's
 * (hero/journey.ts): the page comes up out of the dark, the flight deck's
 * readouts ticking in the top corners; as the capsule comes down the band
 * rises into the frame and brightens, warming like an ember as the heat
 * builds; at its height "fast." is forged, ember orange, glowing; then the
 * fire breaks, the band shows its own colours and the word cools to white.
 * Everything comes to rest: from then on nothing is drawn, and the browser
 * keeps the band gently afloat.
 *
 * The band is the picture as it was sent, moved by transform and opacity
 * only. With reduced motion it is the last frame, at rest; `?t=` holds it at
 * that second.
 */

addDisplay()

/** How long it waits for the picture before setting off without it. */
const WAIT = 1800

/** The second to hold at, if any: `?t=`, or the last frame with reduced motion. */
const heldAt = () => {
  const t = askedSecond()
  if (t !== null) return t
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? AT.settled : null
}

/** The picture, decoded. */
const picture = (src: string) =>
  new Promise<void>((resolve, reject) => {
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => void img.decode().then(resolve, resolve)
    img.onerror = () => reject(new Error(`couldn't load ${src}`))
    img.src = src
  })

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

/** Writes a readout only when it changes. */
const say = (el: HTMLElement | null, text: string) => {
  if (el && el.textContent !== text) el.textContent = text
}

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

/** How far the band has risen into the frame, 0 as the page opens to 1 at rest: slowly out of the dark, most of the way with the heat, easing in after the break. */
const riseAt = (t: number) => smooth(AT.open, AT.settled - 1.5, t)

/** How bright the band is, 0 to 1: dim far below, brightening as it comes up, in full once the fire has broken. */
const lightAt = (t: number) => 0.22 + 0.38 * smooth(AT.ignite, AT.peak, t) + 0.4 * smooth(AT.break, AT.broken + 1.2, t)

/** The first screen on the person's dithered band of light. */
export function DitherHero({ nav }: { nav?: ReactNode }) {
  const root = useRef<HTMLDivElement>(null)
  const field = useRef<HTMLDivElement>(null)
  const light = useRef<HTMLDivElement>(null)
  const warm = useRef<HTMLImageElement>(null)
  const flash = useRef<HTMLDivElement>(null)
  const head = useRef<HTMLHeadingElement>(null)
  const hud = useRef<HTMLDivElement>(null)
  const fast = useRef<HTMLSpanElement>(null)
  const velocity = useRef<HTMLElement>(null)
  const altitude = useRef<HTMLElement>(null)
  const hydrated = useHydrated()
  preload(fieldUrl, { as: 'image' })

  useEffect(() => {
    const el = root.current
    const word = fast.current
    if (!el || !word) return
    const held = heldAt()
    let live = true

    /** Everything for second `t`; after the last frame, the last frame. */
    const draw = (at: number) => {
      const t = Math.min(at, AT.settled)
      const heat = heatAt(t)
      const broken = brokenAt(t)
      put(el, '--dark', (1 - smooth(AT.open, AT.opened, t)).toFixed(3))
      // The band: its light, warmed by the heat as it builds and clearing to its own colours as the fire breaks.
      put(light.current, 'opacity', lightAt(t).toFixed(3))
      put(warm.current, 'opacity', clamp(heat * 0.9).toFixed(3))
      put(flash.current, 'opacity', clamp(0.85 * flare(t, AT.break - 0.02, 2.4)).toFixed(3))
      // "fast.", forged at the heat's height, glowing and slammed in, then cooling as it breaks.
      put(word, 'opacity', smooth(AT.peak + 0.1, AT.peak + 0.4, t).toFixed(3))
      put(word, '--cool', smooth(AT.break, AT.broken + 0.7, t).toFixed(3))
      put(word, '--punch', (1 - smooth(AT.peak + 0.1, AT.peak + 0.55, t)).toFixed(3))
      say(velocity.current, READ.velocity(t))
      say(altitude.current, READ.altitude(t))
      direct(t, heat, broken)
    }

    /*
     * The camera, strapped in, as today's: swaying a little, shaking with the
     * heat, pressed down as the capsule slows, thrown as the fire breaks, then
     * at rest. The band rises under it; the words shake with it.
     */
    const direct = (t: number, heat: number, broken: number) => {
      const shake = shakeAt(t) * 6
      const sway = swayAt(t)
      const x = wobble(t * 0.3, 3) * 3 * sway + (wobble(t * 23, 1) * 0.6 + wobble(t * 41, 2) * 0.4) * shake + 9 * ring(t, AT.break, 8, 2.4)
      const y =
        wobble(t * 0.25, 7) * 2 * sway +
        (wobble(t * 29, 4) * 0.6 + wobble(t * 47, 5) * 0.4) * shake +
        4 * heat -
        5 * ring(t, AT.break, 6.6, 2.4)
      const turn = wobble(t * 19, 6) * 0.03 * shake + 0.2 * ring(t, AT.break, 5.6, 2.4)
      const zoom = 1 + 0.05 * (1 - inOut(t / 2.6)) + 0.03 * heat * (1 - broken) - 0.02 * flare(t, AT.break, 2.2)
      const rest = t >= AT.settled
      const shook = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) rotate(${turn.toFixed(3)}deg)`
      put(head.current, 'transform', rest ? 'none' : shook)
      put(hud.current, 'transform', rest ? 'none' : shook)
      // The band below, by its own height: far down at first, coming up into the frame.
      const low = (1 - riseAt(t)) * 34
      put(field.current, 'transform', rest ? 'none' : `${shook} translate3d(0, ${low.toFixed(3)}%, 0) scale(${zoom.toFixed(4)})`)
    }

    let frame = 0
    let start = performance.now()
    let pausedAt: number | null = null
    let seen = true
    let runs: Animation[] = []
    let begun = false
    let settled = false
    const now = () => (performance.now() - start) / 1000
    // At rest the readouts go on reading, a few times a second while on screen; the browser keeps the band afloat (data-settled).
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
    const settle = () => {
      settled = true
      cancelAnimationFrame(frame)
      draw(AT.settled)
      el.dataset.settled = ''
      read()
    }
    const tick = () => {
      const t = now()
      if (t >= AT.settled) return settle()
      draw(t)
      frame = requestAnimationFrame(tick)
    }

    // It sets off once the picture is in, or after a moment without it; held still, everything is there at once.
    const begin = () => {
      if (begun || !live) return
      begun = true
      el.dataset.begun = ''
      start = performance.now()
      runs = arrive(el)
      if (held !== null) {
        for (const run of runs) {
          run.pause()
          run.currentTime = held * 1000
        }
        draw(held)
        if (held >= AT.settled) {
          settled = true
          el.dataset.settled = ''
        }
      } else if (seen) frame = requestAnimationFrame(tick)
      else {
        pausedAt = 0
        runs.forEach((run) => run.pause())
      }
    }
    draw(held ?? 0)
    const waited = window.setTimeout(begin, WAIT)
    void picture(fieldUrl).then(begin, begin)

    // Off screen it stops, and takes up where it left off when it's back; at rest, the browser's motion stops with it (data-away).
    const io = new IntersectionObserver(([e]) => {
      const was = seen
      seen = e?.isIntersecting ?? true
      if (seen) delete el.dataset.away
      else el.dataset.away = ''
      if (held !== null || !begun || settled) return
      if (was && !seen) {
        pausedAt = now()
        cancelAnimationFrame(frame)
        runs.forEach((run) => run.pause())
      } else if (!was && seen) {
        if (pausedAt !== null) start = performance.now() - pausedAt * 1000
        pausedAt = null
        runs.forEach((run) => run.play())
        cancelAnimationFrame(frame)
        frame = requestAnimationFrame(tick)
      }
    })
    io.observe(el)

    return () => {
      live = false
      delete el.dataset.begun
      delete el.dataset.settled
      delete el.dataset.away
      cancelAnimationFrame(frame)
      clearTimeout(waited)
      clearInterval(reading)
      io.disconnect()
      runs.forEach((run) => run.cancel())
    }
  }, [])

  return (
    <div ref={root} className={s.hero} data-ready={hydrated || undefined}>
      {/* Dark under the nav: it turns to smoked glass over the night. */}
      <LightUnder tone="ink" className={s.under} />
      {/* The band of light along the foot: the picture as sent, its ember-warmed copy over it while the heat lasts, and the break's flash. */}
      <div ref={field} className={s.field} aria-hidden="true">
        <div className={s.afloat}>
          <div ref={light} className={s.light}>
            <img className={s.band} src={fieldUrl} alt="" width={1672} height={941} decoding="async" fetchPriority="high" />
            <img ref={warm} className={s.warm} src={fieldUrl} alt="" width={1672} height={941} decoding="async" />
          </div>
          <div ref={flash} className={s.flash} />
        </div>
      </div>
      <div className={s.curtain} aria-hidden="true" />
      {/* The flight deck's readouts in the top corners, at rest until the clock runs them. */}
      <div ref={hud} className={s.hud} aria-hidden="true">
        <span>
          <i>{HERO.velocity}</i>
          <b ref={velocity}>{READ.velocity(AT.settled)}</b>
        </span>
        <span>
          <i>{HERO.altitude}</i>
          <b ref={altitude}>{READ.altitude(AT.settled)}</b>
        </span>
      </div>
      {/* The headline in the night, the lead and the console under it. */}
      <div className={s.column}>
        <h1 ref={head} className={s.h1}>
          <span className={s.line}>
            <Words text={HERO.title} />
          </span>{' '}
          <span ref={fast} className={s.fast}>
            {HERO.last}
          </span>
        </h1>
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
      </div>
      {nav}
    </div>
  )
}
