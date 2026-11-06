/*
 * The mark as a solid, for the first screen's sun (gl.ts): the section (LOGO_SECTION, its
 * three faces hollowed to circles, its corners cut) drawn out into a thick
 * piece, the bore through it, every edge rounded a little so it catches the
 * light; and the point, a small ball in the middle of the bore. As plain
 * numbers on the mark's 24 grid, centred on the bore, y up, z toward you.
 */

/** The section's corners, going round as LOGO_SECTION draws them; its faces run 0→1, 2→3 and 4→5, hollowed; 1→2, 3→4 and 5→0 are the cuts. */
const CORNERS = [
  [12.42, 5.53],
  [19.89, 18.47],
  [19.47, 19.2],
  [4.53, 19.2],
  [4.11, 18.47],
  [11.58, 5.53],
] as const
const BORE = [12, 14.4] as const
const BORE_RADIUS = 1.8
const FACE_RADIUS = 15.36
export const POINT_RADIUS = 0.8

/** How thick the piece is, and how round its edges, in grid units. */
export const DEPTH = 3.4
const ROUND = 0.34

type V2 = readonly [number, number]

const sub = (a: V2, b: V2): V2 => [a[0] - b[0], a[1] - b[1]]
const len = (a: V2) => Math.hypot(a[0], a[1])
const unit = (a: V2): V2 => {
  const l = len(a)
  return [a[0] / l, a[1] / l]
}
const dot = (a: V2, b: V2) => a[0] * b[0] + a[1] * b[1]

/** On the grid, centred on the bore and y up. */
const grid = ([x, y]: V2): V2 => [x - BORE[0], BORE[1] - y]

/** A run of the outline: its points, and the solid's outward normal at each. */
interface Run {
  pts: V2[]
  nrm: V2[]
}

/** The middle of the circle that hollows a face from `a` to `b`: beyond it, away from the bore (at 0, 0). */
const hollowOf = (a: V2, b: V2): V2 => {
  const d = sub(b, a)
  const l = len(d)
  const mid: V2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
  let n: V2 = [-d[1] / l, d[0] / l]
  if (dot(n, mid) < 0) n = [-n[0], -n[1]]
  const off = Math.sqrt(FACE_RADIUS ** 2 - (l / 2) ** 2)
  return [mid[0] + n[0] * off, mid[1] + n[1] * off]
}

/** The outline, as runs: a hollowed face in `steps` pieces, then a cut, three times round. */
function outline(steps: number): Run[] {
  const c = CORNERS.map(grid)
  const runs: Run[] = []
  for (let i = 0; i < 6; i++) {
    const a = c[i]!
    const b = c[(i + 1) % 6]!
    if (i % 2 === 0) {
      const h = hollowOf(a, b)
      const a0 = Math.atan2(a[1] - h[1], a[0] - h[0])
      let delta = Math.atan2(b[1] - h[1], b[0] - h[0]) - a0
      if (delta > Math.PI) delta -= 2 * Math.PI
      if (delta < -Math.PI) delta += 2 * Math.PI
      const pts: V2[] = []
      const nrm: V2[] = []
      for (let k = 0; k <= steps; k++) {
        const t = a0 + (delta * k) / steps
        const p: V2 = [h[0] + FACE_RADIUS * Math.cos(t), h[1] + FACE_RADIUS * Math.sin(t)]
        pts.push(k === 0 ? a : k === steps ? b : p)
        // Out of the solid is toward the hollow's middle.
        nrm.push(unit(sub(h, p)))
      }
      runs.push({ pts, nrm })
    } else {
      const d = unit(sub(b, a))
      let n: V2 = [d[1], -d[0]]
      const mid: V2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
      if (dot(n, mid) < 0) n = [-n[0], -n[1]]
      runs.push({ pts: [a, b], nrm: [n, n] })
    }
  }
  return runs
}

/** The bore's wall, as one closed run, clockwise as the outline goes: out of the solid is toward the bore's middle. */
function bore(steps: number, from: number): Run {
  const pts: V2[] = []
  const nrm: V2[] = []
  for (let k = 0; k <= steps; k++) {
    const t = from - (2 * Math.PI * k) / steps
    pts.push([BORE_RADIUS * Math.cos(t), BORE_RADIUS * Math.sin(t)])
    nrm.push([-Math.cos(t), -Math.sin(t)])
  }
  return { pts, nrm }
}

export interface Mesh {
  /** x, y, z and the normal's x, y, z, for each corner. */
  data: Float32Array
  index: Uint16Array
}

class Builder {
  data: number[] = []
  index: number[] = []
  get count() {
    return this.data.length / 6
  }
  vert(x: number, y: number, z: number, nx: number, ny: number, nz: number) {
    this.data.push(x, y, z, nx, ny, nz)
    return this.count - 1
  }
  tri(a: number, b: number, c: number) {
    this.index.push(a, b, c)
  }
  done(): Mesh {
    return { data: new Float32Array(this.data), index: new Uint16Array(this.index) }
  }
}

/** How far in from an edge the flat face begins, at each point of a run: along the normal, or along the mitre where two runs meet at a corner. */
function insets(runs: Run[], closed: boolean): V2[][] {
  return runs.map((run, r) =>
    run.pts.map((p, k) => {
      const n = run.nrm[k]!
      let m = n
      const last = k === run.pts.length - 1
      if (!closed && (k === 0 || last)) {
        const other = k === 0 ? runs[(r + runs.length - 1) % runs.length]! : runs[(r + 1) % runs.length]!
        const on = k === 0 ? other.nrm[other.nrm.length - 1]! : other.nrm[0]!
        m = unit([n[0] + on[0], n[1] + on[1]])
      }
      const k2 = ROUND / dot(m, n)
      return [m[0] * k2, m[1] * k2] as V2
    }),
  )
}

/** A wall round a run, front to back: the front edge rounded over, straight down, the back edge rounded. Its triangles turn outward, counter-clockwise seen from outside, round the outline; round a hole, which goes the same way, they are turned over (`hole`). */
function wall(b: Builder, run: Run, inset: V2[], hole = false) {
  const h = DEPTH / 2
  // The round, in quarters of a right angle: 0 on the face, 1 on the wall.
  const ARC = [0, 1 / 3, 2 / 3, 1]
  const rings: { z: number; s: number; side: 1 | -1 }[] = [
    ...ARC.map((u) => ({ z: h - ROUND + ROUND * Math.cos((u * Math.PI) / 2), s: u, side: 1 as const })),
    ...ARC.slice()
      .reverse()
      .map((u) => ({ z: -(h - ROUND + ROUND * Math.cos((u * Math.PI) / 2)), s: u, side: -1 as const })),
  ]
  const first = b.count
  const per = run.pts.length
  for (const ring of rings) {
    const a = (ring.s * Math.PI) / 2
    for (let k = 0; k < per; k++) {
      const p = run.pts[k]!
      const n = run.nrm[k]!
      const i = inset[k]!
      // From the face's edge (in by the inset) out to the wall, as the round turns.
      const back = 1 - Math.sin(a)
      b.vert(p[0] - i[0] * back, p[1] - i[1] * back, ring.z, n[0] * Math.sin(a), n[1] * Math.sin(a), ring.side * Math.cos(a))
    }
  }
  for (let r = 0; r < rings.length - 1; r++)
    for (let k = 0; k < per - 1; k++) {
      const a = first + r * per + k
      const c = a + per
      if (hole) {
        b.tri(a, c, a + 1)
        b.tri(a + 1, c, c + 1)
      } else {
        b.tri(a, a + 1, c)
        b.tri(a + 1, c + 1, c)
      }
    }
}

/** A flat face, front (+1) or back (-1): the ring between the outline's inner edge and the bore's, stitched by their angle round the middle, its triangles counter-clockwise seen from the side it faces. */
function face(b: Builder, outer: V2[], inner: V2[], side: 1 | -1) {
  const z = (side * DEPTH) / 2
  const o = outer.map((p) => b.vert(p[0], p[1], z, 0, 0, side))
  const i = inner.map((p) => b.vert(p[0], p[1], z, 0, 0, side))
  const angle = (p: V2) => Math.atan2(p[1], p[0])
  const start = angle(outer[0]!)
  const round = (p: V2) => {
    let t = start - angle(p)
    while (t < 0) t += 2 * Math.PI
    while (t >= 2 * Math.PI) t -= 2 * Math.PI
    return t
  }
  // The outline goes round clockwise, as LOGO_SECTION draws it; the bore's points from the same angle the same way.
  const N = outer.length
  const M = inner.length
  // Stitched as seen from behind; turned over for the front.
  const tri = (x: number, y: number, z: number) => (side === 1 ? b.tri(x, z, y) : b.tri(x, y, z))
  const po = (k: number) => (k >= N ? 2 * Math.PI : round(outer[k]!))
  const pi = (k: number) => (k >= M ? 2 * Math.PI : round(inner[k]!))
  let a = 0
  let c = 0
  while (a < N || c < M) {
    if (a < N && (c >= M || po(a + 1) <= pi(c + 1))) {
      tri(o[a]!, o[(a + 1) % N]!, i[c % M]!)
      a++
    } else {
      tri(o[a % N]!, i[(c + 1) % M]!, i[c % M]!)
      c++
    }
  }
}

/** The piece: its faces, its walls round the outline and through the bore. */
export function solid(): Mesh {
  const b = new Builder()
  const runs = outline(28)
  const ins = insets(runs, false)
  runs.forEach((run, r) => wall(b, run, ins[r]!))
  // The outline's inner edge, each corner once.
  const outer: V2[] = []
  runs.forEach((run, r) => run.pts.slice(0, -1).forEach((p, k) => outer.push([p[0] - ins[r]![k]![0], p[1] - ins[r]![k]![1]])))
  const start = Math.atan2(outer[0]![1], outer[0]![0])
  const hole = bore(56, start)
  const holeIn = insets([hole], true)[0]!
  wall(b, hole, holeIn, true)
  const inner: V2[] = hole.pts.slice(0, -1).map((p, k) => [p[0] - holeIn[k]![0], p[1] - holeIn[k]![1]])
  face(b, outer, inner, 1)
  face(b, outer, inner, -1)
  return b.done()
}

/** The point: a small ball, in the middle of the bore. */
export function point(): Mesh {
  const b = new Builder()
  const R = 14
  const S = 20
  for (let i = 0; i <= R; i++) {
    const v = (i / R) * Math.PI
    for (let j = 0; j <= S; j++) {
      const u = (j / S) * 2 * Math.PI
      const n = [Math.sin(v) * Math.cos(u), Math.cos(v), Math.sin(v) * Math.sin(u)] as const
      b.vert(n[0] * POINT_RADIUS, n[1] * POINT_RADIUS, n[2] * POINT_RADIUS, n[0], n[1], n[2])
    }
  }
  for (let i = 0; i < R; i++)
    for (let j = 0; j < S; j++) {
      const a = i * (S + 1) + j
      const c = a + S + 1
      b.tri(a, a + 1, c)
      b.tri(a + 1, c + 1, c)
    }
  return b.done()
}
