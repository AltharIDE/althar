import { Fragment, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'

import { useControlled } from '../../lib/controlled'
import { cx } from '../../lib/cx'
import { Button } from '../../primitives/Button/Button'
import { VisuallyHidden } from '../../primitives/VisuallyHidden/VisuallyHidden'
import { Opening } from './Opening'
import { frames, glide, transform, type Cam, type Focus, type Pt } from './camera'
import { SCENES } from './scenes'
import { Station } from './Station'
import s from './Welcome.module.css'

/*
 * The first thing Charrette shows after it is installed, once.
 *
 * A charrette is the architects' push to finish a design, so the welcome is
 * a drafting table seen through a camera. It opens close on the mark as it
 * is drawn, and the camera pulls back. The opening is drawn on the same
 * table as the rest: Begin moves the camera off it, low across the paper, to
 * the first of five plots, and from each straight on to the next, the pencil
 * route drawn beside it as it goes. At each plot the real components are
 * sketched in pencil from their own layout, uncovered, and set working: a
 * task visits a project, a lead takes a task, work moves across the board
 * while one card waits on you, checks pass and a change is accepted, agents
 * sign in. A pointer shows what a person would do. At the end the camera
 * pulls back over the whole table, built.
 *
 * Enter, the arrows or Continue move on; Back goes back; Skip leaves.
 * Nothing loops: each scene plays once and holds its last frame, and only
 * running work keeps its pulse. With reduced motion, or `still`, the camera
 * cuts instead of flying and every scene arrives finished.
 */

export interface WelcomeStopText {
  /** The stop's name on its plot. */
  label: string
  title: string
  body: string
}

export interface WelcomeText {
  name: string
  line: string
  begin: string
  next: string
  back: string
  skip: string
  finish: string
  sheet: (n: number, of: number) => string
  stops: [WelcomeStopText, WelcomeStopText, WelcomeStopText, WelcomeStopText, WelcomeStopText]
  end: { title: string; body: string }
}

export const welcomeText: WelcomeText = {
  name: 'Charrette',
  line: 'Agents come and go. Your project stays.',
  begin: 'Begin',
  next: 'Continue',
  back: 'Back',
  skip: 'Skip',
  finish: 'Find my agents',
  sheet: (n, of) => `Sheet ${String(n).padStart(2, '0')} of ${String(of).padStart(2, '0')}`,
  stops: [
    {
      label: 'Project',
      title: 'A project holds the work',
      body: 'One body of work: the repositories its tasks may change, what those tasks have learned, and how often agents should ask you. Tasks come and go. The project keeps what they found.',
    },
    {
      label: 'Task',
      title: 'Every task has a lead',
      body: 'You tell the coordinator what you want. It plans the work and hands it out, but writes no code. Each task has one agent in charge, its lead, and steps such as review go to other agents, which report back to it.',
    },
    {
      label: 'Calls',
      title: 'You make the calls',
      body: 'Work moves across the board on its own. When something comes up that only you can decide, it comes to you in violet, with what you need to answer it. Answer, and it carries on.',
    },
    {
      label: 'Change',
      title: 'The change comes back to you',
      body: 'A finished task hands back its change: the pull requests, the files and every check. It was made on a branch of its own, so the folders you work in were never touched. Merging stays yours.',
    },
    {
      label: 'Agents',
      title: 'Your agents, signed in as you',
      body: 'Charrette runs the agents you already use, like Claude Code and Codex, on your own plans. Each keeps its own sign-in; Charrette never sees a password or a key. One task can use several labs, so one checks another.',
    },
  ],
  end: { title: 'Ready when you are', body: 'Next, Charrette looks for the agents on this Mac. Then you make your first project.' },
}

/*
 * The table: where each stop sits, in table pixels, the room its notes and
 * its number need around it, and which sides of its plot the route leaves
 * and arrives by. How big each scene is gets measured.
 */
type Side = 'left' | 'right' | 'top' | 'bottom'
interface Stop {
  x: number
  y: number
  pad: { l: number; r: number; t: number; b: number }
  in?: Side
  out?: Side
}
const TABLE = { w: 5200, h: 3400 }
const STOPS: readonly Stop[] = [
  { x: 1150, y: 1000, pad: { l: 300, r: 60, t: 190, b: 150 }, out: 'right' },
  { x: 2350, y: 820, pad: { l: 360, r: 40, t: 190, b: 120 }, in: 'left', out: 'right' },
  { x: 3420, y: 1300, pad: { l: 40, r: 80, t: 190, b: 110 }, in: 'left', out: 'bottom' },
  { x: 2650, y: 2250, pad: { l: 380, r: 40, t: 200, b: 120 }, in: 'right', out: 'left' },
  { x: 1150, y: 2250, pad: { l: 40, r: 40, t: 200, b: 120 }, in: 'right' },
]
const LAST = STOPS.length + 1
/**
 * Where the opening is drawn: on the same table, to the side of the stops, so
 * Begin is the camera moving off it and not a new screen. On a grid line both
 * ways, so its own grid meets the table's exactly.
 */
const OPENING = { x: 320, y: 1760 }
/** The plot's margin round its scene: Station's inset. */
const PLOT = 28

type Size = { w: number; h: number }
const GUESS: Size = { w: 700, h: 500 }

/* Where the camera looks for a step, for a window of this size. */
function camFor(step: number, sizes: readonly Size[], vw: number, vh: number, wide: boolean): { cam: Cam; fx: number; fy: number } {
  /* the words' column and the fade beside it, which nothing on the table should sit under */
  /* the opening, close, where its crossing sits a little above the middle */
  if (step === 0) return { cam: { ...OPENING, s: 1 }, fx: vw / 2, fy: vh / 2 - 65 }
  const textRight = wide ? 56 + Math.min(360, vw * 0.3) + 64 : 0
  const room = { w: (wide ? vw - textRight : vw) - 32, h: wide ? vh - 110 : vh * 0.6 }
  const stop = STOPS[step - 1]
  if (stop) {
    const size = sizes[step - 1] ?? GUESS
    const { l, r, t, b } = stop.pad
    const k = Math.min(1, room.w / (size.w + l + r), room.h / (size.h + t + b))
    const cam = { x: stop.x + (size.w + r - l) / 2, y: stop.y + (size.h + b - t) / 2, s: k }
    return { cam, fx: wide ? textRight + (vw - textRight) / 2 : vw / 2, fy: wide ? (vh - 90) / 2 + 10 : room.h / 2 + 20 }
  }
  /* the whole table, above the words */
  const box = STOPS.map((p, i) => ({
    x0: p.x - 60,
    y0: p.y - 200,
    x1: p.x + (sizes[i] ?? GUESS).w + 60,
    y1: p.y + (sizes[i] ?? GUESS).h + 60,
  }))
  const x0 = Math.min(...box.map((q) => q.x0))
  const x1 = Math.max(...box.map((q) => q.x1))
  const y0 = Math.min(...box.map((q) => q.y0))
  const y1 = Math.max(...box.map((q) => q.y1))
  const high = vh - 300
  const k = Math.min((vw - 64) / (x1 - x0), high / (y1 - y0))
  return { cam: { x: (x0 + x1) / 2, y: (y0 + y1) / 2, s: k }, fx: vw / 2, fy: high / 2 + 24 }
}

/* Where the route meets a plot: the middle of one of its sides, and which way that side faces. */
function anchor(i: number, side: Side, sizes: readonly Size[]) {
  const p = STOPS[i]!
  const z = sizes[i] ?? GUESS
  const x0 = p.x - PLOT
  const y0 = p.y - PLOT
  const x1 = p.x + z.w + PLOT
  const y1 = p.y + z.h + PLOT
  if (side === 'left') return { x: x0, y: (y0 + y1) / 2, nx: -1, ny: 0 }
  if (side === 'right') return { x: x1, y: (y0 + y1) / 2, nx: 1, ny: 0 }
  if (side === 'top') return { x: (x0 + x1) / 2, y: y0, nx: 0, ny: -1 }
  return { x: (x0 + x1) / 2, y: y1, nx: 0, ny: 1 }
}

/* The pencil line from one stop to the next: out of one plot's side and into the next's, square to both. */
function leg(i: number, sizes: readonly Size[]) {
  const a = anchor(i, STOPS[i]!.out ?? 'right', sizes)
  const b = anchor(i + 1, STOPS[i + 1]!.in ?? 'left', sizes)
  const k = Math.max(90, Math.hypot(b.x - a.x, b.y - a.y) * 0.42)
  const c1 = { x: a.x + a.nx * k, y: a.y + a.ny * k }
  const c2 = { x: b.x + b.nx * k, y: b.y + b.ny * k }
  return { d: `M${a.x} ${a.y}C${c1.x} ${c1.y} ${c2.x} ${c2.y} ${b.x} ${b.y}`, a, b, c1, c2 }
}

/* Points along a leg, from its first plot to its second. */
function legPoints(i: number, sizes: readonly Size[]): Pt[] {
  const { a, b, c1, c2 } = leg(i, sizes)
  return Array.from({ length: 25 }, (_, k) => {
    const t = k / 24
    const u = 1 - t
    const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t] as const
    return { x: w[0] * a.x + w[1] * c1.x + w[2] * c2.x + w[3] * b.x, y: w[0] * a.y + w[1] * c1.y + w[2] * c2.y + w[3] * b.y }
  })
}

export interface WelcomeProps {
  /** Where it is: 0 the opening, 1 to 5 the stops, 6 the whole table. */
  step?: number
  defaultStep?: number
  onStepChange?: (step: number) => void
  /** Leaves the welcome, finished or skipped. */
  onDone: () => void
  /** Cut instead of flying, and arrive with every scene finished: for stills. Reduced motion does the same. */
  still?: boolean
  className?: string
  text?: Partial<WelcomeText>
}

/** The welcome, shown once after install: an opening, five working scenes on a drafting table, and the whole table. */
export function Welcome({ step: stepProp, defaultStep = 0, onStepChange, onDone, still = false, className, text }: WelcomeProps) {
  const t = { ...welcomeText, ...text }
  const [step, setStep] = useControlled(stepProp, defaultStep, onStepChange)
  const stepRef = useRef(step)
  useLayoutEffect(() => {
    stepRef.current = step
  })
  const reduced = useReducedMotion()
  const cut = still || reduced
  const view = useRef<HTMLDivElement>(null)
  const world = useRef<HTMLDivElement>(null)
  const tilt = useRef<HTMLDivElement>(null)
  const next = useRef<HTMLButtonElement>(null)
  /** Where the camera is resting: which stop is live. */
  const [landed, setLanded] = useState(cut ? step : 0)
  /** The furthest stop built so far. */
  const [built, setBuilt] = useState(cut ? step : 0)
  const cam = useRef<(Cam & Focus & { far: number }) | null>(null)
  /** The step the camera is placed for. */
  const aim = useRef(0)
  const flight = useRef<Animation[] | null>(null)
  const [wide, setWide] = useState(true)
  const [sizes, setSizes] = useState<Size[]>([])
  const sized = useRef<Size[]>([])

  /* every scene is laid out from the start, hidden: measure them once */
  useLayoutEffect(() => {
    const w = world.current
    if (!w) return
    const found = STOPS.map((_, i) => {
      const el = w.querySelector<HTMLElement>(`[data-stop="${i + 1}"]`)
      return el ? { w: el.offsetWidth, h: el.offsetHeight } : GUESS
    })
    sized.current = found
    setSizes(found)
  }, [])

  const go = (to: number) => (to > LAST ? onDone() : setStep(Math.max(0, to)))

  /* the camera: cut when resizing, fly when the step changes; how long the flight takes */
  const place = (target: number, animate: boolean): number => {
    const v = view.current
    const w = world.current
    if (!v || !w) return 0
    const prev = aim.current
    aim.current = target
    const isWide = v.clientWidth >= 900
    setWide(isWide)
    const { cam: to, fx, fy } = camFor(target, sized.current, v.clientWidth, v.clientHeight, isWide)
    const from = cam.current
    flight.current?.forEach((a) => a.finish())
    /* seen whole, the table's lines and names are drawn heavier, so they read at a distance */
    const far = target > STOPS.length ? Math.min(5, 1 / to.s) : 1
    const reached = () => {
      setLanded(target)
      if (target <= STOPS.length) setBuilt((b) => Math.max(b, target))
    }
    w.style.setProperty('--far', String(far))
    w.style.transform = transform(to, { fx, fy })
    cam.current = { ...to, fx, fy, far }
    const still = !from || (Math.abs(from.x - to.x) < 1 && Math.abs(from.y - to.y) < 1 && Math.abs(from.s - to.s) < 0.001)
    if (!animate || still || typeof w.animate !== 'function') {
      reached()
      return 0
    }
    setLanded(-1)
    /* one step along the way, from the opening to the last plot, is a glide; anything else is a zoom */
    const hop = Math.abs(target - prev) === 1 && Math.max(target, prev) <= STOPS.length
    const legIndex = Math.min(target, prev) - 1
    const via = hop && legIndex >= 0 ? legPoints(legIndex, sized.current) : []
    if (target < prev) via.reverse()
    const f = hop
      ? glide(from, to, from, { fx, fy }, [from.far, far], via)
      : frames(from, to, from, { fx, fy }, v.clientWidth, [from.far, far])
    const timing = { duration: f.ms, easing: f.easing }
    const a = w.animate(f.world, timing)
    const all = [a]
    const lean = tilt.current?.animate(f.tilt, timing)
    if (lean) all.push(lean)
    /* the route is drawn beside the camera as it passes, or rubbed out going back */
    const pencil = f.drawn && via.length > 0 ? w.querySelector<SVGPathElement>(`[data-leg="${legIndex}"]`) : null
    const drawn = f.drawn
    if (pencil && drawn) {
      const n = drawn.length - 1
      const at = drawn.map((u, k) => ({ offset: k / n, strokeDashoffset: String(target > prev ? 1 - u : u) }))
      all.push(pencil.animate(at, timing))
    }
    flight.current = all
    a.onfinish = () => {
      if (flight.current !== all) return
      flight.current = null
      reached()
    }
    return f.ms
  }

  useLayoutEffect(() => {
    place(step, !cut)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, cut])

  /* a resized window keeps the camera where it is aimed, without flying */
  const placeRef = useRef(place)
  useLayoutEffect(() => {
    placeRef.current = place
  })
  useEffect(() => {
    const v = view.current
    if (!v || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      if (cam.current && !flight.current) placeRef.current(aim.current, false)
    })
    ro.observe(v)
    return () => ro.disconnect()
  }, [])

  /* Continue keeps focus, so Enter walks through */
  useEffect(() => {
    next.current?.focus({ preventScroll: true })
  }, [step])

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'ArrowRight') go(step + 1)
      else if (e.key === 'ArrowLeft') go(step - 1)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })

  const stop = step >= 1 && step <= STOPS.length ? t.stops[step - 1] : undefined
  const words = stop ?? (step === LAST ? t.end : undefined)
  return (
    <div className={cx(s.welcome, cut && s.cut, className)}>
      <div ref={view} className={s.view}>
        <div className={s.lens}>
          <div ref={tilt} className={s.tilt}>
            <div ref={world} className={cx(s.world, step > 0 && s.open)} style={{ width: TABLE.w, height: TABLE.h }}>
              <svg className={s.route} width={TABLE.w} height={TABLE.h} aria-hidden="true">
                {sizes.length > 0 &&
                  STOPS.slice(1).map((_, i) => {
                    const { d, a, b } = leg(i, sizes)
                    const drawn = step >= i + 2
                    return (
                      <g key={i}>
                        <path d={d} className={s.plan} />
                        <path d={d} pathLength={1} data-leg={i} className={cx(s.leg, drawn && s.legDrawn)} />
                        <circle cx={a.x} cy={a.y} className={cx(s.node, drawn && s.nodeDrawn)} />
                        <circle cx={b.x} cy={b.y} className={cx(s.node, drawn && s.nodeDrawn)} />
                      </g>
                    )
                  })}
              </svg>
              <div
                className={s.openingSpot}
                style={{ left: OPENING.x, top: OPENING.y }}
                inert={step > 0}
                aria-hidden={step > 0 || undefined}
              >
                <Opening name={t.name} line={t.line} still={cut} away={step > 0} />
              </div>
              {STOPS.map((p, i) => {
                const Scene = SCENES[i]!
                const n = i + 1
                return (
                  <Station key={n} n={n} label={t.stops[i]!.label} x={p.x} y={p.y} shown={step > 0} built={built >= n} instant={cut}>
                    <Scene live={landed === n} instant={cut} />
                  </Station>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {words && wide && step !== LAST && <i className={s.scrim} aria-hidden="true" />}
      {step > 0 && words && (
        <section className={cx(s.words, step === LAST && s.endWords, !wide && s.narrowWords)} key={step} aria-labelledby="welcome-title">
          <h1 id="welcome-title" className={s.heading}>
            {words.title.split(' ').map((w, i) => (
              <Fragment key={i}>
                <span className={s.mask}>
                  <span className={s.rise} style={{ '--i': i } as CSSProperties}>
                    {w}
                  </span>
                </span>{' '}
              </Fragment>
            ))}
          </h1>
          <p className={s.body}>{words.body}</p>
        </section>
      )}

      <Button variant="quiet" className={s.skip} onClick={onDone}>
        {t.skip}
      </Button>
      <footer className={s.block}>
        {step > 0 && <Scale step={step} />}
        <span className={s.cell}>
          <span className={s.cellName}>{t.name}</span>
          {stop && <span className={s.cellSheet}>{t.sheet(step, STOPS.length)}</span>}
        </span>
        <span className={s.buttons}>
          {step > 0 && (
            <Button variant="quiet" onClick={() => go(step - 1)}>
              {t.back}
            </Button>
          )}
          <Button ref={next} kbd="↵" onClick={() => go(step + 1)} className={step === 0 ? s.begin : undefined}>
            {step === 0 ? t.begin : step === LAST ? t.finish : t.next}
          </Button>
        </span>
      </footer>
      <VisuallyHidden>
        <span aria-live="polite">{stop ? `${t.sheet(step, STOPS.length)}. ${stop.title}` : step === LAST ? t.end.title : ''}</span>
      </VisuallyHidden>
    </div>
  )
}

/* Where you are, as the marks on a scale ruler. */
function Scale({ step }: { step: number }) {
  return (
    <span className={s.scale} aria-hidden="true">
      {STOPS.map((_, i) => (
        <i key={i} className={cx(s.tick, i + 1 === step && s.here, i + 1 < step && s.past)} />
      ))}
    </span>
  )
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(() => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    if (typeof matchMedia === 'undefined') return
    const q = matchMedia('(prefers-reduced-motion: reduce)')
    const on = () => setReduced(q.matches)
    q.addEventListener('change', on)
    return () => q.removeEventListener('change', on)
  }, [])
  return reduced
}
