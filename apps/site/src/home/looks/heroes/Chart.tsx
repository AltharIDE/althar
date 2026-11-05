import { CopyButton } from '@althar/ui'
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { AGENTS } from '../../../content/agents'
import { INSTALL } from '../../../content/facts'
import { HERO } from '../../../content/home'
import { askedSecond } from '../../../lib/browser'
import { cx } from '../../../lib/cx'
import { AgentMark } from '../../../shared/AgentMark'
import { Get, OtherMac } from '../../../shared/Close'
import { LightUnder } from '../../../shared/lightUnder'
import { altitudeAt, AT, brokenAt, heatAt, shakeAt, velocityAt } from '../../hero/journey'
import { clamp, flare, out, smooth, wobble } from '../../hero/motion'
import s from './Chart.module.css'
import { ARCS, ENTRY_KM, type Plot, plot, REST_KM } from './chart/plot'

/*
 * Prototype: the first screen as the flight chart's first plate. The same
 * re-entry as today's, plotted on the paper in the chart's cobalt: the air's
 * heights as fine arcs about the planet, its limb a great arc low on the
 * sheet, the altitude scale down the margin where the sections' scale runs.
 * The capsule's path draws itself through the arcs by the journey's clock,
 * one fire-orange dot riding it, its plume as strong as the heat; the
 * altimeter's needle rides down the scale with it, and its speed is an
 * arrow ahead of it, shortening as it slows. At the fire's height "fast." is
 * forged in fire-orange; as the fire breaks the ground is drawn and the word
 * tempers to cobalt, and the capsule comes to rest at 38 km, where the
 * sections' scale begins. From then on nothing is drawn; the dot's beacon
 * is the browser's to pulse.
 */

/** The second to hold at, if any: `?t=`, or the last frame with reduced motion. */
const heldAt = () => {
  const t = askedSecond()
  if (t !== null) return t
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? AT.settled : null
}

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
const put = (el: HTMLElement | SVGElement | null | undefined, name: string, value: string) => {
  if (el && el.style.getPropertyValue(name) !== value) el.style.setProperty(name, value)
}
const attr = (el: Element | null | undefined, name: string, value: string) => {
  if (el && el.getAttribute(name) !== value) el.setAttribute(name, value)
}
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

/** The scale's line, where the sections' chart has it, by the window's width (A.module.css). */
const spineFor = (w: number) => (w >= 1440 ? 196 : w >= 1100 ? 148 : w >= 700 ? 20 : 0)

/** The plot for the root's size: the ground's crest a little above the lead. */
function measure(el: HTMLElement, deck: HTMLElement): Plot {
  const w = el.clientWidth
  const h = el.clientHeight
  const spine = spineFor(w)
  const phone = w < 700
  const top = phone ? 112 : Math.round(Math.max(96, h * 0.125))
  const ground = Math.round(deck.offsetTop - (phone ? 28 : 34))
  const left = phone ? 18 : spine
  const room = w - left
  return plot({
    w,
    h,
    spine,
    from: Math.round(left + (phone ? 6 : Math.max(32, room * 0.035))),
    to: Math.round(w - (phone ? 40 : room * 0.135)),
    top,
    ground,
    bend: phone ? 2.6 : 1.9,
    centre: left + room * 0.46,
  })
}

const READ = {
  velocity: (t: number) => velocityAt(t).toFixed(3),
  altitude: (t: number) => altitudeAt(t).toFixed(2),
}

/** The first screen as the flight chart's first plate. */
export function ChartHero({ nav }: { nav?: ReactNode }) {
  const root = useRef<HTMLDivElement>(null)
  const deck = useRef<HTMLElement>(null)
  const reveal = useRef<SVGRectElement>(null)
  const groundReveal = useRef<SVGRectElement>(null)
  const flown = useRef<SVGPathElement>(null)
  const capsule = useRef<SVGGElement>(null)
  const plume = useRef<SVGGElement>(null)
  const glow = useRef<SVGCircleElement>(null)
  const shock = useRef<SVGCircleElement>(null)
  const arrow = useRef<SVGGElement>(null)
  const shaft = useRef<SVGLineElement>(null)
  const head = useRef<SVGPathElement>(null)
  const ground = useRef<SVGGElement>(null)
  const warm = useRef<HTMLDivElement>(null)
  const fast = useRef<HTMLSpanElement>(null)
  const needle = useRef<HTMLDivElement>(null)
  const altitude = useRef<HTMLElement>(null)
  const speed = useRef<HTMLDivElement>(null)
  const velocity = useRef<HTMLElement>(null)
  const [chart, setChart] = useState<Plot | null>(null)
  const current = useRef<Plot | null>(null)
  const redraw = useRef<() => void>(() => {})

  // The plot for the size, again whenever it changes.
  useLayoutEffect(() => {
    const el = root.current
    const foot = deck.current
    if (!el || !foot) return
    let last = ''
    let timer = 0
    const lay = () => {
      const next = measure(el, foot)
      const key = `${next.frame.w}x${next.frame.h}:${next.frame.ground}`
      if (key === last) return
      last = key
      setChart(next)
    }
    lay()
    const ro = new ResizeObserver(() => {
      clearTimeout(timer)
      timer = window.setTimeout(lay, 60)
    })
    ro.observe(el)
    void document.fonts?.ready.then(lay)
    return () => {
      clearTimeout(timer)
      ro.disconnect()
    }
  }, [])

  useLayoutEffect(() => {
    current.current = chart
    redraw.current()
  }, [chart])

  useEffect(() => {
    const el = root.current
    const word = fast.current
    if (!el || !word) return
    const held = heldAt()
    let live = true

    /** Everything for second `t`; after the last frame, the last frame. */
    const draw = (at: number) => {
      const t = Math.min(at, AT.settled)
      const p = current.current
      const heat = heatAt(t)
      const broken = brokenAt(t)
      // "fast.", forged at the fire's height, slammed in, then tempering to cobalt as it breaks.
      put(word, 'opacity', smooth(AT.peak + 0.1, AT.peak + 0.4, t).toFixed(3))
      put(word, '--cool', smooth(AT.break, AT.broken + 0.9, t).toFixed(3))
      put(word, '--punch', (1 - smooth(AT.peak + 0.1, AT.peak + 0.55, t)).toFixed(3))
      say(altitude.current, READ.altitude(t))
      say(velocity.current, READ.velocity(t))
      if (!p) return
      const { w } = p.frame
      // The air's arcs drawn in from the scale as it opens; the ground as the fire breaks.
      attr(reveal.current, 'width', (w * out((t - 0.1) / 1.3)).toFixed(1))
      attr(groundReveal.current, 'width', (w * out((t - AT.break) / 1.4, 3)).toFixed(1))
      put(ground.current, 'opacity', smooth(AT.break, AT.broken, t).toFixed(3))
      // The path flown, and the capsule on it, shaken a little by the heat.
      const at0 = p.at(t)
      const shake = shakeAt(t) * 1.6
      const x = at0.x + wobble(t * 31, 1) * shake
      const y = at0.y + wobble(t * 37, 4) * shake
      put(flown.current, 'stroke-dasharray', `${at0.length.toFixed(1)} ${(p.length + 20).toFixed(0)}`)
      attr(capsule.current, 'transform', `translate(${x.toFixed(2)} ${y.toFixed(2)})`)
      // The plume behind it, as long and wide as the heat; torn away as it breaks.
      const flicker = 0.86 + 0.14 * wobble(t * 17, 2)
      const torn = broken
      const len = (18 + 150 * heat) * flicker
      const wide = 0.6 + 1.6 * heat
      attr(
        plume.current,
        'transform',
        `translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${at0.angle.toFixed(2)}) translate(${(-torn * 60).toFixed(1)} 0) scale(${len.toFixed(1)} ${wide.toFixed(2)})`,
      )
      put(plume.current, 'opacity', (clamp(heat * 1.4) * (1 - torn)).toFixed(3))
      attr(glow.current, 'r', (6 + 34 * heat * flicker).toFixed(1))
      put(glow.current, 'opacity', clamp(heat * 1.2).toFixed(3))
      // As the fire breaks, a ring goes out from it.
      const ring = smooth(AT.break, AT.break + 1.2, t)
      attr(shock.current, 'r', (8 + 120 * out(ring, 2)).toFixed(1))
      put(shock.current, 'opacity', (t < AT.break ? 0 : 0.9 * (1 - ring)).toFixed(3))
      // The warmth on the paper round the fire.
      put(warm.current, 'transform', `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`)
      put(warm.current, 'opacity', (heat * (1 - broken) + 0.6 * flare(t, AT.break, 3) * 0).toFixed(3))
      // Its speed, an arrow ahead of it as long as it is fast.
      const v = velocityAt(t)
      const reach = 14 + 11 * v
      attr(arrow.current, 'transform', `translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${at0.angle.toFixed(2)})`)
      attr(shaft.current, 'x2', (reach - 6).toFixed(1))
      attr(head.current, 'transform', `translate(${reach.toFixed(1)} 0)`)
      const rad = (at0.angle * Math.PI) / 180
      put(
        speed.current,
        'transform',
        `translate3d(${(x + Math.cos(rad) * (reach + 10)).toFixed(1)}px, ${(y + Math.sin(rad) * (reach + 10)).toFixed(1)}px, 0)`,
      )
      // The altimeter's needle, on the scale where the capsule's height crosses it.
      put(needle.current, 'transform', `translate3d(0, ${p.yAt(altitudeAt(t), p.frame.spine).toFixed(1)}px, 0)`)
    }

    let frame = 0
    let start = performance.now()
    let pausedAt: number | null = null
    let seen = true
    let runs: Animation[] = []
    let begun = false
    let settled = false
    const now = () => (performance.now() - start) / 1000
    const settle = () => {
      settled = true
      cancelAnimationFrame(frame)
      draw(AT.settled)
      el.dataset.settled = ''
    }
    const tick = () => {
      const t = now()
      if (t >= AT.settled) return settle()
      draw(t)
      frame = requestAnimationFrame(tick)
    }
    redraw.current = () => draw(held ?? (settled ? AT.settled : begun ? now() : 0))

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
    // It sets off once the type is in, so the words rise whole; or after a moment without it.
    const waited = window.setTimeout(begin, 700)
    void document.fonts?.ready.then(() => begin())

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
      redraw.current = () => {}
      delete el.dataset.begun
      delete el.dataset.settled
      delete el.dataset.away
      cancelAnimationFrame(frame)
      clearTimeout(waited)
      io.disconnect()
      runs.forEach((run) => run.cancel())
    }
  }, [])

  const p = chart
  const w = p?.frame.w ?? 0
  const h = p?.frame.h ?? 0
  const spine = p?.frame.spine ?? 0
  const labelsLeft = spine >= 100
  return (
    <div ref={root} className={s.hero}>
      {/* Paper under the nav. */}
      <LightUnder tone="light" className={s.under} />
      {/* The paper warmed round the fire. */}
      <div ref={warm} className={s.warm} aria-hidden="true" />
      {p && (
        <svg className={s.plot} width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" focusable="false">
          <defs>
            <clipPath id="chart-reveal">
              <rect ref={reveal} x="0" y="0" width="0" height={h} />
            </clipPath>
            <clipPath id="chart-ground">
              <rect ref={groundReveal} x="0" y="0" width="0" height={h} />
            </clipPath>
            <pattern id="chart-hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <path d="M0 0V7" className={s.hatchLine} />
            </pattern>
            <linearGradient id="chart-plume" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0" stopColor="#ff6d2a" stopOpacity="0" />
              <stop offset="0.55" stopColor="#ff7a2e" stopOpacity="0.45" />
              <stop offset="1" stopColor="#ffb15a" stopOpacity="1" />
            </linearGradient>
            <radialGradient id="chart-glow">
              <stop offset="0" stopColor="#ff8a3a" stopOpacity="0.55" />
              <stop offset="1" stopColor="#ff6d2a" stopOpacity="0" />
            </radialGradient>
          </defs>
          {/* The scale and the air's heights. */}
          <g clipPath="url(#chart-reveal)">
            {spine > 0 && (
              <path className={s.spine} d={`M${spine + 0.5} ${p.yAt(TOP_KM_LINE, spine).toFixed(1)}V${p.yAt(0, spine).toFixed(1)}`} />
            )}
            <g className={s.arcs}>
              {ARCS.map((km) => (
                <path key={km} d={p.arc(km, Math.max(spine, 0), w)} />
              ))}
            </g>
            {spine > 0 && (
              <g className={s.ticks}>
                {Array.from({ length: 25 }, (_, i) => i * 5).map((km) => {
                  const y = Math.round(p.yAt(km, spine)) + 0.5
                  const len = km % 20 === 0 ? 17 : km % 10 === 0 ? 11 : 6
                  return <path key={km} d={`M${spine} ${y}h${len}`} data-kind={km % 20 === 0 ? 2 : km % 10 === 0 ? 1 : 0} />
                })}
              </g>
            )}
            <g className={s.labels}>
              {ARCS.map((km) =>
                labelsLeft ? (
                  <text key={km} x={spine - 12} y={p.yAt(km, spine) + 3.5} textAnchor="end">
                    {km}
                  </text>
                ) : (
                  <text key={km} x={Math.max(spine, 0) + 8} y={p.yAt(km, Math.max(spine, 0) + 8) - 5}>
                    {km} km
                  </text>
                ),
              )}
            </g>
          </g>
          {/* The ground: the limb, hatched under as a drawing's ground is. */}
          <g ref={ground} className={s.ground} clipPath="url(#chart-ground)">
            <path className={s.hatch} d={p.band(14, Math.max(spine, 0), w)} />
            <path className={s.limb} d={p.arc(0, Math.max(spine, 0), w)} />
            {labelsLeft && (
              <text className={s.zero} x={spine - 12} y={p.yAt(0, spine) + 3.5} textAnchor="end">
                0
              </text>
            )}
          </g>
          {/* The path: planned, a fine dotted line; flown, solid; where it enters the air and where it rests. */}
          <path className={s.planned} d={p.d} />
          <path className={s.planned} d={p.down} />
          <path ref={flown} className={s.flown} d={p.d} />
          <g className={s.station} transform={`translate(${p.at(0).x.toFixed(1)} ${p.at(0).y.toFixed(1)})`}>
            <path d="M-11 0h22M0 -11v22" />
            <circle r="5" />
          </g>
          <circle
            ref={shock}
            className={s.shock}
            r="8"
            transform={`translate(${p.at(AT.break).x.toFixed(1)} ${p.at(AT.break).y.toFixed(1)})`}
          />
          <g ref={plume} className={s.plume}>
            <path d="M-1 0C-0.6 -1.6 -0.2 -3 0 -3C0.6 -3 1 -1.5 1 0C1 1.5 0.6 3 0 3C-0.2 3 -0.6 1.6 -1 0Z" fill="url(#chart-plume)" />
          </g>
          <g ref={arrow} className={s.arrow}>
            <line ref={shaft} x1="7" y1="0" x2="60" y2="0" />
            <path ref={head} d="M0 0L-9 -3.5V3.5Z" />
          </g>
          <g ref={capsule} className={s.capsule}>
            <circle ref={glow} r="6" className={s.glow} fill="url(#chart-glow)" />
            <circle r="11" className={s.beacon} />
            <circle r="4.5" className={s.dot} />
          </g>
        </svg>
      )}
      <div className={s.words}>
        <h1 className={s.h1}>
          <span className={s.line}>
            <Words text={HERO.title} />
          </span>{' '}
          <span ref={fast} className={s.fast}>
            {HERO.last}
          </span>
        </h1>
        {/* The readouts, as the chart's own annotations: the altimeter's needle on the scale, the speed at the arrow's head. */}
        <div className={s.read} aria-hidden="true">
          <div ref={needle} className={s.needle} style={{ left: spine }}>
            <span className={s.tag}>
              <b ref={altitude}>{REST_KM.toFixed(2)}</b>
              <i>km</i>
            </span>
          </div>
          <div ref={speed} className={s.speed}>
            <b ref={velocity}>{velocityAt(AT.settled).toFixed(3)}</b>
            <i>km/s</i>
          </div>
        </div>
      </div>
      <footer ref={deck} className={s.deck}>
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
                <CopyButton value={INSTALL.brew} ghost />
              </span>
            </div>
          </div>
          <div className={cx(s.cell, s.ways)}>
            <Get tone="paper" />
            <OtherMac tone="paper" />
          </div>
        </div>
      </footer>
      {nav}
    </div>
  )
}

/** Where the scale's line begins: a little over the top arc. */
const TOP_KM_LINE = Math.max(...ARCS, ENTRY_KM) + 4
