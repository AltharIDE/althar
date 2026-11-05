import { CopyButton } from '@althar/ui'
import { type CSSProperties, type ReactNode, type RefObject, useId, useLayoutEffect, useRef, useState } from 'react'

import { AGENTS } from '../content/agents'
import { INSTALL } from '../content/facts'
import { BRAND, HERO } from '../content/home'
import { askedSecond, useHydrated, useMedia } from '../lib/browser'
import { cx } from '../lib/cx'
import { AgentMark } from '../shared/AgentMark'
import { Get, OtherMac } from '../shared/Close'
import { useGrain } from '../shared/grain'
import { LightUnder } from '../shared/lightUnder'
import { addDisplay } from './display'
import s from './Hero.module.css'
import { type Clock, useClock } from './hero/clock'
import { type Plate, plate, sizeOf } from './hero/plate'
import { Sun } from './hero/Sun'
import { type At, bodiesAt, type Name, nameBox, placeNames, unnamed } from './hero/system'

/*
 * The developer page's first screen, an orrery: Althar at the middle of the
 * deep night sky as the system's sun, the mark floating there as a solid
 * (hero/Sun.tsx), a small warm light rising from it as the altar's does in
 * the footer, and the agents you already pay for each riding an orbit round
 * it, in fine line, as an astronomical plate draws them. The words in a band
 * along the foot, under a hairline rule and the figure's caption: the
 * headline at the left, the lead and the ways to get it at the right.
 *
 * The drawing is worked out for the frame (hero/plate.ts) before the first
 * paint, and again only when the frame or the band changes size. The system
 * turns (hero/system.ts): each agent rides its orbit, the inner ones faster,
 * passing behind the sun and in front of it, its name set aside where there
 * is room and fading where there isn't. One clock moves it and the sun
 * (hero/clock.ts), only while it is on screen; with reduced motion it holds
 * as composed, and `?t=` holds it that many seconds on.
 *
 * The prerender has the sky, the words and the agents' names; the drawing
 * fades up out of the dark once the page's script has measured the frame,
 * and the nav comes in after it (Nav's `opening`).
 */

addDisplay()

/** The width at which the frame is a phone's (Hero.module.css). */
const PHONE = 760
/** Where the picture may start: under the nav. */
const TOP = { wide: 104, phone: 96 }

/** "Building software / has never felt so / fast.": the line in two, the last word its own. */
const WORDS = HERO.title.split(' ')
const LINES = [WORDS.slice(0, 2).join(' '), WORDS.slice(2).join(' ')] as const

const TONE = ['#fffaf2', '#b9c0ff', '#ffd9b0'] as const

/** The discs' size before the frame is measured: a wide screen's, at its nearest. */
const FIRST = sizeOf({ phone: false, scale: 1 }, 1)

/** What the clock moves, by body: the body, its disc and name; its trail (behind the sun or in front), the trail's light, and the break its name makes in the lines. */
interface Moving {
  li: HTMLLIElement | null
  disc: HTMLSpanElement | null
  name: HTMLSpanElement | null
  far: SVGPathElement | null
  near: SVGPathElement | null
  light: SVGLinearGradientElement | null
  stop: SVGStopElement | null
  gap: SVGRectElement | null
}
type Parts = RefObject<Moving[]>
const part = (parts: Parts, i: number) =>
  (parts.current[i] ??= { li: null, disc: null, name: null, far: null, near: null, light: null, stop: null, gap: null })

/** The ids the drawing's layers share, the page's own. */
interface Ids {
  fade: string
  sides: string
  trail: (i: number) => string
  light: string
  warmth: string
}

/** The sky behind the sun: the stars, the far halves of the orbits, and the trails of the bodies behind it; the gradients and the mask all the layers use. */
function Behind({ p, parts, ids }: { p: Plate; parts: Parts; ids: Ids }) {
  return (
    <svg className={s.layer} width={p.w} height={p.h} viewBox={`0 0 ${p.w} ${p.h}`} aria-hidden="true" focusable="false">
      <defs>
        {/* The orbits thin out toward the sides, into the dark... */}
        <linearGradient id={ids.fade} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0.35" />
          <stop offset="0.22" stopColor="#fff" stopOpacity="1" />
          <stop offset="0.78" stopColor="#fff" stopOpacity="1" />
          <stop offset="1" stopColor="#fff" stopOpacity="0.35" />
        </linearGradient>
        {/* ...and break round the names, wherever they are. */}
        <mask id={ids.sides} maskUnits="userSpaceOnUse" x="0" y="0" width={p.w} height={p.h}>
          <rect width={p.w} height={p.h} fill={`url(#${ids.fade})`} />
          {p.bodies.map((b, i) => (
            <rect key={b.id} ref={(el) => void (part(parts, i).gap = el)} rx="3" fill="#000" width="0" height="0" />
          ))}
        </mask>
        {p.bodies.map((b, i) => (
          <linearGradient key={b.id} ref={(el) => void (part(parts, i).light = el)} id={ids.trail(i)} gradientUnits="userSpaceOnUse">
            <stop ref={(el) => void (part(parts, i).stop = el)} stopColor="#dfe3ff" stopOpacity="1" />
            <stop offset="1" stopColor="#dfe3ff" stopOpacity="0" />
          </linearGradient>
        ))}
      </defs>
      <g>
        {p.stars.map((star, i) => (
          <circle key={i} cx={star.x} cy={star.y} r={star.r} fill={TONE[star.tone]} opacity={star.a} />
        ))}
      </g>
      <g className={s.orbit} mask={`url(#${ids.sides})`}>
        {p.orbits.map((o, i) => (
          <path key={i} d={o.far} stroke={o.tone} opacity={o.bright * 0.42} />
        ))}
        <path className={s.ticks} d={p.ticks.far} opacity={0.16} />
      </g>
      <Trails p={p} parts={parts} ids={ids} side="far" />
    </svg>
  )
}

/** The way each body came: in front of the sun or behind it, where the body is. */
function Trails({ p, parts, ids, side }: { p: Plate; parts: Parts; ids: Ids; side: 'far' | 'near' }) {
  return (
    <g fill="none" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" mask={`url(#${ids.sides})`}>
      {p.bodies.map((b, i) => (
        <path key={b.id} ref={(el) => void (part(parts, i)[side] = el)} stroke={`url(#${ids.trail(i)})`} />
      ))}
    </g>
  )
}

/** The sun's light: a little warmth, and fine lines rising from behind the mark, at the sun's depth, so a body passing behind passes behind its light too. Only as large as the light, as it is drawn again while it drifts. */
function Light({ p, ids }: { p: Plate; ids: Ids }) {
  const g = p.glow
  return (
    <svg
      className={cx(s.layer, s.light)}
      style={{ left: g.l, top: g.t }}
      width={g.r - g.l}
      height={g.b - g.t}
      viewBox={`${g.l} ${g.t} ${g.r - g.l} ${g.b - g.t}`}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={ids.light} gradientUnits="userSpaceOnUse" x1="0" y1={p.cy} x2="0" y2={p.cy - p.tall}>
          <stop offset="0" stopColor="#ffe9cf" stopOpacity="0.8" />
          <stop offset="0.45" stopColor="#ffe9cf" stopOpacity="0.32" />
          <stop offset="1" stopColor="#ffe9cf" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={ids.warmth}>
          <stop offset="0" stopColor="#ffd2a0" stopOpacity="0.2" />
          <stop offset="0.4" stopColor="#ffd2a0" stopOpacity="0.06" />
          <stop offset="1" stopColor="#ffd2a0" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx={p.warmth.x} cy={p.warmth.y} r={p.warmth.r} fill={`url(#${ids.warmth})`} />
      <g stroke={`url(#${ids.light})`} fill="none">
        {p.rays.map((r, i) => {
          // Where it breaks up, on its way from its root to its top; above it, the broken light drifts upward.
          const mx = Math.round((r.x0 + ((r.x1 - r.x0) * (r.y0 - r.mid)) / (r.y0 - r.top)) * 10) / 10
          const len = r.dash.split(' ').reduce((sum, one) => sum + Number(one), 0)
          return (
            <g key={i} strokeWidth={r.width}>
              <path d={`M${r.x0} ${r.y0}L${mx} ${r.mid}`} />
              <path
                className={s.rise}
                d={`M${mx} ${r.mid}L${r.x1} ${r.top}`}
                strokeDasharray={r.dash}
                style={{ '--len': len } as CSSProperties}
              />
            </g>
          )
        })}
      </g>
    </svg>
  )
}

/** In front of the sun: the near halves of the orbits, and the trails of the bodies in front of it. */
function Before({ p, parts, ids }: { p: Plate; parts: Parts; ids: Ids }) {
  return (
    <svg className={cx(s.layer, s.before)} width={p.w} height={p.h} viewBox={`0 0 ${p.w} ${p.h}`} aria-hidden="true" focusable="false">
      <g className={s.orbit} mask={`url(#${ids.sides})`}>
        {p.orbits.map((o, i) => (
          <path key={i} d={o.near} stroke={o.tone} opacity={o.bright} />
        ))}
        <path className={s.ticks} d={p.ticks.near} opacity={0.34} />
      </g>
      <Trails p={p} parts={parts} ids={ids} side="near" />
    </svg>
  )
}

/** Every agent Althar runs, on its orbit: its mark on a small dark body, its name beside it where there is room. In the prerender too, for its names; laid out at the nearest size, and placed and sized by the clock. */
function Bodies({ p, parts }: { p: Plate | null; parts: Parts }) {
  const most = p ? sizeOf(p, 1) : FIRST
  return (
    <ul className={s.bodies} aria-label={HERO.agentsName}>
      {AGENTS.map((agent, i) => (
        <li
          key={agent.id}
          ref={(el) => void (part(parts, i).li = el)}
          className={s.body}
          style={{ '--size': `${most}px` } as CSSProperties}
        >
          <span ref={(el) => void (part(parts, i).disc = el)} className={s.disc}>
            <AgentMark agent={agent.id} size={Math.round(most * 0.5)} />
          </span>
          <span ref={(el) => void (part(parts, i).name = el)} className={s.name}>
            {agent.name}
          </span>
        </li>
      ))}
    </ul>
  )
}

const r2 = (n: number) => Math.round(n * 100) / 100

/** Draws the system as it is: every body, its trail, its name, and the break its name makes in the lines. */
function draw(p: Plate, at: At[], names: Name[], parts: Moving[]) {
  const most = sizeOf(p, 1)
  at.forEach((b, i) => {
    const el = parts[i]
    const n = names[i]!
    if (!el?.li) return
    el.li.style.transform = `translate(${r2(b.x)}px, ${r2(b.y)}px)`
    // Behind the sun (at 10) on the far half, in front of it on the near.
    el.li.style.zIndex = String(b.d < 0 ? 5 + Math.round((1 + b.d) * 4) : 12 + Math.round(b.d * 4))
    el.li.style.setProperty('--d', b.d.toFixed(3))
    if (el.disc) el.disc.style.transform = `scale(${r2(b.size / most)})`
    if (el.name) {
      el.name.style.opacity = String(r2(n.alpha))
      el.name.dataset.side = n.side ?? 'right'
      const off = b.size / 2 + 7
      el.name.style.transform = `translateX(${r2(n.side === 'left' ? -off : off)}px)`
    }
    if (el.gap) {
      const bx = n.side ? nameBox(b, p.bodies[i]!.name, n.side) : null
      el.gap.setAttribute('x', bx ? String(r2(bx.l - 5)) : '0')
      el.gap.setAttribute('y', bx ? String(r2(bx.t - 3)) : '0')
      el.gap.setAttribute('width', bx ? String(r2(bx.r - bx.l + 8)) : '0')
      el.gap.setAttribute('height', bx ? String(r2(bx.b - bx.t + 6)) : '0')
      el.gap.setAttribute('opacity', String(r2(n.alpha)))
    }
    const len = Math.hypot(b.x1 - b.x, b.y1 - b.y)
    el.light?.setAttribute('x1', String(r2(b.x)))
    el.light?.setAttribute('y1', String(r2(b.y)))
    el.light?.setAttribute('x2', String(r2(b.x1)))
    el.light?.setAttribute('y2', String(r2(b.y1)))
    el.stop?.setAttribute('offset', Math.min(0.9, (b.size / 2 + 3) / Math.max(1, len)).toFixed(3))
    const front = b.d >= 0
    el.near?.setAttribute('d', front ? b.trail : '')
    el.far?.setAttribute('d', front ? '' : b.trail)
    ;(front ? el.near : el.far)?.setAttribute('opacity', String(r2(0.7 + 0.3 * b.d)))
  })
}

/** Sets the system where the clock is (on opening, after a resize, when motion stops) and moves it with the clock. The names keep their sides across a resize. */
function useSystem(p: Plate | null, parts: Parts, clock: Clock, still: boolean) {
  const names = useRef<Name[]>([])
  useLayoutEffect(() => {
    if (!p) return
    if (names.current.length !== p.bodies.length) names.current = unnamed(p)
    const step = (t: number, dt: number) => {
      const at = bodiesAt(p, t)
      placeNames(p, at, names.current, t, dt)
      draw(p, at, names.current, parts.current)
    }
    step(clock.t, 0)
    if (still) return
    return clock.on(step)
  }, [p, parts, clock, still])
}

export function Hero({ nav }: { nav?: ReactNode }) {
  const root = useRef<HTMLDivElement>(null)
  const band = useRef<HTMLDivElement>(null)
  const grain = useRef<HTMLDivElement>(null)
  const parts = useRef<Moving[]>([])
  const [p, setP] = useState<Plate | null>(null)
  const id = useId()
  const [ids] = useState<Ids>(() => ({
    fade: `${id}fade`,
    sides: `${id}sides`,
    trail: (i) => `${id}trail${i}`,
    light: `${id}light`,
    warmth: `${id}warmth`,
  }))
  // Held still with reduced motion, followed as it changes, or for a look at one frame (`?t=`); neither while the page hydrates.
  const reduced = useMedia('(prefers-reduced-motion: reduce)')
  const frame = useHydrated() && askedSecond() !== null
  const still = reduced || frame
  const clock = useClock(root, !still)

  useGrain(grain, 11)
  useSystem(p, parts, clock, still)

  // Worked out before the first paint, and again only when the frame or the band changes size.
  useLayoutEffect(() => {
    const el = root.current
    const words = band.current
    if (!el || !words) return
    let last = ''
    const measure = () => {
      const w = el.clientWidth
      const h = el.clientHeight
      const foot = words.offsetTop
      const key = `${w}x${h}:${foot}`
      if (key === last || w < 10) return
      last = key
      const phone = w <= PHONE
      setP(plate({ w, h, foot, phone, top: phone ? TOP.phone : TOP.wide }))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    ro.observe(words)
    return () => ro.disconnect()
  }, [])

  return (
    <div
      ref={root}
      className={s.hero}
      data-drawn={p ? '' : undefined}
      data-still={still ? '' : undefined}
      data-frame={frame ? '' : undefined}
    >
      {/* The nav's room, in the flow at the top. */}
      {nav}
      {/* Dark under the nav: it turns to smoked glass over the sky. */}
      <LightUnder tone="ink" className={s.under} />
      <div className={s.sky} aria-hidden="true" />
      <div ref={grain} className={s.grain} aria-hidden="true" />
      <div className={s.drawing}>
        {p && (
          <>
            <Behind p={p} parts={parts} ids={ids} />
            <Light p={p} ids={ids} />
            <Sun cx={p.cx} cy={p.cy} size={p.sun} tilt={p.tilt} clock={clock} still={still} />
            <Before p={p} parts={parts} ids={ids} />
          </>
        )}
        <Bodies p={p} parts={parts} />
      </div>
      <div ref={band} className={s.band}>
        <p className={s.caption} aria-hidden="true">
          <b>Fig. 1</b>
          <span>{BRAND}</span>
          <i className={s.rule} />
          <span>
            {HERO.agents} <b>{AGENTS.length}</b>
          </span>
        </p>
        <h1 className={s.h1}>
          <span className={s.line}>{LINES[0]}</span> <span className={s.line}>{LINES[1]}</span>{' '}
          <span className={cx(s.line, s.fast)}>{HERO.last}</span>
        </h1>
        <div className={s.side}>
          <p className={s.lead}>{HERO.lead}</p>
          <div className={s.ways}>
            <Get tone="blue" />
            <OtherMac tone="blue" />
          </div>
          <div className={s.install}>
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
        </div>
      </div>
    </div>
  )
}
