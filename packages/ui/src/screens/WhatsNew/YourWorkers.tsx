import { type CSSProperties, type RefObject, useEffect, useId, useRef, useState } from 'react'

import { cx } from '../../lib/cx'
import { useReducedMotion } from '../../lib/motion'
import { useOnScreen } from '../../lib/onScreen'
import type { RootProps } from '../../lib/props'
import w from './YourWorkers.module.css'

/*
 * 0.10.0's lead, drawn as an orrery in two acts: one worker, then a fleet.
 *
 * Close up, this computer hands a task to runner-1, a Linux worker of yours:
 * the task flies out along the wire, runner-1 runs its agent, the setup and
 * the tests, and two commits fly back, the task finished. Then the view pulls
 * back: runner-1 is one machine on the first ring round this computer, two
 * more rings draw in, and workers join them one by one, each wired back and
 * at work, until this computer counts dozens of agents working at once.
 *
 * The whole story is one number, its time `t` (0 to 1), written to the
 * drawing as `--t`; everything in it is worked out from that in the CSS, so a
 * frame changes one property and React draws nothing. Given `at` (0 to 1),
 * the drawing is wherever the host puts it, as the home page's scroll does;
 * without, it plays its own loop while on screen. With motion reduced it
 * rests on the fleet.
 */

/** The drawing's own units: what it shows (this computer at its middle), and where this computer stands. */
const VIEW = { x: 0, y: 34, w: 1000, h: 500 } as const
const HOME = { x: 500, y: 284 } as const

/** How far through the story the fleet is whole: where a host's story ends. On its own loop it holds there, then clears from 0.95 (YourWorkers.module.css). */
const WHOLE = 0.86
/** Where it rests with motion reduced, or before it has been seen. */
const REST = 0.88
/** How long the loop takes, in ms. */
const LOOP = 17_000

/** The rings of workers round this computer: their size, how many, where the first stands, and when they join. */
const RINGS = [
  { rx: 194, ry: 96, n: 8, turn: 0, from: 0.5, to: 0.6 },
  { rx: 318, ry: 150, n: 14, turn: 0.035, from: 0.55, to: 0.7 },
  { rx: 444, ry: 206, n: 22, turn: 0.012, from: 0.6, to: 0.8 },
] as const

/** What some of the workers are doing, by ring and place: a label beside them. */
const DOING: Readonly<Record<string, string>> = {
  '1-2': 'Payout export',
  '1-5': 'Webhook retries',
  '1-9': 'Search index',
  '1-12': 'Invoice PDFs',
  '2-3': 'Dark mode',
  '2-8': 'Rate limits',
  '2-14': 'CSV import',
  '2-19': 'Audit log',
}

interface Node {
  readonly key: string
  readonly x: number
  readonly y: number
  /** When it joins, and when it is whole. */
  readonly a: number
  readonly b: number
  readonly doing?: string
  /** Its packets' own pace, so no two run together. */
  readonly delay: number
}

/** Every worker, runner-1 first: on its ring, joining in an order that skips round the ring, so the ring fills all over. */
const NODES: readonly Node[] = RINGS.flatMap((ring, r) =>
  Array.from({ length: ring.n }, (_, k) => {
    const angle = 2 * Math.PI * (ring.turn + k / ring.n)
    const order = r === 0 ? (k === 0 ? -1 : k) : (k * 5) % ring.n
    const a = order < 0 ? 0 : ring.from + (order / ring.n) * (ring.to - ring.from)
    const doing = DOING[`${r}-${k}`]
    return {
      key: `${r}-${k}`,
      x: Math.round(HOME.x + ring.rx * Math.cos(angle)),
      y: Math.round(HOME.y + ring.ry * Math.sin(angle)),
      a,
      b: a + 0.035,
      ...(doing === undefined ? {} : { doing }),
      delay: -((r * 7 + k * 3) % 11) * 0.24,
    }
  }),
)
const ONE = NODES[0]!
/** The laptop's edge, where its wires leave it. */
const EDGE = HOME.x + 66
/** The task's pill, out from this computer's edge to runner-1; its commits', back. */
const OUT = { width: 54, from: EDGE + 2, to: ONE.x - 9 - 54 } as const
const BACK = { width: 40, from: ONE.x - 9 - 40, to: EDGE + 2 } as const

/** How many workers are at work at `t`: runner-1 once its task reaches it, then each as it joins. */
const atWork = (t: number) => (t < 0.14 ? 0 : NODES.filter((node) => node.a <= t).length)

/** What runner-1 runs for the task: commands typed, what comes back not, and when each comes. */
const RUN = [
  { at: 0.16, line: 'Claude Code · Partial refunds', typed: false },
  { at: 0.19, line: 'bun install', typed: true },
  { at: 0.215, line: 'Setup done in 4.2 s', typed: false },
  { at: 0.24, line: 'bun test src/refunds', typed: true },
  { at: 0.27, line: '✓ 23 passed', typed: false },
  { at: 0.31, line: '2 commits back to This Mac', typed: false },
] as const

/** A part shown from `a` to `b` (fading in), and gone from `c` to `d` (fading out); without `c`, it stays. */
const win = (a: number, b: number, c = 2, d = 3) => ({ '--a': a, '--b': b, '--c': c, '--d': d }) as CSSProperties
/** A part that travels `dx` along the wire from `a` to `b`. */
const goes = (dx: number, a: number, b: number) => ({ '--dx': `${dx}px`, '--ma': a, '--mb': b }) as CSSProperties

/**
 * The story's time, where the host says, or played on its own loop while on
 * screen: the loop writes `--t` on the drawing itself each frame, and only the
 * count of agents at work goes through React, as it changes.
 */
function useStory(ref: RefObject<SVGSVGElement | null>, at: number | undefined) {
  const onScreen = useOnScreen(ref)
  const still = useReducedMotion()
  const [looped, setLooped] = useState(atWork(REST))
  const looping = at === undefined && onScreen && !still
  const t = at === undefined ? REST : at * WHOLE

  useEffect(() => {
    const el = ref.current
    if (!looping || !el) return
    // Wake where it was: from the start, unless it was already part way round.
    const was = Number(el.style.getPropertyValue('--t') || 0)
    const since = performance.now() - (was >= REST ? 0 : was * LOOP)
    let frame = requestAnimationFrame(function tick(now) {
      const t = ((now - since) % LOOP) / LOOP
      el.style.setProperty('--t', t.toFixed(4))
      const n = atWork(t)
      setLooped((was) => (was === n ? was : n))
      frame = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(frame)
  }, [looping, ref])

  return {
    t,
    count: at !== undefined ? atWork(t) : still ? atWork(REST) : looped,
    playing: (at !== undefined || looping) && onScreen && !still,
  }
}

/** A worker on its ring: a small machine, its light at work, and what it's doing where that's said. */
function Worker({ node }: { node: Node }) {
  const right = node.x >= HOME.x
  return (
    <g className={w.node} style={win(node.a, node.b)}>
      <g className={w.machine}>
        <rect x={node.x - 6.5} y={node.y - 6.5} width={13} height={13} rx={3.5} className={w.box} />
        <circle cx={node.x} cy={node.y} r={2.3} className={w.light} />
        <circle cx={node.x} cy={node.y} r={2.3} className={w.ping} style={{ animationDelay: `${node.delay}s` }} />
      </g>
      {node.doing === undefined ? null : (
        <text x={node.x + (right ? 13 : -13)} y={node.y + 3.4} textAnchor={right ? 'start' : 'end'} className={w.doing}>
          {node.doing.toUpperCase()}
        </text>
      )}
    </g>
  )
}

export interface YourWorkersText {
  /** What the picture shows, for whoever can't see it. */
  label: string
}

export const yourWorkersText: YourWorkersText = {
  label:
    'This Mac hands a task to runner-1, a Linux worker of yours, which runs the task’s agent, its setup and its tests, and sends two commits back. Then the view pulls back: dozens of workers on rings round This Mac, each wired to it and at work on a task of its own.',
}

export type YourWorkersProps = RootProps<
  'figure',
  {
    text?: Partial<YourWorkersText>
    /** Where the story is, 0 to 1, as the host plays it (the home page's scroll); without, it plays its own loop while on screen. */
    at?: number
  }
>

/** 0.10.0's flagship drawn: this computer and one worker of yours, then a fleet of them, the work going between them. */
export function YourWorkers({ text, at, className, ...rest }: YourWorkersProps) {
  const t = { ...yourWorkersText, ...text }
  const ref = useRef<SVGSVGElement>(null)
  const glow = `yw-glow-${useId().replace(/[^\w-]/g, '')}`
  const { t: story, count, playing } = useStory(ref, at)
  return (
    <figure className={cx(w.figure, className)} aria-label={t.label} {...rest}>
      <svg
        ref={ref}
        className={w.scene}
        viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}`}
        style={{ '--t': story } as CSSProperties}
        data-playing={playing || undefined}
        data-looping={at === undefined || undefined}
        aria-hidden="true"
      >
        <defs>
          <radialGradient id={glow}>
            <stop offset="0" style={{ stopColor: 'var(--yw-live)', stopOpacity: 0.16 }} />
            <stop offset="0.45" style={{ stopColor: 'var(--yw-live)', stopOpacity: 0.06 }} />
            <stop offset="1" style={{ stopColor: 'var(--yw-live)', stopOpacity: 0 }} />
          </radialGradient>
        </defs>
        <g className={w.world}>
          {/* The light of the work, under this computer, growing as the fleet does. */}
          <ellipse cx={HOME.x} cy={HOME.y} rx={470} ry={230} fill={`url(#${glow})`} className={w.glow} />
          {/* The rings, drawing in as the view pulls back, with their ticks as the first screen's orrery has them. */}
          {RINGS.map((ring, r) => (
            <ellipse
              key={`ticks-${r}`}
              cx={HOME.x}
              cy={HOME.y}
              rx={ring.rx}
              ry={ring.ry}
              className={cx(w.ticks, w.fade)}
              style={win(ring.from + 0.02, ring.from + 0.08)}
            />
          ))}
          {RINGS.map((ring, r) => (
            <ellipse
              key={r}
              cx={HOME.x}
              cy={HOME.y}
              rx={ring.rx}
              ry={ring.ry}
              pathLength={1}
              className={w.orbit}
              style={win(ring.from - 0.08 + r * 0.02, ring.from + 0.02 + r * 0.02)}
            />
          ))}

          {/* A wire from this computer to each worker, lit as it joins, the work running along it. */}
          {NODES.map((node, i) => (
            <g key={node.key} className={w.spoke} style={win(node.key === ONE.key ? 0.04 : node.a, node.key === ONE.key ? 0.08 : node.b)}>
              <line x1={HOME.x} y1={HOME.y} x2={node.x} y2={node.y} className={w.wire} />
              <line
                x1={HOME.x}
                y1={HOME.y}
                x2={node.x}
                y2={node.y}
                pathLength={100}
                className={w.packet}
                data-back={i % 3 === 1 || undefined}
                style={{ animationDelay: `${node.delay}s` }}
              />
            </g>
          ))}

          {NODES.map((node) => (
            <Worker key={node.key} node={node} />
          ))}

          {/* The task, out along runner-1's wire; then its commits, back. */}
          <g className={w.travel} style={goes(OUT.to - OUT.from, 0.05, 0.13)}>
            <g className={w.fade} style={win(0.035, 0.05, 0.12, 0.14)}>
              <rect x={OUT.from} y={HOME.y - 5.5} width={OUT.width} height={11} rx={5.5} className={w.pill} />
              <text x={OUT.from + OUT.width / 2} y={HOME.y + 1.6} textAnchor="middle" className={w.pillText}>
                PARTIAL REFUNDS
              </text>
            </g>
          </g>
          <g className={w.travel} style={goes(BACK.to - BACK.from, 0.31, 0.37)}>
            <g className={w.fade} style={win(0.3, 0.315, 0.36, 0.38)}>
              <rect x={BACK.from} y={HOME.y - 5.5} width={BACK.width} height={11} rx={5.5} className={w.pill} />
              <text x={BACK.from + BACK.width / 2} y={HOME.y + 1.6} textAnchor="middle" className={w.pillText}>
                2 COMMITS
              </text>
            </g>
          </g>

          {/* runner-1, close up: its terminal beside it, folding into it as the view pulls back. */}
          <g className={w.card} style={{ ...win(-2, -1, 0.4, 0.47), transformOrigin: `${ONE.x}px ${HOME.y}px` }}>
            <rect x={ONE.x + 12} y={HOME.y - 50} width={140} height={104} rx={7} className={w.term} />
            <text x={ONE.x + 22} y={HOME.y - 35} className={w.prompt}>
              {'>_'}
            </text>
            <text x={ONE.x + 34} y={HOME.y - 35} className={w.name}>
              runner-1
            </text>
            <text x={ONE.x + 143} y={HOME.y - 35} textAnchor="end" className={cx(w.state, w.fade)} style={win(-2, -1, 0.13, 0.15)}>
              Free
            </text>
            <g className={w.fade} style={win(0.14, 0.16, 0.3, 0.315)}>
              <circle cx={ONE.x + 113} cy={HOME.y - 37} r={2} className={w.termLight} />
              <text x={ONE.x + 143} y={HOME.y - 35} textAnchor="end" className={w.state}>
                Running
              </text>
            </g>
            <text x={ONE.x + 143} y={HOME.y - 35} textAnchor="end" className={cx(w.state, w.fade)} style={win(0.315, 0.33)}>
              ✓ Sent back
            </text>
            <line x1={ONE.x + 22} y1={HOME.y - 27} x2={ONE.x + 142} y2={HOME.y - 27} className={w.rule} />
            {RUN.map((one, i) => (
              <text
                key={one.line}
                x={ONE.x + 22}
                y={HOME.y - 15 + i * 10}
                className={cx(w.log, w.fade)}
                data-typed={one.typed || undefined}
                style={win(one.at, one.at + 0.012)}
              >
                {one.typed ? <tspan className={w.dollar}>$ </tspan> : null}
                {one.line}
              </text>
            ))}
          </g>

          {/* This computer, at the middle: the task open on it, then how many agents are at work. */}
          <g className={w.mac}>
            <rect x={HOME.x - 65} y={HOME.y - 48} width={130} height={82} rx={7} className={w.lid} />
            <rect x={HOME.x - 60} y={HOME.y - 43} width={120} height={72} rx={3.5} className={w.screen} />
            <rect x={HOME.x - 78} y={HOME.y + 34} width={156} height={6} rx={3} className={w.base} />
            <g className={w.fade} style={win(-2, -1, 0.42, 0.48)}>
              {[0, 1, 2].map((i) => (
                <circle key={i} cx={HOME.x - 53 + i * 5} cy={HOME.y - 35} r={1.6} className={w.dot} />
              ))}
              <rect x={HOME.x + 26} y={HOME.y - 39.5} width={28} height={8} rx={2.5} className={w.chip} />
              <text x={HOME.x + 40} y={HOME.y - 33.8} textAnchor="middle" className={w.chipText}>
                This Mac
              </text>
              <text x={HOME.x - 53} y={HOME.y - 19} className={w.task}>
                Partial refunds
              </text>
              <text x={HOME.x - 53} y={HOME.y - 11} className={w.branch}>
                althar/partial-refunds
              </text>
              <rect x={HOME.x - 22} y={HOME.y - 5} width={76} height={11} rx={4} className={w.said} />
              <text x={HOME.x - 18} y={HOME.y + 2.3} className={w.saidText}>
                Refund part of a payment.
              </text>
              <text x={HOME.x - 53} y={HOME.y + 20} className={cx(w.status, w.fade)} style={win(-2, -1, 0.13, 0.15)}>
                Starting on runner-1
              </text>
              <g className={w.fade} style={win(0.14, 0.16, 0.36, 0.375)}>
                <circle cx={HOME.x - 51} cy={HOME.y + 18} r={1.9} className={w.live} />
                <text x={HOME.x - 46} y={HOME.y + 20} className={w.status}>
                  On runner-1
                </text>
              </g>
              <text x={HOME.x - 53} y={HOME.y + 20} className={cx(w.status, w.fade)} style={win(0.375, 0.39)}>
                <tspan className={w.ok}>✓ Finished</tspan> <tspan className={w.ok}>+31</tspan> <tspan className={w.del}>−3</tspan>
              </text>
            </g>
            <g className={w.fade} style={win(0.47, 0.53)}>
              <text x={HOME.x} y={HOME.y + 4} textAnchor="middle" className={w.count}>
                {count}
              </text>
              <text x={HOME.x} y={HOME.y + 18} textAnchor="middle" className={w.countLabel}>
                AGENTS AT WORK
              </text>
            </g>
          </g>
          {/* Under it, its name, on a patch of the ground so the wires pass behind. */}
          <g className={w.fade} style={win(0.46, 0.54)}>
            <rect x={HOME.x - 30} y={HOME.y + 52} width={60} height={14} rx={4} className={w.plate} />
            <text x={HOME.x} y={HOME.y + 62} textAnchor="middle" className={w.here}>
              THIS MAC
            </text>
          </g>
        </g>
      </svg>
    </figure>
  )
}
