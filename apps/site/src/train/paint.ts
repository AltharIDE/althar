import { seeded } from '../shared/footer/random'

/* The small sums the train's scene is drawn with. */

export type Ctx = CanvasRenderingContext2D

export const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x))

/** 0 before a, 1 after b, eased between. */
export const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}

export { seeded }
