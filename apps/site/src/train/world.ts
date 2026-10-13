import farUrl from './plate/far.webp'
import fieldsUrl from './plate/fields.webp'
import grassUrl from './plate/grass.webp'
import { SPEED } from './journey'
import { clamp, type Ctx } from './paint'

/*
 * What the passengers see: a snowy range under a clear morning sky, then
 * farmland running up to the line, and the grass of the embankment going by
 * under the window. Telegraph poles stand along the line with their wires.
 *
 * Each is a photograph, looped (the range mirrored, the others crossfaded
 * end to end), and slid along by the train's distance at its own share of
 * the speed: the range barely moves, the fields go by, the grass rushes.
 * What gives the speed away is the smear: each photograph is kept with
 * copies of itself smeared further and further along the line (each half as
 * wide, stretched back out), and drawn from the copy its speed calls for. So
 * flat out costs no more to draw than standing still.
 *
 * Distances are in metres: the grass by the line is NEAR window heights
 * below the horizon, the eye EYE metres up, so a metre there is
 * NEAR × window height / EYE px, and everything else moves by its share.
 */

/** How high the eye at the window is above the ground, in metres. */
export const EYE = 3.5
/** Where the ground that moves at the train's own speed (a share of 1) stands, below the horizon, in window heights. */
const NEAR = 0.3
/** How long the camera's shutter is open, in seconds, slow and flat out: how far a thing smears for its speed. Short at first, so the grass is crisp as the train pulls away; long when flying, so everything near is streaks. */
const EXPOSURE = { slow: 1 / 90, fast: 1 / 22 } as const
/** The pad either side of a loop, in the photograph's px: as far as the most smeared copy reaches. */
const PAD = 300

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
  /** The middle window, in the first screen's CSS px. */
  win: Box
  /** The horizon's height on the screen. */
  horizon: number
}

/** The photographs, loaded. */
export interface Pictures {
  far: HTMLImageElement
  fields: HTMLImageElement
  grass: HTMLImageElement
}

export const PICTURES = { far: farUrl, fields: fieldsUrl, grass: grassUrl } as const

/** Where each photograph stands, in its own px: the row that sits on a line in the window, and how tall it is shown. */
const LAYOUT = {
  /** The range: its highest summit just under the words, the photograph a window and a half tall. */
  far: { row: 739, at: 0.56, tall: 2.15, share: 0.004, start: 770, grade: 'saturate(0.94)' },
  /** The farmland: the tops of its trees on the horizon. */
  fields: { row: 347, at: 0.67, tall: 1.1, share: 0.34, start: 400, grade: 'saturate(0.92) brightness(0.98)' },
  /** The grass: its thick part along the window's foot, its tallest stems reaching up toward the fields. */
  grass: { row: 422, at: 0.92, tall: 1, share: 1, start: 0, grade: 'saturate(0.86) brightness(0.9) sepia(0.1)' },
} as const

/** A photograph, looped, with its smeared copies. */
export interface Strip {
  /** Sharp, then each copy half as wide: smeared twice as far when stretched back out. Each has PAD of the loop either side. */
  levels: HTMLCanvasElement[]
  /** The loop's width in the photograph's own px, without the pads. */
  native: number
  /** The loop's length, and where its top stands and how tall it is, in CSS px. */
  period: number
  top: number
  height: number
  /** Its share of the train's speed. */
  share: number
  /** Where the loop starts, so the best of it is in the window first. */
  start: number
}

export interface World {
  view: View
  /** Px a metre at the ground that moves at the train's speed. */
  unit: number
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
  /** Where the first stands at the start, so one goes by while the train is still slow. */
  phase: number
}

/** Px a metre for something standing on the ground at screen height `y`. */
const metreAt = (view: View, y: number) => Math.max(0.05, (y - view.horizon) / EYE)

/** Px a metre at the ground that moves at the train's speed. */
export const metreUnit = (view: View) => (NEAR * view.win.h) / EYE

/** A photograph as a strip: padded with its own ends, graded, and smeared as far as its fastest calls for. */
function stripOf(view: View, picture: HTMLImageElement, look: (typeof LAYOUT)[keyof typeof LAYOUT]): Strip {
  const { win } = view
  const scale = (look.tall * win.h) / picture.naturalHeight
  const native = picture.naturalWidth
  const height = picture.naturalHeight
  const padded = document.createElement('canvas')
  padded.width = native + PAD * 2
  padded.height = height
  const ctx = padded.getContext('2d')
  if (!ctx) throw new Error('no 2d context')
  ctx.filter = look.grade
  for (const x of [PAD - native, PAD, PAD + native]) ctx.drawImage(picture, x, 0)
  const period = native * scale
  const reach = SPEED.fast * metreUnit(view) * look.share * EXPOSURE.fast
  const most = clamp(Math.ceil(Math.log2(Math.max(1, reach / scale / 1.5))), 0, 8)
  const levels = [padded]
  for (let k = 1; k <= most; k++) {
    const last = levels[k - 1]!
    const next = document.createElement('canvas')
    next.width = Math.max(2, Math.round(last.width / 2))
    next.height = last.height
    const c = next.getContext('2d')
    if (!c) break
    // Halving with the plain filter averages each pair of pixels: the smear, exactly, and quick.
    c.imageSmoothingEnabled = true
    c.imageSmoothingQuality = 'low'
    c.drawImage(last, 0, 0, next.width, next.height)
    levels.push(next)
  }
  const top = win.y + look.at * win.h - look.row * scale
  // The start in the photograph's px brought to the window's middle.
  const start = look.start * scale - (win.x + win.w / 2)
  return { levels, native, period, top, height: height * scale, share: look.share, start }
}

export function bakeWorld(view: View, pictures: Pictures): World {
  const { win } = view
  const strips = [
    stripOf(view, pictures.far, LAYOUT.far),
    stripOf(view, pictures.fields, LAYOUT.fields),
    stripOf(view, pictures.grass, LAYOUT.grass),
  ]
  // Telegraph poles along the line, standing just below the window's sill.
  const foot = win.y + win.h * 1.02
  const poleMetre = metreAt(view, foot)
  const share = (foot - view.horizon) / (NEAR * win.h)
  const unit = metreUnit(view)
  const poles: Poles = {
    foot,
    top: foot - poleMetre * 9.6,
    spacing: poleMetre * 52,
    width: Math.max(4, poleMetre * 0.26),
    share,
    // At the window's far edge a second after the carriage is lit.
    phase: win.x + win.w + SPEED.slow * unit * share * 1.6,
  }
  return { view, unit, strips, poles }
}

/** Where a strip's loop starts on the screen, for the train's distance in metres. */
const offsetOf = (strip: Strip, unit: number, metres: number) => {
  const x = strip.start + metres * unit * strip.share
  return ((x % strip.period) + strip.period) % strip.period
}

/** Draws one level of a strip across the screen, from its offset. */
function drawLevel(ctx: Ctx, strip: Strip, level: number, offset: number, w: number, y: number) {
  const canvas = strip.levels[level]!
  const k = canvas.width / (strip.native + PAD * 2)
  const sx = PAD * k
  const sw = strip.native * k
  for (let x = -offset; x < w; x += strip.period) ctx.drawImage(canvas, sx, 0, sw, canvas.height, x, y, strip.period, strip.height)
}

export interface Moment {
  /** Metres gone. */
  metres: number
  /** Metres a second, and how far from slow to flat out that is, 0 to 1. */
  speed: number
  pace: number
  /** Seconds since the page opened. */
  t: number
  /** How far the world sits from where it rests, in CSS px: the carriage's rock. */
  bob: number
}

/** The shutter for how far to flat out the train is. */
const shutterAt = (pace: number) => EXPOSURE.slow + (EXPOSURE.fast - EXPOSURE.slow) * clamp(pace)

/** Draws what the windows look out on, for this moment. */
export function drawWorld(ctx: Ctx, world: World, now: Moment) {
  const { view, unit, strips } = world
  const exposure = shutterAt(now.pace)
  for (const strip of strips) {
    const offset = offsetOf(strip, unit, now.metres)
    // How far it smears, in the photograph's own px.
    const reach = (now.speed * unit * strip.share * exposure * strip.native) / strip.period
    const want = Math.log2(Math.max(1, reach / 1.5))
    const most = strip.levels.length - 1
    const at = clamp(want, 0, most)
    const lo = Math.floor(at)
    const f = at - lo
    const y = strip.top + now.bob * Math.min(1, strip.share * 1.5 + 0.2)
    drawLevel(ctx, strip, lo, offset, view.w, y)
    if (f > 0.02 && lo < most) {
      ctx.globalAlpha = f
      drawLevel(ctx, strip, lo + 1, offset, view.w, y)
      ctx.globalAlpha = 1
    }
  }
  drawPoles(ctx, world, now)
}

/** The telegraph poles and their wires, drawn each frame, smeared by their speed. */
function drawPoles(ctx: Ctx, world: World, now: Moment) {
  const { poles, unit, view } = world
  const along = now.metres * unit * poles.share
  const reach = now.speed * unit * poles.share * shutterAt(now.pace)
  const first = Math.floor((along - poles.phase - view.w) / poles.spacing) - 1
  const last = Math.ceil((along - poles.phase + view.w * 2) / poles.spacing) + 1
  const bob = now.bob
  const tall = poles.foot - poles.top
  const arm = poles.top + tall * 0.05
  const xs: number[] = []
  for (let i = first; i <= last; i++) xs.push(i * poles.spacing - along + poles.phase)
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
    // Weathered wood, dark against the sky, its edge toward the low sun lit warm; smeared thinner the faster it goes.
    const solid = Math.min(1, (poles.width / wide) * 1.2)
    const g = ctx.createLinearGradient(left, 0, left + wide, 0)
    const edge = Math.min(0.5, reach / wide / 2 + 0.04)
    const lit = reach < 8 ? 1 - reach / 8 : 0
    g.addColorStop(0, `rgba(42, 30, 21, 0)`)
    g.addColorStop(
      edge,
      `rgba(${Math.round(42 + 90 * lit)}, ${Math.round(30 + 62 * lit)}, ${Math.round(21 + 38 * lit)}, ${solid.toFixed(3)})`,
    )
    g.addColorStop(Math.min(0.5, edge + 0.22), `rgba(46, 34, 25, ${solid.toFixed(3)})`)
    g.addColorStop(1 - edge, `rgba(22, 16, 12, ${solid.toFixed(3)})`)
    g.addColorStop(1, 'rgba(22, 16, 12, 0)')
    ctx.fillStyle = g
    ctx.fillRect(left, poles.top + bob, wide, tall)
    // The cross-arm and its insulators.
    ctx.fillStyle = `rgba(30, 22, 16, ${solid.toFixed(3)})`
    ctx.fillRect(left - poles.width * 2.6, arm - poles.width * 0.4 + bob, wide + poles.width * 5.2, poles.width * 0.55)
  }
}

/** For the carriage's light: how much of the sky the nearest things let through, 0.85 to 1, slow to change. */
export const lightAt = (world: World, metres: number) => {
  const { poles, unit, view } = world
  const along = metres * unit * poles.share
  const at = (((poles.phase - view.w * 0.5 - along) % poles.spacing) + poles.spacing) % poles.spacing
  const phase = at / poles.spacing
  const near = Math.min(phase, 1 - phase) * poles.spacing
  return 1 - 0.1 * Math.exp(-((near / (view.win.w * 0.12)) ** 2))
}
