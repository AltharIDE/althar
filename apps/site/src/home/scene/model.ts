import { lerp, range } from '../../lib/motion'
import { TASKS } from '../../content/site'

/*
 * The site in 3D, in metres, y up: a building a floor per task, its
 * scaffold, the ground and street, a laydown of panels, and one tower
 * crane drawn part by part. Everything is lines and flat faces, for the
 * painter in render.ts. The crane's turning parts are built fresh for each
 * frame from its slew angle and trolley.
 */

export type V = readonly [number, number, number]

export const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const neg = (a: V): V => [-a[0], -a[1], -a[2]]
export const X: V = [1, 0, 0]
export const Z: V = [0, 0, 1]

export enum Tone {
  Ink = 'ink',
  Faint = 'faint',
  Grey = 'grey',
  Live = 'live',
  Light = 'light',
  Shade = 'shade',
  Paper = 'paper',
}

export interface Seg {
  a: V
  b: V
  w: number
  tone: Tone
}

export interface Face {
  p: readonly V[]
  n: V
  fill: Tone
  edge: Tone
  w: number
  win?: readonly V[]
}

/** A box on the ground plane, turned to axes u and v, with half-sizes hu and hv. `glaze` puts a window in each side. */
export function box(
  c: V,
  u: V,
  v: V,
  hu: number,
  hv: number,
  y0: number,
  y1: number,
  fill: Tone,
  edge: Tone,
  w = 1,
  glaze = false,
): Face[] {
  const P = (su: number, sv: number, y: number): V => [c[0] + u[0] * hu * su + v[0] * hv * sv, y, c[2] + u[2] * hu * su + v[2] * hv * sv]
  const sides: [V[], V][] = [
    [[P(1, -1, y0), P(1, 1, y0), P(1, 1, y1), P(1, -1, y1)], u],
    [[P(-1, 1, y0), P(-1, -1, y0), P(-1, -1, y1), P(-1, 1, y1)], neg(u)],
    [[P(1, 1, y0), P(-1, 1, y0), P(-1, 1, y1), P(1, 1, y1)], v],
    [[P(-1, -1, y0), P(1, -1, y0), P(1, -1, y1), P(-1, -1, y1)], neg(v)],
  ]
  const lo = y0 + (y1 - y0) * 0.38
  const hi = y1 - (y1 - y0) * 0.14
  const faces: Face[] = sides.map(([p, n]) => {
    const [a, b] = [p[0], p[1]]
    if (!glaze || !a || !b) return { p, n, fill, edge, w }
    const i = (k: number, y: number): V => [lerp(a[0], b[0], k), y, lerp(a[2], b[2], k)]
    return { p, n, fill, edge, w, win: [i(0.14, lo), i(0.86, lo), i(0.86, hi), i(0.14, hi)] }
  })
  faces.push(
    { p: [P(-1, -1, y1), P(1, -1, y1), P(1, 1, y1), P(-1, 1, y1)], n: [0, 1, 0], fill, edge, w },
    { p: [P(-1, -1, y0), P(-1, 1, y0), P(1, 1, y0), P(1, -1, y0)], n: [0, -1, 0], fill, edge, w },
  )
  return faces
}

/* ---- The building --------------------------------------------------------------------------------- */

export const X0 = -12
export const X1 = 12
export const Z0 = -8
export const Z1 = 8
const GF = 4.5
const FH = 3.5
export const FLOORS = TASKS.length
/** The top of the ground floor (k = 0) and of each floor above it. */
export const topOf = (k: number) => GF + k * FH
const ROOF = topOf(FLOORS)
/** Halfway up the floor a task set: the one on top of topOf(k). */
export const midOf = (k: number) => topOf(k) + FH / 2

function floorFaces(k: number): Face[] {
  const y0 = k === 0 ? 0 : topOf(k - 1)
  const y1 = topOf(k)
  const low = k === 0 ? 0.25 : 0.9
  const faces: Face[] = []
  const bay = 4
  for (let i = 0; i < (X1 - X0) / bay; i++) {
    const a = X0 + i * bay
    const b = a + bay
    for (const [z, n] of [
      [Z1, 1],
      [Z0, -1],
    ] as const) {
      faces.push({
        p: [
          [a, y0, z],
          [b, y0, z],
          [b, y1, z],
          [a, y1, z],
        ],
        n: [0, 0, n],
        fill: Tone.Light,
        edge: Tone.Ink,
        w: 1,
        win: [
          [a + 0.6, y0 + low, z],
          [b - 0.6, y0 + low, z],
          [b - 0.6, y1 - 0.5, z],
          [a + 0.6, y1 - 0.5, z],
        ],
      })
    }
  }
  for (let i = 0; i < (Z1 - Z0) / bay; i++) {
    const a = Z0 + i * bay
    const b = a + bay
    for (const [x, n] of [
      [X1, 1],
      [X0, -1],
    ] as const) {
      faces.push({
        p: [
          [x, y0, a],
          [x, y0, b],
          [x, y1, b],
          [x, y1, a],
        ],
        n: [n, 0, 0],
        fill: Tone.Shade,
        edge: Tone.Ink,
        w: 1,
        win: [
          [x, y0 + low, a + 0.6],
          [x, y0 + low, b - 0.6],
          [x, y1 - 0.5, b - 0.6],
          [x, y1 - 0.5, a + 0.6],
        ],
      })
    }
  }
  return faces
}
export const FLOOR_FACES = range(FLOORS + 1).map(floorFaces)

/* ---- The scaffold, 1.2 m off every face, one list per 2 m lift ------------------------------------ */

export const LIFT = 2
const LIFTS = Math.ceil((ROOF + 1.5) / LIFT)
function liftSegs(j: number): Seg[] {
  const y0 = j * LIFT
  const y1 = y0 + LIFT
  const o = 1.2
  const out: Seg[] = []
  const side = (from: V, to: V, bays: number) => {
    const at = (k: number): V => [lerp(from[0], to[0], k / bays), 0, lerp(from[2], to[2], k / bays)]
    for (let k = 0; k <= bays; k++) {
      const p = at(k)
      out.push({ a: [p[0], y0, p[2]], b: [p[0], y1, p[2]], w: 1, tone: Tone.Live })
    }
    for (let k = 0; k < bays; k++) {
      const p = at(k)
      const q = at(k + 1)
      out.push({ a: [p[0], y1, p[2]], b: [q[0], y1, q[2]], w: j % 2 ? 2.2 : 1, tone: Tone.Live })
      if (k % 4 === 0) {
        const [lo, hi] = j % 2 ? [p, q] : [q, p]
        out.push({ a: [lo[0], y0, lo[2]], b: [hi[0], y1, hi[2]], w: 0.7, tone: Tone.Live })
      }
    }
  }
  side([X0 - o, 0, Z1 + o], [X1 + o, 0, Z1 + o], 11)
  side([X1 + o, 0, Z1 + o], [X1 + o, 0, Z0 - o], 8)
  side([X1 + o, 0, Z0 - o], [X0 - o, 0, Z0 - o], 11)
  side([X0 - o, 0, Z0 - o], [X0 - o, 0, Z1 + o], 8)
  return out
}
export const LIFT_SEGS = range(LIFTS).map(liftSegs)

/* ---- The ground and the street -------------------------------------------------------------------- */

export const GROUND_SEGS: Seg[] = [
  ...range(17).map((i): Seg => ({ a: [-36 + i * 4, 0, -44], b: [-36 + i * 4, 0, 12], w: 0.6, tone: Tone.Faint })),
  ...range(15).map((i): Seg => ({ a: [-36, 0, -44 + i * 4], b: [28, 0, -44 + i * 4], w: 0.6, tone: Tone.Faint })),
  { a: [-160, 0, 14], b: [160, 0, 14], w: 1.2, tone: Tone.Ink },
  { a: [-160, 0, 17], b: [160, 0, 17], w: 0.8, tone: Tone.Grey },
  ...range(40).map((i): Seg => ({ a: [-160 + i * 8, 0, 24], b: [-156 + i * 8, 0, 24], w: 0.8, tone: Tone.Grey })),
]

/* ---- The crane ------------------------------------------------------------------------------------ */

/** Where it stands. */
export const M: V = [27, 0, -15]
const FOOT = 1
const MAST = 40
const SECTIONS = 13
const SEC = (MAST - FOOT) / SECTIONS
/** The jib's bottom and top chords, and the tower head's apex. */
export const Y0 = MAST + 1.6
const Y1 = Y0 + 1.8
const APEX = Y0 + 8
const JIB = 40
const COUNTER = 14
/** From the hook down to the top of what it carries. */
export const SLING = 3.4
export const PANEL = 0.5
export const PALLET = 0.3

function mastSection(s: number): Seg[] {
  const y0 = FOOT + s * SEC
  const y1 = y0 + SEC
  const c: V[] = [
    [M[0] - 1, 0, M[2] - 1],
    [M[0] + 1, 0, M[2] - 1],
    [M[0] + 1, 0, M[2] + 1],
    [M[0] - 1, 0, M[2] + 1],
  ]
  const out: Seg[] = []
  c.forEach((p, i) => {
    const q = c[(i + 1) % 4] ?? p
    out.push({ a: [p[0], y0, p[2]], b: [p[0], y1, p[2]], w: 1.4, tone: Tone.Live })
    out.push({ a: [p[0], y1, p[2]], b: [q[0], y1, q[2]], w: 0.8, tone: Tone.Live })
    out.push({ a: [p[0], y0, p[2]], b: [q[0], (y0 + y1) / 2, q[2]], w: 0.7, tone: Tone.Live })
    out.push({ a: [q[0], (y0 + y1) / 2, q[2]], b: [p[0], y1, p[2]], w: 0.7, tone: Tone.Live })
  })
  return out
}
export const MAST_SEGS = range(SECTIONS).flatMap(mastSection)
export const FOUNDATION = box(M, X, Z, 2.6, 2.6, 0, FOOT, Tone.Paper, Tone.Live)

/** Everything above the slewing ring, turned to phi degrees, with the trolley d metres out. */
export function slewing(phi: number, d: number): { segs: Seg[]; faces: Face[]; plate: V; under: V; u: V; v: V } {
  const r = (phi * Math.PI) / 180
  const u: V = [Math.cos(r), 0, Math.sin(r)]
  const v: V = [-Math.sin(r), 0, Math.cos(r)]
  const at = (a: number, lat: number, y: number): V => [M[0] + u[0] * a + v[0] * lat, y, M[2] + u[2] * a + v[2] * lat]
  const segs: Seg[] = []
  const L = (a: V, b: V, w = 1) => segs.push({ a, b, w, tone: Tone.Live })

  // The jib: a triangular truss, tapering to its tip.
  const n = 18
  const r0 = 1.35
  const step = (JIB - r0) / n
  const topY = (i: number) => Y1 - Math.max(0, i - (n - 4)) * 0.38
  for (let i = 0; i < n; i++) {
    const a = r0 + i * step
    const b = a + step
    const m = (a + b) / 2
    const ym = (topY(i) + topY(i + 1)) / 2
    for (const s of [-0.8, 0.8]) {
      L(at(a, s, Y0), at(b, s, Y0), 1.3)
      L(at(a, s, Y0), at(m, 0, ym), 0.75)
      L(at(m, 0, ym), at(b, s, Y0), 0.75)
    }
    L(at(a, 0, topY(i)), at(b, 0, topY(i + 1)), 1.3)
    L(at(a, -0.8, Y0), at(a, 0.8, Y0), 0.6)
    L(at(a, -0.8, Y0), at(b, 0.8, Y0), 0.5)
  }
  L(at(JIB, -0.8, Y0), at(JIB, 0.8, Y0), 0.8)
  L(at(JIB, -0.8, Y0), at(JIB, 0, topY(n)), 0.8)
  L(at(JIB, 0.8, Y0), at(JIB, 0, topY(n)), 0.8)

  // The counter-jib: a deck with handrails, the winch and the weights.
  const cn = 5
  const cs = (COUNTER - r0) / cn
  for (let i = 0; i <= cn; i++) {
    const a = -r0 - i * cs
    L(at(a, -1.1, Y0), at(a, 1.1, Y0), 0.7)
    for (const s of [-1.1, 1.1]) L(at(a, s, Y0), at(a, s, Y0 + 1.1), 0.6)
    if (i === cn) continue
    const b = a - cs
    for (const s of [-1.1, 1.1]) {
      L(at(a, s, Y0), at(b, s, Y0), 1.3)
      L(at(a, s, Y0 + 1.1), at(b, s, Y0 + 1.1), 0.6)
    }
    L(at(a, -1.1, Y0), at(b, 1.1, Y0), 0.5)
  }

  // The tower head, over the turntable.
  const apex: V = [M[0], APEX, M[2]]
  const base = [at(1.2, 1.2, Y0), at(-1.2, 1.2, Y0), at(-1.2, -1.2, Y0), at(1.2, -1.2, Y0)]
  const ring = [at(0.62, 0.62, Y0 + 3.8), at(-0.62, 0.62, Y0 + 3.8), at(-0.62, -0.62, Y0 + 3.8), at(0.62, -0.62, Y0 + 3.8)]
  base.forEach((p, i) => {
    const q = ring[i] ?? p
    const qn = ring[(i + 1) % 4] ?? p
    L(p, apex, 1.3)
    L(q, qn, 0.7)
    L(p, qn, 0.6)
  })
  const cap = [at(0.3, 0.3, APEX - 0.5), at(-0.3, 0.3, APEX - 0.5), at(-0.3, -0.3, APEX - 0.5), at(0.3, -0.3, APEX - 0.5)]
  cap.forEach((p, i) => L(p, cap[(i + 1) % 4] ?? p, 0.8))

  // Pendants from the apex to the jib and the counter-jib.
  L(apex, at(20, 0, Y1), 0.9)
  L(apex, at(30, 0, Y1), 0.9)
  L(apex, at(-COUNTER + 0.6, -1.1, Y0 + 1.1), 0.8)
  L(apex, at(-COUNTER + 0.6, 1.1, Y0 + 1.1), 0.8)

  // The hoist rope, from the winch, over the jib's root and out to the trolley.
  const rope = [at(-3.6, 0, Y0 + 0.9), at(r0, 0, Y1 - 0.4), at(d, 0, Y0 + 0.1)]
  for (let i = 0; i < rope.length - 1; i++) {
    const a = rope[i]
    const b = rope[i + 1]
    if (!a || !b) continue
    const k = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2]) / 5))
    for (let j = 0; j < k; j++)
      L(
        [lerp(a[0], b[0], j / k), lerp(a[1], b[1], j / k), lerp(a[2], b[2], j / k)],
        [lerp(a[0], b[0], (j + 1) / k), lerp(a[1], b[1], (j + 1) / k), lerp(a[2], b[2], (j + 1) / k)],
        0.5,
      )
  }

  const faces: Face[] = [
    // the turntable and the operator's cab
    ...box(at(0, 0, 0), u, v, 1.35, 1.35, MAST, Y0, Tone.Paper, Tone.Live, 1.2),
    ...box(at(1.3, 2.35, 0), u, v, 1.05, 0.95, MAST - 1.3, Y0 + 0.5, Tone.Paper, Tone.Live, 1.2, true),
    // machinery on the counter-jib
    ...box(at(-3.6, 0, 0), u, v, 1, 0.75, Y0, Y0 + 1.1, Tone.Paper, Tone.Live),
    ...box(at(-6.8, 0.35, 0), u, v, 0.45, 0.7, Y0, Y0 + 1.7, Tone.Paper, Tone.Live),
    // the counterweight, in slabs
    ...range(4).flatMap((k) => box(at(-12.4, 0, 0), u, v, 1.3, 1.25, Y0 - 0.7 * (k + 1), Y0 - 0.7 * k, Tone.Live, Tone.Paper, 1)),
    // the trolley
    ...box(at(d, 0, 0), u, v, 0.9, 1, Y0 - 0.55, Y0 - 0.05, Tone.Paper, Tone.Live),
  ]
  return { segs, faces, plate: at(-8.6, 0, Y0 + 2.6), under: at(d, 0, Y0 - 0.55), u, v }
}

/** The falls, the hook block and hook, and what it carries. `hook` is where the slings meet. */
export function hanging(under: V, hook: V, u: V, v: V, load: boolean): { segs: Seg[]; faces: Face[] } {
  const segs: Seg[] = []
  const L = (a: V, b: V, w = 1, tone = Tone.Live) => segs.push({ a, b, w, tone })
  const blockTop = hook[1] + 1.2
  for (const s of [-0.28, 0.28]) {
    const a: V = [under[0] + v[0] * s, under[1], under[2] + v[2] * s]
    const b: V = [hook[0] + v[0] * s, blockTop, hook[2] + v[2] * s]
    const k = Math.max(1, Math.ceil((a[1] - b[1]) / 2))
    for (let j = 0; j < k; j++)
      L(
        [lerp(a[0], b[0], j / k), lerp(a[1], b[1], j / k), lerp(a[2], b[2], j / k)],
        [lerp(a[0], b[0], (j + 1) / k), lerp(a[1], b[1], (j + 1) / k), lerp(a[2], b[2], (j + 1) / k)],
        0.8,
      )
  }
  const faces = box([hook[0], 0, hook[2]], u, v, 0.32, 0.42, hook[1] + 0.35, blockTop, Tone.Paper, Tone.Live, 1.1)
  // the hook itself
  const h = (a: number, y: number): V => [hook[0] + u[0] * a, hook[1] + y, hook[2] + u[2] * a]
  L(h(0, 0.35), h(0, 0), 1.4)
  L(h(0, 0), h(0.22, -0.18), 1.4)
  L(h(0.22, -0.18), h(0.05, -0.34), 1.4)
  if (load) {
    const top = hook[1] - SLING
    for (const [x, z] of [
      [-4, -2.5],
      [4, -2.5],
      [4, 2.5],
      [-4, 2.5],
    ] as const)
      L([hook[0], hook[1] - 0.2, hook[2]], [hook[0] + x, top, hook[2] + z], 0.7, Tone.Ink)
    faces.push(...box([hook[0], 0, hook[2]], X, Z, 4, 2.5, top - PANEL, top, Tone.Light, Tone.Ink, 1.1))
  }
  return { segs, faces }
}

/** The panels still waiting on the laydown, on their pallet. */
export function laydown(at: V, count: number): Face[] {
  return [
    ...box(at, X, Z, 4.4, 2.9, 0, PALLET, Tone.Shade, Tone.Ink, 0.9),
    ...range(count).flatMap((k) => box(at, X, Z, 4, 2.5, PALLET + k * PANEL, PALLET + (k + 1) * PANEL, Tone.Light, Tone.Ink, 0.9)),
  ]
}
