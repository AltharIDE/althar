import { useEffect, useRef } from 'react'

import { Agent, AGENTS } from '../../content/agents'
import { HERO } from '../../content/home'
import { useMedia } from '../../lib/browser'
import { AgentMark } from '../../shared/AgentMark'
import { MARK_DOTS, MARK_EYE } from './markDots'
import s from './Rings.module.css'

/*
 * The first screen's drawing, flat, as the pitch deck draws it: Althar's mark
 * as a halftone at the middle, six orbits round it, and the agents riding
 * them, each a disc with its mark and its name. The inner orbits run faster
 * than the outer ones, as planets do (Kepler: a period growing as the orbit's
 * radius to the 3/2), and scrolling quickens them all for a moment. What is
 * behind the middle is smaller and fainter; a name changes side as its agent
 * passes the near or far point, fading out and in rather than sliding. The
 * mark leans towards the pointer and bobs, slowly, all the time. With reduced
 * motion it is held, as drawn.
 */

/** The orrery's own px: its box, its middle, and each orbit's radii. */
const W = 1400
const H = 760
const CX = 700
const CY = 390
const ORBITS: ReadonlyArray<readonly [number, number]> = [
  [150, 58],
  [228, 88],
  [318, 123],
  [420, 162],
  [540, 208],
  [680, 262],
]

/** Who rides where: an agent, its orbit, and where on it it starts, in degrees. */
const RIDERS: ReadonlyArray<{ agent: Agent; orbit: number; at: number }> = [
  { agent: Agent.Claude, orbit: 0, at: 30 },
  { agent: Agent.OpenCode, orbit: 1, at: -40 },
  { agent: Agent.Codex, orbit: 1, at: 150 },
  { agent: Agent.Copilot, orbit: 2, at: 100 },
  { agent: Agent.Junie, orbit: 2, at: 250 },
  { agent: Agent.Mistral, orbit: 3, at: -70 },
  { agent: Agent.Grok, orbit: 3, at: 15 },
  { agent: Agent.Kimi, orbit: 4, at: -20 },
  { agent: Agent.Qwen, orbit: 4, at: 60 },
  { agent: Agent.Antigravity, orbit: 5, at: 35 },
]
const nameOf = (agent: Agent) => AGENTS.find((a) => a.id === agent)?.name ?? agent

/** The ticks on the third and fifth orbits: one every 3°, longer every 30°. */
const TICKS = [3, 5].flatMap((orbit) => Array.from({ length: 120 }, (_, i) => ({ orbit, at: i * 3, long: i % 10 === 0 })))

/** Degrees an orbit has turned after `t` ms of the clock. */
const turned = (orbit: number, t: number) => t * 0.006 * Math.pow(ORBITS[orbit]![0] / 150, -1.5)
const place = (orbit: number, deg: number) => {
  const [rx, ry] = ORBITS[orbit]!
  const a = (deg * Math.PI) / 180
  return { x: CX + rx * Math.cos(a), y: CY + ry * Math.sin(a), a }
}

/** How far a name sits from its disc's middle. */
const GAP = 23

export function Rings({ className }: { className?: string }) {
  const svg = useRef<SVGSVGElement>(null)
  const mark = useRef<HTMLDivElement>(null)
  const still = useMedia('(prefers-reduced-motion: reduce)')

  useEffect(() => {
    const root = svg.current
    const lean = mark.current
    if (!root || !lean) return
    const riders = [...root.querySelectorAll<SVGGElement>('[data-rider]')].map((g) => ({
      g,
      orbit: Number(g.dataset.orbit),
      at: Number(g.dataset.at),
      disc: g.querySelector<SVGGElement>('[data-disc]')!,
      name: g.querySelector<SVGTextElement>('text')!,
      w: -1,
    }))
    const ticks = [...root.querySelectorAll<SVGLineElement>('[data-tick]')].map((line) => ({
      line,
      orbit: Number(line.dataset.orbit),
      at: Number(line.dataset.at),
      len: Number(line.dataset.len),
    }))
    let t = 0
    const draw = () => {
      for (const k of ticks) {
        const p = place(k.orbit, k.at - turned(k.orbit, t))
        k.line.setAttribute('x1', p.x.toFixed(1))
        k.line.setAttribute('x2', p.x.toFixed(1))
        k.line.setAttribute('y1', p.y.toFixed(1))
        k.line.setAttribute('y2', (p.y + k.len).toFixed(1))
      }
      for (const r of riders) {
        const p = place(r.orbit, r.at - turned(r.orbit, t))
        const depth = (Math.sin(p.a) + 1) / 2
        r.g.setAttribute('transform', `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`)
        r.g.setAttribute('opacity', (0.62 + depth * 0.38).toFixed(2))
        r.disc.setAttribute('transform', `scale(${(0.82 + depth * 0.18).toFixed(3)})`)
        if (r.w < 0) r.w = r.name.getComputedTextLength()
        // The name on the side away from the middle; as it changes side it fades out and in.
        const c = Math.cos(p.a)
        let f = Math.min(1, Math.abs(c) / 0.22)
        f = f * f * (3 - 2 * f)
        r.name.setAttribute('x', c >= 0 ? String(GAP) : (-GAP - r.w).toFixed(1))
        r.name.setAttribute('opacity', f.toFixed(2))
      }
    }
    draw()
    if (still) {
      lean.style.transform = ''
      return
    }

    // The pointer, as a lean of the mark: towards it while it moves, a slow sway when it rests.
    let px = 0
    let py = 0
    let moved = -1e9
    const onPointer = (e: PointerEvent) => {
      px = (e.clientX / window.innerWidth) * 2 - 1
      py = (e.clientY / window.innerHeight) * 2 - 1
      moved = performance.now()
    }
    window.addEventListener('pointermove', onPointer, { passive: true })

    let rx = 0
    let ry = 0
    let boost = 0
    let lastY = window.scrollY
    let last = performance.now()
    let frame = 0
    const tick = (now: number) => {
      const dt = Math.min(64, now - last)
      last = now
      // Scrolling quickens the orbits, by how fast you scroll, and lets go slowly.
      const y = window.scrollY
      boost = Math.min(14, boost * 0.93 + (Math.abs(y - lastY) / Math.max(1, dt)) * 1.6)
      lastY = y
      t += dt * (1 + boost)
      // Off screen, only the clock runs.
      if (y < window.innerHeight * 1.2) {
        draw()
        let tx = px
        let ty = py
        if (now - moved > 2500) {
          const k = now / 1000
          tx = Math.sin(k * 0.55) * 0.55
          ty = Math.sin(k * 0.37 + 1.2) * 0.4
        }
        ry += (tx * 22 - ry) * 0.06
        rx += (-ty * 16 - rx) * 0.06
        const bob = Math.sin(((now / 1000) * Math.PI * 2) / 3.6) * 7
        lean.style.transform = `perspective(900px) translateY(${bob.toFixed(2)}px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg)`
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', onPointer)
    }
  }, [still])

  const dots = []
  for (let i = 0; i < MARK_DOTS.length; i += 3)
    dots.push(<circle key={i} cx={CX + MARK_DOTS[i]!} cy={CY + MARK_DOTS[i + 1]!} r={MARK_DOTS[i + 2]!} />)

  return (
    <div className={className}>
      {/* The mark, behind the orbits: it leans on its own layer. */}
      <div ref={mark} className={s.mark} aria-hidden="true">
        <svg className={s.layer} viewBox={`0 0 ${W} ${H}`}>
          <g fill="var(--cobalt)">
            {dots}
            <circle cx={CX + MARK_EYE.x} cy={CY + MARK_EYE.y} r={MARK_EYE.r} />
          </g>
        </svg>
      </div>
      <svg ref={svg} className={s.layer} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
        <g className={s.orbits}>
          {ORBITS.map(([orx, ory]) => (
            <ellipse key={orx} cx={CX} cy={CY} rx={orx} ry={ory} />
          ))}
        </g>
        <g className={s.ticks}>
          {TICKS.map((k) => {
            const p = place(k.orbit, k.at)
            const len = k.long ? 5 : 2.5
            return (
              <line
                key={`${k.orbit}-${k.at}`}
                data-tick=""
                data-orbit={k.orbit}
                data-at={k.at}
                data-len={len}
                x1={p.x}
                x2={p.x}
                y1={p.y}
                y2={p.y + len}
              />
            )
          })}
        </g>
        {RIDERS.map((r) => {
          const p = place(r.orbit, r.at)
          return (
            <g key={r.agent} data-rider="" data-orbit={r.orbit} data-at={r.at} transform={`translate(${p.x} ${p.y})`}>
              <text className={s.name} x={GAP} y="3.8">
                {nameOf(r.agent)}
              </text>
              <g data-disc="" data-planet="">
                <circle r="20.5" className={s.halo} />
                <circle r="17.5" className={s.disc} />
                <g transform="translate(-8.5 -8.5)" className={s.agent}>
                  <AgentMark agent={r.agent} size={17} />
                </g>
              </g>
            </g>
          )
        })}
      </svg>
      <ul className={s.agents} aria-label={HERO.agentsName}>
        {AGENTS.map((a) => (
          <li key={a.id}>{a.name}</li>
        ))}
      </ul>
    </div>
  )
}
