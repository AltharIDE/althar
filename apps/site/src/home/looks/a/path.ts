/*
 * Prototype, A: the descent's path through the chart. It runs down a lane
 * beside the sheets, crosses the page in a long S between one sheet and the
 * next, from the left lane to the right and back, and at the end flares onto
 * the zero line, level as it touches down. Its height on the page is its
 * altitude, so it only ever goes down: any height has one point on it.
 */

export type Pt = readonly [number, number]

type Piece = { a: Pt; c1: Pt; c2: Pt; b: Pt }

/** A sheet: the height of its top rule, and of the foot of what it shows. */
export interface Stop {
  rule: number
  foot: number
}

export interface Plan {
  /** Where it starts: the scale's top. */
  start: number
  /** The lanes beside the sheets: the left one, the right one. */
  left: number
  right: number
  stops: readonly Stop[]
  /** The zero line, and where along it the path touches down. */
  zero: number
  land: number
}

export interface Path {
  d: string
  length: number
  /** Where it crosses each sheet's top rule. */
  stations: Pt[]
  /** Where it touches down. */
  touchdown: Pt
  /** At height `y`: how far along it is, and where across. */
  at: (y: number) => { length: number; x: number }
}

/** How far below a sheet's foot it leaves the lane, and how far below the next sheet's rule it is down the other: the rule's words start further down. */
const LEAVE = 20
const ARRIVE = 16
/** How long the S's ends run straight down before they turn, as a share of its height. */
const TURN = 0.4
/** How far the lane drifts across, either way, down a sheet. */
const DRIFT = 9

const cubic = (p: Piece, t: number): Pt => {
  const u = 1 - t
  const k0 = u * u * u
  const k1 = 3 * u * u * t
  const k2 = 3 * u * t * t
  const k3 = t * t * t
  return [k0 * p.a[0] + k1 * p.c1[0] + k2 * p.c2[0] + k3 * p.b[0], k0 * p.a[1] + k1 * p.c1[1] + k2 * p.c2[1] + k3 * p.b[1]]
}

/** A run down a lane: drifting a little across and back, as a path flown is never ruled straight. */
const run = (a: Pt, b: Pt, drift: number): Piece => {
  const h = b[1] - a[1]
  return { a, c1: [a[0] + drift, a[1] + h * 0.35], c2: [b[0] - drift, b[1] - h * 0.35], b }
}

/** An S from one lane to the other, leaving and arriving straight down. */
const swing = (a: Pt, b: Pt): Piece => {
  const h = b[1] - a[1]
  return { a, c1: [a[0], a[1] + h * TURN], c2: [b[0], b[1] - h * TURN], b }
}

export function plot(plan: Plan): Path {
  const pieces: Piece[] = []
  const lane = (side: number) => (side ? plan.right : plan.left)
  let side = 0
  let at: Pt = [plan.left, plan.start]
  plan.stops.forEach((stop, i) => {
    const x = lane(side)
    // Down the lane, past the sheet's rule, to below its foot.
    const foot: Pt = [x, stop.foot + LEAVE]
    pieces.push(run(at, foot, side ? -DRIFT : DRIFT))
    at = foot
    const next = plan.stops[i + 1]
    if (next) {
      side ^= 1
      const into: Pt = [lane(side), next.rule + ARRIVE]
      pieces.push(swing(at, into))
      at = into
    }
  })
  // The flare: down out of the lane, then level as it meets the ground.
  const touchdown: Pt = [plan.land, plan.zero]
  const h = touchdown[1] - at[1]
  const dx = touchdown[0] - at[0]
  pieces.push({ a: at, c1: [at[0], at[1] + h * 0.8], c2: [touchdown[0] - dx * 0.6, touchdown[1]], b: touchdown })

  // Sampled, for finding the point at a height.
  const ys: number[] = []
  const xs: number[] = []
  const ls: number[] = []
  let length = 0
  let last: Pt | null = null
  for (const piece of pieces) {
    for (let k = last ? 1 : 0; k <= 64; k++) {
      const p = cubic(piece, k / 64)
      if (last) length += Math.hypot(p[0] - last[0], p[1] - last[1])
      ys.push(p[1])
      xs.push(p[0])
      ls.push(length)
      last = p
    }
  }
  const f = (n: number) => n.toFixed(1)
  const d = pieces
    .map(
      (p, i) =>
        `${i ? '' : `M${f(p.a[0])} ${f(p.a[1])}`}C${f(p.c1[0])} ${f(p.c1[1])} ${f(p.c2[0])} ${f(p.c2[1])} ${f(p.b[0])} ${f(p.b[1])}`,
    )
    .join('')

  const pointAt = (y: number) => {
    if (y <= ys[0]!) return { length: 0, x: xs[0]! }
    const n = ys.length - 1
    if (y >= ys[n]!) return { length, x: xs[n]! }
    let lo = 0
    let hi = n
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (ys[mid]! <= y) lo = mid
      else hi = mid
    }
    const span = ys[hi]! - ys[lo]!
    const t = span > 0 ? (y - ys[lo]!) / span : 0
    return { length: ls[lo]! + (ls[hi]! - ls[lo]!) * t, x: xs[lo]! + (xs[hi]! - xs[lo]!) * t }
  }
  // Its stations: where it crosses each sheet's rule.
  const stations: Pt[] = plan.stops.map((stop) => [pointAt(stop.rule).x, stop.rule])
  return { d, length, stations, touchdown, at: pointAt }
}
