import { seeded } from './random'

/*
 * The altar's light, over the footer's engraving (engraving/, placed by
 * engraving.ts): fine lines rooted on the altar's table, whole low down and
 * breaking up as they rise, drifting up and breathing, and their streak
 * shimmering in the water. Drawn on every frame, and only while seen; it
 * keeps out of the words. Nothing here touches the page, so it can be drawn
 * on an OffscreenCanvas as well.
 */

/** A 2D context, on the page or off it. */
export type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

export interface Ground {
  w: number
  h: number
  /** How large the drawing's parts are against the desktop's: 1 at 1440 wide. */
  k: number
  /** The landscape's box: its top, its height. */
  top: number
  tall: number
  /** The water's edge. */
  water: number
  /** The altar: its middle, the ground it stands on, its top. */
  ax: number
  ground: number
  altarTop: number
  /** Where the words are: nothing tall may reach into these. */
  clear: ReadonlyArray<Clear>
}

/** A box of words, in the canvas's px: its left and right, and its foot. */
export interface Clear {
  left: number
  right: number
  bottom: number
}

/** How high something standing between `from` and `to` may reach, to stay under the words: its top's y, or -Infinity where nothing is over it. */
const ceiling = (clear: ReadonlyArray<Clear>, from: number, to: number, margin: number) =>
  clear.reduce((y, c) => (to > c.left - margin && from < c.right + margin ? Math.max(y, c.bottom + margin) : y), -Infinity)

/** The altar, bottom to top, as width and height at the desktop's size: two steps, the block, a cornice, the table. */
const ALTAR: ReadonlyArray<readonly [number, number]> = [
  [104, 9],
  [88, 8],
  [62, 38],
  [78, 8],
  [70, 5],
]
/** How wide the table on top is, where the light stands. */
const TABLE = ALTAR[ALTAR.length - 1]![0]

/** The light standing on the altar, and its streak in the water: fine lines rooted on the table, whole low down and breaking up as they rise, drifting up, breathing. */
export function lightOf(g: Ground) {
  const rand = seeded(23)
  const n = Math.round(18 + 14 * g.k)
  const half = (TABLE * g.k) / 2 - 3
  const lines = Array.from({ length: n }, (_, i) => {
    // Across the table, gathered toward its middle, as a column of light is.
    const u = (i / (n - 1)) * 2 - 1
    const spread = Math.sign(u) * Math.pow(Math.abs(u), 1.35)
    const dx = spread * half + (rand() - 0.5) * 1.2
    const middle = 1 - Math.abs(spread)
    const reach = (0.55 + 0.45 * rand()) * (0.5 + 0.5 * middle)
    // How far up it stays whole, as a share of its length.
    const whole = 0.18 + 0.32 * rand() * (0.5 + middle)
    const dash = [6 + rand() * 22, 2 + rand() * 3, 3 + rand() * 12, 2 + rand() * 5, 12 + rand() * 30, 3 + rand() * 6]
    return {
      dx,
      reach,
      whole,
      dash,
      width: 0.5 + 0.45 * middle,
      speed: 8 + rand() * 12,
      phase: rand() * Math.PI * 2,
      period: 4200 + rand() * 4200,
    }
  })
  const ripples = Array.from({ length: 70 }, () => ({ u: rand(), dx: (rand() - 0.5) * 2, len: 3 + rand() * 12, phase: rand() * 6.28 }))
  return { lines, ripples }
}

/** Where the light can reach across, in CSS px: its lines open out from the table, and its streak shimmers wider in the water. The light's own canvas is only this wide. */
export function lightBox(g: Ground) {
  const reach = Math.ceil(60 * g.k + 12)
  const left = Math.max(0, Math.floor(g.ax - reach))
  return { left, width: Math.min(g.w, Math.ceil(g.ax + reach)) - left }
}

export function drawLight(ctx: Ctx, g: Ground, light: ReturnType<typeof lightOf>, t: number) {
  const { w, h, ax, altarTop, water, k } = g
  ctx.clearRect(0, 0, w, h)
  ctx.lineCap = 'butt'
  // On the table's top edge, so the light stands on it.
  const foot = altarTop + 0.6
  for (const line of light.lines) {
    const breathe = 1 + 0.12 * Math.sin((t / line.period) * Math.PI * 2 + line.phase)
    // It opens a little as it rises, and stops under any words over it.
    const x0 = ax + line.dx
    const x1 = ax + line.dx * 1.6
    const roof = Math.max(8, ceiling(g.clear, Math.min(x0, x1), Math.max(x0, x1), 16))
    const length = Math.min(foot - roof, (foot - roof) * line.reach * breathe)
    const at = (s: number) => [x0 + (x1 - x0) * s, foot - length * s] as const
    const grad = ctx.createLinearGradient(0, foot, 0, foot - length)
    grad.addColorStop(0, 'rgba(31, 53, 200, 0.9)')
    grad.addColorStop(0.3, 'rgba(31, 53, 200, 0.5)')
    grad.addColorStop(1, 'rgba(31, 53, 200, 0)')
    ctx.strokeStyle = grad
    ctx.lineWidth = line.width
    // Whole from the table up...
    const [mx, my] = at(line.whole)
    ctx.setLineDash([])
    ctx.beginPath()
    ctx.moveTo(x0, foot)
    ctx.lineTo(mx, my)
    ctx.stroke()
    // ...then breaking up, the breaks drifting upward.
    const [tx, ty] = at(1)
    ctx.setLineDash(line.dash)
    ctx.lineDashOffset = (t / 1000) * line.speed
    ctx.beginPath()
    ctx.moveTo(mx, my)
    ctx.lineTo(tx, ty)
    ctx.stroke()
  }
  ctx.setLineDash([])
  // Its streak in the water, shimmering.
  ctx.beginPath()
  const deep = (h - water) * 0.85
  for (const r of light.ripples) {
    const y = water + 3 + r.u * deep
    const x = ax + r.dx * 22 * k * (1 + r.u * 0.6) + Math.sin(t / 700 + r.phase + y * 0.2) * 3
    ctx.moveTo(x - r.len / 2, y)
    ctx.lineTo(x + r.len / 2, y)
  }
  ctx.strokeStyle = 'rgba(31, 53, 200, 0.7)'
  ctx.lineWidth = 0.8
  ctx.stroke()
}
