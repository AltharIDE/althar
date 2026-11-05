import { useLayoutEffect, useRef } from 'react'

/*
 * Prototype, D: a sea of cloud in the footer's two inks, painted here until
 * the painted plates come. Billows in rows from the far horizon to the near
 * foot, each lit from above in paper and shaded in cobalt, the far ones lost
 * in the sky; or, `under`, the cloud's base seen from below, hanging. Painted
 * once for its size; nothing moves.
 */

const COBALT = [31, 53, 200] as const
const PAPER = [244, 242, 236] as const

/** Cobalt mixed toward paper by `t`, at `a`. */
const ink = (t: number, a = 1) => {
  const c = COBALT.map((v, i) => Math.round(v + (PAPER[i]! - v) * Math.min(1, Math.max(0, t))))
  return `rgba(${c[0]},${c[1]},${c[2]},${a})`
}

function random(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface Sea {
  seed: number
  /** Where the far horizon stands, as a share of the height from the top (from the foot, `under`). */
  horizon: number
  /** Rows of billows, far to near. */
  rows: number
  /** The nearest billows' radius, in CSS px at 1280 wide. */
  near: number
  /** The cloud's base seen from under it, hanging from the top. */
  under?: boolean
}

function paint(cv: HTMLCanvasElement, w: number, h: number, sea: Sea) {
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  cv.width = Math.round(w * dpr)
  cv.height = Math.round(h * dpr)
  const ctx = cv.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  if (sea.under) {
    ctx.translate(0, h)
    ctx.scale(1, -1)
  }
  const r = random(sea.seed)
  const scale = Math.max(0.5, Math.min(1.35, w / 1280))
  const y0 = h * sea.horizon
  for (let row = 0; row < sea.rows; row++) {
    const t = sea.rows === 1 ? 1 : row / (sea.rows - 1)
    const depth = t ** 1.7
    const base = y0 + (h - y0) * t ** 1.2
    const R = (4 + (sea.near - 4) * depth) * scale
    // Far rows are lost in the haze; near ones lit, low in contrast, as gouache lays them. Seen from under, they keep to their shade.
    const lit = sea.under ? 0.36 + 0.2 * depth : 0.52 + 0.4 * depth
    const shade = sea.under ? 0.14 + 0.12 * depth : 0.4 + 0.2 * depth
    // The paint softer the farther it is.
    ctx.filter = `blur(${(1.8 - 1.4 * depth) * scale}px)`
    // The body of the row, so no sky shows between its billows.
    ctx.fillStyle = ink(shade)
    ctx.fillRect(-4, base, w + 8, h - base + 4)
    const billows: { x: number; y: number; rr: number }[] = []
    for (let x = -R * 1.6; x < w + R * 1.6; x += R * (0.7 + r() * 0.9)) {
      const rr = R * (0.55 + r() * 0.6) * (r() < 0.1 * depth ? 1.45 : 1)
      billows.push({ x, y: base - rr * (0.12 + r() * 0.3), rr })
    }
    billows.sort(() => r() - 0.5)
    for (const b of billows) {
      // Wider than tall, lit flat across its top, its shade low in it.
      const rx = b.rr * (1.35 + r() * 0.5)
      const ry = b.rr * 0.78
      const g = ctx.createLinearGradient(0, b.y - ry, 0, b.y + ry * 0.7)
      g.addColorStop(0, ink(lit))
      g.addColorStop(0.45, ink(lit - 0.05))
      g.addColorStop(1, ink(shade))
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.ellipse(b.x, b.y, rx, ry, 0, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.filter = 'none'
}

/** A canvas of cloud, painted for its size, and again whenever its width changes. */
export function Clouds({ sea, className }: { sea: Sea; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const { seed, horizon, rows, near, under } = sea
  useLayoutEffect(() => {
    const cv = ref.current
    if (!cv) return
    let frame = 0
    let size = ''
    const draw = () => {
      frame = 0
      const w = cv.clientWidth
      const h = cv.clientHeight
      const next = `${w}x${h}`
      if (next === size || w < 2 || h < 2) return
      size = next
      paint(cv, w, h, { seed, horizon, rows, near, under })
    }
    draw()
    const ro = new ResizeObserver(() => {
      if (!frame) frame = requestAnimationFrame(draw)
    })
    ro.observe(cv)
    return () => {
      cancelAnimationFrame(frame)
      ro.disconnect()
    }
  }, [seed, horizon, rows, near, under])
  return <canvas ref={ref} className={className} aria-hidden="true" />
}
