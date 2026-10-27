/*
 * The engraving's randomness: the same small unevenness every time.
 */

/** The same small unevenness every time: a seeded random, 0 to 1. */
export function seeded(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Smooth value noise on a seeded lattice, plain and layered. */
export function noise(seed: number) {
  const r = seeded(seed)
  const size = 256
  const table = Float32Array.from({ length: size }, () => r())
  const perm = Uint8Array.from({ length: size }, (_, i) => i)
  for (let i = size - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1))
    ;[perm[i], perm[j]] = [perm[j]!, perm[i]!]
  }
  const fade = (t: number) => t * t * (3 - 2 * t)
  const at = (x: number, y: number) => table[perm[(perm[x & 255]! + y) & 255]!]!
  const n2 = (x: number, y: number) => {
    const xi = Math.floor(x)
    const yi = Math.floor(y)
    const u = fade(x - xi)
    const v = fade(y - yi)
    const a = at(xi, yi) + (at(xi + 1, yi) - at(xi, yi)) * u
    const b = at(xi, yi + 1) + (at(xi + 1, yi + 1) - at(xi, yi + 1)) * u
    return a + (b - a) * v
  }
  /** Layered: big shapes, then smaller ones over them. */
  const fbm = (x: number, y = 0.5, octaves = 4) => {
    let sum = 0
    let amp = 0.5
    let f = 1
    for (let o = 0; o < octaves; o++) {
      sum += amp * n2(x * f, y * f)
      f *= 2
      amp *= 0.5
    }
    return sum / (1 - 0.5 ** octaves)
  }
  return { n2, fbm }
}
