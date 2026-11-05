import { useEffect, useRef } from 'react'

/*
 * Prototype, E: a field drawn as an ordered dither, in the first screen's
 * night, the footer's cobalt and paper, and a little of the re-entry's
 * orange. A field gives, for each point of its box, how far along night →
 * cobalt → paper it is (0 to 1), and how much ember shows there; each cell
 * then takes one of a few inks along that ramp by an 8×8 Bayer threshold,
 * so every tone is made only of square dots. Drawn once at a cell per
 * canvas pixel and scaled up unsmoothed, so it stays crisp at any width;
 * again only when its box changes size. Nothing moves.
 */

export interface Field {
  /** Where (x, y) of a w × h box is along night (0) → cobalt (0.5) → paper (1). */
  tone: (x: number, y: number, w: number, h: number) => number
  /** How much of the re-entry's orange shows at (x, y), 0 to 1. */
  ember?: (x: number, y: number, w: number, h: number) => number
}

const NIGHT = [5, 3, 2]
const COBALT = [31, 53, 200]
const PAPER = [244, 242, 236]
const EMBER = [255, 109, 42]

/** The inks along the ramp: night, cobalt and paper and the mixes between, each a step the dots dither across. */
const INKS = (() => {
  const steps = 7
  const mix = (a: number[], b: number[], t: number) => a.map((v, i) => Math.round(v + (b[i]! - v) * t))
  return Array.from({ length: steps }, (_, k) => {
    const t = (k / (steps - 1)) * 2
    return t <= 1 ? mix(NIGHT, COBALT, t) : mix(COBALT, PAPER, t - 1)
  })
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
  return m.map((row) => row.map((v) => (v + 0.5) / 64))
})()

/** Between 0 and 1; nothing that isn't a number gets past it. */
const clamp = (v: number) => (v > 1 ? 1 : v > 0 ? v : 0)

function draw(canvas: HTMLCanvasElement, field: Field, w: number, h: number) {
  // Coarse enough to read as dots: four pixels a cell, three on a phone.
  const cell = w < 700 ? 3 : 4
  const cols = Math.ceil(w / cell)
  const rows = Math.ceil(h / cell)
  canvas.width = cols
  canvas.height = rows
  canvas.style.width = `${cols * cell}px`
  canvas.style.height = `${rows * cell}px`
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const img = ctx.createImageData(cols, rows)
  const last = INKS.length - 1
  for (let j = 0; j < rows; j++) {
    const y = (j + 0.5) * cell
    const row = BAYER[j & 7]!
    // The ember's dots on a threshold of their own, so they don't sit on the ramp's.
    const off = BAYER[(j + 3) & 7]!
    for (let i = 0; i < cols; i++) {
      const x = (i + 0.5) * cell
      const q = clamp(field.tone(x, y, w, h)) * last
      const k = Math.floor(q)
      let ink = INKS[Math.min(last, q - k > row[i & 7]! ? k + 1 : k)]!
      if (field.ember && clamp(field.ember(x, y, w, h)) > off[(i + 5) & 7]!) ink = EMBER
      const o = (j * cols + i) * 4
      img.data[o] = ink[0]!
      img.data[o + 1] = ink[1]!
      img.data[o + 2] = ink[2]!
      img.data[o + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
}

/** A field, dithered, filling its positioned parent. */
export function Dither({ field, className }: { field: Field; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    const box = canvas?.parentElement
    if (!canvas || !box) return
    let size = ''
    const observer = new ResizeObserver(() => {
      const w = box.clientWidth
      const h = box.clientHeight
      if (!w || !h || size === `${w}×${h}`) return
      size = `${w}×${h}`
      draw(canvas, field, w, h)
    })
    observer.observe(box)
    return () => observer.disconnect()
  }, [field])
  return <canvas ref={ref} className={className} aria-hidden="true" />
}

const smooth = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a))
  return t * t * (3 - 2 * t)
}

/**
 * The edge of a planet seen from orbit, crossing the box from `from` (its
 * height at the left, 0 to 1) to `to` (at the right), steepening as it
 * rises (`bend`): night above with a faint glow over the edge, cobalt under it,
 * paler with depth, and paper across the foot (from `foot`), where the box
 * gives way to the page; a hairline of ember along the edge.
 */
export function limb({
  from,
  to,
  bend = 1.8,
  foot = 0.62,
  ember = 0.32,
}: {
  from: number
  to: number
  bend?: number
  foot?: number
  ember?: number
}): Field {
  const edge = (x: number, w: number, h: number) => {
    // The last column of dots can stand a little past the box's edge.
    const u = clamp(x / w)
    return h * (from > to ? from - (from - to) * u ** bend : to - (to - from) * (1 - u) ** bend)
  }
  return {
    tone: (x, y, w, h) => {
      const d = y - edge(x, w, h)
      const air = smooth(-0.07 * w, 0.06 * w, d)
      const deep = smooth(0.08 * w, 0.42 * w, d)
      const inner = 0.5 * air + 0.5 * deep
      const base = smooth(foot * h, h, y)
      return base + (1 - base) * inner
    },
    ember: (x, y, w, h) => {
      const d = (y - edge(x, w, h)) / (0.011 * w) - 0.4
      return ember * Math.exp(-d * d) * (1 - smooth(foot * h, h, y))
    },
  }
}

/**
 * The close: the paper above deepening into cobalt, and low in it a wide,
 * gentle dome of light, the altar's, brightening back into paper across the
 * foot, where the footer is printed; a hairline of ember along its rim.
 */
export const dome: Field = {
  tone: (x, y, w, h) => {
    const top = 1 - 0.5 * smooth(0, 0.34 * h, y)
    const u = (x - w / 2) / (0.62 * w)
    const rim = h * (0.8 - 0.2 * Math.max(0, 1 - u * u))
    const light = 0.5 + 0.5 * smooth(-0.03 * w, 0.2 * w, y - rim)
    const base = smooth(0.9 * h, h, y)
    const tone = Math.max(top, light)
    return base + (1 - base) * tone
  },
  ember: (x, y, w, h) => {
    const u = (x - w / 2) / (0.62 * w)
    const rim = h * (0.8 - 0.2 * Math.max(0, 1 - u * u))
    const d = (y - rim) / (0.008 * w) - 0.3
    return 0.42 * Math.exp(-d * d) * Math.max(0, 1 - u * u)
  },
}
