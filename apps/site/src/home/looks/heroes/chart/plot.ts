import { altitudeAt, AT, velocityAt } from '../../../hero/journey'

/*
 * The re-entry, plotted: a cross-section of the air over the planet, drawn
 * about its centre far below the first screen. The ground is the limb, a
 * great arc low on the sheet; the air's heights are arcs about the same
 * centre, every 20 km; the capsule's path runs through them by the
 * journey's own clock, its height the altimeter's (altitudeAt) and its
 * distance along the planet what its speed has carried it (velocityAt,
 * summed). So the path is the readouts, drawn: a long shallow run high in
 * the air while it is fast, then the turn down, then near straight down
 * once it has shed its speed, coming to rest at 38 km.
 */

/** The heights drawn as arcs, in km, top down; the ground is the limb. */
export const ARCS = [120, 100, 80, 60, 40, 20] as const
/** The plot's top arc, and the heights where the capsule enters the air and comes to rest. */
export const TOP_KM = 120
export const ENTRY_KM = altitudeAt(AT.open)
export const REST_KM = altitudeAt(AT.settled)

/** How far downrange the capsule has come by second `t`, summed once in small steps; as a share of the whole run. */
const rangeAt = (() => {
  const step = 1 / 240
  const n = Math.ceil(AT.settled / step)
  const table = new Float64Array(n + 1)
  for (let i = 1; i <= n; i++) table[i] = table[i - 1]! + velocityAt((i - 0.5) * step) * step
  const total = table[n]!
  return (t: number) => {
    const x = Math.min(Math.max(t, 0), AT.settled) / step
    const i = Math.min(Math.floor(x), n - 1)
    const f = x - i
    return (table[i]! * (1 - f) + table[i + 1]! * f) / total
  }
})()

/** Where the sheet's plot stands: its size, the scale's line, the top arc's and the ground's crests. */
export interface Frame {
  w: number
  h: number
  /** The scale's line, as the sections' chart has it. */
  spine: number
  /** Where the path sets off and where it comes to rest, across. */
  from: number
  to: number
  /** The crests of the top arc and of the ground. */
  top: number
  ground: number
  /** The ground's radius, as a share of the width: the larger, the flatter. */
  bend: number
  /** The planet's centre, across. */
  centre: number
}

export interface Point {
  x: number
  y: number
  /** The direction of travel, in degrees clockwise from the right. */
  angle: number
  /** How far along the path, in px. */
  length: number
}

/** Samples along the path, by the clock. */
const SAMPLES = 480

export interface Plot {
  frame: Frame
  cx: number
  cy: number
  /** The ground's radius, and px a kilometre. */
  r: number
  k: number
  /** An arc at height `km`, from x `a` to x `b`, left to right. */
  arc: (km: number, a: number, b: number) => string
  /** Where the arc at height `km` crosses the vertical at `x`. */
  yAt: (km: number, x: number) => number
  /** The band under the ground, `depth` px deep, from x `a` to x `b`. */
  band: (depth: number, a: number, b: number) => string
  /** The path flown, and its length. */
  d: string
  length: number
  /** Down from where it rests to the ground: the rest of the descent, planned. */
  down: string
  /** Where the capsule is at second `t`. */
  at: (t: number) => Point
  rest: Point
}

export function plot(frame: Frame): Plot {
  const { w, top, ground } = frame
  const k = (ground - top) / TOP_KM
  const r = Math.max(w * frame.bend, 600)
  const cx = frame.centre
  const cy = ground + r
  const radius = (km: number) => r + km * k
  const yAt = (km: number, x: number) => {
    const rr = radius(km)
    const dx = Math.min(Math.abs(x - cx), rr)
    return cy - Math.sqrt(rr * rr - dx * dx)
  }
  const f = (n: number) => n.toFixed(1)
  const arc = (km: number, a: number, b: number) => {
    const rr = radius(km)
    return `M${f(a)} ${f(yAt(km, a))}A${f(rr)} ${f(rr)} 0 0 1 ${f(b)} ${f(yAt(km, b))}`
  }
  const band = (depth: number, a: number, b: number) => {
    const inner = r - depth
    const yIn = (x: number) => cy - Math.sqrt(inner * inner - (x - cx) ** 2)
    return `${arc(0, a, b)}L${f(b)} ${f(yIn(b))}A${f(inner)} ${f(inner)} 0 0 0 ${f(a)} ${f(yIn(a))}Z`
  }

  // The angles about the centre where the path sets off and comes to rest.
  const phi0 = Math.asin((frame.from - cx) / radius(ENTRY_KM))
  const phi1 = Math.asin((frame.to - cx) / radius(REST_KM))
  const xs = new Float64Array(SAMPLES + 1)
  const ys = new Float64Array(SAMPLES + 1)
  const ls = new Float64Array(SAMPLES + 1)
  let d = ''
  for (let i = 0; i <= SAMPLES; i++) {
    const t = (i / SAMPLES) * AT.settled
    const phi = phi0 + (phi1 - phi0) * rangeAt(t)
    const rr = radius(altitudeAt(t))
    xs[i] = cx + rr * Math.sin(phi)
    ys[i] = cy - rr * Math.cos(phi)
    if (i > 0) ls[i] = ls[i - 1]! + Math.hypot(xs[i]! - xs[i - 1]!, ys[i]! - ys[i - 1]!)
    d += `${i ? 'L' : 'M'}${f(xs[i]!)} ${f(ys[i]!)}`
  }
  const length = ls[SAMPLES]!

  const at = (t: number): Point => {
    const u = (Math.min(Math.max(t, 0), AT.settled) / AT.settled) * SAMPLES
    const i = Math.min(Math.floor(u), SAMPLES - 1)
    const g = u - i
    const x = xs[i]! * (1 - g) + xs[i + 1]! * g
    const y = ys[i]! * (1 - g) + ys[i + 1]! * g
    // The direction over a short stretch either side, so it turns smoothly.
    const a = Math.max(0, i - 2)
    const b = Math.min(SAMPLES, i + 3)
    const angle = (Math.atan2(ys[b]! - ys[a]!, xs[b]! - xs[a]!) * 180) / Math.PI
    return { x, y, angle, length: ls[i]! * (1 - g) + ls[i + 1]! * g }
  }
  const rest = at(AT.settled)
  // Straight down to the ground, toward the planet's centre.
  const toCentre = Math.atan2(cy - rest.y, cx - rest.x)
  const fall = Math.hypot(cx - rest.x, cy - rest.y) - r
  const down = `M${f(rest.x)} ${f(rest.y)}L${f(rest.x + fall * Math.cos(toCentre))} ${f(rest.y + fall * Math.sin(toCentre))}`

  return { frame, cx, cy, r, k, arc, yAt, band, d, length, down, at, rest }
}
