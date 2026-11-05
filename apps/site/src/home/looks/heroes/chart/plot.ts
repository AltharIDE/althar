import { altitudeAt, AT, velocityAt } from '../../../hero/journey'

/*
 * The re-entry, plotted: a cross-section of the air over the planet, drawn
 * about its centre far below the first screen. The ground is the limb, a
 * great arc low on the sheet; the air's heights are arcs about the same
 * centre; the capsule's path runs through them by the journey's own clock,
 * its height the altimeter's (altitudeAt) and its distance along the planet
 * what its speed has carried it (velocityAt, summed). So the path is today's
 * readouts, drawn: a long shallow run high in the air while it is fast, then
 * the turn down once it has shed its speed, coming to rest at 38 km.
 */

/** The heights drawn as arcs, in km, top down; the ground is the limb. */
export const ARCS = [120, 100, 80, 60, 40, 20] as const
/** The plot's top, a little over where the capsule enters the air. */
export const TOP_KM = 126
/** Where the capsule enters the air and where it comes to rest, in km; its speed there, in km/s. */
export const ENTRY_KM = altitudeAt(AT.open)
export const REST_KM = altitudeAt(AT.settled)
export const REST_SPEED = velocityAt(AT.settled)

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

/** Where the plot stands on the sheet, in px. */
export interface Frame {
  w: number
  h: number
  /** Where the path sets off and where it comes to rest, across. */
  from: number
  to: number
  /** The crests of the plot's top and of the ground. */
  top: number
  ground: number
  /** The planet's centre, across, and the ground's radius. */
  centre: number
  radius: number
}

/** Samples along the path, by the clock. */
const SAMPLES = 480

export interface Plot {
  frame: Frame
  /** Px a kilometre. */
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
  /** Where it sets off and where it rests. */
  entry: { x: number; y: number }
  rest: { x: number; y: number }
  /** Down from where it rests to the ground, toward the planet's centre: the rest of the descent, still to fly. */
  down: string
}

const f = (n: number) => n.toFixed(1)

export function plot(frame: Frame): Plot {
  const { top, ground, centre: cx, radius: r } = frame
  const k = (ground - top) / TOP_KM
  const cy = ground + r
  const radius = (km: number) => r + km * k
  const yAt = (km: number, x: number) => {
    const rr = radius(km)
    const dx = Math.min(Math.abs(x - cx), rr)
    return cy - Math.sqrt(rr * rr - dx * dx)
  }
  const arc = (km: number, a: number, b: number) => {
    const rr = radius(km)
    return `M${f(a)} ${f(yAt(km, a))}A${f(rr)} ${f(rr)} 0 0 1 ${f(b)} ${f(yAt(km, b))}`
  }
  const band = (depth: number, a: number, b: number) => {
    const inner = r - depth
    const yIn = (x: number) => cy - Math.sqrt(inner * inner - (x - cx) ** 2)
    return `${arc(0, a, b)}L${f(b)} ${f(yIn(b))}A${f(inner)} ${f(inner)} 0 0 0 ${f(a)} ${f(yIn(a))}Z`
  }

  // The angles about the centre where the path sets off and comes to rest; it may run either way.
  const phi0 = Math.asin((frame.from - cx) / radius(ENTRY_KM))
  const phi1 = Math.asin((frame.to - cx) / radius(REST_KM))
  let d = ''
  let length = 0
  let px = 0
  let py = 0
  for (let i = 0; i <= SAMPLES; i++) {
    const t = (i / SAMPLES) * AT.settled
    const phi = phi0 + (phi1 - phi0) * rangeAt(t) ** SHAPE
    const rr = radius(altitudeAt(t))
    const x = cx + rr * Math.sin(phi)
    const y = cy - rr * Math.cos(phi)
    if (i > 0) length += Math.hypot(x - px, y - py)
    d += `${i ? 'L' : 'M'}${f(x)} ${f(y)}`
    px = x
    py = y
  }
  const entry = { x: frame.from, y: yAt(ENTRY_KM, frame.from) }
  const rest = { x: px, y: py }
  // Straight down to the ground, toward the planet's centre.
  const toCentre = Math.atan2(cy - rest.y, cx - rest.x)
  const fall = Math.hypot(cx - rest.x, cy - rest.y) - r
  const down = `M${f(rest.x)} ${f(rest.y)}L${f(rest.x + fall * Math.cos(toCentre))} ${f(rest.y + fall * Math.sin(toCentre))}`

  return { frame, k, arc, yAt, band, d, length, entry, rest, down }
}
