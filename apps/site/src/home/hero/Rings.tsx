import { useEffect, useRef } from 'react'

import { Agent, AGENTS } from '../../content/agents'
import { HERO } from '../../content/home'
import { useMedia } from '../../lib/browser'
import { isZoomed } from '../../lib/zoom'
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
const TICK_ORBITS = [3, 5] as const

/** Degrees an orbit has turned after `t` ms of the clock. */
const turned = (orbit: number, t: number) => t * 0.006 * Math.pow(ORBITS[orbit]![0] / 150, -1.5)
const place = (orbit: number, deg: number) => {
  const [rx, ry] = ORBITS[orbit]!
  const a = (deg * Math.PI) / 180
  return { x: CX + rx * Math.cos(a), y: CY + ry * Math.sin(a), a }
}
/** An orbit's ticks, turned by `turn` degrees, as one path: each a short stroke down from its place. One attribute a frame for an orbit's 120 ticks, not 480. */
const ticksOf = (orbit: number, turn: number) => {
  let d = ''
  for (let i = 0; i < 120; i++) {
    const p = place(orbit, i * 3 - turn)
    d += `M${p.x.toFixed(1)} ${p.y.toFixed(1)}v${i % 10 === 0 ? 5 : 2.5}`
  }
  return d
}

/** How far a name sits from its disc's middle, and a note's from its dot. */
const GAP = 23
const NOTE_GAP = 11
/** Where the project's notes sit on the inner orbit, in degrees. */
const NOTE_AT = [90, 150, 210, 270, 330]

/**
 * `notes`: the project's own, riding the inner orbit as cobalt dots with
 * their names, for the race's last beat (story/Race.tsx).
 */
export function Rings({ className, notes }: { className?: string; notes?: readonly string[] }) {
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
      disc: g.querySelector<SVGGElement>('[data-disc]'),
      name: g.querySelector<SVGTextElement>('text')!,
      gap: Number(g.dataset.gap),
      w: -1,
    }))
    const ticks = [...root.querySelectorAll<SVGPathElement>('[data-ticks]')].map((path) => ({ path, orbit: Number(path.dataset.ticks) }))
    let t = 0
    // Each attribute is written only as it changes: an unchanged one, written every frame, still has it styled again.
    const written = new WeakMap<Element, Record<string, string>>()
    const set = (el: Element | null, name: string, value: string) => {
      if (!el) return
      let was = written.get(el)
      if (!was) written.set(el, (was = {}))
      if (was[name] === value) return
      was[name] = value
      el.setAttribute(name, value)
    }
    const draw = () => {
      for (const k of ticks) set(k.path, 'd', ticksOf(k.orbit, turned(k.orbit, t)))
      for (const r of riders) {
        const p = place(r.orbit, r.at - turned(r.orbit, t))
        const depth = (Math.sin(p.a) + 1) / 2
        set(r.g, 'transform', `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`)
        set(r.g, 'opacity', (0.62 + depth * 0.38).toFixed(2))
        set(r.disc, 'transform', `scale(${(0.82 + depth * 0.18).toFixed(3)})`)
        if (r.w < 0) r.w = r.name.getComputedTextLength()
        // The name on the side away from the middle; as it changes side it fades out and in.
        const c = Math.cos(p.a)
        let f = Math.min(1, Math.abs(c) / 0.22)
        f = f * f * (3 - 2 * f)
        set(r.name, 'x', c >= 0 ? String(r.gap) : (-r.gap - r.w).toFixed(1))
        set(r.name, 'opacity', f.toFixed(2))
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
    // Off screen nothing runs, not even the clock: nothing is read or drawn there, and the orbits carry on where they were.
    let seen = false
    const io = new IntersectionObserver(([e]) => {
      const was = seen
      seen = !!e?.isIntersecting
      if (seen && !was) {
        last = performance.now()
        lastY = window.scrollY
        frame = requestAnimationFrame(tick)
      } else if (!seen) cancelAnimationFrame(frame)
    })
    io.observe(root)
    const tick = (now: number) => {
      const dt = Math.min(64, now - last)
      last = now
      // Pinch-zoomed in, it holds still, drawing nothing, and goes on where it was (lib/zoom.ts).
      if (isZoomed()) {
        lastY = window.scrollY
        frame = requestAnimationFrame(tick)
        return
      }
      // Scrolling quickens the orbits, by how fast you scroll, and lets go slowly.
      const y = window.scrollY
      boost = Math.min(14, boost * 0.93 + (Math.abs(y - lastY) / Math.max(1, dt)) * 1.6)
      lastY = y
      t += dt * (1 + boost)
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
      frame = requestAnimationFrame(tick)
    }
    return () => {
      io.disconnect()
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
            {/* The eye: in the race's orrery, the board's pointer dot is taken from it (story/waterfall.ts). */}
            <circle cx={CX + MARK_EYE.x} cy={CY + MARK_EYE.y} r={MARK_EYE.r} data-eye="" />
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
          {TICK_ORBITS.map((orbit) => (
            <path key={orbit} data-ticks={orbit} d={ticksOf(orbit, 0)} />
          ))}
        </g>
        {RIDERS.map((r) => {
          const p = place(r.orbit, r.at)
          return (
            <g key={r.agent} data-rider="" data-orbit={r.orbit} data-at={r.at} data-gap={GAP} transform={`translate(${p.x} ${p.y})`}>
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
        {notes?.map((note, i) => {
          const at = NOTE_AT[i % NOTE_AT.length]!
          const p = place(0, at)
          return (
            <g key={note} data-rider="" data-orbit={0} data-at={at} data-gap={NOTE_GAP} transform={`translate(${p.x} ${p.y})`}>
              <text className={s.note} x={NOTE_GAP} y="3.8">
                {note}
              </text>
              <circle r="3.5" className={s.noteDot} />
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
