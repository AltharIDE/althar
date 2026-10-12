import { canvasOf, clamp, type Ctx, roundRect, soft } from './paint'
import type { Box, View } from './world'

/*
 * The carriage, from inside: a dark wall with its windows cut in it, one
 * wide in the middle and the next ones either side, each in a deep frame;
 * and two passengers, seen against the light, facing each other across the
 * middle window and looking out: a man on the left, a child on the right,
 * each in a high-backed seat.
 *
 * It is painted once for the size, in two parts: the carriage as it is in
 * shadow, and the light the windows throw on it (on the frames' reveals,
 * the wall about them, and the edges of the passengers turned to the
 * glass), which the frame draws over it, brighter or dimmer as poles and
 * trees go by.
 */

export interface Carriage {
  /** The wall, frames and passengers, with the windows cut out. */
  shadow: HTMLCanvasElement
  /** The windows' light on all of that, drawn over it. */
  light: HTMLCanvasElement
  /** Every window, the middle one first. */
  windows: Box[]
  radius: number
}

/* The passengers, in a head's measure: 100 from the crown to the chin, facing right, the skull's middle at x 0. */

interface Figure {
  head: string
  body: string
  collar: string
  /** Where the head turns on the neck. */
  pivot: readonly [number, number]
  /** How far the head is lifted toward the window, in radians. */
  lift: number
}

/** A man, his head lifted a little to the window, in a jumper. */
const MAN: Figure = {
  head: `M -34 100
    C -36 92 -50 76 -53 54
    C -56 30 -40 3 -10 -1
    C 14 -4 34 7 40 23
    C 43 31 45 37 45 42
    C 45 45 43 46 43 48
    C 46 54 52 60 54 64
    C 55 67 51 68 46 68
    C 47 70 48 72 47 74
    C 45 75 45 75 46 76
    C 47 78 46 80 44 81
    C 42 82 42 83 43 85
    C 45 90 44 95 39 98
    C 33 101 24 101 17 100
    C 13 105 13 113 15 120
    C 17 128 17 140 18 152
    L -32 152
    C -32 132 -33 112 -34 100 Z`,
  body: `M 22 146
    C 34 152 46 170 50 196
    C 55 230 56 280 57 420
    L -104 420
    C -104 330 -104 250 -98 214
    C -94 186 -84 166 -66 156
    C -50 148 -38 144 -30 142
    C -10 140 8 141 22 146 Z`,
  /** The collar of his jumper, over the neck's foot. */
  collar: `M -36 140 C -20 134 6 134 24 142 C 26 148 26 152 22 156 C 4 150 -18 150 -38 154 Z`,
  pivot: [0, 120],
  lift: -0.1,
}

/** A child, a rounder head, a small nose, a hood down on the shoulders, chin up at the glass. */
const CHILD: Figure = {
  head: `M -30 112
    C -36 102 -56 84 -60 58
    C -64 26 -40 -2 -6 -2
    C 20 -2 38 12 42 32
    C 44 40 43 46 42 50
    C 45 55 49 59 49 63
    C 49 66 46 67 43 67
    C 45 70 45 72 43 74
    C 42 75 42 75 43 76
    C 44 79 42 81 40 82
    C 38 84 38 86 39 88
    C 40 93 35 97 28 97
    C 22 98 17 98 13 99
    C 11 106 11 114 13 126
    L -30 126
    C -30 120 -30 116 -30 112 Z`,
  body: `M 15 118
    C 26 124 36 140 40 164
    C 44 196 45 260 46 480
    L -92 480
    C -92 380 -92 280 -88 230
    C -84 186 -74 154 -56 136
    C -46 126 -36 120 -28 118
    C -10 114 4 114 15 118 Z`,
  /** The hood, bunched behind the neck. */
  collar: `M -24 108 C -44 102 -66 110 -80 128 C -88 140 -88 152 -84 160 C -70 150 -50 144 -28 140 C -18 132 -16 116 -24 108 Z`,
  pivot: [0, 112],
  lift: -0.16,
}

/** Tufts of hair over the crown: the man's short, the child's untidy. */
const HAIR = {
  man: `M -54 60 C -58 40 -54 20 -40 8 C -34 2 -28 -2 -20 -4 C -14 -7 -8 -6 -4 -7 C 2 -9 8 -8 14 -6 C 20 -5 26 -4 30 -1 C 36 3 40 9 42 16 C 43 19 43 21 41 23 C 34 16 22 12 10 12 C -10 12 -30 22 -42 40 C -48 50 -50 56 -54 60 Z`,
  child: `M -62 60 C -68 40 -64 18 -50 4 C -44 -2 -38 -6 -30 -8 C -26 -12 -18 -14 -12 -12 C -6 -15 2 -15 8 -12 C 14 -12 20 -10 26 -6 C 32 -4 36 0 40 6 C 44 12 46 18 46 24 C 46 28 44 32 42 34 C 40 28 36 24 30 22 C 22 20 14 18 6 18 C -14 16 -34 22 -46 36 C -54 44 -58 52 -62 60 Z`,
}

interface Sitter {
  shape: Figure
  hair: string
  /** The skull's middle, and the head's height (crown to chin), in CSS px. */
  x: number
  crown: number
  size: number
  /** 1 facing right, -1 facing left. */
  facing: 1 | -1
}

/**
 * A passenger's outline, set where they sit: its parts as paths of their
 * own, each filled on its own, since one path's overlapping parts drawn the
 * other way round would leave holes where they cross.
 */
function partsOf(sitter: Sitter): Path2D[] {
  const { shape, facing, size, x, crown } = sitter
  const s = size / 100
  const place = new DOMMatrix().translate(x, crown).scale(s * facing, s)
  const [px, py] = shape.pivot
  // The head turns up toward the window, about the neck.
  const turn = new DOMMatrix()
    .translate(px, py)
    .rotate((shape.lift * 180) / Math.PI)
    .translate(-px, -py)
  const head = place.multiply(turn)
  const part = (d: string, at: DOMMatrix) => {
    const path = new Path2D()
    path.addPath(new Path2D(d), at)
    return path
  }
  return [part(shape.body, place), part(shape.collar, place), part(shape.head, head), part(sitter.hair, head)]
}

/** Fills every part of an outline. */
const fillAll = (ctx: Ctx, parts: readonly Path2D[]) => parts.forEach((part) => ctx.fill(part))

/** A seat's high back, behind a passenger: the side of it, rounded at the headrest. */
function seatOf(sitter: Sitter, bottom: number) {
  const { size, x, crown, facing } = sitter
  const back = x - facing * size * 1.02
  const thick = size * 0.62
  const left = facing === 1 ? back - thick : back
  const path = new Path2D()
  roundRect(path, left, crown - size * 0.16, thick, bottom - crown + size * 0.4, size * 0.26)
  return path
}

/** Where the passengers sit, for the window: below the headline, at its sides, their heads against the glass. */
export function sittersOf(view: View): Sitter[] {
  const { win } = view
  const size = clamp(Math.min(win.h * 0.27, win.w * 0.2), 52, 230)
  const narrow = win.w < 560
  const child = size * 0.8
  return [
    {
      shape: MAN,
      hair: HAIR.man,
      x: win.x + win.w * (narrow ? 0.12 : 0.035) + (narrow ? size * 0.2 : 0),
      crown: win.y + win.h - size * 2,
      size,
      facing: 1,
    },
    {
      shape: CHILD,
      hair: HAIR.child,
      x: win.x + win.w * (narrow ? 0.88 : 0.955) - (narrow ? size * 0.12 : 0),
      crown: win.y + win.h - child * 1.75,
      size: child,
      facing: -1,
    },
  ]
}

/** The windows: the middle one, and the next ones either side where the screen is wide enough to show them. */
export function windowsOf(view: View) {
  const { win, w } = view
  const pillar = clamp(win.w * 0.12, 64, 190)
  const windows: Box[] = [win]
  if (win.x - pillar > 8) {
    windows.push({ x: win.x - pillar - win.w, y: win.y, w: win.w, h: win.h })
    windows.push({ x: win.x + win.w + pillar, y: win.y, w: win.w, h: win.h })
  }
  return { windows: windows.filter((b) => b.x < w && b.x + b.w > 0), pillar }
}

const WALL = { top: '#17120f', middle: '#1d1713', foot: '#100d0b' }
const FRAME = '#241d17'

export function bakeCarriage(view: View): Carriage {
  const { w, h, dpr, win } = view
  const { windows } = windowsOf(view)
  const radius = clamp(Math.min(win.w, win.h) * 0.1, 18, 74)
  const frame = clamp(win.h * 0.034, 9, 26)
  const shadow = canvasOf(w, h, dpr)
  const light = canvasOf(w, h, dpr)
  const ctx = shadow.ctx
  const glow = light.ctx

  // The wall: dark, warm, a little lighter about the windows' height.
  const wall = ctx.createLinearGradient(0, 0, 0, h)
  wall.addColorStop(0, WALL.top)
  wall.addColorStop(clamp((win.y + win.h * 0.5) / h), WALL.middle)
  wall.addColorStop(1, WALL.foot)
  ctx.fillStyle = wall
  ctx.fillRect(0, 0, w, h)
  // A panel seam down each pillar, and the rail under the windows.
  const sill = win.y + win.h + frame * 1.6
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)'
  ctx.fillRect(0, sill, w, Math.max(2, frame * 0.25))
  ctx.fillStyle = 'rgba(255, 236, 214, 0.05)'
  ctx.fillRect(0, sill + Math.max(2, frame * 0.25), w, 1)

  for (const box of windows) {
    // The frame: a deep surround, its reveal stepping in to the rubber and the glass.
    const outer = new Path2D()
    roundRect(outer, box.x - frame, box.y - frame, box.w + frame * 2, box.h + frame * 2, radius + frame)
    const g = ctx.createLinearGradient(0, box.y - frame, 0, box.y + box.h + frame)
    g.addColorStop(0, '#1c1612')
    g.addColorStop(0.6, FRAME)
    g.addColorStop(1, '#2f271f')
    ctx.fillStyle = g
    ctx.fill(outer)
    // Its outer edge, caught by the room's light.
    ctx.strokeStyle = 'rgba(255, 228, 196, 0.07)'
    ctx.lineWidth = 1.2
    ctx.stroke(outer)
    // A shadow inside the frame's lip, falling onto the reveal.
    const reveal = new Path2D()
    roundRect(reveal, box.x - frame * 0.45, box.y - frame * 0.45, box.w + frame * 0.9, box.h + frame * 0.9, radius + frame * 0.45)
    ctx.fillStyle = '#120e0b'
    ctx.fill(reveal)

    // The light on the reveal and around the window, painted apart.
    soft(glow, frame * 0.5, () => {
      glow.strokeStyle = 'rgba(205, 222, 255, 0.3)'
      glow.lineWidth = frame * 0.7
      const ring = new Path2D()
      roundRect(ring, box.x - frame * 0.2, box.y - frame * 0.2, box.w + frame * 0.4, box.h + frame * 0.4, radius + frame * 0.2)
      glow.stroke(ring)
    })
    // The sill catches most: the light falls in from above.
    soft(glow, frame * 0.6, () => {
      glow.fillStyle = 'rgba(232, 238, 255, 0.3)'
      glow.fillRect(box.x + radius * 0.6, box.y + box.h + frame * 0.05, box.w - radius * 1.2, frame * 0.55)
    })
    soft(glow, Math.max(20, frame * 3.5), () => {
      glow.strokeStyle = 'rgba(150, 178, 240, 0.07)'
      glow.lineWidth = frame * 3
      glow.stroke(outer)
    })
  }

  // The glass: cut the windows out of the wall, and of its light.
  for (const c of [ctx, glow]) {
    c.save()
    c.globalCompositeOperation = 'destination-out'
    for (const box of windows) {
      c.beginPath()
      roundRect(c, box.x, box.y, box.w, box.h, radius)
      c.fill()
    }
    c.restore()
  }
  // The rubber round the glass, and a shadow it casts in.
  for (const box of windows) {
    ctx.save()
    ctx.beginPath()
    roundRect(ctx, box.x, box.y, box.w, box.h, radius)
    ctx.clip()
    soft(ctx, frame * 0.9, () => {
      ctx.strokeStyle = 'rgba(8, 10, 20, 0.5)'
      ctx.lineWidth = frame * 1.1
      ctx.beginPath()
      roundRect(ctx, box.x, box.y, box.w, box.h, radius)
      ctx.stroke()
    })
    // A faint sheen on the glass, falling from the top left.
    const sheen = ctx.createLinearGradient(box.x, box.y, box.x + box.w * 0.6, box.y + box.h)
    sheen.addColorStop(0, 'rgba(255, 255, 255, 0.07)')
    sheen.addColorStop(0.35, 'rgba(255, 255, 255, 0.015)')
    sheen.addColorStop(0.36, 'rgba(255, 255, 255, 0.04)')
    sheen.addColorStop(0.45, 'rgba(255, 255, 255, 0)')
    ctx.fillStyle = sheen
    ctx.fillRect(box.x, box.y, box.w, box.h)
    ctx.restore()
    ctx.strokeStyle = '#090807'
    ctx.lineWidth = Math.max(2, frame * 0.22)
    ctx.beginPath()
    roundRect(ctx, box.x, box.y, box.w, box.h, radius)
    ctx.stroke()
  }

  // The passengers and their seats, against the light. The windows' glow is behind them, so not on them.
  const sitters = sittersOf(view).map((sitter) => ({ ...sitter, seat: [seatOf(sitter, h + 40)], body: partsOf(sitter) }))
  const clear = (parts: readonly Path2D[]) => {
    glow.save()
    glow.globalCompositeOperation = 'destination-out'
    glow.fillStyle = '#000'
    fillAll(glow, parts)
    glow.restore()
  }
  for (const { seat, body, x, size, facing } of sitters) {
    // The seat: dark upholstery, a little lighter toward the window.
    const sg = ctx.createLinearGradient(x - facing * size * 1.6, 0, x - facing * size * 0.9, 0)
    sg.addColorStop(0, '#0d0b0a')
    sg.addColorStop(1, '#1b1612')
    ctx.fillStyle = sg
    fillAll(ctx, seat)
    // The passenger: dark, turned a little toward the light at the front.
    const pg = ctx.createLinearGradient(x - facing * size, 0, x + facing * size * 0.6, 0)
    pg.addColorStop(0, '#0b0908')
    pg.addColorStop(1, '#1f1914')
    ctx.fillStyle = pg
    fillAll(ctx, body)
    clear(seat)
    clear(body)
  }
  // Their edges toward the glass catch the light, on the light layer: the seats' first, then the passengers in front of them.
  for (const { seat, size, facing } of sitters) rim(glow, view, seat, facing, size * 0.03, 'rgba(240, 232, 220, 0.45)')
  for (const { body } of sitters) clear(body)
  for (const { body, size, facing } of sitters) {
    rim(glow, view, body, facing, size * 0.028, 'rgba(255, 244, 228, 0.95)')
    rim(glow, view, body, facing, size * 0.07, 'rgba(176, 200, 255, 0.22)')
  }
  return { shadow: shadow.canvas, light: light.canvas, windows, radius }
}

/**
 * The light on an outline's edges that face the glass: the shape, less
 * itself moved away from the light and softened, leaves a crescent on the
 * side the light comes from.
 */
function rim(ctx: Ctx, view: View, shape: readonly Path2D[], facing: 1 | -1, width: number, colour: string) {
  const layer = canvasOf(view.w, view.h, view.dpr)
  const c = layer.ctx
  c.fillStyle = colour
  fillAll(c, shape)
  c.globalCompositeOperation = 'destination-out'
  c.translate(-facing * width, width * 0.55)
  soft(c, width * 0.45 * view.dpr, () => {
    c.fillStyle = '#000'
    fillAll(c, shape)
  })
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.drawImage(layer.canvas, 0, 0)
  ctx.restore()
}
