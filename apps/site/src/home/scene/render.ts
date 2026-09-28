import { BRANDS, type Brand } from '@charrette/ui'

import { clamp, ease, lerp } from '../../lib/motion'
import { brandOf, TASKS } from '../../content/site'
import {
  dot,
  FLOOR_FACES,
  FOUNDATION,
  GROUND_SEGS,
  hanging,
  laydown,
  LIFT,
  LIFT_SEGS,
  M,
  MAST_SEGS,
  midOf,
  slewing,
  sub,
  Tone,
  topOf,
  X0,
  X1,
  Z0,
  Z1,
  type Face,
  type Seg,
  type V,
} from './model'
import { LAYDOWN, setAt, type State } from './timeline'

/*
 * The painter. A level camera (verticals stay vertical, as in a two-point
 * perspective drawing) drifts slowly round the site; every segment and face
 * is projected, sorted far to near and painted. Then the draughtsman's
 * set-up on top, kept out of the words: the horizon, the vanishing points
 * and lines from the roof's corners. Then the notes: a dot on the building's
 * edge at each floor, and a leader out to where its label goes.
 */

export type Palette = Record<Tone, string> & { font: string; mono: string; signal: string; ground: string; lead: string }

export interface Frame {
  W: number
  H: number
  t: number
  /** Wide enough for the notes beside the building. */
  wide: boolean
  /** Where the words are, which the construction lines keep out of. */
  keepOut: readonly DOMRect[]
}

/** Where one floor's label goes, and how far it's drawn in. */
export interface Anchor {
  k: number
  x: number
  y: number
  left: boolean
  p: number
}

interface Camera {
  eye: V
  f: V
  r: V
  F: number
  cx: number
  hy: number
}

const NEAR = 0.5

function cameraAt(t: number, W: number, H: number, wide: boolean): Camera {
  const az = ((34 + 7 * Math.sin((t / 80) * Math.PI * 2)) * Math.PI) / 180
  const T: V = [5, 0, -3]
  const R = 72
  const eye: V = [T[0] + R * Math.sin(az), 1.7, T[2] + R * Math.cos(az)]
  const fx = T[0] - eye[0]
  const fz = T[2] - eye[2]
  const fl = Math.hypot(fx, fz)
  const f: V = [fx / fl, 0, fz / fl]
  return {
    eye,
    f,
    r: [-f[2], 0, f[0]],
    F: wide ? Math.min(0.9 * H, 0.6 * W) : 0.86 * W,
    cx: (wide ? 0.55 : 0.44) * W,
    hy: wide ? 0.87 * H : H - 34,
  }
}

const toCam = (c: Camera, p: V): V => {
  const d = sub(p, c.eye)
  return [dot(d, c.r), d[1], dot(d, c.f)]
}
const toScreen = (c: Camera, q: V): [number, number] => [c.cx + (c.F * q[0]) / q[2], c.hy - (c.F * q[1]) / q[2]]
const project = (c: Camera, p: V): [number, number] | null => {
  const q = toCam(c, p)
  return q[2] > NEAR ? toScreen(c, q) : null
}

type Item =
  | { kind: 'seg'; z: number; a: [number, number]; b: [number, number]; w: number; tone: Tone; alpha: number }
  | { kind: 'face'; z: number; p: [number, number][]; win: [number, number][] | null; fill: Tone; edge: Tone; w: number; alpha: number }

function pushSeg(c: Camera, s: Seg, alpha: number, out: Item[]) {
  let a = toCam(c, s.a)
  let b = toCam(c, s.b)
  if (a[2] < NEAR && b[2] < NEAR) return
  if (a[2] < NEAR || b[2] < NEAR) {
    const k = (NEAR - a[2]) / (b[2] - a[2])
    const m: V = [lerp(a[0], b[0], k), lerp(a[1], b[1], k), NEAR]
    if (a[2] < NEAR) a = m
    else b = m
  }
  const z = (a[2] + b[2]) / 2
  out.push({ kind: 'seg', z, a: toScreen(c, a), b: toScreen(c, b), w: s.w * clamp(64 / z, 0.55, 1.4), tone: s.tone, alpha })
}

function pushFace(c: Camera, f: Face, alpha: number, out: Item[]) {
  const p0 = f.p[0]
  if (!p0 || dot(f.n, sub(c.eye, p0)) <= 0) return
  const q = f.p.map((p) => toCam(c, p))
  if (q.some((v) => v[2] < NEAR)) return
  const z = q.reduce((n, v) => n + v[2], 0) / q.length
  out.push({
    kind: 'face',
    z,
    p: q.map((v) => toScreen(c, v)),
    win: f.win ? f.win.map((p) => toScreen(c, toCam(c, p))) : null,
    fill: f.fill,
    edge: f.edge,
    w: f.w * clamp(64 / z, 0.55, 1.4),
    alpha,
  })
}

function drawItem(ctx: CanvasRenderingContext2D, pal: Palette, it: Item) {
  ctx.globalAlpha = it.alpha
  if (it.kind === 'seg') {
    ctx.strokeStyle = pal[it.tone]
    ctx.lineWidth = it.w
    ctx.beginPath()
    ctx.moveTo(it.a[0], it.a[1])
    ctx.lineTo(it.b[0], it.b[1])
    ctx.stroke()
    return
  }
  ctx.beginPath()
  it.p.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
  ctx.closePath()
  ctx.fillStyle = pal[it.fill]
  ctx.fill()
  ctx.strokeStyle = pal[it.edge]
  ctx.lineWidth = it.w
  ctx.stroke()
  if (it.win) {
    ctx.beginPath()
    it.win.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
    ctx.closePath()
    ctx.lineWidth = it.w * 0.7
    ctx.stroke()
  }
}

/** Paints one frame, and says where the floors' labels go. */
export function paint(ctx: CanvasRenderingContext2D, pal: Palette, fr: Frame, st: State, sway: readonly [number, number]): Anchor[] {
  const { W, H, t, wide } = fr
  const c = cameraAt(t, W, H, wide)
  ctx.clearRect(0, 0, W, H)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  const ground: Item[] = []
  GROUND_SEGS.forEach((s) => pushSeg(c, s, 1, ground))

  const items: Item[] = []
  FLOOR_FACES.forEach((faces, k) => {
    const a = k === 0 ? 1 : (st.floors[k - 1] ?? 0)
    if (a > 0) faces.forEach((f) => pushFace(c, f, a, items))
  })
  if (st.scaffoldAlpha > 0)
    LIFT_SEGS.forEach((segs, j) => {
      if ((j + 1) * LIFT <= st.scaffoldTop + 0.01) segs.forEach((s) => pushSeg(c, s, st.scaffoldAlpha, items))
    })
  FOUNDATION.forEach((f) => pushFace(c, f, 1, items))
  MAST_SEGS.forEach((s) => pushSeg(c, s, 1, items))
  laydown(LAYDOWN, st.stack).forEach((f) => pushFace(c, f, 1, items))

  const top = slewing(st.slew, st.trolley)
  top.segs.forEach((s) => pushSeg(c, s, 1, items))
  top.faces.forEach((f) => pushFace(c, f, 1, items))
  const hook: V = [top.under[0] + sway[0], st.hook, top.under[2] + sway[1]]
  const hung = hanging(top.under, hook, top.u, top.v, st.load)
  hung.segs.forEach((s) => pushSeg(c, s, 1, items))
  hung.faces.forEach((f) => pushFace(c, f, 1, items))
  items.sort((a, b) => b.z - a.z)

  // The draughtsman's set-up, kept out of the words.
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, 0, W, H)
  for (const r of fr.keepOut) ctx.rect(r.x - 16, r.y - 12, r.width + 32, r.height + 24)
  ctx.clip('evenodd')
  ctx.globalAlpha = 1
  ctx.strokeStyle = pal.faint
  ctx.lineWidth = 0.8
  ctx.beginPath()
  ctx.moveTo(0, c.hy)
  ctx.lineTo(W, c.hy)
  ctx.stroke()
  const vp = (d: V): number | null => {
    const q = dot(d, c.f)
    return Math.abs(q) < 0.05 ? null : c.cx + (c.F * dot(d, c.r)) / q
  }
  const vx = vp([1, 0, 0])
  const vz = vp([0, 0, -1])
  const roof = topOf(st.floors.filter((f) => f > 0.5).length)
  ctx.setLineDash([2, 5])
  ctx.strokeStyle = pal.grey
  ctx.lineWidth = 0.7
  const lines: [V, number | null][] = [
    [[X0, roof, Z1], vx],
    [[X1, roof, Z1], vz],
    [[X0, 0, Z1], vx],
    [[X1, 0, Z1], vz],
  ]
  for (const [p, x] of lines) {
    const s = project(c, p)
    if (!s || x === null) continue
    ctx.beginPath()
    ctx.moveTo(s[0], s[1])
    ctx.lineTo(x, c.hy)
    ctx.stroke()
  }
  ctx.setLineDash([])
  ctx.fillStyle = pal.grey
  ctx.font = `500 10px ${pal.mono}`
  ctx.textAlign = 'right'
  ctx.fillText('HL', W - 12, c.hy - 6)
  ctx.textAlign = 'left'
  for (const x of [vx, vz]) {
    if (x === null || x < 8 || x > W - 40) continue
    ctx.fillRect(x - 3, c.hy - 3, 6, 6)
    ctx.fillText('VP', x + 6, c.hy - 6)
  }
  ctx.restore()

  for (const it of ground) drawItem(ctx, pal, it)
  for (const it of items) drawItem(ctx, pal, it)
  ctx.globalAlpha = 1

  // The agent's mark and name, on the plate on the counter-jib.
  const plate = project(c, top.plate)
  if (plate && st.plate) {
    const size = wide ? 12.5 : 10.5
    const icon = wide ? 14 : 12
    ctx.font = `700 ${size}px ${pal.font}`
    const text = st.plate.toUpperCase()
    const brand = brandOf(st.plate)
    const gap = brand ? icon + 7 : 0
    const w = ctx.measureText(text).width + 20 + gap
    const h = wide ? 25 : 21
    const x0 = plate[0] - w / 2
    ctx.fillStyle = pal.live
    ctx.fillRect(x0, plate[1] - h / 2, w, h)
    ctx.fillStyle = pal.paper
    if (brand) mark(ctx, brand, x0 + 10, plate[1] - icon / 2, icon)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, x0 + 10 + gap, plate[1] + 0.5)
    ctx.textBaseline = 'alphabetic'
  }

  return wide ? leaders(ctx, pal, c, st, t) : []
}

const PATHS = new Map<Brand, { paths: Path2D[]; evenOdd: boolean }>()
/** An agent's mark, from the same drawing BrandMark uses, in the current fill. */
function mark(ctx: CanvasRenderingContext2D, brand: Brand, x: number, y: number, size: number) {
  let m = PATHS.get(brand)
  if (!m) {
    const d = BRANDS[brand]
    m = { paths: d.paths.map((p) => new Path2D(p.d)), evenOdd: Boolean(d.evenOdd) }
    PATHS.set(brand, m)
  }
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(size / 24, size / 24)
  for (const p of m.paths) ctx.fill(p, m.evenOdd ? 'evenodd' : 'nonzero')
  ctx.restore()
}

/*
 * The floors' notes, drafted as the welcome screens pin theirs: a dot on
 * the building's edge, a short stub straight out, a line to where the label
 * sits, a shoulder. The lower three go off the left edge, the upper three
 * off the right, clear of the mast. Each leader is cased in paper so it
 * reads over whatever it crosses. The labels themselves are HTML, placed
 * where these say.
 */
const GAP = 64
function leaders(ctx: CanvasRenderingContext2D, pal: Palette, c: Camera, st: State, t: number): Anchor[] {
  const mast = project(c, [M[0], 20, M[2]])
  const sides = [
    { left: true, ks: [0, 1, 2], edge: (k: number): V => [X0, midOf(k), Z1] },
    { left: false, ks: [3, 4, 5], edge: (k: number): V => [X1, midOf(k), Z0] },
  ]
  const out: Anchor[] = []
  for (const side of sides) {
    const dots = side.ks.map((k) => ({ k, at: project(c, side.edge(k)) }))
    const ys = dots.flatMap((d) => (d.at ? [d.at[1]] : []))
    if (ys.length !== dots.length) continue
    const mean = ys.reduce((n, y) => n + y, 0) / ys.length
    dots.forEach(({ k, at }, j) => {
      if (!at) return
      const p = clamp((t - setAt(k)) / 1.1)
      if ((st.floors[k] ?? 0) <= 0 || p <= 0) return
      const dir = side.left ? -1 : 1
      // Higher floors are further up the screen: the top one gets the top slot.
      const y = mean + (1 - j) * GAP
      const x = side.left ? at[0] - 118 : Math.max(at[0] + 110, (mast?.[0] ?? 0) + 54)
      const path: [number, number][] = [at, [at[0] + dir * 12, at[1]], [x, y], [x + dir * 16, y]]
      stroke(ctx, pal, path, ease(clamp(p / 0.55)))
      ctx.globalAlpha = Math.min(1, p * 4)
      ctx.beginPath()
      ctx.arc(at[0], at[1], 3, 0, Math.PI * 2)
      ctx.fillStyle = TASKS[k]?.you ? pal.signal : pal.ink
      ctx.strokeStyle = pal.ground
      ctx.lineWidth = 2
      ctx.stroke()
      ctx.fill()
      ctx.globalAlpha = 1
      out.push({ k, x: x + dir * 22, y, left: side.left, p })
    })
  }
  return out
}

function stroke(ctx: CanvasRenderingContext2D, pal: Palette, path: [number, number][], k: number) {
  let total = 0
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]
    const b = path[i]
    if (a && b) total += Math.hypot(b[0] - a[0], b[1] - a[1])
  }
  ctx.setLineDash([total * k, total])
  for (const [tone, w] of [
    [pal.ground, 5],
    [pal.lead, 1],
  ] as const) {
    ctx.strokeStyle = tone
    ctx.lineWidth = w
    ctx.beginPath()
    path.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
    ctx.stroke()
  }
  ctx.setLineDash([])
}

export function paletteOf(el: Element): Palette {
  const cs = getComputedStyle(el)
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback
  return {
    [Tone.Ink]: v('--t-1', '#141417'),
    [Tone.Grey]: v('--t-3', '#6f6f77'),
    [Tone.Faint]: v('--t-4', '#9a99a0'),
    [Tone.Live]: v('--live', '#2b3bff'),
    [Tone.Light]: v('--n-1', '#fcfbf8'),
    [Tone.Shade]: v('--n-4', '#e7e3da'),
    [Tone.Paper]: v('--paper', '#ffffff'),
    ground: v('--n-2', '#f4f2ec'),
    lead: v('--t-2', '#45454c'),
    signal: v('--signal', '#7a3ff0'),
    font: v('--font', 'system-ui, sans-serif'),
    mono: v('--mono', 'ui-monospace, monospace'),
  }
}
