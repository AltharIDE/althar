/*
 * Prototype, B: the landing site's terrain, as a map draws it. A heightfield
 * over the whole sheet, made once from smooth noise, quiet at the top and
 * rising into hills toward the foot, where a lake lies with a headland
 * running into it; its contours traced by marching squares, joined into
 * lines, and sorted by how near they come to the words, so the map clears
 * round them as an engraver's would. The water is drawn as old maps draw
 * it: the shore, and lines inside it following the shore, wider apart as
 * they go out. Pure: it takes sizes and boxes, and gives SVG paths.
 */

/** A box the map keeps clear of: the words. */
export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

export interface TerrainInput {
  width: number
  height: number
  /** Where the lake lies, and the headland with the landing mark on its tip. */
  lake: { cx: number; cy: number; rx: number; ry: number }
  mark: { x: number; y: number }
  clear: Box[]
  /** The grid the field is sampled on, in px. */
  step: number
}

/** The map's lines, by how far they keep from the words: full, softened, faint. */
export interface TerrainPaths {
  contour: [string, string, string]
  index: [string, string, string]
  shore: [string, string, string]
  water: [string, string, string]
}

// ---- smooth noise: gradient noise from a fixed shuffle, so the land is the same every time ----

const PERM = (() => {
  const p = Array.from({ length: 256 }, (_, i) => i)
  let s = 0x2f6b1d
  for (let i = 255; i > 0; i--) {
    s = (s * 1664525 + 1013904223) >>> 0
    const j = s % (i + 1)
    ;[p[i], p[j]] = [p[j]!, p[i]!]
  }
  return Uint8Array.from([...p, ...p])
})()

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10)
const grad = (h: number, x: number, y: number) => {
  switch (h & 7) {
    case 0:
      return x + y
    case 1:
      return -x + y
    case 2:
      return x - y
    case 3:
      return -x - y
    case 4:
      return x
    case 5:
      return -x
    case 6:
      return y
    default:
      return -y
  }
}

function noise(x: number, y: number) {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = x - xi
  const yf = y - yi
  const X = xi & 255
  const Y = yi & 255
  const u = fade(xf)
  const v = fade(yf)
  const aa = PERM[PERM[X]! + Y]!
  const ab = PERM[PERM[X]! + Y + 1]!
  const ba = PERM[PERM[X + 1]! + Y]!
  const bb = PERM[PERM[X + 1]! + Y + 1]!
  const x1 = grad(aa, xf, yf) + u * (grad(ba, xf - 1, yf) - grad(aa, xf, yf))
  const x2 = grad(ab, xf, yf - 1) + u * (grad(bb, xf - 1, yf - 1) - grad(ab, xf, yf - 1))
  return (x1 + v * (x2 - x1)) * 0.7
}

/** Four octaves, each turned a little against the last so no grid shows. */
function fbm(x: number, y: number) {
  let sum = 0
  let amp = 0.55
  for (let o = 0; o < 4; o++) {
    sum += amp * noise(x, y)
    const nx = x * 1.6 - y * 1.2
    y = x * 1.2 + y * 1.6 + 17.3
    x = nx + 3.1
    amp *= 0.5
  }
  return sum
}

// ---- marching squares: the segments where a field crosses a level, in a grid `cols` by `rows` ----

type Emit = (x1: number, y1: number, x2: number, y2: number, level: number) => void

function march(
  f: Float32Array,
  cols: number,
  rows: number,
  step: number,
  levels: (lo: number, hi: number) => Iterable<number>,
  emit: Emit,
) {
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const a = f[j * cols + i]!
      const b = f[j * cols + i + 1]!
      const c = f[(j + 1) * cols + i + 1]!
      const d = f[(j + 1) * cols + i]!
      const lo = Math.min(a, b, c, d)
      const hi = Math.max(a, b, c, d)
      const x = i * step
      const y = j * step
      for (const level of levels(lo, hi)) {
        const k = (a > level ? 8 : 0) | (b > level ? 4 : 0) | (c > level ? 2 : 0) | (d > level ? 1 : 0)
        if (k === 0 || k === 15) continue
        // Where the level crosses each edge: top, right, bottom, left.
        const t = () => [x + ((level - a) / (b - a)) * step, y] as const
        const r = () => [x + step, y + ((level - b) / (c - b)) * step] as const
        const bo = () => [x + ((level - d) / (c - d)) * step, y + step] as const
        const l = () => [x, y + ((level - a) / (d - a)) * step] as const
        const seg = (p: readonly [number, number], q: readonly [number, number]) => emit(p[0], p[1], q[0], q[1], level)
        switch (k) {
          case 1:
          case 14:
            seg(l(), bo())
            break
          case 2:
          case 13:
            seg(bo(), r())
            break
          case 3:
          case 12:
            seg(l(), r())
            break
          case 4:
          case 11:
            seg(t(), r())
            break
          case 6:
          case 9:
            seg(t(), bo())
            break
          case 7:
          case 8:
            seg(l(), t())
            break
          case 5:
          case 10: {
            // A saddle: settled by the cell's middle.
            const mid = (a + b + c + d) / 4 > level
            if ((k === 5) === mid) {
              seg(l(), t())
              seg(bo(), r())
            } else {
              seg(t(), r())
              seg(l(), bo())
            }
            break
          }
        }
      }
    }
  }
}

/** Segments joined end to end into lines, written as one SVG path. */
function joined(segs: number[]) {
  const key = (x: number, y: number) => `${Math.round(x * 4)},${Math.round(y * 4)}`
  const ends = new Map<string, number[]>()
  const n = segs.length / 4
  for (let s = 0; s < n; s++) {
    for (const e of [0, 1]) {
      const k = key(segs[s * 4 + e * 2]!, segs[s * 4 + e * 2 + 1]!)
      const list = ends.get(k)
      if (list) list.push(s * 2 + e)
      else ends.set(k, [s * 2 + e])
    }
  }
  const used = new Uint8Array(n)
  const out: string[] = []
  const pt = (s: number, e: number) => [segs[s * 4 + e * 2]!, segs[s * 4 + e * 2 + 1]!] as const
  const f = (v: number) => (Math.round(v * 10) / 10).toString()
  for (let s0 = 0; s0 < n; s0++) {
    if (used[s0]) continue
    used[s0] = 1
    // Walk on from each end, then put the two halves together.
    const walk = (s: number, e: number) => {
      const pts: (readonly [number, number])[] = []
      let cs = s
      let ce = e
      for (;;) {
        const p = pt(cs, ce)
        const next = ends.get(key(p[0], p[1]))?.find((id) => !used[id >> 1])
        if (next === undefined) break
        cs = next >> 1
        used[cs] = 1
        ce = (next & 1) ^ 1
        pts.push(pt(cs, ce))
      }
      return pts
    }
    const forward = walk(s0, 1)
    const back = walk(s0, 0)
    const line = [...back.reverse(), pt(s0, 0), pt(s0, 1), ...forward]
    out.push(
      `M${f(line[0]![0])} ${f(line[0]![1])}` +
        line
          .slice(1)
          .map(([x, y]) => `L${f(x)} ${f(y)}`)
          .join(''),
    )
  }
  return out.join('')
}

/** How far a point is from the nearest box: 0 inside one. */
function clearance(x: number, y: number, boxes: Box[]) {
  let best = Infinity
  for (const b of boxes) {
    const dx = Math.max(b.left - x, 0, x - b.right)
    const dy = Math.max(b.top - y, 0, y - b.bottom)
    const d = Math.hypot(dx, dy)
    if (d < best) best = d
  }
  return best
}

/** Which of the three strengths a line has at a point, or -1 where it is cleared away. */
const band = (c: number) => (c < 16 ? -1 : c < 46 ? 2 : c < 100 ? 1 : 0)

export function terrain({ width, height, lake, mark, clear, step }: TerrainInput): TerrainPaths {
  const cols = Math.ceil(width / step) + 1
  const rows = Math.ceil(height / step) + 1
  const land = new Float32Array(cols * rows)
  const water = new Float32Array(cols * rows)
  const S = 470
  for (let j = 0; j < rows; j++) {
    const y = j * step
    // Measured up from the foot, so the land by the landing site keeps its shape whatever is above it.
    const up = height - y
    const deep = 1 - up / height
    // Quiet ground at the top; hills rising toward the foot.
    const amp = 1.25 + 9.5 * Math.pow(Math.max(0, deep), 2.1)
    for (let i = 0; i < cols; i++) {
      const x = i * step
      const wx = x / S + 0.35 * fbm(x / 900 + 11, up / 900)
      const wy = up / S + 0.35 * fbm(x / 900 - 7, up / 900 + 5)
      land[j * cols + i] = amp * fbm(wx, wy)
      // The lake: inside an ellipse, its shore made irregular, less a headland running up into it from the south shore to the mark.
      const ex = (x - lake.cx) / lake.rx
      const ey = (y - lake.cy) / lake.ry
      const head =
        1.25 * Math.exp(-(((x - mark.x) / 44) ** 2) - ((y - mark.y - 70) / 82) ** 2) +
        0.9 * Math.exp(-(((x - mark.x - 18) / 60) ** 2) - ((y - mark.y - 150) / 70) ** 2)
      water[j * cols + i] = 1 - Math.hypot(ex, ey) + 0.16 * fbm(x / 160 + 40, y / 160 - 12) - head
    }
  }

  // The land's contours, every level, every fifth an index contour; none on the water or near the shore.
  const contour: number[][] = [[], [], []]
  const index: number[][] = [[], [], []]
  const ints = function* (lo: number, hi: number) {
    for (let l = Math.ceil(lo); l <= Math.floor(hi); l++) yield l + 1e-4
  }
  march(land, cols, rows, step, ints, (x1, y1, x2, y2, level) => {
    const mx = (x1 + x2) / 2
    const my = (y1 + y2) / 2
    const i = Math.min(cols - 1, Math.round(mx / step))
    const j = Math.min(rows - 1, Math.round(my / step))
    if (water[j * cols + i]! > -0.05) return
    const b = band(clearance(mx, my, clear))
    if (b < 0) return
    ;(Math.abs(Math.round(level)) % 5 === 0 ? index : contour)[b]!.push(x1, y1, x2, y2)
  })

  // The water: its shore, and the lines inside it, closer by the shore.
  const shore: number[][] = [[], [], []]
  const wlines: number[][] = [[], [], []]
  const WATER = [0.07, 0.15, 0.25, 0.38, 0.54]
  march(
    water,
    cols,
    rows,
    step,
    function* (lo, hi) {
      if (lo < 0 && hi > 0) yield 0
      for (const l of WATER) if (lo < l && hi > l) yield l
    },
    (x1, y1, x2, y2, level) => {
      const b = band(clearance((x1 + x2) / 2, (y1 + y2) / 2, clear))
      if (b < 0) return
      ;(level === 0 ? shore : wlines)[b]!.push(x1, y1, x2, y2)
    },
  )
  return {
    contour: contour.map(joined) as TerrainPaths['contour'],
    index: index.map(joined) as TerrainPaths['index'],
    shore: shore.map(joined) as TerrainPaths['shore'],
    water: wlines.map(joined) as TerrainPaths['water'],
  }
}
