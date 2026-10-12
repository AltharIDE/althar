import { canvasOf, clamp, css, type Ctx, hex, lerp, loopNoise, mix, type Rgb, seeded, shade, smooth, soft } from './paint'

/*
 * What the passengers see: a clear morning, snow on the far range, blue
 * hills, a forest, then fields running up to the line, and the grass of the
 * embankment going by under the window. Telegraph poles stand along the
 * line with their wires.
 *
 * Each band of it is painted once for the size, as a strip that loops, and
 * slid along by the train's distance at its own share of the speed: the
 * further away, the slower, as from a real window. What gives the speed away
 * is the smear: each strip is kept with copies of itself smeared further
 * and further along the line (each half as wide, stretched back out), and
 * drawn from the copy its speed calls for. So flat out costs no more to
 * draw than standing still.
 *
 * Sizes are in metres where a thing has a real size. A thing standing on
 * the ground at `y` is drawn at (y − horizon) / EYE px a metre, as the eye
 * at the window is EYE metres up: so a farmhouse on the far fields is
 * small and a tree by the line is tall, and the bands keep one perspective.
 */

/** How high the eye at the window is above the ground, in metres. */
export const EYE = 3.5
/** Where the grass that moves at the train's own speed (a share of 1) stands, below the horizon, in window heights. */
const NEAR = 0.3
/** How long the camera's shutter is open, in seconds: how far a thing smears for its speed. */
const EXPOSURE = 1 / 22

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export interface View {
  w: number
  h: number
  dpr: number
  /** The main window, in the first screen's CSS px. */
  win: Box
  /** The horizon's height on the screen. */
  horizon: number
  /** The headline's top and foot: no cloud drifts behind it, so the words always stand on blue. */
  words: { top: number; bottom: number }
}

/** A band of the landscape, painted once, that loops. */
export interface Strip {
  name: string
  /** Sharp, then each copy half as wide: smeared twice as far when stretched back out. Each has PAD of the loop at either end, so the stretch has no seam. */
  levels: HTMLCanvasElement[]
  /** The loop's length, in CSS px. */
  period: number
  top: number
  height: number
  /** Its share of the nearest ground's speed. */
  share: number
  /** How it drifts on its own, in CSS px a second (the clouds). */
  drift: number
}

export interface World {
  view: View
  /** Px a metre at the ground that moves at the train's speed. */
  unit: number
  sky: HTMLCanvasElement
  strips: Strip[]
  poles: Poles
}

export interface Poles {
  /** The ground they stand on, and their top, on the screen. */
  foot: number
  top: number
  /** Px between them along the line, their width, and their share of the speed. */
  spacing: number
  width: number
  share: number
}

/** The pad either side of a strip's loop, in CSS px: as far as the most smeared copy reaches. */
const PAD = 160

/** Px a metre for something standing on the ground at screen height `y`. */
const metreAt = (view: View, y: number) => Math.max(0.05, (y - view.horizon) / EYE)

/** A strip's share of the speed, from the ground it stands on: twice as far down the screen is twice as near, and twice as fast. */
const shareAt = (view: View, ground: number) => (ground - view.horizon) / (NEAR * view.win.h)

function stripOf(
  view: View,
  name: string,
  top: number,
  bottom: number,
  share: number,
  period: number,
  paint: (ctx: Ctx, period: number, height: number) => void,
  drift = 0,
): Strip {
  const height = bottom - top
  const loop = Math.round(period)
  const sharp = canvasOf(loop, height, view.dpr)
  paint(sharp.ctx, loop, height)
  // The loop with PAD of itself either side, so a smeared copy, stretched, reads the loop's far end where it meets the near.
  const padded = canvasOf(loop + PAD * 2, height, view.dpr)
  padded.ctx.setTransform(1, 0, 0, 1, 0, 0)
  const d = view.dpr
  padded.ctx.drawImage(sharp.canvas, Math.round(PAD * d), 0)
  padded.ctx.drawImage(sharp.canvas, Math.round((PAD - loop) * d), 0)
  padded.ctx.drawImage(sharp.canvas, Math.round((PAD + loop) * d), 0)
  // As many smeared copies as its fastest calls for.
  const reach = 92 * metreUnit(view) * share * EXPOSURE
  const most = clamp(Math.ceil(Math.log2(Math.max(1, (reach * d) / 1.5))), 0, 8)
  const levels = [padded.canvas]
  for (let k = 1; k <= most; k++) {
    const last = levels[k - 1]!
    const next = document.createElement('canvas')
    next.width = Math.max(2, Math.round(last.width / 2))
    next.height = last.height
    const ctx = next.getContext('2d')
    if (!ctx) break
    // Halving with the plain filter averages each pair of pixels: the smear, exactly, and quick.
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'low'
    ctx.drawImage(last, 0, 0, next.width, next.height)
    levels.push(next)
  }
  return { name, levels, period: loop, top, height, share, drift }
}

/** Px a metre at the ground that moves at the train's speed. */
export const metreUnit = (view: View) => (NEAR * view.win.h) / EYE

/* ---------------------------------------------------------------- sky */

const SKY = {
  high: hex('#2143c4'),
  upper: hex('#3561da'),
  mid: hex('#5a88e8'),
  low: hex('#a9c4f3'),
  edge: hex('#e6edf7'),
}

function paintSky(view: View) {
  const { canvas, ctx } = canvasOf(view.w, view.h, view.dpr)
  const { win, horizon } = view
  const g = ctx.createLinearGradient(0, 0, 0, horizon + 4)
  const at = (y: number) => clamp(y / (horizon + 4))
  g.addColorStop(0, css(SKY.high))
  g.addColorStop(at(win.y + win.h * 0.12), css(SKY.upper))
  g.addColorStop(at(Math.max(win.y + win.h * 0.2, view.words.bottom)), css(SKY.mid))
  g.addColorStop(at(horizon - win.h * 0.08), css(SKY.low))
  g.addColorStop(1, css(SKY.edge))
  ctx.fillStyle = g
  ctx.fillRect(0, 0, view.w, view.h)
  // The morning's warmth low on the left, where the light comes from.
  const sun = ctx.createRadialGradient(
    win.x - win.w * 0.1,
    horizon - win.h * 0.05,
    0,
    win.x - win.w * 0.1,
    horizon - win.h * 0.05,
    win.w * 0.75,
  )
  sun.addColorStop(0, 'rgba(255, 238, 214, 0.55)')
  sun.addColorStop(0.4, 'rgba(255, 238, 214, 0.18)')
  sun.addColorStop(1, 'rgba(255, 238, 214, 0)')
  ctx.fillStyle = sun
  ctx.fillRect(0, 0, view.w, view.h)
  return canvas
}

/* ------------------------------------------------------------- clouds */

function paintClouds(
  ctx: Ctx,
  period: number,
  height: number,
  k: number,
  seed: number,
  dpr: number,
  clear: { top: number; bottom: number },
) {
  const r = seeded(seed)
  // Every cloud drawn sharp onto three sheets, each then softened once: the undersides, the lit tops, the wisps.
  const under = canvasOf(period, height, dpr)
  const over = canvasOf(period, height, dpr)
  const wisps = canvasOf(period, height, dpr)
  const count = Math.max(4, Math.round(period / (300 * k)))
  for (let c = 0; c < count; c++) {
    const cx = (c + r() * 0.8) * (period / count)
    // High ones above the words, larger and rounder, nearer; low ones under them, smaller and flatter, lying along the far range.
    const high = r() < 0.5
    const lift = r()
    const size = (high ? lerp(0.8, 1.2, lift) : lerp(0.45, 0.8, lift)) * k * (0.75 + r() * 0.5)
    const wide = 220 * size * (0.8 + r() * 0.7)
    const tall = 70 * size * (0.7 + r() * 0.5)
    const above = clear.top - tall * 0.15
    const below = clear.bottom + tall * 1.2
    const base = high ? Math.min(above, lerp(tall * 0.9, above, r())) : lerp(Math.max(below, height * 0.7), height * 0.98, r())
    if (high && above < tall * 0.6) continue
    if (!high && base > height + tall * 0.2) continue
    const puffs = 16 + Math.floor(r() * 12)
    const blobs: Array<{ x: number; y: number; r: number }> = []
    for (let p = 0; p < puffs; p++) {
      const u = r() * 2 - 1
      const along = Math.sign(u) * Math.abs(u) ** 0.8
      const swell = Math.sqrt(1 - along * along)
      const rr = tall * (0.2 + 0.44 * swell) * (0.7 + r() * 0.5)
      blobs.push({ x: cx + (along * wide) / 2, y: base - rr * (0.45 + r() * 0.5) - swell * tall * 0.25 * r(), r: rr })
    }
    for (const shift of [-period, 0, period]) {
      if (cx + shift + wide < -40 || cx + shift - wide > period + 40) continue
      for (const b of blobs) {
        under.ctx.fillStyle = 'rgb(176, 192, 228)'
        under.ctx.beginPath()
        under.ctx.arc(b.x + shift, b.y + b.r * 0.2, b.r, 0, Math.PI * 2)
        under.ctx.fill()
        const g = over.ctx.createRadialGradient(b.x + shift - b.r * 0.35, b.y - b.r * 0.45, 0, b.x + shift, b.y, b.r)
        g.addColorStop(0, 'rgba(255, 255, 255, 1)')
        g.addColorStop(0.65, 'rgba(250, 252, 255, 0.96)')
        g.addColorStop(1, 'rgba(222, 231, 250, 0.3)')
        over.ctx.fillStyle = g
        over.ctx.beginPath()
        over.ctx.arc(b.x + shift, b.y - b.r * 0.1, b.r * 0.86, 0, Math.PI * 2)
        over.ctx.fill()
      }
      // The base flat, as a cumulus's is, trimmed soft.
      for (const sheet of [under.ctx, over.ctx]) {
        sheet.save()
        sheet.globalCompositeOperation = 'destination-out'
        const cut = sheet.createLinearGradient(0, base - tall * 0.1, 0, base + tall * 0.2)
        cut.addColorStop(0, 'rgba(0, 0, 0, 0)')
        cut.addColorStop(1, 'rgba(0, 0, 0, 1)')
        sheet.fillStyle = cut
        sheet.fillRect(cx + shift - wide, base - tall * 0.1, wide * 2, tall * 0.8)
        sheet.restore()
      }
    }
  }
  // Thin streaks low down, lying along the far range.
  for (let s = 0; s < count * 1.6; s++) {
    const x = r() * period
    const y = lerp(height * 0.72, height * 0.98, r())
    const w = (140 + r() * 300) * k
    wisps.ctx.fillStyle = `rgba(255, 255, 255, ${(0.3 + r() * 0.25).toFixed(3)})`
    for (const shift of [-period, 0, period]) {
      wisps.ctx.beginPath()
      wisps.ctx.ellipse(x + shift, y, w / 2, 3.2 * k, 0, 0, Math.PI * 2)
      wisps.ctx.fill()
    }
  }
  soft(ctx, 3.2 * k * dpr, () => ctx.drawImage(under.canvas, 0, 0, period, height))
  soft(ctx, 1.8 * k * dpr, () => ctx.drawImage(over.canvas, 0, 0, period, height))
  soft(ctx, 5 * k * dpr, () => ctx.drawImage(wisps.canvas, 0, 0, period, height))
}

/* ---------------------------------------------------------- mountains */

interface PeaksLook {
  seed: number
  /** Summits a 1000 px of range. */
  density: number
  /** The range's foot, and its highest and lowest summits, in the strip's px. */
  foot: number
  highest: number
  lowest: number
  /** How rough the ridges are: a share of each stretch's length. */
  rough: number
  /** How wide a peak stands for its height, either side. */
  spread: readonly [number, number]
  lit: Rgb
  dark: Rgb
  haze: Rgb
  /** How hazy the furthest peaks are, and the nearest. */
  hazeFar: number
  hazeNear: number
  snow?: { lit: Rgb; dark: Rgb; above: number }
  forest?: Rgb
}

type Pt = readonly [number, number]

/** A ridge from a to b, broken by halving: each middle pushed up or down by `rough` of its stretch. */
function ridge(r: () => number, a: Pt, b: Pt, rough: number, sag: number, depth = 6): Pt[] {
  const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + sag]
  const out: Pt[] = [a]
  const halve = (p: Pt, q: Pt, d: number) => {
    if (d === 0) return
    const len = Math.hypot(q[0] - p[0], q[1] - p[1])
    const m: Pt = [(p[0] + q[0]) / 2 + (r() - 0.5) * len * rough * 0.35, (p[1] + q[1]) / 2 + (r() - 0.5) * len * rough]
    halve(p, m, d - 1)
    out.push(m)
    halve(m, q, d - 1)
  }
  halve(a, mid, depth)
  out.push(mid)
  halve(mid, b, depth)
  out.push(b)
  return out
}

/** A path through points, moved along by `shift`. */
function trace(path: Path2D, points: readonly Pt[], shift: number, start = true) {
  points.forEach(([x, y], i) => (i === 0 && start ? path.moveTo(x + shift, y) : path.lineTo(x + shift, y)))
}

/**
 * A range as single peaks, the furthest first, each lit on its left face and
 * in shadow on its right, split along a spine from the summit, snow on the
 * high ones lying in a broken line and running down the gullies, and the air
 * thickening toward each peak's foot.
 */
function paintPeaks(ctx: Ctx, period: number, look: PeaksLook) {
  const r = seeded(look.seed)
  const count = Math.max(3, Math.round((period / 1000) * look.density))
  const peaks = Array.from({ length: count }, (_, i) => {
    const far = r()
    const top = lerp(look.lowest, look.highest, r() ** 1.3 * (0.55 + 0.45 * far))
    return { x: ((i + r() * 0.9) / count) * period, top, far }
  }).sort((a, b) => b.far - a.far)
  for (const peak of peaks) {
    const tall = look.foot - peak.top
    const left = tall * lerp(look.spread[0], look.spread[1], r())
    const right = tall * lerp(look.spread[0], look.spread[1], r())
    const summit: Pt = [peak.x, peak.top]
    const sag = tall * 0.12
    const west = ridge(r, [peak.x - left, look.foot + 2], summit, look.rough, sag)
    const east = ridge(r, summit, [peak.x + right, look.foot + 2], look.rough, sag)
    const spine = ridge(r, summit, [peak.x + right * (0.15 + r() * 0.35), look.foot + 2], look.rough * 0.7, tall * 0.04, 5)
    const haze = lerp(look.hazeNear, look.hazeFar, peak.far)
    const snowy = look.snow !== undefined && tall > (look.foot - look.highest) * look.snow.above
    const line = peak.top + tall * (0.22 + r() * 0.16)
    const steps: number[] = []
    for (let x = 0; x < left + right;) {
      const step = tall * (0.04 + r() * 0.08)
      x += step
      steps.push(step, r(), r(), r(), r())
    }
    const grain = look.forest ? Array.from({ length: Math.round((left + right) * tall * 0.02) }, () => [r(), r(), r(), r()] as const) : []
    for (const shift of [-period, 0, period]) {
      if (peak.x + right + shift < 0 || peak.x - left + shift > period) continue
      const outline = new Path2D()
      trace(outline, west, shift)
      trace(outline, east.slice(1), shift, false)
      outline.closePath()
      const shadow = new Path2D()
      trace(shadow, spine, shift)
      trace(shadow, [...east].reverse().slice(0, -1), shift, false)
      shadow.closePath()
      ctx.save()
      ctx.clip(outline)
      ctx.fillStyle = css(look.lit)
      ctx.fillRect(peak.x - left + shift - 4, peak.top - 4, left + right + 8, tall + 8)
      ctx.fillStyle = css(look.dark)
      ctx.fill(shadow)
      if (snowy && look.snow) {
        // Snow above a broken line, lower down the gullies.
        const cap = new Path2D()
        let x = peak.x - left
        cap.moveTo(x + shift, peak.top - 10)
        cap.lineTo(x + shift, line)
        for (let i = 0; i < steps.length; i += 5) {
          const step = steps[i]!
          x += step
          const gully = steps[i + 1]! < 0.3 ? tall * (0.1 + steps[i + 2]! * 0.22) : 0
          cap.lineTo(x - step * 0.5 + shift, line + (steps[i + 3]! - 0.5) * tall * 0.1 + gully)
          cap.lineTo(x + shift, line + (steps[i + 4]! - 0.5) * tall * 0.08)
        }
        cap.lineTo(peak.x + right + shift, peak.top - 10)
        cap.closePath()
        ctx.fillStyle = css(look.snow.lit)
        ctx.fill(cap)
        ctx.save()
        ctx.clip(shadow)
        ctx.fillStyle = css(look.snow.dark)
        ctx.fill(cap)
        ctx.restore()
      }
      if (look.forest) {
        // Forest's grain over the lower slopes.
        for (const [a, b, c, d] of grain) {
          ctx.fillStyle = css(look.forest, 0.25 + c * 0.3)
          ctx.beginPath()
          ctx.arc(peak.x - left + a * (left + right) + shift, look.foot - b ** 1.6 * tall * 0.7, 0.8 + d * 1.4, 0, Math.PI * 2)
          ctx.fill()
        }
      }
      // The air, thicker toward the foot, and over the whole of the furthest.
      const air = ctx.createLinearGradient(0, peak.top, 0, look.foot)
      air.addColorStop(0, css(look.haze, haze * 0.55))
      air.addColorStop(1, css(look.haze, Math.min(0.95, haze * 1.5 + 0.2)))
      ctx.fillStyle = air
      ctx.fillRect(peak.x - left + shift - 4, peak.top - 4, left + right + 8, tall + 8)
      ctx.restore()
    }
  }
}

/* ------------------------------------------------------------ forests */

function paintForest(ctx: Ctx, period: number, height: number, seed: number, k: number) {
  const n = loopNoise(seed, period)
  const r = seeded(seed + 1)
  const top = height * 0.25
  const ridgeAt = (x: number) => lerp(top, height * 0.82, n(x, 340 * k, 4) ** 1.2)
  const body = hex('#355651')
  const crown = hex('#2b4a45')
  const lit = hex('#4d6e62')
  ctx.fillStyle = css(body)
  ctx.beginPath()
  ctx.moveTo(0, height)
  for (let x = 0; x <= period; x += 2) ctx.lineTo(x, ridgeAt(x))
  ctx.lineTo(period, height)
  ctx.closePath()
  ctx.fill()
  // Crowns along the ridge, and through the forest below it, darker as they go down.
  const crowns = Math.round(period / (2.2 * k))
  for (let c = 0; c < crowns; c++) {
    const x = r() * period
    const ridge = ridgeAt(x)
    const y = ridge + r() ** 2.2 * (height - ridge)
    const size = (1.6 + r() * 2.6) * k * (0.9 + (y / height) * 0.4)
    for (const shift of [-period, 0, period]) {
      const cx = x + shift
      if (cx < -10 || cx > period + 10) continue
      ctx.fillStyle = css(r() < 0.3 ? lit : crown, 0.9)
      ctx.beginPath()
      ctx.ellipse(cx, y, size, size * 1.25, 0, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.save()
  ctx.globalCompositeOperation = 'source-atop'
  const haze = ctx.createLinearGradient(0, top, 0, height)
  haze.addColorStop(0, 'rgba(160, 182, 212, 0.38)')
  haze.addColorStop(1, 'rgba(176, 196, 222, 0.62)')
  ctx.fillStyle = haze
  ctx.fillRect(0, 0, period, height)
  ctx.restore()
}

/* ------------------------------------------------------------- fields */

interface FieldsLook {
  seed: number
  /** Where its ground starts and ends, in the strip's px. */
  ground: number
  bottom: number
  /** Px a metre at its ground's top and bottom. */
  near: number
  far: number
  palette: Rgb[]
  hedge: Rgb
  tree: Rgb
  treeLit: Rgb
  haze: Rgb
  hazeBy: number
  /** Trees a 100 m of line, and their height in metres. */
  trees: number
  treeHeight: readonly [number, number]
  /** Farmhouses a km of line. */
  houses: number
  /** Px of the strip above the ground that tall things may reach into. */
  room: number
}

function paintFields(ctx: Ctx, period: number, height: number, look: FieldsLook) {
  const r = seeded(look.seed)
  const n = loopNoise(look.seed + 5, period)
  const span = look.bottom - look.ground
  // Bands of crops running along the line, taller as they come nearer.
  let y = look.ground
  const bands: number[] = []
  while (y < look.bottom) {
    bands.push(y)
    const near = lerp(look.far, look.near, (y - look.ground) / span)
    y += Math.max(2, near * (6 + r() * 14))
  }
  bands.push(look.bottom)
  for (let b = 0; b < bands.length - 1; b++) {
    const top = bands[b]!
    const foot = bands[b + 1]!
    // Each band is patches of field along the line, their ends slanting as lanes and ditches do, running away from the eye.
    const metre = lerp(look.far, look.near, (top - look.ground) / span)
    const ends: Array<{ x: number; lean: number }> = []
    for (let x = 0; x < period - metre * 30; x += metre * (40 + r() * 160)) ends.push({ x, lean: (r() - 0.5) * 1.6 })
    ends.push({ x: period, lean: ends[0]!.lean })
    const deep = foot - top
    for (let i = 0; i < ends.length - 1; i++) {
      const a = ends[i]!
      const b = ends[i + 1]!
      const colour = look.palette[Math.floor(r() * look.palette.length)]!
      const tint = shade(colour, (r() - 0.5) * 0.14)
      const rows = Math.floor(deep / Math.max(1.4, metre * 0.6))
      const furrow = r() < 0.5 ? -0.08 : 0.07
      for (const shift of [-period, 0, period]) {
        if (b.x + shift + deep * 2 < 0 || a.x + shift - deep * 2 > period) continue
        const patch = new Path2D()
        patch.moveTo(a.x + shift - 0.5, top - 0.5)
        patch.lineTo(b.x + shift + 0.5, top - 0.5)
        patch.lineTo(b.x + b.lean * deep + shift + 0.5, foot + 0.5)
        patch.lineTo(a.x + a.lean * deep + shift - 0.5, foot + 0.5)
        patch.closePath()
        ctx.fillStyle = css(tint)
        ctx.fill(patch)
        // Rows of the crop, faint, along the line.
        ctx.save()
        ctx.clip(patch)
        ctx.fillStyle = css(shade(tint, furrow), 0.55)
        for (let row = 0; row < rows; row++)
          ctx.fillRect(a.x + shift - deep * 2, top + ((row + 0.5) * deep) / rows, b.x - a.x + deep * 4, Math.max(0.4, metre * 0.12))
        ctx.restore()
      }
    }
    // A hedge between the bands, now and then: a row of bushes, gappy.
    if (r() < 0.5) {
      const tall = Math.max(1, metre * (1.2 + r() * 1.4))
      for (let hx = 0; hx < period; hx += Math.max(1.2, tall * 0.45)) {
        const lump = n(hx + b * 97, metre * 8, 3)
        if (lump < 0.42) continue
        const rr = tall * (0.45 + lump * 0.5) * (0.8 + r() * 0.4)
        ctx.fillStyle = css(shade(look.hedge, (r() - 0.5) * 0.15))
        ctx.beginPath()
        ctx.arc(hx, top - rr * 0.55, rr, 0, Math.PI * 2)
        ctx.fill()
        if (r() < 0.4) {
          ctx.fillStyle = css(look.treeLit, 0.55)
          ctx.beginPath()
          ctx.arc(hx - rr * 0.3, top - rr * 0.9, rr * 0.45, 0, Math.PI * 2)
          ctx.fill()
        }
      }
    }
  }
  // Variation over the whole: light and shade drifting across the land.
  for (let x = 0; x < period; x += 3) {
    const cloud = n(x, 260, 3)
    ctx.fillStyle = cloud > 0.5 ? css([255, 250, 230], (cloud - 0.5) * 0.18) : css([20, 40, 30], (0.5 - cloud) * 0.22)
    ctx.fillRect(x, look.ground, 3.5, span)
  }
  // Farmhouses: a white wall and a dark roof, small, on the far ground.
  // Counted by the ground's middle: at its top, by the horizon, a metre is next to nothing.
  const middle = lerp(look.far, look.near, 0.5)
  const houses = Math.round((period / middle / 1000) * look.houses)
  for (let h = 0; h < houses; h++) {
    const hx = r() * period
    const gy = look.ground + r() ** 1.8 * span * 0.5
    const m = lerp(look.far, look.near, (gy - look.ground) / span)
    const w = m * (9 + r() * 8)
    const wall = m * (4 + r() * 2)
    const roof = m * (3 + r() * 1.5)
    ctx.fillStyle = css(r() < 0.6 ? hex('#efe9df') : hex('#c9b8a0'))
    ctx.fillRect(hx, gy - wall, w, wall)
    ctx.fillStyle = css(shade(hex('#ece6dc'), -0.25), 0.9)
    ctx.fillRect(hx + w * 0.62, gy - wall, w * 0.38, wall)
    ctx.fillStyle = css(r() < 0.5 ? hex('#8a3b2c') : hex('#3d3f46'))
    ctx.beginPath()
    ctx.moveTo(hx - m * 0.6, gy - wall)
    ctx.lineTo(hx + w * 0.5, gy - wall - roof)
    ctx.lineTo(hx + w + m * 0.6, gy - wall)
    ctx.closePath()
    ctx.fill()
  }
  // Trees: round crowns on a dark trunk, lit on the left, standing on their own ground.
  const trees = Math.round((period / middle / 100) * look.trees)
  const placed: Array<{ x: number; y: number; m: number; h: number }> = []
  for (let t = 0; t < trees; t++) {
    // In copses as often as alone.
    const at = t > 0 && r() < 0.55 ? placed[placed.length - 1]!.x + (r() - 0.3) * 14 * middle : r() * period
    const gy = look.ground + r() ** 1.5 * span * 0.85
    const m = lerp(look.far, look.near, (gy - look.ground) / span)
    const h = m * lerp(look.treeHeight[0], look.treeHeight[1], r())
    // Never taller than the strip has room for above it.
    placed.push({ x: ((at % period) + period) % period, y: gy, m, h: Math.min(h, gy - 2) })
  }
  placed.sort((a, b) => a.y - b.y)
  for (const t of placed) {
    for (const shift of [-period, 0, period]) {
      const x = t.x + shift
      if (x < -t.h || x > period + t.h) continue
      drawTree(ctx, x, t.y, t.h, t.m, look, r)
    }
  }
  // The air between, over the far edge.
  ctx.save()
  ctx.globalCompositeOperation = 'source-atop'
  const haze = ctx.createLinearGradient(0, look.ground - look.room, 0, look.bottom)
  haze.addColorStop(0, css(look.haze, look.hazeBy))
  haze.addColorStop(1, css(look.haze, look.hazeBy * 0.35))
  ctx.fillStyle = haze
  ctx.fillRect(0, 0, period, height)
  ctx.restore()
}

/** A tree on its ground: mostly round crowns, some poplars, some firs. Lit from the left. */
function drawTree(ctx: Ctx, x: number, ground: number, tall: number, metre: number, look: FieldsLook, r: () => number) {
  const kind = r()
  const dark = shade(look.tree, -0.18)
  const trunk = Math.max(0.6, metre * 0.45)
  if (kind < 0.18) {
    // A fir: tiers narrowing to a point.
    const wide = tall * (0.32 + r() * 0.1)
    ctx.fillStyle = css(dark)
    ctx.fillRect(x - trunk / 2, ground - tall * 0.15, trunk, tall * 0.15)
    const tiers = 5
    for (let t = 0; t < tiers; t++) {
      const k = t / tiers
      const base = ground - tall * (0.1 + k * 0.78)
      const half = (wide / 2) * (1 - k * 0.85)
      ctx.fillStyle = css(shade(look.tree, -0.25 + k * 0.08))
      ctx.beginPath()
      ctx.moveTo(x - half, base)
      ctx.quadraticCurveTo(x - half * 0.3, base - tall * 0.12, x, base - tall * 0.24)
      ctx.quadraticCurveTo(x + half * 0.3, base - tall * 0.12, x + half, base)
      ctx.closePath()
      ctx.fill()
    }
    return
  }
  // Round crowns and poplars: an outline of clumps over a dark mass, lit clumps on the light's side.
  const poplar = kind < 0.42
  const wide = poplar ? tall * (0.2 + r() * 0.06) : tall * (0.5 + r() * 0.22)
  const crown = poplar ? tall * 0.88 : tall * (0.66 + r() * 0.1)
  const cy = ground - tall + crown / 2
  ctx.fillStyle = css(dark)
  ctx.fillRect(x - trunk / 2, ground - tall + crown * 0.8, trunk, tall - crown * 0.8)
  ctx.fillStyle = css(dark)
  ctx.beginPath()
  ctx.ellipse(x, cy + crown * 0.04, wide * 0.44, crown * 0.44, 0, 0, Math.PI * 2)
  ctx.fill()
  const clumps = poplar ? 14 : 18 + Math.floor(r() * 8)
  for (let c = 0; c < clumps; c++) {
    const a = r() * Math.PI * 2
    const d = 0.55 + r() * 0.45
    const cx = x + Math.cos(a) * d * wide * 0.42
    const yy = cy + Math.sin(a) * d * crown * 0.42
    const rr = Math.max(0.8, wide * (poplar ? 0.16 : 0.13) * (0.7 + r() * 0.6))
    // Toward the top left, lighter.
    const lit = clamp(0.5 - Math.cos(a + 0.8) * 0.5)
    ctx.fillStyle = css(mix(look.tree, look.treeLit, lit * 0.8 * r()))
    ctx.beginPath()
    ctx.arc(cx, yy, rr, 0, Math.PI * 2)
    ctx.fill()
  }
  for (let c = 0; c < clumps / 3; c++) {
    const cx = x - wide * (0.05 + r() * 0.3)
    const yy = cy - crown * (0.1 + r() * 0.28)
    const rr = Math.max(0.6, wide * 0.1 * (0.6 + r() * 0.6))
    ctx.fillStyle = css(look.treeLit, 0.7)
    ctx.beginPath()
    ctx.arc(cx, yy, rr, 0, Math.PI * 2)
    ctx.fill()
  }
}

/* --------------------------------------------------------- embankment */

function paintBank(ctx: Ctx, period: number, height: number, seed: number, metre: number) {
  const r = seeded(seed)
  const n = loopNoise(seed + 2, period)
  const crest = height * 0.18
  const crestAt = (x: number) => crest + (n(x, metre * 9, 4) - 0.5) * metre * 1.6
  const base = hex('#3c5a2a')
  const g = ctx.createLinearGradient(0, crest - metre, 0, height)
  g.addColorStop(0, css(hex('#5c7d3a')))
  g.addColorStop(0.35, css(base))
  g.addColorStop(1, css(hex('#2a3f1e')))
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.moveTo(0, height)
  for (let x = 0; x <= period; x += 2) ctx.lineTo(x, crestAt(x))
  ctx.lineTo(period, height)
  ctx.closePath()
  ctx.fill()
  // Bushes along the crest, now and then.
  const bushes = Math.round(period / (metre * 14))
  for (let b = 0; b < bushes; b++) {
    const x = r() * period
    const size = metre * (0.6 + r() * 1.3)
    const y = crestAt(x) + size * 0.3
    for (let c = 0; c < 9; c++) {
      const cx = x + (r() - 0.5) * size * 2.2
      const cy = y - r() * size * 0.9
      const rr = size * (0.35 + r() * 0.45)
      for (const shift of [-period, 0, period]) {
        if (cx + shift < -rr || cx + shift > period + rr) continue
        ctx.fillStyle = css(r() < 0.35 ? hex('#4f7234') : hex('#263d1c'), 0.95)
        ctx.beginPath()
        ctx.arc(cx + shift, cy, rr, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }
  // Grass: blades, leaning a little, in many greens, thickest at the crest.
  const blades = Math.round((period * height) / (metre * 0.9))
  const greens = ['#6f9440', '#55782f', '#86a64c', '#2f4a21', '#9bb257', '#46672b'].map(hex)
  ctx.lineCap = 'round'
  for (let i = 0; i < blades; i++) {
    const x = r() * period
    const top = crestAt(x)
    const y = top + r() ** 1.6 * (height - top)
    const tall = metre * (0.15 + r() * 0.35) * (y < top + metre ? 1.4 : 1)
    const lean = (r() - 0.35) * tall * 0.5
    ctx.strokeStyle = css(greens[Math.floor(r() * greens.length)]!, 0.75)
    ctx.lineWidth = Math.max(0.6, metre * 0.035)
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.quadraticCurveTo(x + lean * 0.3, y - tall * 0.6, x + lean, y - tall)
    ctx.stroke()
  }
  // Flowers in the grass.
  for (let i = 0; i < blades / 40; i++) {
    const x = r() * period
    const top = crestAt(x)
    const y = top + r() * (height - top) * 0.7
    ctx.fillStyle = r() < 0.6 ? 'rgba(244, 232, 140, 0.9)' : 'rgba(255, 255, 255, 0.85)'
    ctx.beginPath()
    ctx.arc(x, y, Math.max(0.7, metre * 0.05), 0, Math.PI * 2)
    ctx.fill()
  }
}

/* -------------------------------------------------------------- world */

export function bakeWorld(view: View): World {
  const { win, horizon: hz, w } = view
  const wh = win.h
  const k = clamp(wh / 640, 0.5, 1.6)
  const unit = metreUnit(view)
  const wide = Math.max(1400, w * 2)

  const sky = paintSky(view)
  const strips: Strip[] = []
  const cloudTop = win.y - wh * 0.05
  const cloudFoot = hz - wh * 0.1
  const clear = { top: view.words.top - cloudTop, bottom: view.words.bottom - cloudTop }
  strips.push(
    stripOf(
      view,
      'clouds',
      cloudTop,
      cloudFoot,
      0.002,
      wide * 1.3,
      (ctx, p, h) => paintClouds(ctx, p, h, k, 11, view.dpr, clear),
      -1.5 * k,
    ),
  )

  const farTop = hz - wh * 0.22
  strips.push(
    stripOf(view, 'range', farTop, hz + 2, 0.006, wide * 1.2, (ctx, p, h) =>
      paintPeaks(ctx, p, {
        seed: 21,
        density: 9 / k,
        foot: h - 2,
        highest: wh * 0.01,
        lowest: h - wh * 0.08,
        rough: 0.34,
        spread: [1.1, 2.1],
        lit: hex('#a9b9e2'),
        dark: hex('#6276b0'),
        haze: hex('#cfdcf2'),
        hazeFar: 0.5,
        hazeNear: 0.12,
        snow: { lit: hex('#f7f9ff'), dark: hex('#b4c2e6'), above: 0.45 },
      }),
    ),
  )
  const midTop = hz - wh * 0.12
  strips.push(
    stripOf(view, 'foothills', midTop, hz + 3, 0.016, wide, (ctx, p, h) =>
      paintPeaks(ctx, p, {
        seed: 33,
        density: 11 / k,
        foot: h - 1,
        highest: wh * 0.01,
        lowest: h - wh * 0.05,
        rough: 0.16,
        spread: [1.8, 3.4],
        lit: hex('#6c86b6'),
        dark: hex('#4d6497'),
        haze: hex('#bccbe8'),
        hazeFar: 0.45,
        hazeNear: 0.1,
        forest: hex('#3c5677'),
      }),
    ),
  )
  const forestTop = hz - wh * 0.085
  strips.push(stripOf(view, 'forest', forestTop, hz + wh * 0.02, 0.04, wide, (ctx, p, h) => paintForest(ctx, p, h, 41, k)))

  // The fields, three bands, each its own ground and speed.
  const bands = [
    { name: 'far fields', from: 0, to: 0.05, room: 0.05, seed: 51, trees: 2.6, treeHeight: [8, 16] as const, houses: 7, hazeBy: 0.38 },
    { name: 'fields', from: 0.045, to: 0.135, room: 0.12, seed: 61, trees: 1.4, treeHeight: [7, 13] as const, houses: 3, hazeBy: 0.16 },
    { name: 'near fields', from: 0.125, to: 0.27, room: 0.1, seed: 71, trees: 0.5, treeHeight: [3, 6] as const, houses: 0, hazeBy: 0.04 },
  ]
  const palettes = [
    ['#8fa874', '#9fb07a', '#b4b47e', '#7f9a6c', '#a7b88a'],
    ['#7d9a55', '#93a85c', '#b1ad64', '#6c8b4c', '#9db36a'],
    ['#6f8f45', '#86a04e', '#a6a656', '#5d7e3d', '#91ab58'],
  ]
  bands.forEach((band, i) => {
    const groundTop = hz + band.from * wh
    const groundFoot = hz + band.to * wh
    const top = groundTop - band.room * wh
    const share = shareAt(view, (groundTop + groundFoot) / 2)
    strips.push(
      stripOf(view, band.name, top, groundFoot + 2, share, wide, (ctx, p, h) =>
        paintFields(ctx, p, h, {
          seed: band.seed,
          ground: groundTop - top,
          bottom: h,
          far: metreAt(view, groundTop),
          near: metreAt(view, groundFoot),
          palette: palettes[i]!.map(hex),
          hedge: hex(i === 0 ? '#4c6a52' : '#2f4a2c'),
          tree: hex(i === 0 ? '#45624f' : '#2d4a2b'),
          treeLit: hex(i === 0 ? '#6a8467' : '#557a3e'),
          haze: hex('#c9d8ee'),
          hazeBy: band.hazeBy,
          trees: band.trees,
          treeHeight: band.treeHeight,
          houses: band.houses,
          room: band.room * wh,
        }),
      ),
    )
  })

  const bankTop = hz + wh * 0.235
  const bankFoot = Math.max(win.y + wh + wh * 0.04, bankTop + 20)
  const bankMetre = metreAt(view, hz + NEAR * wh)
  strips.push(stripOf(view, 'embankment', bankTop, bankFoot, 1, wide, (ctx, p, h) => paintBank(ctx, p, h, 81, bankMetre)))

  // Telegraph poles along the line, standing just below the window's sill.
  const foot = win.y + wh * 1.02
  const poleMetre = metreAt(view, foot)
  const poles: Poles = {
    foot,
    top: foot - poleMetre * 9.6,
    spacing: poleMetre * 52,
    width: Math.max(4, poleMetre * 0.26),
    share: shareAt(view, foot),
  }
  return { view, unit, sky, strips, poles }
}

/** Where a strip's loop starts on the screen, for the train's distance in metres and the second. */
const offsetOf = (strip: Strip, unit: number, metres: number, t: number) => {
  const x = metres * unit * strip.share - strip.drift * t
  return ((x % strip.period) + strip.period) % strip.period
}

/** Draws one level of a strip across the screen, from its offset. */
function drawLevel(ctx: Ctx, strip: Strip, level: number, offset: number, w: number, y: number, dpr: number) {
  const canvas = strip.levels[level]!
  const scale = canvas.width / ((strip.period + PAD * 2) * dpr)
  const sx = PAD * dpr * scale
  const sw = strip.period * dpr * scale
  for (let x = -offset; x < w; x += strip.period) {
    ctx.drawImage(canvas, sx, 0, sw, canvas.height, x, y, strip.period, strip.height)
  }
}

export interface Moment {
  /** Metres gone. */
  metres: number
  /** Metres a second. */
  speed: number
  /** Seconds since the page opened. */
  t: number
  /** How far the world sits from where it rests, in CSS px: the carriage's rock. */
  bob: number
}

/** Draws what the windows look out on, for this moment. */
export function drawWorld(ctx: Ctx, world: World, now: Moment) {
  const { view, unit, sky, strips } = world
  ctx.drawImage(sky, 0, 0, view.w, view.h)
  for (const strip of strips) {
    const offset = offsetOf(strip, unit, now.metres, now.t)
    const reach = now.speed * unit * strip.share * EXPOSURE
    const want = Math.log2(Math.max(1, (reach * view.dpr) / 1.5))
    const most = strip.levels.length - 1
    const at = clamp(want, 0, most)
    const lo = Math.floor(at)
    const f = at - lo
    const y = strip.top + now.bob * Math.min(1, strip.share * 1.5 + 0.2)
    drawLevel(ctx, strip, lo, offset, view.w, y, view.dpr)
    if (f > 0.02 && lo < most) {
      ctx.globalAlpha = f
      drawLevel(ctx, strip, lo + 1, offset, view.w, y, view.dpr)
      ctx.globalAlpha = 1
    }
  }
  drawPoles(ctx, world, now)
}

/** The telegraph poles and their wires, drawn each frame, smeared by their speed. */
function drawPoles(ctx: Ctx, world: World, now: Moment) {
  const { poles, unit, view } = world
  const along = now.metres * unit * poles.share
  const reach = now.speed * unit * poles.share * EXPOSURE
  const first = Math.floor((along - view.w) / poles.spacing) - 1
  const last = Math.ceil((along + view.w * 2) / poles.spacing) + 1
  const bob = now.bob
  const tall = poles.foot - poles.top
  const arm = poles.top + tall * 0.05
  // How solid a pole looks, smeared over its reach.
  const solid = poles.width / (poles.width + reach)
  const xs: number[] = []
  for (let i = first; i <= last; i++) xs.push(i * poles.spacing - along + view.w * 0.5)
  // Wires: a sag between each pair, smeared into a band when fast, as they rise and fall past the eye.
  const sag = tall * 0.085
  const wires = [0, 0.018, 0.036].map((d) => arm + tall * d)
  const samples = reach > 6 ? 5 : 1
  ctx.lineWidth = Math.max(0.8, poles.width * 0.12)
  for (let s = 0; s < samples; s++) {
    const shift = samples === 1 ? 0 : (s / (samples - 1) - 0.5) * reach
    ctx.strokeStyle = `rgba(28, 32, 40, ${(0.62 / samples ** 0.6).toFixed(3)})`
    ctx.beginPath()
    for (let i = 0; i < xs.length - 1; i++) {
      const a = xs[i]! + shift
      const b = xs[i + 1]! + shift
      if (b < -10 || a > view.w + 10) continue
      for (const y of wires) {
        ctx.moveTo(a, y + bob)
        ctx.quadraticCurveTo((a + b) / 2, y + bob + sag * 2, b, y + bob)
      }
    }
    ctx.stroke()
  }
  for (const x of xs) {
    if (x + reach < -40 || x - reach > view.w + 40) continue
    const left = x - poles.width / 2 - reach / 2
    const wide = poles.width + reach
    const g = ctx.createLinearGradient(left, 0, left + wide, 0)
    const edge = Math.min(0.5, reach / wide / 2 + 0.08)
    const body = `rgba(36, 30, 26, ${solid.toFixed(3)})`
    g.addColorStop(0, 'rgba(36, 30, 26, 0)')
    g.addColorStop(edge, body)
    g.addColorStop(1 - edge, body)
    g.addColorStop(1, 'rgba(36, 30, 26, 0)')
    ctx.fillStyle = g
    ctx.fillRect(left, poles.top + bob, wide, tall)
    // The cross-arm and its insulators.
    ctx.fillRect(left - poles.width * 2.6, arm - poles.width * 0.4 + bob, wide + poles.width * 5.2, poles.width * 0.55)
    // The lit edge, on the light's side, while it is slow enough to see.
    if (reach < 4) {
      ctx.fillStyle = 'rgba(230, 210, 180, 0.35)'
      ctx.fillRect(x - poles.width / 2, poles.top + bob, Math.max(1, poles.width * 0.22), tall)
    }
  }
}

/** For the carriage's light: how much of the sky the nearest things let through, 0.85 to 1, slow to change. */
export const lightAt = (world: World, metres: number) => {
  const { poles, unit, view } = world
  const along = metres * unit * poles.share
  const phase = ((along - view.w * 0.5) % poles.spacing) / poles.spacing
  const near = Math.min(phase, 1 - phase) * poles.spacing
  return 1 - 0.1 * Math.exp(-((near / (view.win.w * 0.12)) ** 2))
}

export { lerp, smooth }
