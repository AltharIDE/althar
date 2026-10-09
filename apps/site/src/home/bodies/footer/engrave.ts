import { LOGO_SECTION } from '@althar/ui'

import { noise, seeded } from './parts'

/*
 * A landscape engraved in cobalt ink, drawn once for the size it is shown
 * at: far hills over a lake, a wooded slope at the left with boulders at
 * its foot, a hill framing the right, and a headland in the water with an
 * altar on it, cypresses among the trees. Everything is small marks, as a
 * print's: crowns of trees as scalloped paper, hatched and crossed on the
 * side away from the light with the dark among them showing, boulders in
 * outline, cypresses solid, the water in broken lines. Where the altar's
 * light stands the marks thin, so the hills behind it read lit, and
 * nothing tall reaches into the words. The light itself is drawn apart,
 * on every frame (drawLight), over this.
 */

export const INK = '#1f35c8'

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

const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x))
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}
const gauss = (x: number, at: number, wide: number) => Math.exp(-(((x - at) / wide) ** 2))

/** The altar, bottom to top, as width and height at the desktop's size: two steps, the block, a cornice, the table. */
const ALTAR: ReadonlyArray<readonly [number, number]> = [
  [104, 9],
  [88, 8],
  [62, 38],
  [78, 8],
  [70, 5],
]
const ALTAR_TALL = ALTAR.reduce((sum, [, bh]) => sum + bh, 0)
/** How wide the table on top is, where the light stands. */
const TABLE = ALTAR[ALTAR.length - 1]![0]

/** Where everything stands, for a canvas `w` by `h` whose words end at `sky`: the landscape keeps below them. */
export function groundOf(w: number, h: number, clear: ReadonlyArray<Clear>): Ground {
  const sky = Math.max(0, ...clear.map((c) => c.bottom)) + 36
  const k = clamp(w / 1440, 0.62, 1.15)
  // On a phone the words span the width, so the tallest cypress must stay under them too.
  const below = Math.min(h - 220, Math.max(sky, h * 0.36))
  const top = w < 700 ? below + (h - below) * 0.3 : below
  const tall = h - top
  const water = top + tall * 0.8
  const ax = w * (w < 700 ? 0.66 : 0.64)
  const ground = top + tall * 0.55
  const altarTop = ground + 2 - ALTAR_TALL * k
  return { w, h, k, top, tall, water, ax, ground, altarTop, clear }
}

interface Crown {
  x: number
  y: number
  r: number
}

export function drawLandscape(ctx: CanvasRenderingContext2D, w: number, h: number, clear: ReadonlyArray<Clear>, paper: string): Ground {
  const g = groundOf(w, h, clear)
  const { k, top, tall, water, ax, ground } = g
  const rand = seeded(7)
  const { fbm } = noise(11)
  const Y = (f: number) => top + tall * f
  const ink = (a: number) => `rgba(31, 53, 200, ${Math.max(0, Math.min(1, a)).toFixed(3)})`

  ctx.clearRect(0, 0, w, h)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  // How lit a place is by the altar's light: a column above it, and a pool round it.
  const column = 40 * k + w * 0.02
  const lit = (x: number, y: number) =>
    Math.min(1, gauss(x, ax, column) * smooth(ground + 30, top, y) * 0.9 + gauss(Math.hypot(x - ax, (y - ground) * 1.5), 0, 120 * k) * 0.75)

  // ---- the ground's shapes, back to front ----
  // The far shore, where open water meets the far hills.
  const horizon = Y(0.44)
  const far = (x: number) => Y(0.28 + 0.12 * fbm((x / w) * 2.4 + 3.1)) - tall * 0.05 * gauss(x, w * 0.58, w * 0.12)
  // A hill behind the slope at the left, down to the far shore; and one framing the right, down to the near water.
  const shore = Y(0.5)
  const midLeft = (x: number) => Y(0.08 + 0.08 * fbm((x / w) * 4 + 7.7)) + (shore - Y(0.08)) * Math.pow(smooth(w * 0.1, w * 0.54, x), 1.3)
  const midRight = (x: number) =>
    shore + 8 - (shore - Y(0.04 + 0.06 * fbm((x / w) * 4 + 2.2))) * Math.pow(smooth(w * 0.7, w * 1.02, x), 0.8)
  const slopeEnd = w * (w < 700 ? 0.42 : 0.36)
  const near = (x: number) =>
    Y(0.02 + 0.05 * fbm((x / w) * 5 + 1.3)) + (water - Y(0.02)) * Math.pow(smooth(-slopeEnd * 0.1, slopeEnd, x), 1.15)
  // The headland: a knoll in the water, flat on top where the altar stands.
  const capeHalf = Math.max(w * 0.11, 120 * k)
  const flat = Math.max(w * 0.026, 44 * k)
  const cape = (x: number) => {
    const d = Math.abs(x - ax)
    if (d <= flat) return ground + Math.sin(x * 0.07) * 1.2
    const t = clamp((d - flat) / (capeHalf - flat))
    // A mound, round at the shoulder and spreading at the water.
    return ground + (water - ground) * Math.pow(t * t * (3 - 2 * t), x < ax ? 0.75 : 0.85) + (fbm((x / w) * 9 + 4) - 0.5) * 14 * k * t
  }
  const inCape = (x: number) => Math.abs(x - ax) < capeHalf

  const outline = (ridge: (x: number) => number, from: number, to: number, floor: number, inset = 0) => {
    ctx.beginPath()
    ctx.moveTo(from, floor)
    for (let x = from; x <= to; x += 4) ctx.lineTo(x, Math.min(floor, ridge(x) + inset))
    ctx.lineTo(to, Math.min(floor, ridge(to) + inset))
    ctx.lineTo(to, floor)
    ctx.closePath()
  }
  /**
   * Paper under `ridge` down to `floor`, so what is behind stops here, then
   * hatched dark: what shows of it between the crowns is the shade among
   * the trees. Thinner where the light falls. It starts a little under the
   * ridge, so the skyline is the crowns' and not a line.
   */
  const layer = (ridge: (x: number) => number, from: number, to: number, floor: number, dark: number, gap: number, inset: number) => {
    outline(ridge, from, to, floor, inset)
    ctx.fillStyle = paper
    ctx.fill()
    ctx.save()
    outline(ridge, from, to, floor + inset * 0.2, inset * 1.4)
    ctx.clip()
    const across = ctx.createLinearGradient(0, 0, w, 0)
    for (let i = 0; i <= 20; i++) {
      const x = (i / 20) * w
      across.addColorStop(i / 20, ink(dark * (1 - 0.85 * gauss(x, ax, column * 1.6))))
    }
    ctx.strokeStyle = across
    ctx.lineWidth = 0.7
    ctx.beginPath()
    const span = floor - (top - tall)
    for (let x = from - span; x < to; x += gap) {
      ctx.moveTo(x, floor)
      ctx.lineTo(x + span, floor - span)
    }
    ctx.stroke()
    ctx.restore()
  }

  /** Crowns of trees over the area from `ridge` down to `floor(x)`: in staggered rows, so no columns show; a little larger as they come nearer. */
  const crownsUnder = (ridge: (x: number) => number, floor: (x: number) => number, r: number, from = 0, to = w): Crown[] => {
    const out: Crown[] = []
    const step = r * 1.3
    let high = Infinity
    let low = -Infinity
    for (let x = from; x <= to; x += 6) {
      high = Math.min(high, ridge(x))
      low = Math.max(low, floor(x))
    }
    let row = 0
    for (let gy = high; gy < low + r * 0.5; gy += step * 0.74, row++) {
      const shift = (row % 2) * step * 0.5
      for (let gx = from - step + shift; gx < to + step; gx += step) {
        const x = gx + (rand() - 0.5) * step * 0.7
        const y = gy + (rand() - 0.5) * step * 0.45
        if (y < ridge(x) + r * 0.3 || y > floor(x) + r * 0.5) continue
        const nearer = clamp((y - high) / Math.max(1, low - high))
        out.push({ x, y, r: r * (0.68 + 0.5 * rand()) * (0.88 + 0.24 * nearer) })
      }
    }
    return out.sort((a, b) => a.y - b.y)
  }

  const blob = (x: number, y: number, r: number, n: number, bump: number) => {
    const path = new Path2D()
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2
      const rr = r * (0.9 + 0.2 * rand())
      const px = x + Math.cos(a) * rr
      const py = y + Math.sin(a) * rr * 0.9
      if (i === 0) path.moveTo(px, py)
      else {
        const am = a - Math.PI / n
        path.quadraticCurveTo(x + Math.cos(am) * rr * bump, y + Math.sin(am) * rr * bump * 0.95, px, py)
      }
    }
    path.closePath()
    return path
  }

  /** Hatches the part of `path` away from the light, from clear at its upper left to `dark` at its lower right. */
  const shade = (path: Path2D, x: number, y: number, r: number, dark: number, gap: number) => {
    ctx.save()
    ctx.clip(path)
    const g = ctx.createLinearGradient(x - r * 0.15, y - r * 0.25, x + r * 0.75, y + r * 0.85)
    g.addColorStop(0, ink(0))
    g.addColorStop(0.35, ink(dark * 0.35))
    g.addColorStop(1, ink(dark))
    ctx.strokeStyle = g
    ctx.lineWidth = 0.8
    ctx.beginPath()
    for (let o = -r * 2; o < r * 2; o += gap) {
      ctx.moveTo(x + o - r, y - r)
      ctx.lineTo(x + o + r, y + r)
    }
    ctx.stroke()
    // The deepest part, crossed.
    const cross = ctx.createLinearGradient(x + r * 0.1, y + r * 0.1, x + r * 0.8, y + r * 0.9)
    cross.addColorStop(0, ink(0))
    cross.addColorStop(1, ink(dark * 0.9))
    ctx.strokeStyle = cross
    ctx.lineWidth = 0.7
    ctx.beginPath()
    for (let o = -r * 2; o < r * 2; o += gap * 1.1) {
      ctx.moveTo(x + o + r, y - r)
      ctx.lineTo(x + o - r, y + r)
    }
    ctx.stroke()
    ctx.restore()
  }

  /** One crown: a scalloped blob of paper, shaded and outlined on the side away from the light, a few leaves where the shade begins. */
  const crown = ({ x, y, r }: Crown, alpha: number) => {
    const path = blob(x, y, r, 11, 1.18)
    ctx.fillStyle = paper
    ctx.fill(path)
    const l = lit(x, y)
    shade(path, x, y, r, alpha * (1 - l * 0.85), Math.max(1.3, 1.7 * k))
    // Leaves, as little cups, where light turns to shade.
    ctx.beginPath()
    const count = Math.round(r * r * 0.16)
    for (let i = 0; i < count; i++) {
      const a = rand() * Math.PI * 2
      const d = Math.sqrt(rand()) * r * 0.9
      const px = x + Math.cos(a) * d
      const py = y + Math.sin(a) * d
      const v = 0.5 + 0.5 * (((px - x) / r) * 0.55 + ((py - y) / r) * 0.83)
      if (v < 0.3 || v > 0.85 || rand() > 0.8 * (1 - lit(px, py))) continue
      const m = (1 + 1.3 * rand()) * Math.min(1, 0.6 + k * 0.4)
      const a0 = 0.15 * Math.PI + (rand() - 0.5) * 0.6
      ctx.moveTo(px + Math.cos(a0) * m, py + Math.sin(a0) * m)
      ctx.arc(px, py, m, a0, a0 + Math.PI * 0.95)
    }
    ctx.strokeStyle = ink(alpha * 0.85 * (1 - l * 0.7))
    ctx.lineWidth = 0.7
    ctx.stroke()
    const edge = ctx.createLinearGradient(x - r, y - r, x + r * 0.7, y + r * 0.7)
    edge.addColorStop(0, ink(0))
    edge.addColorStop(0.5, ink(0.3 * alpha * (1 - l)))
    edge.addColorStop(1, ink(alpha * (1 - l * 0.8)))
    ctx.strokeStyle = edge
    ctx.lineWidth = 0.9
    ctx.stroke(path)
  }

  type Thing = { y: number; draw: () => void }
  /** Crowns and cypresses, nearest last, so a cypress stands among the trees and not on them. */
  const grove = (crowns: Crown[], alpha: number, trees: Array<{ x: number; base: number; tall: number; alpha: number }>) => {
    const things: Thing[] = [
      ...crowns.map((c) => ({ y: c.y, draw: () => crown(c, alpha) })),
      // Nothing behind the altar stands up in its light.
      ...trees
        .filter((t) => t.base > ground || Math.abs(t.x - ax) > column * 1.6)
        .map((t) => ({ y: t.base - 4, draw: () => cypress(t.x, t.base, t.tall, t.alpha) })),
    ]
    things.sort((a, b) => a.y - b.y)
    for (const t of things) t.draw()
  }

  /** A cypress: a dark flame of a tree, slender, round at the tip, its foliage in short strokes of paper on the side toward the light, bushes at its foot. */
  const cypress = (x: number, base: number, high: number, alpha: number) => {
    // Under the words, it stops short of them.
    const roof = ceiling(g.clear, x - high / 12, x + high / 12, 14)
    const tallness = Math.max(high * 0.4, Math.min(high, base - roof))
    const wide = high / 6
    const prof = (t: number) => Math.pow(1 - Math.pow(t, 1.15), 0.62) * (0.8 + 0.2 * Math.sin(Math.PI * Math.min(1, t * 2.4)))
    const side = (sign: number, seed: number) => {
      const steps = 34
      for (let i = 0; i <= steps; i++) {
        const t = sign < 0 ? i / steps : 1 - i / steps
        const half = (wide / 2) * prof(t)
        const wob = (fbm(x * 0.013 + t * 7, seed) - 0.5) * half * 0.5
        ctx.lineTo(x + sign * half + wob, base - tallness * t)
      }
    }
    ctx.beginPath()
    side(-1, 2.3)
    side(1, 5.1)
    ctx.closePath()
    ctx.fillStyle = ink(alpha)
    ctx.fill()
    // Foliage: little scales of paper, overlapping upward, more toward the light.
    ctx.beginPath()
    const count = Math.round(tallness * wide * 0.06)
    for (let i = 0; i < count; i++) {
      const t = 0.04 + rand() * 0.86
      const half = (wide / 2) * prof(t) * 0.78
      const u = rand() * 2 - 1
      if (rand() > 0.05 + 0.6 * ((1 - u) / 2) ** 1.8) continue
      const px = x + u * half
      const py = base - tallness * t
      const m = (0.8 + rand() * 0.9) * Math.min(1, 0.5 + wide / 28)
      ctx.moveTo(px - m, py)
      ctx.arc(px, py, m, Math.PI, Math.PI * 2)
    }
    ctx.strokeStyle = paper
    ctx.lineWidth = 0.6
    ctx.globalAlpha = 0.8
    ctx.stroke()
    ctx.globalAlpha = 1
    // Bushes at its foot, so it grows from the ground and doesn't stand on it.
    const br = Math.max(4, wide * 0.55)
    crown({ x: x - wide * 0.45, y: base - br * 0.2, r: br * 0.9 }, alpha)
    crown({ x: x + wide * 0.5, y: base - br * 0.1, r: br }, alpha)
  }

  /** Boulders: paper in outline, a crack, hatched on the shaded side; the dark between them is what lies under. */
  const rocks = (inside: (x: number, y: number) => boolean, from: number, to: number, top0: number, bottom: number, r: number) => {
    const list: Crown[] = []
    for (let gy = top0; gy < bottom; gy += r * 0.75) {
      for (let gx = from + (rand() - 0.5) * r; gx < to; gx += r * 1.35) {
        const x = gx + (rand() - 0.5) * r * 0.5
        const y = gy + (rand() - 0.5) * r * 0.3
        if (inside(x, y))
          list.push({ x, y, r: r * (0.45 + 0.75 * rand() ** 1.5) * (0.85 + 0.3 * clamp((y - top0) / Math.max(1, bottom - top0))) })
      }
    }
    list.sort((a, b) => a.y - b.y)
    for (const { x, y, r: rr } of list) {
      const path = new Path2D()
      const n = 6 + Math.floor(rand() * 3)
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * Math.PI * 2 + rand() * 0.3
        const q = rr * (0.7 + 0.4 * rand())
        const px = x + Math.cos(a) * q * 1.3
        const py = y + Math.sin(a) * q * 0.68
        if (i === 0) path.moveTo(px, py)
        else path.lineTo(px, py)
      }
      path.closePath()
      ctx.fillStyle = paper
      ctx.fill(path)
      shade(path, x, y, rr * 1.2, 0.85 * (1 - lit(x, y) * 0.8), Math.max(1.6, 2.1 * k))
      ctx.strokeStyle = ink(0.9)
      ctx.lineWidth = 0.95
      ctx.stroke(path)
      ctx.beginPath()
      let px = x - rr * 0.3 + rand() * rr * 0.3
      let py = y - rr * 0.25
      ctx.moveTo(px, py)
      for (let s = 0; s < 3; s++) {
        px += (rand() - 0.2) * rr * 0.4
        py += rand() * rr * 0.22
        ctx.lineTo(px, py)
      }
      ctx.strokeStyle = ink(0.6)
      ctx.lineWidth = 0.6
      ctx.stroke()
    }
  }

  // Far hills: small, pale crowns, a few far cypresses, standing on the far shore.
  layer(far, 0, w, horizon, 0.28, 3.2, 5.5 * k * 0.7)
  grove(
    crownsUnder(far, () => horizon - 4 * k, 5.5 * k),
    0.4,
    [0.5, 0.56, 0.62].map((f) => ({ x: w * f, base: far(w * f) + 8 * k, tall: tall * 0.09, alpha: 0.45 })),
  )

  // Open water, back to the far shore: lines close and fine far off, longer and darker as they come nearer.
  const reflects = (x: number, y: number) => {
    const under = (top0: number, depth: number) => (y > top0 && y < top0 + depth ? 1 - (y - top0) / depth : 0)
    return Math.max(
      x < slopeEnd ? under(water, tall * 0.18) * (1 - x / slopeEnd) ** 0.5 : 0,
      inCape(x) ? under(water, tall * 0.14) * (1 - Math.abs(x - ax) / capeHalf) : 0,
      x > w * 0.72 ? under(water, tall * 0.16) * smooth(w * 0.72, w, x) : 0,
      x > w * 0.12 && x < w * 0.54 ? under(shore, tall * 0.06) * 0.7 : 0,
      under(horizon, tall * 0.04) * 0.35,
    )
  }
  ctx.beginPath()
  const rows = Math.round((h - horizon) / 3.4)
  for (let r = 1; r <= rows; r++) {
    const t = r / rows
    const y = horizon + (h - horizon) * Math.pow(t, 1.6)
    let x = -rand() * 40
    while (x < w) {
      const dash = 4 + rand() * (10 + 60 * t)
      const mid0 = x + dash / 2
      const dark = reflects(mid0, y)
      const clear = Math.abs(mid0 - ax) < 28 * k && y > water && t < 0.85
      const p = 0.1 + 0.42 * t + 0.85 * dark - (clear ? 0.5 : 0)
      if (rand() < p) {
        ctx.moveTo(x, y)
        ctx.lineTo(x + dash, y)
      }
      x += dash + 3 + rand() * (24 - 16 * t)
    }
  }
  ctx.strokeStyle = ink(0.75)
  ctx.lineWidth = 0.65
  ctx.stroke()

  // The hills nearer: the one behind the slope, and the one framing the right.
  layer(midLeft, 0, w * 0.56, shore + 2, 0.7, 2.4, 10 * k * 0.7)
  grove(
    crownsUnder(midLeft, () => shore, 10 * k, 0, w * 0.56),
    0.72,
    (
      [
        [0.36, 0.17],
        [0.4, 0.13],
        [0.47, 0.1],
      ] as const
    ).map(([f, t]) => ({ x: w * f, base: midLeft(w * f) + 16 * k, tall: tall * t, alpha: 0.8 })),
  )
  layer(midRight, w * 0.68, w, water + 2, 0.8, 2.2, 12.5 * k * 0.7)
  grove(
    crownsUnder(midRight, () => water, 12.5 * k, w * 0.68, w),
    0.85,
    (
      [
        [0.79, 0.16],
        [0.86, 0.22],
        [0.9, 0.17],
        [0.97, 0.26],
      ] as const
    ).map(([f, t]) => ({ x: w * f, base: midRight(w * f) + 26 * k, tall: tall * t, alpha: 0.9 })),
  )

  // The near slope at the left: woods above, boulders at its foot.
  const rockLine = (x: number) => water - tall * 0.2 * (1 - x / slopeEnd) - tall * 0.04
  layer(near, 0, slopeEnd, water + 2, 0.95, 1.9, 16 * k * 0.7)
  grove(
    crownsUnder(near, (x) => Math.min(water, rockLine(x) + 8 * k), 16 * k, 0, slopeEnd),
    1,
    (
      [
        [0.05, 0.46],
        [0.13, 0.38],
        [0.22, 0.28],
      ] as const
    ).map(([f, t]) => ({ x: w * f, base: near(w * f) + tall * 0.12, tall: tall * t, alpha: 0.96 })),
  )
  rocks(
    (x, y) => y > Math.max(rockLine(x), near(x) - 8 * k) && y < water + 2 && x < slopeEnd + 6 * k,
    0,
    slopeEnd + 20 * k,
    water - tall * 0.3,
    water + 6,
    30 * k,
  )

  // The headland: a mound of ground, grass on it in tufts, thinner where the light falls; bushes on its flanks, boulders at the water.
  outline(cape, ax - capeHalf, ax + capeHalf, water + 4)
  ctx.fillStyle = paper
  ctx.fill()
  ctx.save()
  outline(cape, ax - capeHalf, ax + capeHalf, water + 4)
  ctx.clip()
  ctx.beginPath()
  for (let y = ground + 2; y < water + 4; y += 2.6 * Math.max(0.85, k)) {
    let x = ax - capeHalf + rand() * 8
    while (x < ax + capeHalf) {
      const len = 2 + rand() * 7
      const away = clamp(Math.hypot((x - ax) / capeHalf, (y - ground) / (water - ground)) * 1.2)
      if (rand() < 0.12 + 0.75 * away) {
        ctx.moveTo(x, y)
        ctx.lineTo(x + len, y + (rand() - 0.5) * 1.2)
        // Now and then a blade standing up.
        if (rand() < 0.08) {
          ctx.moveTo(x + len * 0.6, y)
          ctx.lineTo(x + len * 0.6 + 0.6, y - 1.8)
        }
      }
      x += len + 1.5 + rand() * 5
    }
  }
  ctx.strokeStyle = ink(0.7)
  ctx.lineWidth = 0.6
  ctx.stroke()
  // The altar's shadow, falling right across the ground, hatched.
  const foot = (ALTAR[0]![0] * k) / 2
  ctx.beginPath()
  ctx.moveTo(ax + foot * 0.2, ground + 2)
  ctx.lineTo(ax + foot, ground + 2)
  ctx.lineTo(ax + foot + 34 * k, ground + 9 * k)
  ctx.lineTo(ax + foot * 0.4, ground + 9 * k)
  ctx.closePath()
  ctx.clip()
  ctx.beginPath()
  for (let x = ax - 10; x < ax + foot + 40 * k; x += 1.8) {
    ctx.moveTo(x, ground)
    ctx.lineTo(x - 10 * k, ground + 12 * k)
  }
  ctx.strokeStyle = ink(0.75)
  ctx.lineWidth = 0.55
  ctx.stroke()
  ctx.restore()
  // Its ridge, drawn only across the top, where nothing covers it.
  ctx.beginPath()
  for (let x = ax - flat * 1.4; x <= ax + flat * 1.4; x += 3) ctx.lineTo(x, cape(x) + 0.5)
  ctx.strokeStyle = ink(0.5)
  ctx.lineWidth = 0.8
  ctx.stroke()
  const flank = (x: number) => (Math.abs(x - ax) > flat * 1.25 ? cape(x) + 3 * k : water + 99)
  grove(
    crownsUnder(flank, (x) => Math.min(water - 14 * k, cape(x) + tall * 0.16), 9 * k, ax - capeHalf, ax + capeHalf).filter((c) =>
      inCape(c.x),
    ),
    0.95,
    [
      { x: ax - flat - 18 * k, base: cape(ax - flat - 18 * k) + 6 * k, tall: tall * 0.3, alpha: 0.96 },
      { x: ax + flat + 22 * k, base: cape(ax + flat + 22 * k) + 6 * k, tall: tall * 0.23, alpha: 0.96 },
    ],
  )
  rocks(
    (x, y) => inCape(x) && Math.abs(x - ax) < capeHalf * 0.92 && y > cape(x) + 4 && y > water - tall * 0.09,
    ax - capeHalf,
    ax + capeHalf,
    water - tall * 0.11,
    water + 4,
    22 * k,
  )

  drawAltar(ctx, g, paper)

  // A few birds, high and small, near the light.
  ctx.beginPath()
  for (const [bx, by, bs] of [
    [0.7, -0.02, 1],
    [0.73, -0.06, 0.8],
    [0.57, 0.02, 0.7],
    [0.78, 0.01, 0.6],
  ] as const) {
    const x = w * bx
    const yy = top + tall * by
    const sz = 5 * k * bs
    ctx.moveTo(x - sz, yy - sz * 0.3)
    ctx.quadraticCurveTo(x - sz * 0.4, yy - sz * 0.6, x, yy)
    ctx.quadraticCurveTo(x + sz * 0.4, yy - sz * 0.6, x + sz, yy - sz * 0.3)
  }
  ctx.strokeStyle = ink(0.9)
  ctx.lineWidth = 0.9
  ctx.stroke()

  return g
}

/** The altar on the headland: steps, a block with Althar's mark cut in its face, a cornice and a table, shaded on the right. */
function drawAltar(ctx: CanvasRenderingContext2D, g: Ground, paper: string) {
  const { ax, ground, k } = g
  let y = ground + 2
  ctx.lineJoin = 'miter'
  for (const [bw, bh] of ALTAR) {
    const w = bw * k
    const h = bh * k
    const x = ax - w / 2
    y -= h
    ctx.fillStyle = paper
    ctx.fillRect(x, y, w, h)
    // The shaded right side, hatched.
    ctx.beginPath()
    for (let hx = x + w * 0.66; hx < x + w; hx += 2.1) {
      ctx.moveTo(hx, y + 0.5)
      ctx.lineTo(hx, y + h - 0.5)
    }
    ctx.strokeStyle = INK
    ctx.lineWidth = 0.55
    ctx.globalAlpha = 0.75
    ctx.stroke()
    ctx.globalAlpha = 1
    ctx.lineWidth = 1.1
    ctx.strokeRect(x, y, w, h)
    if (bh === 38) {
      // Courses of stone, and the mark cut in the face.
      ctx.beginPath()
      ctx.moveTo(x, y + h * 0.5)
      ctx.lineTo(x + w, y + h * 0.5)
      ctx.lineWidth = 0.6
      ctx.stroke()
      ctx.save()
      const s = (h * 0.42) / 24
      ctx.translate(ax - w * 0.08 - 12 * s, y + h * 0.04 + 1)
      ctx.scale(s, s)
      ctx.lineWidth = 0.9 / s
      ctx.stroke(new Path2D(LOGO_SECTION))
      ctx.restore()
      // The cornice's shadow on the block.
      ctx.beginPath()
      for (let hy = y + 1.5; hy < y + 5 * k; hy += 1.6) {
        ctx.moveTo(x + 1, hy)
        ctx.lineTo(x + w - 1, hy)
      }
      ctx.lineWidth = 0.45
      ctx.globalAlpha = 0.6
      ctx.stroke()
      ctx.globalAlpha = 1
    }
  }
  ctx.lineJoin = 'round'
}

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

export function drawLight(ctx: CanvasRenderingContext2D, g: Ground, light: ReturnType<typeof lightOf>, t: number) {
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
