import { CopyButton } from '@althar/ui'
import { type ReactNode, useId, useLayoutEffect, useRef, useState } from 'react'

import { AGENTS } from '../../../content/agents'
import { INSTALL } from '../../../content/facts'
import { HERO } from '../../../content/home'
import { askedSecond } from '../../../lib/browser'
import { cx } from '../../../lib/cx'
import { AgentMark } from '../../../shared/AgentMark'
import { Get, OtherMac } from '../../../shared/Close'
import s from './Chart.module.css'
import { ENTRY_KM, FIGURES, LAYERS, type Plot, plot, REST_KM, REST_SPEED, TOP_KM } from './chart/plot'

/*
 * Prototype: the first screen as the flight chart's first plate, a still
 * picture. The same re-entry as today's, plotted on the paper in look A's
 * cobalt: the air's heights as fine dashed arcs about the planet, its limb a
 * great arc low on the sheet, hatched under as the sections' ground is; the
 * altitude scale down the margin where the sections' scale runs. The
 * capsule's path comes in from the entry interface high at the right, runs
 * long and shallow while it is fast, and turns down at the left, coming to
 * rest at 38 km, right over where the sections' scale and path begin: one
 * fire-orange dot, the altimeter's needle reading it on the scale, its speed
 * beside it. The path draws itself once as the page opens; with reduced
 * motion, or held at a second (`?t=`), the picture is simply there.
 */

/** The ground's hatching, in px deep. */
const HATCH = 14

/** The plot for the sheet's size: its top under the headline, its ground a little over the lead and the console. */
function lay(el: HTMLElement, probe: HTMLElement, words: HTMLElement, deck: HTMLElement): Plot {
  const w = el.clientWidth
  const h = el.clientHeight
  const phone = w <= 700
  const narrow = w < 1100
  const spine = phone ? 0 : probe.offsetLeft
  const l = words.offsetLeft
  const right = words.offsetLeft + words.offsetWidth
  const top = words.offsetTop + words.offsetHeight + (phone ? 44 : 52)
  // The ground's crest, so the limb clears the lead and the console all the way along them.
  const parts = [...deck.children] as HTMLElement[]
  const deckLeft = deck.offsetLeft
  const deckRight = deckLeft + Math.max(...parts.map((p) => p.offsetLeft + p.offsetWidth))
  // The planet's centre a little right of the plot's middle, so the path, coming in from the right, falls all the way.
  const centre = spine + (w - spine) * (phone ? 0.6 : 0.58)
  const radius = Math.max((w - spine) * (phone ? 3 : 4.5), 1200)
  const dip = (x: number) => radius - Math.sqrt(Math.max(0, radius * radius - (x - centre) ** 2))
  const ground = deck.offsetTop - (phone ? 24 : 28) - HATCH - Math.max(dip(deckLeft), dip(deckRight))
  return plot({
    w,
    h,
    // In from high at the right, on the sheet's margin; at rest midway between the scale's ticks and the sheet's edge, where the sections' path sets off.
    from: phone ? w - 24 : right,
    to: phone ? l + 10 : narrow ? l + 40 : Math.round((spine + l + 4) / 2),
    top,
    ground: Math.round(ground),
    centre,
    radius,
  })
}

/** The scale's ticks on its line, each on a whole pixel: every 5 km, longer every 10, longest and labelled every 20. */
function ticksFor(p: Plot, spine: number) {
  const out: [string[], string[], string[]] = [[], [], []]
  for (let km = 0; km <= TOP_KM - 1; km += 5) {
    const y = Math.round(p.yAt(km, spine)) + 0.5
    const kind = km % 20 === 0 ? 2 : km % 10 === 0 ? 1 : 0
    out[kind].push(`M${spine} ${y}h${[6, 11, 17][kind]}`)
  }
  return out.map((one) => one.join(''))
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

/** The first screen as the flight chart's first plate. */
export function ChartHero({ nav }: { nav?: ReactNode }) {
  const root = useRef<HTMLDivElement>(null)
  const probe = useRef<HTMLElement>(null)
  const words = useRef<HTMLDivElement>(null)
  const deck = useRef<HTMLElement>(null)
  const flown = useRef<SVGPathElement>(null)
  const [p, setPlot] = useState<Plot | null>(null)
  const drawn = useRef(false)
  const id = useId().replace(/:/g, '')

  // The plot for the size, again whenever it changes, and once the type is in.
  useLayoutEffect(() => {
    const el = root.current
    const at = probe.current
    const head = words.current
    const foot = deck.current
    if (!el || !at || !head || !foot) return
    let last = ''
    let frame = 0
    const measure = () => {
      frame = 0
      const next = lay(el, at, head, foot)
      const { frame: f } = next
      const key = `${f.w}x${f.h}:${f.top}:${f.ground}:${f.to}`
      if (key === last) return
      last = key
      setPlot(next)
    }
    const later = () => {
      if (!frame) frame = requestAnimationFrame(measure)
    }
    measure()
    const ro = new ResizeObserver(later)
    ro.observe(el)
    ro.observe(head)
    ro.observe(foot)
    void document.fonts?.ready.then(later)
    return () => {
      cancelAnimationFrame(frame)
      ro.disconnect()
    }
  }, [])

  // Once laid, the picture comes in: the path drawing itself from the entry to rest, then the capsule; only the first time, and only where motion is welcome.
  useLayoutEffect(() => {
    const el = root.current
    if (!p || !el || drawn.current) return
    drawn.current = true
    const still = askedSecond() !== null || window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (still) {
      // Held at a second, it is simply there; with reduced motion it fades in (Chart.module.css).
      if (askedSecond() !== null) el.style.setProperty('--in', '0ms')
      el.dataset.laid = ''
      return
    }
    el.dataset.laid = ''
    const path = flown.current
    const runs: Animation[] = []
    if (path) {
      const length = path.getTotalLength()
      runs.push(
        path.animate([{ strokeDasharray: `0 ${length + 10}` }, { strokeDasharray: `${length} ${length + 10}` }], {
          duration: 2200,
          delay: 250,
          easing: 'cubic-bezier(0.33, 1, 0.68, 1)',
          fill: 'backwards',
        }),
      )
    }
    for (const one of el.querySelectorAll('[data-after]'))
      runs.push(one.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 500, delay: 2100, easing: 'ease-out', fill: 'backwards' }))
    return () => runs.forEach((run) => run.cancel())
  }, [p])

  const w = p?.frame.w ?? 0
  const h = p?.frame.h ?? 0
  const spine = p && w > 700 ? (probe.current?.offsetLeft ?? 0) : 0
  const scale = spine > 0
  // Wide, the scale's figures stand at the left of its line, as the sections' do; narrower, at the right of its ticks.
  const wide = w >= 1100
  const needleY = p && scale ? p.yAt(REST_KM, spine) : 0
  return (
    <div ref={root} className={s.hero}>
      <i ref={probe} className={s.probe} aria-hidden="true" />
      {p && (
        <svg className={s.plot} width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" focusable="false">
          <defs>
            <pattern id={`${id}-hatch`} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <path d="M0 0V7" className={s.hatchLine} />
            </pattern>
          </defs>
          {/* Where the air begins, and where each of its layers gives way to the next, from the scale to the sheet's edge; named at the margin. */}
          <g className={s.arcs}>
            {[ENTRY_KM, ...LAYERS.map((layer) => layer.km)].map((km) => (
              <path key={km} d={p.arc(km, spine, w)} />
            ))}
          </g>
          {LAYERS.map(({ km, name }) => {
            // At the margin; or, where the path runs through the words there, short of where it crosses the arc.
            const width = (name.length + 8) * 7.2
            const over = p.crosses(km + 16 / p.k) ?? p.crosses(km)
            const at = p.crosses(km)
            const x = over !== null && at !== null && over > p.entry.x - width - 12 ? at - 14 : p.entry.x
            return (
              <text key={km} className={s.note} x={x} y={p.yAt(km, x) - 7} textAnchor="end">
                {name} · {km} km
              </text>
            )
          })}
          {/* The ground: the limb, hatched under. */}
          <path className={s.hatch} d={p.band(HATCH, spine, w)} style={{ fill: `url(#${id}-hatch)` }} />
          <path className={s.limb} d={p.arc(0, spine, w)} />
          {/* The scale: its line from the plot's top to the ground, its ticks and its figures. */}
          {scale && (
            <g shapeRendering="crispEdges">
              <path className={s.spine} d={`M${spine + 0.5} ${Math.round(p.yAt(TOP_KM, spine))}V${Math.round(p.yAt(0, spine))}`} />
              <g className={s.ticks}>
                {ticksFor(p, spine).map((d, i) => (
                  <path key={i} d={d} data-kind={i} />
                ))}
              </g>
            </g>
          )}
          {scale &&
            FIGURES.map((km) => {
              const y = p.yAt(km, spine)
              // The needle covers the figures near it.
              if (Math.abs(y - needleY) < 24) return null
              return (
                <text key={km} className={s.km} x={wide ? spine - 12 : spine + 22} y={y + 3.5} textAnchor={wide ? 'end' : 'start'}>
                  {km}
                </text>
              )
            })}
          {/* The capsule's height read across to the scale, along its own arc. */}
          {scale && <path className={s.reading} d={p.arc(REST_KM, spine, p.rest.x)} data-after="" />}
          {/* The path: flown, then the rest of the way down still to fly; where it entered the air. */}
          <path className={s.planned} d={p.down} />
          <path ref={flown} className={s.flown} d={p.d} />
          <g className={s.station} transform={`translate(${p.entry.x.toFixed(1)} ${p.entry.y.toFixed(1)})`}>
            <path d="M-11 0h22M0 -11v22" />
            <circle r="5" />
          </g>
          <text className={s.note} x={p.entry.x} y={p.entry.y - 18} textAnchor="end">
            Entry interface · {ENTRY_KM.toFixed(0)} km
          </text>
          {/* The capsule at rest, and a leader out to its speed. */}
          <path className={s.reading} d={`M${(p.rest.x + 10).toFixed(1)} ${Math.round(p.rest.y) + 0.5}h16`} data-after="" />
          <g className={s.capsule} transform={`translate(${p.rest.x.toFixed(1)} ${p.rest.y.toFixed(1)})`} data-after="">
            <circle r="10" className={s.halo} />
            <circle r="4.5" />
          </g>
        </svg>
      )}
      {/* The readouts, as the chart's own annotations. */}
      {p && scale && (
        <div className={s.needle} style={{ left: spine, top: needleY }} aria-hidden="true" data-after="">
          <b>{REST_KM.toFixed(2)}</b>
          <i>km</i>
        </div>
      )}
      {p && (
        <div className={s.speed} style={{ left: p.rest.x, top: p.rest.y }} aria-hidden="true" data-after="">
          <span className={s.alt}>
            <b>{REST_KM.toFixed(2)}</b>
            <i>km</i>
            <i>·</i>
          </span>
          <b>{REST_SPEED.toFixed(3)}</b>
          <i>km/s</i>
        </div>
      )}
      <div ref={words} className={s.words}>
        <h1 className={s.h1}>
          {HERO.title} <span className={s.fast}>{HERO.last}</span>
        </h1>
        <p className={s.lead}>{HERO.lead}</p>
      </div>
      <footer ref={deck} className={s.deck}>
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
