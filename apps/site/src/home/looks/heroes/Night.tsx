import { CopyButton, LOGO_BORE, LOGO_SECTION } from '@althar/ui'
import { type CSSProperties, type ReactNode, useLayoutEffect, useRef, useState } from 'react'

import { AGENTS } from '../../../content/agents'
import { INSTALL } from '../../../content/facts'
import { BRAND, HERO } from '../../../content/home'
import { cx } from '../../../lib/cx'
import { AgentMark } from '../../../shared/AgentMark'
import { Get, OtherMac } from '../../../shared/Close'
import { useGrain } from '../../../shared/grain'
import { LightUnder } from '../../../shared/lightUnder'
import { addDisplay } from '../../display'
import s from './Night.module.css'
import { type Plate, plate } from './night/plate'

/*
 * Prototype, Orrery: Althar at the middle of the deep night sky as the
 * system's sun, a small warm light rising from it, and the agents you
 * already pay for each riding an orbit round it, in fine line, as an
 * astronomical plate draws them. The words in a band along the foot, under
 * a hairline rule and the figure's caption: the headline at the left, the
 * lead and the ways to get it at the right.
 *
 * Nothing moves. The drawing (night/plate.ts) is worked out for the frame's
 * size, and again only when the size changes.
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

/** The drawing, behind the words: the stars, the orbits, the sun and its light. */
function Drawing({ p }: { p: Plate }) {
  const k = p.sun / 24
  return (
    <svg className={s.plate} width={p.w} height={p.h} viewBox={`0 0 ${p.w} ${p.h}`} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="orrery-light" gradientUnits="userSpaceOnUse" x1="0" y1={p.cy} x2="0" y2={p.cy - p.tall}>
          <stop offset="0" stopColor="#ffe9cf" stopOpacity="0.8" />
          <stop offset="0.45" stopColor="#ffe9cf" stopOpacity="0.32" />
          <stop offset="1" stopColor="#ffe9cf" stopOpacity="0" />
        </linearGradient>
        {/* The orbits thin out toward the sides, into the dark. */}
        <linearGradient id="orrery-fade" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0.35" />
          <stop offset="0.22" stopColor="#fff" stopOpacity="1" />
          <stop offset="0.78" stopColor="#fff" stopOpacity="1" />
          <stop offset="1" stopColor="#fff" stopOpacity="0.35" />
        </linearGradient>
        {/* ...and break round the names. */}
        <mask id="orrery-sides" maskUnits="userSpaceOnUse" x="0" y="0" width={p.w} height={p.h}>
          <rect width={p.w} height={p.h} fill="url(#orrery-fade)" />
          {p.names.map((n, i) => (
            <rect key={i} x={n.l - 5} y={n.t - 3} width={n.r - n.l + 8} height={n.b - n.t + 6} rx="3" fill="#000" />
          ))}
        </mask>
        <radialGradient id="orrery-warmth">
          <stop offset="0" stopColor="#ffd2a0" stopOpacity="0.2" />
          <stop offset="0.4" stopColor="#ffd2a0" stopOpacity="0.06" />
          <stop offset="1" stopColor="#ffd2a0" stopOpacity="0" />
        </radialGradient>
        {p.bodies.map((b) => (
          <linearGradient
            key={b.id}
            id={`orrery-trail-${b.id}`}
            gradientUnits="userSpaceOnUse"
            x1={b.x}
            y1={b.y}
            x2={b.trail.x1}
            y2={b.trail.y1}
          >
            <stop offset={(b.size / 2 + 3) / Math.hypot(b.trail.x1 - b.x, b.trail.y1 - b.y)} stopColor="#dfe3ff" stopOpacity="1" />
            <stop offset="1" stopColor="#dfe3ff" stopOpacity="0" />
          </linearGradient>
        ))}
      </defs>
      <g>
        {p.stars.map((star, i) => (
          <circle key={i} cx={star.x} cy={star.y} r={star.r} fill={TONE[star.tone]} opacity={star.a} />
        ))}
      </g>
      {/* The far halves, behind the sun. */}
      <g className={s.orbit} mask="url(#orrery-sides)">
        {p.orbits.map((o, i) => (
          <path key={i} d={o.far} stroke={o.tone} opacity={o.bright * 0.42} />
        ))}
        <path className={s.ticks} d={p.ticks.far} opacity={0.16} />
      </g>
      {/* The sun: a little warmth, its light rising, the mark. */}
      <circle cx={p.cx} cy={p.cy - p.sun * 0.3} r={p.sun * 1.6} fill="url(#orrery-warmth)" />
      <g stroke="url(#orrery-light)" fill="none">
        {p.rays.map((r, i) => {
          // Where it breaks up, on its way from its root to its top.
          const mx = Math.round((r.x0 + ((r.x1 - r.x0) * (r.y0 - r.mid)) / (r.y0 - r.top)) * 10) / 10
          return (
            <g key={i} strokeWidth={r.width}>
              <path d={`M${r.x0} ${r.y0}L${mx} ${r.mid}`} />
              <path d={`M${mx} ${r.mid}L${r.x1} ${r.top}`} strokeDasharray={r.dash} />
            </g>
          )
        })}
      </g>
      <g transform={`translate(${p.cx - 12 * k} ${p.cy - 14.4 * k}) scale(${k})`}>
        <path className={s.mark} d={LOGO_SECTION + LOGO_BORE} fillRule="evenodd" />
        <circle className={s.point} cx="12" cy="14.4" r="0.8" />
      </g>
      {/* The near halves, in front of it, and the way each agent came. */}
      <g className={s.orbit} mask="url(#orrery-sides)">
        {p.orbits.map((o, i) => (
          <path key={i} d={o.near} stroke={o.tone} opacity={o.bright} />
        ))}
        <path className={s.ticks} d={p.ticks.near} opacity={0.34} />
      </g>
      <g fill="none" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" mask="url(#orrery-sides)">
        {p.bodies.map((b) => (
          <path key={b.id} d={b.trail.d} stroke={`url(#orrery-trail-${b.id})`} opacity={0.7 + 0.3 * b.d} />
        ))}
      </g>
    </svg>
  )
}

/** Every agent Althar runs, on its orbit: its mark on a small dark body, its name beside it where there is room. */
function Bodies({ p }: { p: Plate }) {
  return (
    <ul className={s.bodies} aria-label={HERO.agentsName}>
      {p.bodies.map((b) => (
        <li
          key={b.id}
          className={s.body}
          data-side={b.side ?? undefined}
          style={
            {
              left: b.x,
              top: b.y,
              zIndex: Math.round(10 + 10 * b.d),
              '--d': b.d,
              '--size': `${b.size}px`,
            } as CSSProperties
          }
        >
          <span className={s.disc}>
            <AgentMark agent={b.id} size={b.mark} />
          </span>
          <span className={b.side ? s.name : s.sr}>{b.name}</span>
        </li>
      ))}
    </ul>
  )
}

/** The first screen, as an orrery: Althar at the middle, the agents in orbit round it. */
export function NightHero({ nav }: { nav?: ReactNode }) {
  const root = useRef<HTMLDivElement>(null)
  const band = useRef<HTMLDivElement>(null)
  const grain = useRef<HTMLDivElement>(null)
  const [p, setP] = useState<Plate | null>(null)

  useGrain(grain, 11)

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
    <div ref={root} className={s.hero}>
      {/* Dark under the nav: it turns to smoked glass over the sky. */}
      <LightUnder tone="ink" className={s.under} />
      <div className={s.sky} aria-hidden="true" />
      {p && <Drawing p={p} />}
      <div ref={grain} className={s.grain} aria-hidden="true" />
      {p && <Bodies p={p} />}
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
