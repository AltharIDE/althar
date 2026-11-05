import { CopyButton } from '@althar/ui'
import { type CSSProperties, type ReactNode, type RefObject, useLayoutEffect, useRef, useState } from 'react'

import { AGENTS } from '../../../content/agents'
import { INSTALL } from '../../../content/facts'
import { BRAND, HERO } from '../../../content/home'
import { cx } from '../../../lib/cx'
import { still as stillNow } from '../../../lib/browser'
import { AgentMark } from '../../../shared/AgentMark'
import { Get, OtherMac } from '../../../shared/Close'
import { useGrain } from '../../../shared/grain'
import { LightUnder } from '../../../shared/lightUnder'
import { addDisplay } from '../../display'
import { useSun } from '../state'
import s from './Night.module.css'
import { type Plate, bodyAt, fits, nameBox, plate, sidesFor, sizeOf, type Box } from './night/plate'
import { Sun } from './Sun'

/*
 * Prototype, Orrery: Althar at the middle of the deep night sky as the
 * system's sun, a thing floating there (Sun.tsx: a solid, or planes in
 * depth), a small warm light rising from it, and the agents you already pay
 * for each riding an orbit round it, in fine line, as an astronomical plate
 * draws them. The words in a band along the foot, under a hairline rule and
 * the figure's caption: the headline at the left, the lead and the ways to
 * get it at the right.
 *
 * The system turns: each agent rides its orbit, the inner ones faster,
 * passing behind the sun and in front of it, its name set aside where there
 * is room and fading where there isn't. It opens as the plate is composed
 * (night/plate.ts), runs only while it is on screen, and holds there with
 * reduced motion or `?t=` (`?orbit=` holds it that many seconds on).
 */

addDisplay()

/** The width at which the frame is a phone's. */
const PHONE = 760
/** Where the picture may start: under the nav and the bar beneath it. */
const TOP = { wide: 128, phone: 124 }

/** "Building software / has never felt so / fast.": the line in two, the last word its own. */
const WORDS = HERO.title.split(' ')
const LINES = [WORDS.slice(0, 2).join(' '), WORDS.slice(2).join(' ')] as const

const TONE = ['#fffaf2', '#b9c0ff', '#ffd9b0'] as const

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

/** The sky behind the sun: the stars, the far halves of the orbits, and the trails of the bodies behind it; the gradients and the mask all the layers use. */
function Behind({ p, parts }: { p: Plate; parts: Parts }) {
  return (
    <svg className={s.plate} width={p.w} height={p.h} viewBox={`0 0 ${p.w} ${p.h}`} aria-hidden="true" focusable="false">
      <defs>
        {/* The orbits thin out toward the sides, into the dark... */}
        <linearGradient id="orrery-fade" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0.35" />
          <stop offset="0.22" stopColor="#fff" stopOpacity="1" />
          <stop offset="0.78" stopColor="#fff" stopOpacity="1" />
          <stop offset="1" stopColor="#fff" stopOpacity="0.35" />
        </linearGradient>
        {/* ...and break round the names, wherever they are. */}
        <mask id="orrery-sides" maskUnits="userSpaceOnUse" x="0" y="0" width={p.w} height={p.h}>
          <rect width={p.w} height={p.h} fill="url(#orrery-fade)" />
          {p.bodies.map((b, i) => (
            <rect key={b.id} ref={(el) => void (part(parts, i).gap = el)} rx="3" fill="#000" width="0" height="0" />
          ))}
        </mask>
        {p.bodies.map((b, i) => (
          <linearGradient
            key={b.id}
            ref={(el) => void (part(parts, i).light = el)}
            id={`orrery-trail-${b.id}`}
            gradientUnits="userSpaceOnUse"
          >
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
      <g className={s.orbit} mask="url(#orrery-sides)">
        {p.orbits.map((o, i) => (
          <path key={i} d={o.far} stroke={o.tone} opacity={o.bright * 0.42} />
        ))}
        <path className={s.ticks} d={p.ticks.far} opacity={0.16} />
      </g>
      <Trails p={p} parts={parts} side="far" />
    </svg>
  )
}

/** The way each body came: in front of the sun or behind it, where the body is. */
function Trails({ p, parts, side }: { p: Plate; parts: Parts; side: 'far' | 'near' }) {
  return (
    <g fill="none" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" mask="url(#orrery-sides)">
      {p.bodies.map((b, i) => (
        <path key={b.id} ref={(el) => void (part(parts, i)[side] = el)} stroke={`url(#orrery-trail-${b.id})`} />
      ))}
    </g>
  )
}

/** The sun's light: a little warmth, and fine lines rising from behind the mark, at the sun's depth, so a body passing behind passes behind its light too. */
function Light({ p }: { p: Plate }) {
  return (
    <svg className={cx(s.plate, s.light)} width={p.w} height={p.h} viewBox={`0 0 ${p.w} ${p.h}`} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="orrery-light" gradientUnits="userSpaceOnUse" x1="0" y1={p.cy} x2="0" y2={p.cy - p.tall}>
          <stop offset="0" stopColor="#ffe9cf" stopOpacity="0.8" />
          <stop offset="0.45" stopColor="#ffe9cf" stopOpacity="0.32" />
          <stop offset="1" stopColor="#ffe9cf" stopOpacity="0" />
        </linearGradient>
        <radialGradient id="orrery-warmth">
          <stop offset="0" stopColor="#ffd2a0" stopOpacity="0.2" />
          <stop offset="0.4" stopColor="#ffd2a0" stopOpacity="0.06" />
          <stop offset="1" stopColor="#ffd2a0" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx={p.cx} cy={p.cy - p.sun * 0.2} r={p.sun * 1.25} fill="url(#orrery-warmth)" />
      <g stroke="url(#orrery-light)" fill="none">
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
function Before({ p, parts }: { p: Plate; parts: Parts }) {
  return (
    <svg className={cx(s.plate, s.before)} width={p.w} height={p.h} viewBox={`0 0 ${p.w} ${p.h}`} aria-hidden="true" focusable="false">
      <g className={s.orbit} mask="url(#orrery-sides)">
        {p.orbits.map((o, i) => (
          <path key={i} d={o.near} stroke={o.tone} opacity={o.bright} />
        ))}
        <path className={s.ticks} d={p.ticks.near} opacity={0.34} />
      </g>
      <Trails p={p} parts={parts} side="near" />
    </svg>
  )
}

/** Every agent Althar runs, on its orbit: its mark on a small dark body, its name beside it where there is room. Laid out at the nearest size; the clock places and sizes each. */
function Bodies({ p, parts }: { p: Plate; parts: Parts }) {
  const most = sizeOf(p, 1)
  return (
    <ul className={s.bodies} aria-label={HERO.agentsName}>
      {p.bodies.map((b, i) => (
        <li key={b.id} ref={(el) => void (part(parts, i).li = el)} className={s.body} style={{ '--size': `${most}px` } as CSSProperties}>
          <span ref={(el) => void (part(parts, i).disc = el)} className={s.disc}>
            <AgentMark agent={b.id} size={b.mark} />
          </span>
          <span ref={(el) => void (part(parts, i).name = el)} className={s.name}>
            {b.name}
          </span>
        </li>
      ))}
    </ul>
  )
}

type Side = 'left' | 'right'
/** A name's state: the side it is set on (or none), the side it should be, since when, and how far it has faded in. */
interface Named {
  side: Side | null
  want: Side | null
  since: number
  alpha: number
}
/** How long a name takes to fade, and how long the room for it must hold before it moves. */
const FADE = 0.35
const SETTLE = 0.3
const r2 = (n: number) => Math.round(n * 100) / 100

/** Draws the system at second `t`: every body, its trail, its name. `dt` since the last frame (0 to place the names at once). */
function drawAt(p: Plate, parts: Moving[], named: Named[], t: number, dt: number) {
  const most = sizeOf(p, 1)
  const at = p.bodies.map((b) => ({ ...bodyAt(p, b.orbit, b.at - p.orbits[b.orbit]!.speed * t), name: b.name }))
  // Names, nearest first: each keeps its side while there is room, else takes the other, else fades.
  const kept: Box[] = [...p.fixed]
  const order = at.map((_, i) => i).sort((a, b) => at[b]!.d - at[a]!.d)
  for (const i of order) {
    const b = at[i]!
    const n = named[i]!
    const others = at.filter((_, j) => j !== i)
    const pick = sidesFor(p, b, n.side).find((side) => fits(p, nameBox(b, b.name, side), kept, others)) ?? null
    if (pick !== n.want) {
      n.want = pick
      n.since = t
    }
    if (dt === 0) {
      n.side = n.want
      n.alpha = n.want ? 1 : 0
    } else {
      const target = t - n.since >= SETTLE ? n.want : n.side
      if (target !== n.side) {
        n.alpha = Math.max(0, n.alpha - dt / FADE)
        if (n.alpha === 0) n.side = target
      } else if (n.side) n.alpha = Math.min(1, n.alpha + dt / FADE)
    }
    if (n.side && n.alpha > 0) kept.push(nameBox(b, b.name, n.side))
    if (n.want && n.want !== n.side) kept.push(nameBox(b, b.name, n.want))
  }
  at.forEach((b, i) => {
    const el = parts[i]
    const n = named[i]!
    if (!el?.li) return
    el.li.style.transform = `translate(${r2(b.x)}px, ${r2(b.y)}px)`
    // Behind the sun (at 10) when on the far half, in front of it on the near.
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
      const bx = n.side ? nameBox(b, b.name, n.side) : null
      el.gap.setAttribute('x', bx ? String(r2(bx.l - 5)) : '0')
      el.gap.setAttribute('y', bx ? String(r2(bx.t - 3)) : '0')
      el.gap.setAttribute('width', bx ? String(r2(bx.r - bx.l + 8)) : '0')
      el.gap.setAttribute('height', bx ? String(r2(bx.b - bx.t + 6)) : '0')
      el.gap.setAttribute('opacity', String(r2(n.alpha)))
    }
    const len = Math.hypot(b.trail.x1 - b.x, b.trail.y1 - b.y)
    el.light?.setAttribute('x1', String(r2(b.x)))
    el.light?.setAttribute('y1', String(r2(b.y)))
    el.light?.setAttribute('x2', String(r2(b.trail.x1)))
    el.light?.setAttribute('y2', String(r2(b.trail.y1)))
    el.stop?.setAttribute('offset', String(Math.min(0.9, (b.size / 2 + 3) / Math.max(1, len)).toFixed(3)))
    const front = b.d >= 0
    el.near?.setAttribute('d', front ? b.trail.d : '')
    el.far?.setAttribute('d', front ? '' : b.trail.d)
    ;(front ? el.near : el.far)?.setAttribute('opacity', String(r2(0.7 + 0.3 * b.d)))
  })
}

/** Runs the system's clock while the frame is on screen; holds it with reduced motion or `?t=`. The clock goes on across a resize. */
function useOrbits(root: RefObject<HTMLElement | null>, p: Plate | null, parts: Parts, still: boolean) {
  const clock = useRef(Number(new URLSearchParams(window.location.search).get('orbit')) || 0)
  const named = useRef<Named[]>([])
  useLayoutEffect(() => {
    const el = root.current
    if (!p || !el) return
    // Each name from where the plate set it, or where it was before the resize.
    if (named.current.length !== p.bodies.length)
      named.current = p.bodies.map((b) => ({ side: b.side, want: b.side, since: -Infinity, alpha: b.side ? 1 : 0 }))
    drawAt(p, parts.current, named.current, clock.current, 0)
    if (still) return
    let frame = 0
    let last = 0
    let shown = true
    const tick = (now: number) => {
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0
      last = now
      clock.current += dt
      if (dt > 0) drawAt(p, parts.current, named.current, clock.current, dt)
      frame = requestAnimationFrame(tick)
    }
    const io = new IntersectionObserver(([entry]) => {
      const on = entry?.isIntersecting ?? true
      if (on === shown) return
      shown = on
      cancelAnimationFrame(frame)
      last = 0
      if (on) frame = requestAnimationFrame(tick)
    })
    io.observe(el)
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      io.disconnect()
    }
  }, [root, p, parts, still])
}

/** The first screen, as an orrery: Althar at the middle, the agents in orbit round it. */
export function NightHero({ nav }: { nav?: ReactNode }) {
  const root = useRef<HTMLDivElement>(null)
  const band = useRef<HTMLDivElement>(null)
  const grain = useRef<HTMLDivElement>(null)
  const [p, setP] = useState<Plate | null>(null)
  const parts = useRef<Moving[]>([])
  const kind = useSun()
  const [still] = useState(stillNow)

  useGrain(grain, 11)
  useOrbits(root, p, parts, still)

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
    <div ref={root} className={s.hero} data-still={still ? '' : undefined}>
      {/* Dark under the nav: it turns to smoked glass over the sky. */}
      <LightUnder tone="ink" className={s.under} />
      <div className={s.sky} aria-hidden="true" />
      <div ref={grain} className={s.grain} aria-hidden="true" />
      {p && (
        <>
          <Behind p={p} parts={parts} />
          <Light p={p} />
          <Sun kind={kind} cx={p.cx} cy={p.cy} size={p.sun} still={still} />
          <Before p={p} parts={parts} />
          <Bodies p={p} parts={parts} />
        </>
      )}
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
      {nav}
    </div>
  )
}
