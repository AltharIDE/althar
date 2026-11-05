/*
 * The streak: the person's picture (field.webp) redrawn as one sweep of
 * light, its edge a clear diagonal rising to the right. Above the edge the
 * night, with a little of the light spilling into it; below, the light,
 * from its own colour at the edge to pink and near-white in the far corner,
 * cobalt to the left and pink to the right as in the picture.
 *
 * Each cell takes one of nine inks along its hue's ramp by an 8×8 Bayer
 * threshold, so every tone is made of square dots. It is drawn at the
 * screen's own pixels, a whole number of them a cell, so the dots stay
 * square and sharp at any size and density; once, and again only when the
 * box changes size. Nothing moves.
 */

/** Where the edge runs and how the light lies, in the box's CSS px. */
export interface Streak {
  /** A point the edge passes through. */
  x: number
  y: number
  /** How steeply the edge rises to the right, in degrees from the horizontal. */
  angle: number
  /** Where along cobalt (0) → violet (0.5) → pink (1) the colour is at the box's left edge, and at its right. */
  hue: readonly [number, number]
  /** A cell's side, in CSS px. */
  cell: number
}

/*
 * Each hue's ramp, night to near-white, read off the person's picture: its
 * cobalt foot on the left, the violet in the middle and the pink and
 * near-white of its lower right. Level 4 is the hue at full.
 */
const RAMPS = [
  [0x000002, 0x01032d, 0x020c6e, 0x0221bb, 0x0340ec, 0x3058f8, 0x6a7ff9, 0xa9b3fb, 0xe2e6fe],
  [0x000002, 0x0c0844, 0x2f1fa6, 0x6a3cee, 0x9a5ff9, 0xbd78fb, 0xdc9cfc, 0xefc8fd, 0xf9e9fe],
  [0x000002, 0x20094a, 0x511b7f, 0x9437ab, 0xde5fd2, 0xfa8ce4, 0xfbaeed, 0xfcc5f5, 0xfcdcf8],
]
const LEVELS = RAMPS[0]!.length
const LAST = LEVELS - 1

/** How finely the hue runs between the ramps. */
const HUES = 64

/** Every ink, by hue step and level, as a canvas pixel (little-endian RGBA). */
const INKS = (() => {
  const out = new Uint32Array(HUES * LEVELS)
  const part = (c: number, shift: number) => (c >> shift) & 0xff
  for (let h = 0; h < HUES; h++) {
    const at = (h / (HUES - 1)) * (RAMPS.length - 1)
    const lo = Math.min(RAMPS.length - 2, Math.floor(at))
    const t = at - lo
    for (let k = 0; k < LEVELS; k++) {
      const a = RAMPS[lo]![k]!
      const b = RAMPS[lo + 1]![k]!
      const mix = (shift: number) => Math.round(part(a, shift) + (part(b, shift) - part(a, shift)) * t)
      out[h * LEVELS + k] = (0xff << 24) | (mix(0) << 16) | (mix(8) << 8) | mix(16)
    }
  }
  return out
})()

/** The 8×8 Bayer matrix, as thresholds between 0 and 1. */
const BAYER = (() => {
  let m = [[0]]
  while (m.length < 8) {
    const n = m.length
    m = Array.from({ length: n * 2 }, (_, y) =>
      Array.from({ length: n * 2 }, (_, x) => 4 * m[y % n]![x % n]! + [0, 2, 3, 1][(y < n ? 0 : 2) + (x < n ? 0 : 1)]!),
    )
  }
  return Float32Array.from(m.flat(), (v) => (v + 0.5) / 64)
})()

const clamp = (v: number) => (v > 1 ? 1 : v > 0 ? v : 0)

/** How bright the light is just inside its edge, and how far it spills over it, as a share of the ramp. */
const EDGE = 0.5
const SPILL = 0.24

/** How much cooler the light is at its edge than deep inside it, along cobalt → pink. */
const COOL = 0.3

/** The light's brightness at signed distance `d` from the edge (positive inside it), `s` of the way to the far corner, at hue `u`. */
const brightness = (d: number, s: number, u: number, reach: number) => {
  if (d < 0) {
    const t = 1 + d / reach
    return t > 0 ? SPILL * t * t : 0
  }
  // Cobalt only ever gets to its own full colour, as in the picture's lower left; the pink end to near-white.
  const top = 0.62 + 0.38 * u
  return EDGE + (top - EDGE) * s ** 0.85
}

/** Draws the streak over the whole of `canvas`, `w` × `h` CSS px at `dpr` device pixels each. */
export function drawStreak(canvas: HTMLCanvasElement, w: number, h: number, dpr: number, streak: Streak) {
  const W = Math.max(1, Math.round(w * dpr))
  const H = Math.max(1, Math.round(h * dpr))
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const img = ctx.createImageData(W, H)
  const out = new Uint32Array(img.data.buffer)
  // A whole number of device pixels a cell, so every cell is the same square.
  const c = Math.max(1, Math.round(streak.cell * dpr))
  const size = c / dpr
  const cols = Math.ceil(W / c)
  const rows = Math.ceil(H / c)
  const rad = (streak.angle * Math.PI) / 180
  // The edge's normal, pointing into the light (down and to the right).
  const nx = Math.sin(rad)
  const ny = Math.cos(rad)
  const depth = Math.max(1, (w - streak.x) * nx + (h - streak.y) * ny)
  const reach = Math.max(24, 0.07 * Math.max(w, h))
  const [from, to] = streak.hue
  const line = new Uint32Array(W)
  for (let j = 0; j < rows; j++) {
    const y = (j + 0.5) * size
    const bayer = (j & 7) * 8
    for (let i = 0; i < cols; i++) {
      const x = (i + 0.5) * size
      const d = (x - streak.x) * nx + (y - streak.y) * ny
      const s = clamp(d / depth)
      // Cooler along the edge, warming to pink deep in the light, as the picture does.
      const u = clamp(from + ((to - from) * x) / w - COOL * (1 - s))
      const q = clamp(brightness(d, s, u, reach)) * LAST
      let k = Math.floor(q)
      if (q - k > BAYER[bayer + (i & 7)]!) k++
      const ink = INKS[Math.round(u * (HUES - 1)) * LEVELS + Math.min(LAST, k)]!
      line.fill(ink, i * c, Math.min(W, (i + 1) * c))
    }
    for (let r = j * c, end = Math.min(H, r + c); r < end; r++) out.set(line, r * W)
  }
  ctx.putImageData(img, 0, 0)
}
