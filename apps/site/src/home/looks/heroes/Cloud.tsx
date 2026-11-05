import { CopyButton } from '@althar/ui'
import { type ReactNode, useEffect, useRef } from 'react'

import { AGENTS } from '../../../content/agents'
import { INSTALL } from '../../../content/facts'
import { HERO } from '../../../content/home'
import { askedSecond, useHydrated } from '../../../lib/browser'
import { cx } from '../../../lib/cx'
import { AgentMark } from '../../../shared/AgentMark'
import { Get, OtherMac } from '../../../shared/Close'
import { LightUnder } from '../../../shared/lightUnder'
import { altitudeAfter, altitudeAt, AT, brokenAt, heatAt, shakeAt, swayAt, velocityAfter, velocityAt } from '../../hero/journey'
import { clamp, flare, ring, smooth, wobble } from '../../hero/motion'
import bankUrl from '../d/art/bank.webp'
import seaUrl from '../d/art/sea.webp'
import s from './Cloud.module.css'

/*
 * Prototype, a new first screen: Cloud, the calm one. The same re-entry as
 * today's, from the dark, but there is no cabin: the screen is the window.
 * The capsule comes down out of the night; the heat builds at the glass in
 * the paintings' third ink, ember; at its height "fast." is forged in it; it
 * breaks, and there is the sky, an even cobalt, and the cloud sea rising
 * into the foot of the frame, painted in the footer's two inks. The word
 * cools to paper white, and everything comes to rest above the cloud, the
 * cloud's foot the paper the page goes on in.
 */

/** How long it waits for its paintings before setting off without them. */
const WAIT = 1800

/** The second to hold at, if any: `?t=`, or the last frame with reduced motion. */
const heldAt = () => {
  const t = askedSecond()
  if (t !== null) return t
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? AT.settled : null
}

/** A painting, decoded. */
const picture = (src: string) =>
  new Promise<void>((resolve) => {
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => void img.decode().then(resolve, resolve)
    img.onerror = () => resolve()
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

/** The first screen coming down out of the night onto the cloud sea. */
export function CloudHero({ nav }: { nav?: ReactNode }) {
  const root = useRef<HTMLDivElement>(null)
  const camera = useRef<HTMLDivElement>(null)
  const night = useRef<HTMLDivElement>(null)
  const sea = useRef<HTMLImageElement>(null)
  const bank = useRef<HTMLImageElement>(null)
  const heat = useRef<HTMLDivElement>(null)
  const flash = useRef<HTMLDivElement>(null)
  const fast = useRef<HTMLSpanElement>(null)
  const velocity = useRef<HTMLElement>(null)
  const altitude = useRef<HTMLElement>(null)
  const hydrated = useHydrated()

  useEffect(() => {
    const el = root.current
    const word = fast.current
    if (!el || !word) return
    const held = heldAt()
    let live = true

    /** Everything for second `t`; after the last frame, the last frame. */
    const draw = (at: number) => {
      const t = Math.min(at, AT.settled)
      const hot = heatAt(t)
      const broken = brokenAt(t)
      put(el, '--dark', (1 - smooth(AT.open, AT.opened, t)).toFixed(3))
      // The night lifting as the capsule comes down: under the fire, and the last of it once the sky opens.
      put(night.current, 'opacity', (1 - smooth(1.2, 7.4, t)).toFixed(3))
      // The cloud sea rising into the foot of the frame as the capsule comes down to it, the bank nearer, faster.
      const rise = smooth(AT.open, AT.settled, t)
      put(sea.current, 'transform', `translate3d(-50%, ${((1 - rise) * 34).toFixed(2)}%, 0)`)
      put(bank.current, 'transform', `translate3d(-50%, ${((1 - rise) * 70).toFixed(2)}%, 0)`)
      const flicker = 0.85 + 0.15 * (wobble(t * 9, 4) * 0.6 + wobble(t * 23, 8) * 0.4)
      put(heat.current, 'opacity', clamp(hot * flicker * 1.05).toFixed(3))
      put(flash.current, 'opacity', clamp(0.75 * flare(t, AT.break - 0.02, 2.6)).toFixed(3))
      // "fast.", forged at the fire's height, slammed in, then cooling to paper as it breaks.
      put(word, 'opacity', smooth(AT.peak + 0.1, AT.peak + 0.4, t).toFixed(3))
      put(word, '--cool', smooth(AT.break, AT.broken + 0.9, t).toFixed(3))
      put(word, '--punch', (1 - smooth(AT.peak + 0.1, AT.peak + 0.55, t)).toFixed(3))
      say(velocity.current, READ.velocity(t))
      say(altitude.current, READ.altitude(t))
      direct(t, hot, broken)
    }

    /* The camera: swaying a little, shaking with the heat, thrown as the fire breaks, then still. */
    const direct = (t: number, hot: number, broken: number) => {
      const shake = shakeAt(t) * 5
      const sway = swayAt(t)
      const x = wobble(t * 0.3, 3) * 3 * sway + (wobble(t * 23, 1) * 0.6 + wobble(t * 41, 2) * 0.4) * shake + 8 * ring(t, AT.break, 8, 2.4)
      const y =
        wobble(t * 0.25, 7) * 2 * sway +
        (wobble(t * 29, 4) * 0.6 + wobble(t * 47, 5) * 0.4) * shake +
        4 * hot -
        5 * ring(t, AT.break, 6.6, 2.4)
      const turn = wobble(t * 19, 6) * 0.03 * shake + 0.2 * ring(t, AT.break, 5.6, 2.4)
      const zoom = 1 + 0.025 * hot * (1 - broken)
      put(
        camera.current,
        'transform',
        t >= AT.settled
          ? 'none'
          : `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) rotate(${turn.toFixed(3)}deg) scale(${zoom.toFixed(4)})`,
      )
    }

    let frame = 0
    let start = performance.now()
    let pausedAt: number | null = null
    let seen = true
    let runs: Animation[] = []
    let begun = false
    let settled = false
    const now = () => (performance.now() - start) / 1000
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
    const rest = () => {
      el.dataset.settled = ''
    }
    const settle = () => {
      settled = true
      cancelAnimationFrame(frame)
      draw(AT.settled)
      rest()
      read()
    }
    const tick = () => {
      const t = now()
      if (t >= AT.settled) return settle()
      draw(t)
      frame = requestAnimationFrame(tick)
    }

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
          rest()
        }
      } else if (seen) frame = requestAnimationFrame(tick)
      else {
        pausedAt = 0
        runs.forEach((run) => run.pause())
      }
    }
    draw(held ?? 0)
    const waited = window.setTimeout(begin, WAIT)
    void Promise.all([picture(seaUrl), picture(bankUrl)]).then(begin)

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
      {/* Dark under the nav, and cobalt: it turns to smoked glass over the sky. */}
      <LightUnder tone="ink" className={s.under} />
      <div ref={camera} className={s.camera}>
        <div className={s.sky} aria-hidden="true" />
        <img ref={sea} className={s.sea} src={seaUrl} alt="" aria-hidden="true" decoding="async" />
        <img ref={bank} className={s.bank} src={bankUrl} alt="" aria-hidden="true" decoding="async" />
        <div className={s.foot} aria-hidden="true" />
        <div ref={night} className={s.night} aria-hidden="true" />
        <div ref={heat} className={s.heat} aria-hidden="true" />
        <div ref={flash} className={s.flash} aria-hidden="true" />
        <div className={s.curtain} aria-hidden="true" />
        <div className={s.words}>
          <h1 className={s.h1}>
            <span className={s.line}>
              <Words text={HERO.title} />
            </span>{' '}
            <span ref={fast} className={s.fast}>
              {HERO.last}
            </span>
          </h1>
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
