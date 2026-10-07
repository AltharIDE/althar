/*
 * The drawing the launch builds the mark from, in the mark's own 24 grid
 * (foundations/Logo): the three straight sides its faces are hollowed from,
 * run on as far as the window goes; the three circles that hollow them, as a
 * compass would draw them; and a scale along each side, as on the ruler the
 * mark is a section of. All of it follows from the mark's corners and the
 * radius of its faces, so it can't drift from the mark.
 */

export interface Point {
  readonly x: number
  readonly y: number
}

/** The bore's middle, where the point is set: the section's centroid. */
export const BORE: Point = { x: 12, y: 14.4 }
export const BORE_RADIUS = 1.8
export const POINT_RADIUS = 0.8
/** How deep each face is hollowed: the radius of the circle it is cut by. */
export const FACE_RADIUS = 15.36
/** The section's extent, top to bottom, for placing it. */
export const TOP = 5.53
export const BOTTOM = 19.2

/** Each face as LOGO_SECTION draws it, from where it starts to where it ends, sweeping the same way. */
export const FACES: ReadonlyArray<readonly [Point, Point]> = [
  [
    { x: 12.42, y: 5.53 },
    { x: 19.89, y: 18.47 },
  ],
  [
    { x: 19.47, y: 19.2 },
    { x: 4.53, y: 19.2 },
  ],
  [
    { x: 4.11, y: 18.47 },
    { x: 11.58, y: 5.53 },
  ],
]

/** One side of the section: the straight line its face is hollowed from, which way is out, and the circle that hollows it. */
export interface Side {
  readonly from: Point
  readonly to: Point
  /** Halfway along the face. */
  readonly middle: Point
  /** Along the side, from `from` to `to`, one unit long. */
  readonly along: Point
  /** Away from the bore, one unit long: where the scale's marks stand. */
  readonly out: Point
  /** The middle of the circle that hollows the face, beyond the side. */
  readonly centre: Point
}

const sideOf = ([from, to]: readonly [Point, Point]): Side => {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const length = Math.hypot(dx, dy)
  const along = { x: dx / length, y: dy / length }
  const middle = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }
  const normal = { x: -along.y, y: along.x }
  const away = normal.x * (middle.x - BORE.x) + normal.y * (middle.y - BORE.y) > 0 ? 1 : -1
  const out = { x: normal.x * away, y: normal.y * away }
  // The circle stands off the side by as much as its radius leaves over the half chord.
  const off = Math.sqrt(FACE_RADIUS * FACE_RADIUS - (length / 2) * (length / 2))
  return { from, to, middle, along, out, centre: { x: middle.x + out.x * off, y: middle.y + out.y * off } }
}

export const SIDES: ReadonlyArray<Side> = FACES.map(sideOf)

/** A side turned about the bore by `angle` radians, as a blade of an iris turns about its middle. */
export const turned = (side: Side, angle: number): Side => {
  if (angle === 0) return side
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const turn = (p: Point): Point => ({
    x: BORE.x + (p.x - BORE.x) * cos - (p.y - BORE.y) * sin,
    y: BORE.y + (p.x - BORE.x) * sin + (p.y - BORE.y) * cos,
  })
  const spin = (v: Point): Point => ({ x: v.x * cos - v.y * sin, y: v.x * sin + v.y * cos })
  return {
    from: turn(side.from),
    to: turn(side.to),
    middle: turn(side.middle),
    along: spin(side.along),
    out: spin(side.out),
    centre: turn(side.centre),
  }
}

const n = (value: number) => Number(value.toFixed(3))

/** A side's line, `reach` units each way from its middle. */
export const sideLine = (side: Side, reach: number) =>
  `M${n(side.middle.x - side.along.x * reach)} ${n(side.middle.y - side.along.y * reach)}L${n(side.middle.x + side.along.x * reach)} ${n(side.middle.y + side.along.y * reach)}`

/** The whole circle that hollows a side, starting where its face starts and going the way the face goes. */
export const faceCircle = (side: Side) => {
  const r = FACE_RADIUS
  const opposite = { x: 2 * side.centre.x - side.from.x, y: 2 * side.centre.y - side.from.y }
  return `M${n(side.from.x)} ${n(side.from.y)}A${r} ${r} 0 1 0 ${n(opposite.x)} ${n(opposite.y)}A${r} ${r} 0 1 0 ${n(side.from.x)} ${n(side.from.y)}`
}

/** A mark of a side's scale: how far along from its middle, how long, and whether it marks a fifth (and stands out). */
export interface Tick {
  readonly at: number
  readonly length: number
  readonly major: boolean
}

/** The marks between each half unit, out to `reach` either way. */
export const SCALE_STEP = 0.5
export const ticks = (reach: number): ReadonlyArray<Tick> => {
  const count = Math.floor(reach / SCALE_STEP)
  return Array.from({ length: count * 2 + 1 }, (_, index) => {
    const step = index - count
    const length = step % 10 === 0 ? 0.95 : step % 5 === 0 ? 0.6 : 0.32
    return { at: step * SCALE_STEP, length, major: step % 5 === 0 }
  })
}

/** The marks shown so far along one side, as one path: the major or the minor ones, within `shown` units of its middle. */
export const scalePath = (side: Side, marks: ReadonlyArray<Tick>, shown: number, major: boolean) => {
  let d = ''
  for (const mark of marks) {
    if (mark.major !== major || Math.abs(mark.at) > shown) continue
    const x = side.middle.x + side.along.x * mark.at
    const y = side.middle.y + side.along.y * mark.at
    // Stood a little off the line, so the line itself reads clean.
    const start = 0.12
    d += `M${n(x + side.out.x * start)} ${n(y + side.out.y * start)}l${n(side.out.x * mark.length)} ${n(side.out.y * mark.length)}`
  }
  return d
}

/** A circle as a path, for cutting the bore out of what covers it. */
export const circle = (centre: Point, r: number) =>
  r <= 0 ? '' : `M${n(centre.x - r)} ${n(centre.y)}a${n(r)} ${n(r)} 0 1 0 ${n(2 * r)} 0a${n(r)} ${n(r)} 0 1 0 ${n(-2 * r)} 0Z`
