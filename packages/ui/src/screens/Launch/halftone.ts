/*
 * The mark as a halftone, as the README prints it (brand/banners/printed.html):
 * a lattice turned 15° about the section's middle, a dot wherever the lattice
 * falls in the section and out of the bore, each as big as the section is
 * dark there, lit from the upper left, so the top tip is pale and the base
 * heavy. The lattice is coarser than the README's, so it holds at the
 * launch's size. In the mark's 24 grid (foundations/Logo).
 */

export interface Point {
  readonly x: number
  readonly y: number
}

/** The section's corners, going round as LOGO_SECTION draws it; its faces run 0→1, 2→3 and 4→5, hollowed. */
const CORNERS: ReadonlyArray<Point> = [
  { x: 12.42, y: 5.53 },
  { x: 19.89, y: 18.47 },
  { x: 19.47, y: 19.2 },
  { x: 4.53, y: 19.2 },
  { x: 4.11, y: 18.47 },
  { x: 11.58, y: 5.53 },
]
export const BORE: Point = { x: 12, y: 14.4 }
export const BORE_RADIUS = 1.8
/** The point, solid in the bore, as large as the README prints it. */
export const POINT_RADIUS = 1.05
const FACE_RADIUS = 15.36

/** The middle of the circle that hollows the face from `from` to `to`: beyond it, away from the bore. */
const hollowOf = (from: Point, to: Point): Point => {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const length = Math.hypot(dx, dy)
  const middle = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }
  let normal = { x: -dy / length, y: dx / length }
  if (normal.x * (middle.x - BORE.x) + normal.y * (middle.y - BORE.y) < 0) normal = { x: -normal.x, y: -normal.y }
  const off = Math.sqrt(FACE_RADIUS * FACE_RADIUS - (length / 2) ** 2)
  return { x: middle.x + normal.x * off, y: middle.y + normal.y * off }
}
const HOLLOWS = [0, 2, 4].map((i) => hollowOf(CORNERS[i]!, CORNERS[i + 1]!))

/** Whether a point of the grid is in the section: in its corners' outline, out of each face's hollow, and out of the bore. */
export const inSection = (x: number, y: number) => {
  for (let i = 0; i < CORNERS.length; i++) {
    const a = CORNERS[i]!
    const b = CORNERS[(i + 1) % CORNERS.length]!
    // The corners go round clockwise on screen: inside is to the right of each edge.
    if ((b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x) < 0) return false
  }
  if (HOLLOWS.some((o) => Math.hypot(x - o.x, y - o.y) < FACE_RADIUS)) return false
  return Math.hypot(x - BORE.x, y - BORE.y) > BORE_RADIUS
}

export interface Dot {
  readonly x: number
  readonly y: number
  /** Its radius once set, in grid units. */
  readonly r: number
  /** How far down the section it is, 0 at the top tip to 1 at the base. */
  readonly down: number
  /** The same small unevenness every time, three ways, 0 to 1. */
  readonly jitter: readonly [number, number, number]
}

/** 0 to 1, the same every time, for `i` and a stream `n`. */
export const jitterOf = (i: number, n = 0) => {
  const v = Math.sin(i * 12.9898 + n * 78.233 + 4.1) * 43758.5453
  return v - Math.floor(v)
}

export const halftone = (pitch = 0.5): ReadonlyArray<Dot> => {
  const angle = (15 * Math.PI) / 180
  const ca = Math.cos(angle)
  const sa = Math.sin(angle)
  const reach = Math.ceil(10.5 / pitch) + 2
  const dots: Array<Dot> = []
  for (let a = -reach; a < reach; a++)
    for (let b = -reach; b < reach; b++) {
      const x = 12 + (a * ca - b * sa) * pitch
      const y = 12.9 + (a * sa + b * ca) * pitch
      if (!inSection(x, y)) continue
      const tone = Math.min(1, Math.max(0.06, ((y - 5.5) / 13.7) * 0.78 + (Math.abs(x - 12) / 8) * 0.18 + ((x - 12) / 8) * 0.1))
      const i = dots.length
      dots.push({
        x,
        y,
        r: (pitch / 2) * Math.sqrt(tone) * 1.08,
        down: Math.min(1, Math.max(0, (y - 5.5) / 13.7)),
        jitter: [jitterOf(i, 0), jitterOf(i, 1), jitterOf(i, 2)],
      })
    }
  return dots
}

export const DOTS = halftone()

/** The point's particles: where each starts, round the bore. */
export const PARTICLES: ReadonlyArray<{ readonly angle: number; readonly far: number }> = Array.from({ length: 11 }, (_, i) => ({
  angle: jitterOf(i, 5) * Math.PI * 2,
  far: 3.2 + jitterOf(i, 6) * 2.4,
}))
