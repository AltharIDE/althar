/*
 * The sums the first screen moves by. Everything is a function of the
 * clock's second, never of the last frame, so any second can be shown on its
 * own (`?t=`, reduced motion) and a slow frame never throws a spring.
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

/** Quick out, coming to rest with no speed left. */
export const out = (u: number, power = 3) => 1 - (1 - clamp(u)) ** power

/** A flash at `at`: 0 before, 1 at once, dying away (`decay` a second). */
export const flare = (t: number, at: number, decay: number) => (t < at ? 0 : Math.exp(-(t - at) * decay))

/** A knock at `at`, ringing out: 0 before it, then a swing that dies away. `freq` in radians a second, `decay` how fast it dies. */
export const ring = (t: number, at: number, freq: number, decay: number) =>
  t < at ? 0 : Math.exp(-(t - at) * decay) * Math.sin((t - at) * freq)

/** Smooth, never-repeating unevenness, -1 to 1: a hand on the camera, a capsule's shaking. */
export const wobble = (t: number, seed = 0) =>
  Math.sin(t * 1.7 + seed) * 0.5 + Math.sin(t * 2.9 + seed * 1.3) * 0.3 + Math.sin(t * 4.3 + seed * 2.1) * 0.2
