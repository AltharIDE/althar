/*
 * The camera over the table, and the two ways it moves.
 *
 * Between plots, and from the opening to the first, it glides (`glide`):
 * straight and low over the table, hardly pulling back, tipped forward to
 * look where it is going, while the pencil route is drawn beside it, kept
 * level with it however the route bends. The camera never follows a bend or
 * rolls into one. A glide shapes its own pace in its keyframes and runs
 * linear.
 *
 * Anything else, like the pull back over the whole table at the end, is a
 * zoom (`frames`) along van Wijk and Nuij's smooth and efficient zooming and
 * panning (2003), the one map apps fly along: it pulls back only as far as
 * the distance needs, crosses, and closes in, at an even perceived speed. It
 * is sampled into keyframes and the animation eases both ends. The tilt
 * follows how far the camera has pulled back, so it leans most at the height
 * of the flight and not at all on a straight zoom.
 */

export interface Cam {
  /** The table point at the focus, in table pixels. */
  x: number
  y: number
  /** Screen pixels per table pixel. */
  s: number
}

/** Where the camera's point lands on screen. */
export interface Focus {
  fx: number
  fy: number
}

/** How readily it pulls back on the way: higher pulls back further. */
const RHO = 2.1
/** The lean at the height of a flight that pulls well back. */
const TILT = 11
const SAMPLES = 40

export const EASE = 'cubic-bezier(0.45, 0, 0.25, 1)'

export const transform = (c: Cam, f: Focus) => `translate3d(${f.fx - c.x * c.s}px, ${f.fy - c.y * c.s}px, 0) scale(${c.s})`

/** The path from one view to another, for a window this wide: where the camera is at t in [0, 1], and how long the flight takes. */
export function path(a: Cam, b: Cam, vw: number): { ms: number; at: (t: number) => Cam } {
  const w0 = vw / a.s
  const w1 = vw / b.s
  const dx = b.x - a.x
  const dy = b.y - a.y
  const d = Math.hypot(dx, dy)
  const r2 = RHO * RHO
  let S: number
  let at: (t: number) => Cam
  if (d < 1) {
    /* no distance to cross: a straight zoom */
    const k = Math.log(w1 / w0)
    S = Math.abs(k) / RHO
    at = (t) => ({ x: a.x + dx * t, y: a.y + dy * t, s: vw / (w0 * Math.exp(k * t)) })
  } else {
    const b0 = (w1 * w1 - w0 * w0 + r2 * r2 * d * d) / (2 * w0 * r2 * d)
    const b1 = (w1 * w1 - w0 * w0 - r2 * r2 * d * d) / (2 * w1 * r2 * d)
    const r0 = Math.log(Math.sqrt(b0 * b0 + 1) - b0)
    const r1 = Math.log(Math.sqrt(b1 * b1 + 1) - b1)
    S = (r1 - r0) / RHO
    at = (t) => {
      const u = (w0 / (r2 * d)) * (Math.cosh(r0) * Math.tanh(RHO * t * S + r0) - Math.sinh(r0))
      const w = (w0 * Math.cosh(r0)) / Math.cosh(RHO * t * S + r0)
      return { x: a.x + u * dx, y: a.y + u * dy, s: vw / w }
    }
  }
  return { ms: Math.round(Math.min(2300, Math.max(1500, S * 1200))), at }
}

export interface Pt {
  x: number
  y: number
}

export interface Frames {
  ms: number
  /** The timing over the whole flight: a zoom eases here, a ride in its keyframes. */
  easing: string
  world: Keyframe[]
  tilt: Keyframe[]
  /** How much of the route has been ridden at each keyframe, for a route drawn as the camera goes. */
  drawn?: number[]
}

/**
 * The keyframes for a zoom: the table's transform (and its line weight, when
 * that changes) and the lean. `far` is the line weight at each end.
 */
export function frames(a: Cam, b: Cam, fa: Focus, fb: Focus, vw: number, far: [number, number]): Frames {
  const { ms, at } = path(a, b, vw)
  const ts = Array.from({ length: SAMPLES + 1 }, (_, i) => i / SAMPLES)
  const cams = ts.map(at)
  /* how far past a steady zoom the camera has pulled back, at each moment */
  const la = Math.log(a.s)
  const lb = Math.log(b.s)
  const back = cams.map((c, i) => Math.max(0, la + (lb - la) * ts[i]! - Math.log(c.s)))
  const most = Math.max(...back)
  const lean = most > 0.02 ? Math.min(1, most / 0.5) : 0
  const scaled = Math.abs(lb - la) > 0.01
  const world = cams.map((c, i) => {
    const t = ts[i]!
    const f = { fx: fa.fx + (fb.fx - fa.fx) * t, fy: fa.fy + (fb.fy - fa.fy) * t }
    const frame: Keyframe = { offset: t, transform: transform(c, f) }
    if (far[0] !== far[1]) {
      const p = scaled ? Math.min(1, Math.max(0, (Math.log(c.s) - la) / (lb - la))) : t
      frame['--far'] = String(far[0] * Math.pow(far[1] / far[0], p))
    }
    return frame
  })
  const tilt = back.map((v, i) => {
    const deg = most > 0 ? TILT * lean * (v / most) : 0
    return { offset: ts[i], transform: `rotateX(${deg.toFixed(3)}deg) rotateZ(${(-deg / 9).toFixed(3)}deg)` }
  })
  return { ms, easing: EASE, world, tilt }
}

/* ---- the glide ------------------------------------------------------------ */

/** Keyframes for a glide, which paces itself: enough that linear steps between them read as a curve. */
const LOW = 72
/** The lens for a glide: near enough that the table falls away when the camera tips. */
const DEPTH = 1500
/** How far the camera tips forward at the middle of a glide. */
const TIP = 34

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
/** Gathers speed and settles, evenly. */
const smooth = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(2 - 2 * t, 3) / 2)
/** Nothing at either end, most in the middle. */
const bell = (t: number) => Math.sin(Math.PI * clamp(t, 0, 1))

/**
 * The keyframes for a glide from one view to the next, with `via`, the route
 * between them in the order it is travelled, drawn as the camera passes.
 */
export function glide(a: Cam, b: Cam, fa: Focus, fb: Focus, far: [number, number], via: readonly Pt[]): Frames {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const d = Math.hypot(dx, dy)
  const ux = d ? dx / d : 0
  const uy = d ? dy / d : 0
  const ms = Math.round(clamp(1400 + d * Math.sqrt(a.s * b.s) * 0.45, 1900, 2800))
  const ts = Array.from({ length: LOW + 1 }, (_, i) => i / LOW)
  const focus = (t: number) => ({ fx: fa.fx + (fb.fx - fa.fx) * t, fy: fa.fy + (fb.fy - fa.fy) * t })
  const world = ts.map((t) => {
    const p = smooth(t)
    /* even in how the scale feels, and drawn back a little in the middle */
    const s = Math.exp(Math.log(a.s) + (Math.log(b.s) - Math.log(a.s)) * p) * (1 - 0.2 * bell(p))
    const frame: Keyframe = { offset: t, transform: transform({ x: a.x + dx * p, y: a.y + dy * p, s }, focus(t)) }
    if (far[0] !== far[1]) frame['--far'] = String(far[0] * Math.pow(far[1] / far[0], p))
    return frame
  })
  /* tipped toward where it is going, so that side of the table falls away; never rolled */
  const tilt = ts.map((t) => {
    const deg = TIP * Math.pow(bell(t), 1.2)
    const f = focus(t)
    return {
      offset: t,
      transformOrigin: `${f.fx}px ${f.fy}px`,
      transform: `perspective(${DEPTH}px) rotateX(${(-uy * deg).toFixed(3)}deg) rotateY(${(ux * deg).toFixed(3)}deg)`,
    }
  })
  /* how far along the way each point of the route lies, never going back: the pencil keeps level with the camera */
  let most = -Infinity
  const ahead = via.map((q) => (most = Math.max(most, d ? ((q.x - a.x) * dx + (q.y - a.y) * dy) / (d * d) : 0)))
  /* a route that starts behind the camera or ends past where it lands is drawn within the glide all the same */
  const lo = Math.min(0, ahead[0] ?? 0)
  const hi = Math.max(1, ahead.at(-1) ?? 1)
  const along = ahead.map((v) => (v - lo) / (hi - lo))
  const drawnAt = (p: number) => {
    const last = along.length - 1
    if (last < 1 || p <= along[0]!) return 0
    if (p >= along[last]!) return 1
    let i = 1
    while (along[i]! < p) i++
    const span = along[i]! - along[i - 1]!
    return (i - 1 + (span ? (p - along[i - 1]!) / span : 1)) / last
  }
  return { ms, easing: 'linear', world, tilt, drawn: ts.map((t) => drawnAt(smooth(t))) }
}
