import { CopyButton } from '@althar/ui'
import { type CSSProperties, type ReactNode, useId, useLayoutEffect, useRef, useState } from 'react'

import { AGENTS } from '../../../content/agents'
import { INSTALL } from '../../../content/facts'
import { HERO } from '../../../content/home'
import { AgentMark } from '../../../shared/AgentMark'
import { Get, OtherMac } from '../../../shared/Close'
import { addDisplay } from '../../display'
import s from './Chart.module.css'
import { type Box, lay, type Measure, type Piece, type Plate, REST_KM, REST_SPEED, scale } from './chart/descent'

/*
 * Prototype: the first screen as a descent. The headline is the re-entry:
 * on the flight chart's paper, the capsule's path comes in nearly level
 * high at the left, over the altitude scale, and turns down ever more
 * steeply through the air's layers to come to rest in the full stop of
 * "fast.". The sentence hangs from it, each piece under the station where
 * the path crosses a layer, each larger than the last, "fast." the largest,
 * at the foot. Under the level part of the path, beside the scale, the lead,
 * the download and the install stand in a ruled title block, as a drawing's
 * has. A still picture: drawn once to the type as set, and again whenever
 * the sheet changes size; nothing moves.
 */

addDisplay()

/** The headline's first two words, the rest, and its last word: the three pieces it hangs in. */
const WORDS = HERO.title.split(' ')
const PIECES = [WORDS.slice(0, 2).join(' '), WORDS.slice(2).join(' '), HERO.last] as const

/** A label's width at the margin: the mono at 10px, tracked 0.12em. */
const labelWidth = (words: string) => words.length * 7.2

/** Every agent Althar runs, as its mark, named on hover and to a screen reader. */
function Agents() {
  return (
    <ul className={s.agents} aria-label={HERO.agentsName}>
      {AGENTS.map((agent) => (
        <li key={agent.id} title={agent.name}>
          <AgentMark agent={agent.id} size={16} />
          <span className={s.sr}>{agent.name}</span>
        </li>
      ))}
    </ul>
  )
}

/** A piece of the headline as set: its advance to the end of its ink, and its ink over and under the baseline. */
function measurePiece(el: HTMLElement, ctx: CanvasRenderingContext2D): Piece {
  const cs = getComputedStyle(el)
  ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
  ctx.letterSpacing = cs.letterSpacing === 'normal' ? '0px' : cs.letterSpacing
  const text = el.textContent ?? ''
  const all = ctx.measureText(text)
  // The ink's right: the last letter's origin and its own ink, so a piece ends exactly at its leader.
  const last = ctx.measureText(text.slice(-1))
  const origin = ctx.measureText(text.slice(0, -1)).width
  return {
    size: parseFloat(cs.fontSize),
    w: origin + last.actualBoundingBoxRight,
    asc: all.actualBoundingBoxAscent,
    desc: all.actualBoundingBoxDescent,
  }
}

/** The plate for the sheet as it is now. */
function measure(root: HTMLElement, pieces: HTMLElement[], block: HTMLElement, probe: HTMLElement): Measure | null {
  const ctx = document.createElement('canvas').getContext('2d')
  if (!ctx) return null
  const w = root.clientWidth
  const h = root.clientHeight
  const cs = getComputedStyle(root)
  const px = (name: string) => parseFloat(cs.getPropertyValue(name)) || 0
  const [a, b, c] = pieces.map((one) => measurePiece(one, ctx)) as [Piece, Piece, Piece]
  // The full stop's ink in "fast.", from the piece's origin.
  const fast = pieces[2]!
  const fs = getComputedStyle(fast)
  ctx.font = `${fs.fontWeight} ${fs.fontSize} ${fs.fontFamily}`
  ctx.letterSpacing = fs.letterSpacing === 'normal' ? '0px' : fs.letterSpacing
  const word = fast.textContent ?? ''
  const origin = ctx.measureText(word.slice(0, -1)).width
  const dot = ctx.measureText(word.slice(-1))
  const box: Box = { x: block.offsetLeft, y: block.offsetTop, w: block.offsetWidth, h: block.offsetHeight }
  return {
    w,
    h,
    spine: probe.offsetLeft || null,
    left: block.offsetLeft,
    right: w - px('--r'),
    top: px('--top'),
    pieces: [a, b, c],
    stop: {
      mid: origin + (dot.actualBoundingBoxRight - dot.actualBoundingBoxLeft) / 2,
      top: dot.actualBoundingBoxAscent,
      half: (dot.actualBoundingBoxRight + dot.actualBoundingBoxLeft) / 2,
    },
    block: box,
    label: labelWidth,
  }
}

/** Where a piece stands: its left edge, and its top so its baseline falls where the plate says. */
const at = (plate: Plate | null, i: number, base: number[]): CSSProperties | undefined => {
  const one = plate?.set[i]
  if (!one) return undefined
  return { left: Math.round(one.x), top: Math.round(one.base - (base[i] ?? 0)) }
}

/** The first screen as a descent. */
export function ChartHero({ nav }: { nav?: ReactNode }) {
  const root = useRef<HTMLDivElement>(null)
  const probe = useRef<HTMLElement>(null)
  const block = useRef<HTMLDivElement>(null)
  const one = useRef<HTMLSpanElement>(null)
  const two = useRef<HTMLSpanElement>(null)
  const three = useRef<HTMLSpanElement>(null)
  const [plate, setPlate] = useState<Plate | null>(null)
  // Each piece's baseline from its own top, as set.
  const [base, setBase] = useState<number[]>([0, 0, 0])
  const id = useId().replace(/:/g, '')

  // Laid once the type is in, so it is never laid to a stand-in face; again whenever the sheet changes size.
  useLayoutEffect(() => {
    const el = root.current
    const at = probe.current
    const foot = block.current
    const pieces = [one.current, two.current, three.current]
    if (!el || !at || !foot || pieces.some((p) => !p)) return
    let frame = 0
    let last = ''
    let live = true
    const draw = () => {
      frame = 0
      const m = measure(el, pieces as HTMLElement[], foot, at)
      if (!m) return
      const key = JSON.stringify([m.w, m.h, m.pieces, m.block])
      if (key === last) return
      last = key
      setBase((pieces as HTMLElement[]).map((p) => (p.firstElementChild as HTMLElement | null)?.offsetTop ?? 0))
      setPlate(lay(m))
    }
    const later = () => {
      if (!frame && live) frame = requestAnimationFrame(draw)
    }
    if (document.fonts.status === 'loaded') draw()
    void document.fonts.ready.then(later)
    const ro = new ResizeObserver(later)
    ro.observe(el)
    ro.observe(foot)
    return () => {
      live = false
      cancelAnimationFrame(frame)
      ro.disconnect()
    }
  }, [])

  const p = plate
  const ticks = p && p.spine !== null ? scale(p.air, p.h) : null
  return (
    <div ref={root} className={s.hero} data-laid={p ? '' : undefined}>
      <i ref={probe} className={s.probe} aria-hidden="true" />
      {p && (
        <svg className={s.plate} width={p.w} height={p.h} viewBox={`0 0 ${p.w} ${p.h}`} aria-hidden="true" focusable="false">
          <defs>
            {/* The air's arcs break where the type stands, as a drawing's lines break for its lettering. */}
            <mask id={`${id}-air`} maskUnits="userSpaceOnUse" x="0" y="0" width={p.w} height={p.h}>
              <rect width={p.w} height={p.h} fill="#fff" />
              {p.holes.map((o, i) => (
                <rect key={i} x={o.x} y={o.y} width={o.w} height={o.h} fill="#000" />
              ))}
            </mask>
          </defs>
          <g className={s.arcs} mask={`url(#${id}-air)`}>
            {p.arcs.map((one) => (
              <path key={one.km} d={one.d} />
            ))}
          </g>
          {p.labels.map((label) => (
            <text key={label.lines[0]} className={s.note} x={label.x} y={label.y} textAnchor="end">
              {label.lines.map((line, i) => (
                <tspan key={line} x={label.x} dy={i ? 13 : -(label.lines.length - 1) * 13}>
                  {line}
                </tspan>
              ))}
            </text>
          ))}
          {/* The altitude scale: its line down the whole sheet, its ticks and its figures. */}
          {ticks && p.spine !== null && (
            <g>
              <path className={s.spine} d={`M${p.spine + 0.5} 0V${p.h}`} shapeRendering="crispEdges" />
              <g className={s.ticks} shapeRendering="crispEdges">
                {ticks.ticks.map((d, i) => (
                  <path key={i} d={d} data-kind={i} />
                ))}
              </g>
              {ticks.figures.map(({ km, y }) => (
                <text key={km} className={s.km} x={p.spine! - 12} y={y + 3.5} textAnchor="end">
                  {km}
                </text>
              ))}
            </g>
          )}
          {/* The path, and the leaders the pieces hang from. */}
          <path className={s.flown} d={p.flown} />
          <path className={s.leader} d={p.leaders} shapeRendering="crispEdges" />
          {p.stations.map(({ km, at: [x, y] }) => (
            <circle key={km} className={s.station} cx={x.toFixed(1)} cy={y.toFixed(1)} r="3.5" />
          ))}
          {/* The capsule's reading, beside the full stop it rests in. */}
          <text className={s.reading} x={p.reading.x} y={p.reading.y} textAnchor={p.reading.anchor}>
            <tspan x={p.reading.x} dy="-15">
              {REST_KM.toFixed(2)} KM
            </tspan>
            <tspan x={p.reading.x} dy="15">
              {REST_SPEED.toFixed(3)} KM/S
            </tspan>
          </text>
        </svg>
      )}
      <h1 className={s.h1}>
        <span ref={one} className={s.one} style={at(p, 0, base)}>
          <i className={s.base} />
          {PIECES[0]}
        </span>{' '}
        <span ref={two} className={s.two} style={at(p, 1, base)}>
          <i className={s.base} />
          {PIECES[1]}
        </span>{' '}
        <span ref={three} className={s.three} style={at(p, 2, base)}>
          <i className={s.base} />
          {PIECES[2]}
        </span>
      </h1>
      {/* The title block: the lead, the download, the install and the agents, in ruled cells. */}
      <div ref={block} className={s.block}>
        <p className={s.lead}>{HERO.lead}</p>
        <div className={s.ways}>
          <Get tone="paper" />
          <OtherMac tone="paper" />
        </div>
        <div className={s.row}>
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
        <div className={s.row}>
          <span className={s.label}>{HERO.agents}</span>
          <Agents />
        </div>
      </div>
      {nav}
    </div>
  )
}
