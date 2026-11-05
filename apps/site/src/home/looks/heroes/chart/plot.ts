import { altitudeAt, AT, velocityAt } from '../../../hero/journey'

/*
 * The re-entry, plotted: a cross-section of the air over the planet, drawn
 * about its centre far below the first screen. The ground is the limb, a
 * great arc low on the sheet; the air's heights are arcs about the same
 * centre; the capsule's path runs through them from where today's
 * altimeter starts, the entry interface, to where it comes to rest. Its
 * shape is today's readouts, summed: the height lost against the way flown
 * downrange at the speed it was going is near a parabola, long and shallow
 * while it is fast, then turning down once it has shed its speed, and
 * falling straight at rest. That parabola is what is drawn, so the path
 * bends rather than breaks.
 */

/** The air's layers, drawn as arcs where one gives way to the next, in km, top down; the ground is the limb. */
export const LAYERS = [
  { km: 100, name: 'Kármán line' },
  { km: 85, name: 'Mesopause' },
  { km: 50, name: 'Stratopause' },
  { km: 12, name: 'Tropopause' },
] as const
/** The scale's figures, every 20 km. */
export const FIGURES = [120, 100, 80, 60, 40, 20, 0] as const
/** The plot's top, a little over where the capsule enters the air. */
export const TOP_KM = 126
/** Where the capsule enters the air and where it comes to rest, in km; its speed there, in km/s. */
export const ENTRY_KM = altitudeAt(AT.open)
export const REST_KM = altitudeAt(AT.settled)
export const REST_SPEED = velocityAt(AT.settled)

/**
 * The share of the way downrange flown by the time a share `a` of the height
 * is lost: 1 − (1 − a)^n. Fitted to the readouts (n near 2.5 lands on them
 * within a few hundredths); a little under, the turn is eased out over the
 * last stretch, where the readouts crowd it into a few pixels.
 */
const SHAPE = 2.1

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

/** Samples along the path. */
const SAMPLES = 240

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
  /** The path flown. */
  d: string
  /** Where it sets off and where it rests. */
  entry: { x: number; y: number }
  rest: { x: number; y: number }
  /** Down from where it rests to the ground, toward the planet's centre: the rest of the descent, still to fly. */
  down: string
  /** Where the path crosses the arc at height `km`, across; null if it never comes to it. */
  crosses: (km: number) => number | null
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
  /** The path where a share `a` of the height is lost. */
  const along = (a: number) => {
    const phi = phi0 + (phi1 - phi0) * (1 - (1 - a) ** SHAPE)
    const rr = radius(ENTRY_KM + (REST_KM - ENTRY_KM) * a)
    return { x: cx + rr * Math.sin(phi), y: cy - rr * Math.cos(phi) }
  }
  let d = ''
  let x = 0
  let y = 0
  for (let i = 0; i <= SAMPLES; i++) {
    ;({ x, y } = along(i / SAMPLES))
    d += `${i ? 'L' : 'M'}${f(x)} ${f(y)}`
  }
  const crosses = (km: number) => (km > ENTRY_KM || km < REST_KM ? null : along((ENTRY_KM - km) / (ENTRY_KM - REST_KM)).x)
  const entry = { x: frame.from, y: yAt(ENTRY_KM, frame.from) }
  const rest = { x, y }
  // Straight down to the ground, toward the planet's centre.
  const toCentre = Math.atan2(cy - rest.y, cx - rest.x)
  const fall = Math.hypot(cx - rest.x, cy - rest.y) - r
  const down = `M${f(rest.x)} ${f(rest.y)}L${f(rest.x + fall * Math.cos(toCentre))} ${f(rest.y + fall * Math.sin(toCentre))}`

  return { frame, k, arc, yAt, band, d, entry, rest, down, crosses }
}
