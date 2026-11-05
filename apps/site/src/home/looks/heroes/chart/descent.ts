import { altitudeAt, AT, velocityAt } from '../../../hero/journey'

/*
 * The descent, drawn: a cross-section of the air over the planet, its centre
 * far below the altitude scale, so the scale is a radius and every height an
 * arc about it, level at the scale and falling away to the right. Through it
 * the capsule's path: a body thrown nearly level through air that slows it,
 * under its own weight, so it runs long and shallow while it is fast and
 * turns down ever more steeply as it sheds its speed. It comes to rest in the
 * full stop of "fast.".
 *
 * The sentence hangs from the path where it crosses the air's layers: each
 * piece ends under a station, on a fine leader, and each is larger than the
 * last. The layout is the type's first: where the pieces stand decides where
 * the stations are, and the scale is fitted to them.
 */

/** Where the capsule enters the air and where it comes to rest, in km; its speed at rest, in km/s. */
export const ENTRY_KM = altitudeAt(AT.open)
export const REST_KM = altitudeAt(AT.settled)
export const REST_SPEED = velocityAt(AT.settled)

/** The air's layers, top down, each drawn as an arc where it gives way to the next. */
export const LAYERS = [
  { km: ENTRY_KM, name: 'Entry interface' },
  { km: 100, name: 'Kármán line' },
  { km: 85, name: 'Mesopause' },
  { km: 50, name: 'Stratopause' },
  { km: 12, name: 'Tropopause' },
] as const

export type Pt = readonly [number, number]
export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** The air over the planet: the scale's line, where the ground would cross it, px a km, and the ground's radius. */
export interface Air {
  spine: number
  ground: number
  k: number
  radius: number
}

/** Where the arc at height `km` crosses the vertical at `x`. */
export const yAt = (air: Air, km: number, x: number) => {
  const r = air.radius + km * air.k
  const dx = x - air.spine
  return air.ground + air.radius - Math.sqrt(Math.max(0, r * r - dx * dx))
}

const f = (n: number) => n.toFixed(1)

/** The arc at height `km` from x `a` to x `b`. */
export const arc = (air: Air, km: number, a: number, b: number) => {
  const r = air.radius + km * air.k
  return `M${f(a)} ${f(yAt(air, km, a))}A${f(r)} ${f(r)} 0 0 1 ${f(b)} ${f(yAt(air, km, b))}`
}

/** The air fitted to two heights at two points, its curve given. */
function fit(spine: number, radius: number, one: { km: number; at: Pt }, two: { km: number; at: Pt }): Air {
  let air: Air = { spine, ground: 0, k: 5, radius }
  // The arcs' fall depends a little on the scale, so settle it in a few rounds.
  for (let i = 0; i < 6; i++) {
    const fall = (km: number, x: number) => yAt({ ...air, ground: 0 }, km, x) + km * air.k
    const a = one.at[1] - fall(one.km, one.at[0])
    const b = two.at[1] - fall(two.km, two.at[0])
    const k = (b - a) / (one.km - two.km)
    air = { spine, radius, k, ground: a + one.km * k }
  }
  return air
}

/**
 * A body thrown at `angle` below level, at unit speed against unit weight,
 * through air whose pull grows with the square of its speed (`drag`): its
 * path from (0, 0), y down, until it falls within `steep` degrees of
 * straight down, at the speed the air lets it.
 */
function thrown(angle: number, drag: number, steep: number): Pt[] {
  let x = 0
  let y = 0
  let vx = Math.cos(angle)
  let vy = Math.sin(angle)
  const dt = 1 / 8000
  const limit = Math.tan(((90 - steep) * Math.PI) / 180)
  const out: Pt[] = [[0, 0]]
  for (let i = 1; i < 4_000_000; i++) {
    const v = Math.hypot(vx, vy)
    vx -= drag * v * vx * dt
    vy += (1 - drag * v * vy) * dt
    x += vx * dt
    y += vy * dt
    if (vy >= limit * vx) {
      out.push([x, y])
      break
    }
    if (i % 8 === 0) out.push([x, y])
  }
  return out
}

/** The throw, worked out once: it is the same at every size, only laid differently. */
const THROWS = new Map<string, Pt[]>()
const throwOf = (angle: number, drag: number, steep: number) => {
  const key = `${angle}:${drag}:${steep}`
  let one = THROWS.get(key)
  if (!one) THROWS.set(key, (one = thrown(angle, drag, steep)))
  return one
}

/**
 * The throw laid from `a` to `b`, evenly spaced along its length. A chart's
 * heights are drawn larger than its distances, so it is drawn taller across
 * than it flew; thrown on until it falls within a tenth of a degree of
 * straight down, it still falls straight at its end, past the "t".
 */
function flight(a: Pt, b: Pt, angle: number, drag: number, n = 360): Pt[] {
  const raw = throwOf(angle, drag, 0.1)
  const [ex, ey] = raw[raw.length - 1]!
  const sx = (b[0] - a[0]) / ex
  const sy = (b[1] - a[1]) / ey
  const pts: Pt[] = raw.map(([x, y]) => [a[0] + x * sx, a[1] + y * sy] as const)
  // Evenly along its length, so its line is drawn as finely at the turn as on the level.
  const run = [0]
  for (let i = 1; i < pts.length; i++) run.push(run[i - 1]! + Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]))
  const total = run[run.length - 1]!
  const out: Pt[] = []
  let j = 0
  for (let i = 0; i <= n; i++) {
    const at = (total * i) / n
    while (j < run.length - 2 && run[j + 1]! < at) j++
    const t = (at - run[j]!) / (run[j + 1]! - run[j]! || 1)
    out.push([pts[j]![0] + (pts[j + 1]![0] - pts[j]![0]) * t, pts[j]![1] + (pts[j + 1]![1] - pts[j]![1]) * t])
  }
  return out
}

/** The path's height on the screen at `x`. */
const pathY = (pts: readonly Pt[], x: number) => {
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1]!
    const [x1, y1] = pts[i]!
    if (x1 >= x) return y0 + (y1 - y0) * ((x - x0) / (x1 - x0 || 1))
  }
  return pts[pts.length - 1]![1]
}

/** Where the path first goes under the arc at height `km`. */
const crossing = (air: Air, pts: readonly Pt[], km: number): Pt | null => {
  let last = pts[0]![1] - yAt(air, km, pts[0]![0])
  for (let i = 1; i < pts.length; i++) {
    const [x, y] = pts[i]!
    const now = y - yAt(air, km, x)
    if (last < 0 && now >= 0) {
      const [px, py] = pts[i - 1]!
      const t = last / (last - now)
      return [px + (x - px) * t, py + (y - py) * t]
    }
    last = now
  }
  return null
}

const d = (pts: readonly Pt[]) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${f(x)} ${f(y)}`).join('')

/** A piece of the headline as set: its advance, and its ink above and below the baseline, in px. */
export interface Piece {
  size: number
  w: number
  asc: number
  desc: number
}

/** What the plate is laid from: the sheet, the pieces as set, the title block, and the full stop's ink. */
export interface Measure {
  w: number
  h: number
  /** The scale's line; null on a phone, which has none. */
  spine: number | null
  /** The sheet's content edges. */
  left: number
  right: number
  /** The top of the room under the nav and the bar over the sheet. */
  top: number
  pieces: readonly [Piece, Piece, Piece]
  /** The full stop's ink in "fast.", from its origin and baseline: its middle across, its top above the baseline. */
  stop: { mid: number; top: number; half: number }
  /** The title block, laid by its own CSS. */
  block: Box
  /** A label's width, in px, for its words. */
  label: (words: string) => number
}

export interface Station {
  km: number
  at: Pt
}

export interface Label {
  x: number
  y: number
  lines: string[]
}

export interface Plate {
  w: number
  h: number
  phone: boolean
  air: Air
  spine: number | null
  /** The path flown, and the rest of the way down still to fly. */
  flown: string
  /** The pieces: where each one's left edge and baseline stand. */
  set: { x: number; base: number }[]
  /** Each piece's ink, padded: where the arcs break for it. */
  holes: Box[]
  stations: Station[]
  /** The leaders, from a station down to the piece it holds. */
  leaders: string
  /** Each layer's arc, across the sheet, and its name at the margin. */
  arcs: { km: number; d: string }[]
  labels: Label[]
  /** The capsule at rest: the full stop's top, and its reading beside it. */
  rest: Pt
  reading: { x: number; y: number; anchor: 'start' | 'end' }
}

/** A layer's name and height, on one line or, where the room is narrow, two. */
const named = (layer: (typeof LAYERS)[number]) => [layer.name.toUpperCase(), `${layer.km.toFixed(0)} KM`]

/** The sheet at a desktop's width: the path over the whole of it, the pieces hanging under it in a falling line, the title block under its level part. */
function wide(m: Measure): Plate {
  const { w, h, left, right, pieces } = m
  const spine = m.spine ?? 0
  const u = Math.min(w / 1280, h / 800)
  const [p1, p2, p3] = pieces
  // How far a piece hangs under its station, and how far short of its leader it ends.
  const hang = Math.round(16 * u)
  const short = Math.round(13 * u)

  // "fast." at the foot, flush on the title block's foot, its full stop the capsule's rest; room at its right for the layers' names.
  const base3 = m.block.y + m.block.h
  const x3 = Math.max(m.block.x + m.block.w + 48 * u, right - Math.round(116 * u) - p3.w)
  const rest: Pt = [x3 + m.stop.mid, base3 - m.stop.top]

  // The path sets off at the scale, high, and is thrown nearly level to the full stop.
  const start: Pt = [spine, Math.round(m.top + 44 * u)]
  // Falling straight for the last of the way, past the "t", at the speed the air lets it.
  const pts = flight(start, rest, p3.size * 0.78, 0.03, 1)

  // "Building software" on the sheet's left edge, its station where it ends: where the capsule enters the air.
  const x1 = left
  const s1x = x1 + p1.w + short
  const s1: Pt = [s1x, pathY(pts, s1x)]
  const radius = Math.max(3.4 * w, 3600)
  const air = fit(spine, radius, { km: ENTRY_KM, at: s1 }, { km: REST_KM, at: rest })
  const base1 = Math.round(s1[1] + hang + p1.asc)

  // "has never felt so" under the Kármán line's station.
  const s2 = crossing(air, pts, 100) ?? s1
  const x2 = s2[0] - short - p2.w
  const base2 = Math.round(s2[1] + hang + p2.asc)

  const stations: Station[] = []
  for (const layer of LAYERS) {
    const at = layer.km === ENTRY_KM ? s1 : crossing(air, pts, layer.km)
    if (at) stations.push({ km: layer.km, at })
  }

  const set = [
    { x: x1, base: base1 },
    { x: x2, base: base2 },
    { x: x3, base: base3 },
  ]
  const pad = Math.round(14 * u)
  const holes = set.map(({ x, base }, i) => ({
    x: x - pad,
    y: base - pieces[i]!.asc - pad,
    w: pieces[i]!.w + 2 * pad,
    h: pieces[i]!.asc + pieces[i]!.desc + 2 * pad,
  }))

  const leaders = [
    [s1, base1],
    [s2, base2],
  ]
    .map(([at, base]) => `M${Math.round((at as Pt)[0]) + 0.5} ${f((at as Pt)[1] + 4)}V${base}`)
    .join('')

  // Each layer named at the margin, over its arc; in two lines where the path or "fast." leaves no room for one.
  const labels: Label[] = []
  for (const layer of LAYERS) {
    const y = yAt(air, layer.km, right) - 8
    if (y > h - 12) continue
    const one = named(layer)
    const line = `${one[0]} · ${one[1]}`
    const room = (lines: string[]) => {
      const width = Math.max(...lines.map(m.label))
      const top = y - (lines.length - 1) * 13 - 9
      const box = { x: right - width, y: top, w: width, h: y - top + 3 }
      const clearOfPath = pts.every(([px, py]) => py < box.y - 10 || py > box.y + box.h + 10 || px < box.x - 14)
      const clearOfType = holes.every((o) => o.x + o.w < box.x || o.y > box.y + box.h || o.y + o.h < box.y)
      return clearOfPath && clearOfType
    }
    if (room([line])) labels.push({ x: right, y, lines: [line] })
    else if (room(one)) labels.push({ x: right, y, lines: one })
  }

  return {
    w,
    h,
    phone: false,
    air,
    spine,
    flown: d(pts),
    set,
    holes,
    stations,
    leaders,
    arcs: LAYERS.map((layer) => ({ km: layer.km, d: arc(air, layer.km, spine, w) })),
    labels,
    rest,
    reading: { x: x3 + p3.w + Math.round(18 * u), y: base3, anchor: 'start' },
  }
}

export function lay(m: Measure): Plate {
  return wide(m)
}

/** The scale's ticks on its line, each on a whole pixel: every km, longer every 5, longest every 10; and its figures every 10. */
export function scale(air: Air, h: number) {
  const out: [string[], string[], string[]] = [[], [], []]
  const figures: { km: number; y: number }[] = []
  for (let km = Math.max(0, Math.ceil((air.ground - h) / air.k)); km <= Math.floor(air.ground / air.k); km++) {
    const y = Math.round(air.ground - km * air.k) + 0.5
    const kind = km % 10 === 0 ? 2 : km % 5 === 0 ? 1 : 0
    out[kind].push(`M${air.spine} ${y}h${[5, 9, 15][kind]}`)
    if (kind === 2) figures.push({ km, y })
  }
  return { ticks: out.map((one) => one.join('')) as [string, string, string], figures }
}
