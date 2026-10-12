import { noise, seeded } from '../shared/footer/random'

/*
 * The small tools the train's pictures are painted with: canvases, colour
 * mixing, and noise that loops, so a strip of landscape can be laid end to
 * end without a seam.
 */

export type Ctx = CanvasRenderingContext2D

/** A canvas `w` × `h` CSS px at `dpr`, its context set to draw in CSS px. */
export function canvasOf(w: number, h: number, dpr: number) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(w * dpr))
  canvas.height = Math.max(1, Math.round(h * dpr))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no 2d context')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  return { canvas, ctx }
}

export const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x))
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k
export const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}

/** A colour as its red, green and blue, 0 to 255. */
export type Rgb = readonly [number, number, number]

export const hex = (h: string): Rgb => {
  const n = Number.parseInt(h.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
export const mix = (a: Rgb, b: Rgb, k: number): Rgb => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)]
export const css = (c: Rgb, alpha = 1) => `rgba(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])}, ${alpha.toFixed(3)})`
/** A colour lighter or darker by `by`, -1 to 1. */
export const shade = (c: Rgb, by: number): Rgb => (by >= 0 ? mix(c, [255, 255, 255], by) : mix(c, [0, 0, 0], -by))

/**
 * Noise that loops every `period` px along x: sampled round a circle, so the
 * strip's right end meets its left. Features are about `feature` px across.
 */
export function loopNoise(seed: number, period: number) {
  const { n2 } = noise(seed)
  return (x: number, feature: number, octaves = 4, row = 0) => {
    const a = (x / period) * Math.PI * 2
    const r = period / (2 * Math.PI * feature)
    let sum = 0
    let amp = 0.5
    let norm = 0
    let f = 1
    for (let o = 0; o < octaves; o++) {
      sum += amp * n2(r * Math.cos(a) * f + 37.1 * o + row * 13.7, r * Math.sin(a) * f + 11.3 * o + row * 7.9)
      norm += amp
      amp *= 0.5
      f *= 2
    }
    return sum / norm
  }
}

export { seeded }

/** Whether the context can soften what it draws with a filter. */
export const canFilter = (ctx: Ctx) => 'filter' in ctx && typeof ctx.filter === 'string'

/** Draws `paint` softened by `blur` CSS px, where the browser can. */
export function soft(ctx: Ctx, blur: number, paint: () => void) {
  if (blur > 0 && canFilter(ctx)) {
    const before = ctx.filter
    ctx.filter = `blur(${blur.toFixed(2)}px)`
    paint()
    ctx.filter = before
  } else paint()
}

/** A rounded rectangle's path. */
export function roundRect(ctx: Ctx | Path2D, x: number, y: number, w: number, h: number, r: number) {
  const k = Math.min(r, w / 2, h / 2)
  ctx.moveTo(x + k, y)
  ctx.lineTo(x + w - k, y)
  ctx.arcTo(x + w, y, x + w, y + k, k)
  ctx.lineTo(x + w, y + h - k)
  ctx.arcTo(x + w, y + h, x + w - k, y + h, k)
  ctx.lineTo(x + k, y + h)
  ctx.arcTo(x, y + h, x, y + h - k, k)
  ctx.lineTo(x, y + k)
  ctx.arcTo(x, y, x + k, y, k)
  ctx.closePath()
}
