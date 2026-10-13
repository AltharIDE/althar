/*
 * The sums the first screen moves by. Everything is a function of the
 * journey's second, never of the last frame, so any second can be shown on
 * its own (`?t=`, reduced motion) and a slow frame never throws a spring.
 */

export const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x))

/** 0 before a, 1 after b, eased in and out between. */
export const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}

/** Eased in and out, harder than smooth: a camera's move. */
export const inOut = (u: number) => {
  const x = clamp(u)
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2
}

/** Quick out, long settle. */
export const out = (u: number, power = 4) => 1 - (1 - clamp(u)) ** power

/**
 * A knock at `at`, ringing out: 0 before it, then a swing that dies away,
 * starting at 0 and going first toward +1. `freq` in radians a second,
 * `decay` how fast it dies (1/s).
 */
export const ring = (t: number, at: number, freq: number, decay: number) =>
  t < at ? 0 : Math.exp(-(t - at) * decay) * Math.sin((t - at) * freq)

/** A spring let go at `at` from 1, swinging through 0 to rest: 1 before it. */
export const release = (t: number, at: number, freq: number, decay: number) =>
  t < at ? 1 : Math.exp(-(t - at) * decay) * Math.cos((t - at) * freq)

/** A flash at `at`: 0 before, 1 at once, dying away. */
export const flare = (t: number, at: number, decay: number) => (t < at ? 0 : Math.exp(-(t - at) * decay))

/** Smooth, never-repeating unevenness, -1 to 1: a hand on the camera, a carriage's tremble. */
export const wobble = (t: number, seed = 0) =>
  (Math.sin(t * 1.7 + seed) * 0.5 + Math.sin(t * 2.9 + seed * 1.3) * 0.3 + Math.sin(t * 4.3 + seed * 2.1) * 0.2) / 1.0

/** A knock on the camera: when, how hard (px), and how it rings. */
export interface Knock {
  at: number
  /** Px it throws the frame sideways and up, and how much it punches the zoom (a share). */
  x: number
  y: number
  zoom?: number
  freq?: number
  decay?: number
}

/** The camera at a moment: where it has moved the frame (px), how far it has turned (deg), how close it is (scale). */
export interface Camera {
  x: number
  y: number
  turn: number
  zoom: number
}

/** The camera after its knocks, on top of where it otherwise is. */
export function knocked(t: number, base: Camera, knocks: readonly Knock[]): Camera {
  let { x, y, turn, zoom } = base
  for (const k of knocks) {
    const f = k.freq ?? 34
    const d = k.decay ?? 7
    const r = ring(t, k.at, f, d)
    x += k.x * r
    y += k.y * ring(t, k.at, f * 0.83, d)
    turn += (k.x / 40) * ring(t, k.at, f * 0.7, d)
    zoom += (k.zoom ?? 0) * release(t, k.at, f * 0.4, d * 0.9) * (t < k.at ? 0 : 1)
  }
  return { x, y, turn, zoom }
}
