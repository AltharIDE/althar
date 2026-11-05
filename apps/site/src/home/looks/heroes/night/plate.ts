import { Agent, AGENTS } from '../../../../content/agents'
import { seeded } from '../../../../shared/footer/random'

/*
 * The Orrery's drawing, as plain numbers: Althar at the middle as the
 * system's sun, its light rising from it in fine lines as the altar's does
 * in the footer, and the agents you already pay for each on an orbit round
 * it. The orbits are circles seen from a little above their plane, so flat
 * ellipses, spaced wider outward, the outer ones running off both sides.
 * Each agent sits at a seat chosen for the frame (0° at the right, 90°
 * nearest, 180° at the left, 270° farthest): nearer is larger and brighter.
 * The same numbers every time; worked out again only when the size does.
 */

const DEG = Math.PI / 180

/** Where an agent rides: its orbit (0 the innermost) and how far round it at the start, in degrees. */
type Seat = readonly [orbit: number, at: number]

/** On a wide screen: seven orbits, the two outer ones running off the sides; the agents spread round them so no two names meet. */
const WIDE = {
  orbits: 7,
  inner: 0.23,
  flat: 0.22,
  seats: {
    [Agent.Claude]: [0, 36],
    [Agent.Codex]: [1, 198],
    [Agent.OpenCode]: [2, 322],
    [Agent.Copilot]: [3, 132],
    [Agent.Junie]: [4, 238],
    [Agent.Grok]: [4, 16],
    [Agent.Kimi]: [5, 142],
    [Agent.Mistral]: [5, 298],
    [Agent.Qwen]: [6, 113],
    [Agent.Antigravity]: [6, 66],
  } as Partial<Record<Agent, Seat>>,
}

/** On a phone: six orbits, higher and smaller, the outer three running off; the agents near the nearest and farthest points, where the orbits are on screen. */
const PHONE = {
  orbits: 6,
  inner: 0.25,
  flat: 0.27,
  seats: {
    [Agent.Claude]: [0, 40],
    [Agent.Codex]: [1, 215],
    [Agent.OpenCode]: [2, 300],
    [Agent.Copilot]: [2, 152],
    [Agent.Junie]: [3, 246],
    [Agent.Grok]: [3, 58],
    [Agent.Kimi]: [4, 110],
    [Agent.Mistral]: [4, 284],
    [Agent.Qwen]: [5, 97],
    [Agent.Antigravity]: [5, 80],
  } as Partial<Record<Agent, Seat>>,
}

/** The frame: its size, where the picture may start (under the nav and the bar), and where the words' band begins. */
export interface Frame {
  w: number
  h: number
  top: number
  foot: number
  phone: boolean
}

export interface Orbit {
  rx: number
  ry: number
  /** How fast it is ridden, in degrees a second: the inner ones faster, as a planet's year is shorter nearer its sun. */
  speed: number
  /** The far half, behind the sun, and the near half, in front of it. */
  far: string
  near: string
  /** How bright its line is, the near half's; the far half is fainter. */
  bright: number
  /** Its line's colour: warm near the sun, in its light, cooling to cobalt outward. */
  tone: string
}

export interface Body {
  id: Agent
  name: string
  /** Its orbit, and how far round it at the start, in degrees. */
  orbit: number
  at: number
  x: number
  y: number
  /** How near: 1 at the nearest point of its orbit, -1 at the farthest. */
  d: number
  /** The disc's diameter and the mark's size in it. */
  size: number
  mark: number
  /** Which side its name is set, or none where there is no room (the mark alone, named for screen readers). */
  side: 'left' | 'right' | null
  /** The way it came, along its orbit: a short arc behind it, from where it was to where it is. */
  trail: { d: string; x1: number; y1: number }
}

export interface Star {
  x: number
  y: number
  r: number
  a: number
  /** White, faintly cobalt, or warm. */
  tone: 0 | 1 | 2
}

/** A line of the sun's light: from its root on the mark's edge, whole up to `mid`, broken above it up to `top`. */
export interface Ray {
  x0: number
  y0: number
  x1: number
  mid: number
  top: number
  dash: string
  width: number
}

export interface Plate {
  w: number
  h: number
  cx: number
  cy: number
  phone: boolean
  /** How large the bodies are drawn, and where the band's words begin. */
  scale: number
  foot: number
  /** What no name may cover: the sun and its light, and the bar under the nav. */
  fixed: Box[]
  orbits: Orbit[]
  bodies: Body[]
  stars: Star[]
  /** The sun: the mark's size, its light, and how tall the light stands over the mark's middle. */
  sun: number
  rays: Ray[]
  tall: number
  /** The graduations along one orbit: near and far. */
  ticks: { near: string; far: string }
  /** Where the names are set: the lines break round them, as a drawn chart's do. */
  names: Box[]
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))
const r1 = (n: number) => Math.round(n * 10) / 10

/** The orbits' colours: in the sun's light, and out in the cold. */
const WARM = [246, 228, 206] as const
const COLD = [170, 180, 255] as const
const mix = (a: readonly number[], b: readonly number[], t: number) => `rgb(${a.map((x, i) => Math.round(x + (b[i]! - x) * t)).join(' ')})`

/** The innermost orbit's year, in seconds; each outer one's longer by its size to the power of one and a half, as Kepler found the planets' are. */
const YEAR = 64
const KEPLER = 1.5

/** Seen from a little above, in perspective: the near half of each orbit a little deeper than the far half. */
const FAR = 0.88
const NEAR = 1.12

/** The name's width, in px: JetBrains Mono's advance (0.6em) and the label's tracking (0.12em), at 10.5px. */
const LABEL = { size: 10.5, advance: 0.72, height: 12, gap: 7 }
const labelWidth = (name: string) => name.length * LABEL.size * LABEL.advance

export interface Box {
  l: number
  t: number
  r: number
  b: number
}
const meets = (a: Box, b: Box, m: number) => a.l < b.r + m && b.l < a.r + m && a.t < b.b + m && b.t < a.b + m

/** Works out the drawing for a frame. */
export function plate(f: Frame): Plate {
  const { w, h, phone } = f
  const plan = phone ? PHONE : WIDE
  const cx = w / 2
  // The orrery fills the room between the bar and the band, its nearest edge clear of the band's rule.
  const room = Math.max(160, f.foot - f.top - (phone ? 16 : 26))
  const ryMost = room / (FAR + NEAR)
  // Flat as a low angle sees it; flatter still where the screen is short and wide, so the outer orbits still run off the sides.
  const rxMost = Math.max(ryMost / plan.flat, w * (phone ? 1.3 : 0.7))
  const flat = ryMost / rxMost
  const cy = f.top + ryMost * FAR
  const scale = phone ? 1 : clamp(w / 1280, 0.9, 1.3)

  const orbits: Orbit[] = Array.from({ length: plan.orbits }, (_, i) => {
    // Spaced wider outward: each a like step larger than the one inside it.
    const rx = rxMost * plan.inner ** ((plan.orbits - 1 - i) / (plan.orbits - 1))
    const ry = rx * flat
    const L = r1(cx - rx)
    const R = r1(cx + rx)
    const y = r1(cy)
    return {
      rx,
      ry,
      speed: 360 / (YEAR * (rx / (rxMost * plan.inner)) ** KEPLER),
      far: `M${L} ${y}A${r1(rx)} ${r1(ry * FAR)} 0 0 1 ${R} ${y}`,
      near: `M${R} ${y}A${r1(rx)} ${r1(ry * NEAR)} 0 0 1 ${L} ${y}`,
      // Brighter near the sun, fainter outward.
      bright: 0.5 - 0.2 * (i / (plan.orbits - 1)),
      tone: mix(WARM, COLD, Math.min(1, (i + 0.6) / (plan.orbits * 0.6))),
    }
  })

  // The sun: the mark, standing as an object in the middle, and its light rising from behind it, no higher than the bar.
  const sun = phone ? 72 : Math.round(124 * scale)
  const tall = Math.min(sun * 2.4, cy - f.top + 6)
  const rays = raysOf(cx, cy, sun, tall)
  const fixed: Box[] = [
    // The sun and its light.
    { l: cx - sun * 0.7, t: cy - tall, r: cx + sun * 0.7, b: cy + sun * 0.45 },
    // The bar under the nav, where the picture's top would meet it.
    { l: cx - 190, t: 0, r: cx + 190, b: f.top },
  ]
  const geo = { cx, cy, orbits, phone, scale, w, foot: f.foot, fixed }

  // The bodies, seated; then their names, set where there is room.
  const bodies: Body[] = AGENTS.map((agent, n) => {
    const [oi, deg] = plan.seats[agent.id] ?? [n % plan.orbits, (n * 137) % 360]
    const orbit = Math.min(oi, orbits.length - 1)
    const o = bodyAt(geo, orbit, deg)
    return { id: agent.id, name: agent.name, orbit, at: deg, ...o, mark: Math.round(sizeOf(geo, 1) * 0.5), side: null }
  })

  // Names, nearest first: outward from the middle, or inward if that doesn't fit, or none.
  const kept: Box[] = [...fixed]
  const order = [...bodies].sort((a, b) => b.d - a.d)
  const names: Box[] = []
  for (const b of order) {
    const others = bodies.filter((one) => one !== b)
    for (const side of sidesFor(geo, b, null)) {
      const bx = nameBox(b, b.name, side)
      if (!fits(geo, bx, kept, others)) continue
      b.side = side
      kept.push(bx)
      names.push(bx)
      break
    }
  }

  // Graduations along one orbit, square to it, longer every thirty degrees.
  const ticked = orbits[Math.min(phone ? 3 : 3, orbits.length - 1)]!
  const ticks = { near: '', far: '' }
  for (let deg = 0; deg < 360; deg += 5) {
    const [x, y] = onOrbit(geo, ticked, deg)
    const sin = Math.sin(deg * DEG)
    const nx = Math.cos(deg * DEG) / ticked.rx
    const ny = sin / (ticked.ry * (sin > 0 ? NEAR : FAR))
    const len = Math.hypot(nx, ny)
    const l = deg % 30 === 0 ? 6 : deg % 10 === 0 ? 3.5 : 2
    const seg = `M${r1(x)} ${r1(y)}l${r1((nx / len) * l)} ${r1((ny / len) * l)}`
    if (sin > 0) ticks.near += seg
    else ticks.far += seg
  }

  const stars = starsOf(w, h, f.foot, cx, cy, sun, tall).filter((s) => !names.some((n) => meets(n, { l: s.x, t: s.y, r: s.x, b: s.y }, 4)))
  return { w, h, cx, cy, phone, scale, foot: f.foot, fixed, orbits, bodies, stars, sun, rays, tall, ticks, names }
}

/** What placing a body needs of the drawing. */
type Geo = Pick<Plate, 'cx' | 'cy' | 'orbits' | 'phone' | 'scale' | 'w' | 'foot' | 'fixed'>

/** A point on an orbit, `deg` round it. */
const onOrbit = (p: Geo, o: Orbit, deg: number) => {
  const sin = Math.sin(deg * DEG)
  return [p.cx + o.rx * Math.cos(deg * DEG), p.cy + o.ry * sin * (sin > 0 ? NEAR : FAR)] as const
}

/** A disc's diameter, by how near it is (1 nearest, -1 farthest). */
export const sizeOf = (p: Pick<Plate, 'phone' | 'scale'>, d: number) => Math.round((p.phone ? 20 + 4 * d : 26 + 5 * d) * p.scale * 10) / 10

/** A body `deg` round its orbit: where it is, how near, how large, and the way it came. */
export function bodyAt(p: Geo, orbit: number, deg: number) {
  const o = p.orbits[orbit]!
  const [x, y] = onOrbit(p, o, deg)
  const d = Math.sin(deg * DEG)
  // The way it came: prograde, so from a little further round (a larger angle); a like length of arc on every orbit.
  const span = clamp(((p.phone ? 46 : 70) * p.scale) / o.rx, 0.12, 0.42) / DEG
  const steps = 16
  const pts = Array.from({ length: steps + 1 }, (_, k) => onOrbit(p, o, deg + (span * k) / steps))
  const [x1, y1] = pts[steps]!
  return { x, y, d, size: sizeOf(p, d), trail: { d: `M${pts.map(([px, py]) => `${r1(px)} ${r1(py)}`).join('L')}`, x1, y1 } }
}

type Placed = Pick<Body, 'x' | 'y' | 'size'>

/** Where a body's name is set on `side`. */
export function nameBox(b: Placed, name: string, side: 'left' | 'right'): Box {
  const lw = labelWidth(name)
  const l = side === 'right' ? b.x + b.size / 2 + LABEL.gap : b.x - b.size / 2 - LABEL.gap - lw
  return { l, t: b.y - LABEL.height / 2, r: l + lw, b: b.y + LABEL.height / 2 }
}

/** The sides a name may take, in the order to try them: the one it has first, then outward, then (not on a phone, where a name across the middle crowds it) inward. */
export function sidesFor(p: Pick<Plate, 'cx' | 'phone'>, b: Placed, has: 'left' | 'right' | null): ('left' | 'right')[] {
  const out = b.x < p.cx ? 'left' : 'right'
  const inward = out === 'left' ? 'right' : 'left'
  const order: ('left' | 'right')[] = p.phone ? [out] : [out, inward]
  return has && (!p.phone || has === out) ? [has, ...order.filter((one) => one !== has)] : order
}

/** Whether a name fits there: on the screen, above the band, clear of what is kept and of the other discs. */
export function fits(p: Geo, bx: Box, kept: Box[], others: Placed[]) {
  const edge = p.phone ? 10 : 16
  if (bx.l < edge || bx.r > p.w - edge || bx.b > p.foot - 6) return false
  if (kept.some((k) => meets(k, bx, 8))) return false
  return !others.some((o) => meets({ l: o.x - o.size / 2, t: o.y - o.size / 2, r: o.x + o.size / 2, b: o.y + o.size / 2 }, bx, 6))
}

/**
 * The sun's light, as the altar's in the footer: fine lines rising from
 * behind the mark, rooted along its two upper edges so it stands on them,
 * gathered toward the middle, whole low down and breaking up as they rise.
 */
function raysOf(cx: number, cy: number, sun: number, tall: number): Ray[] {
  const rand = seeded(29)
  const k = sun / 24
  // Across the mark's upper half, a line every two and a half px or so, rooted well inside its edges so the light stays behind it as it turns.
  const half = sun * 0.15
  const n = Math.max(9, Math.round((half * 2) / 2.6) | 1)
  return Array.from({ length: n }, (_, i) => {
    const u = (i / (n - 1)) * 2 - 1
    const dx = u * half + (rand() - 0.5) * 0.4
    const middle = 1 - Math.abs(u)
    // Its root: just inside the mark's upper edge where it is, so it stands on it. The edge is a face hollowed to a circle: the chord from the tip to a corner, and the hollow under it (on the 24 grid).
    const along = clamp((Math.abs(dx) / k - 0.42) / 7.47, 0, 1)
    const edge = 5.53 + along * 12.94 + 3.9 * 4 * along * (1 - along) + 1.6
    const root = cy + (edge - 14.4) * k
    const reach = tall * (0.38 + 0.62 * middle ** 1.6) * (0.86 + 0.14 * rand())
    const top = cy - reach
    const whole = 0.55 + 0.25 * rand()
    const dash = [10 + rand() * 18, 1.5 + rand() * 2, 4 + rand() * 10, 2 + rand() * 3, 3 + rand() * 6, 3 + rand() * 5]
    return {
      x0: r1(cx + dx),
      y0: r1(root),
      x1: r1(cx + dx * 1.3),
      mid: r1(root - (root - top) * whole),
      top: r1(top),
      dash: dash.map(r1).join(' '),
      width: r1(0.5 + 0.3 * middle),
    }
  })
}

/** A still field of stars, sparse and fine, the same wherever the frame is cut: laid on a fixed field about the middle, and thinning out over the band. */
function starsOf(w: number, h: number, band: number, cx: number, cy: number, sun: number, tall: number): Star[] {
  const rand = seeded(7)
  const stars: Star[] = []
  const FIELD_W = 2600
  const FIELD_H = 1200
  const count = 600
  for (let i = 0; i < count; i++) {
    const x = cx + (rand() - 0.5) * FIELD_W
    const y = rand() * FIELD_H
    const size = rand()
    const bright = rand()
    const hue = rand()
    const keep = rand()
    if (x < -2 || x > w + 2 || y > h) continue
    // Fewer over the band, where the words are.
    if (y > band - 40 && keep > 0.25) continue
    // None in the sun's light.
    if (Math.abs(x - cx) < sun * 0.95 && y > cy - tall - 24 && y < cy + sun * 0.6) continue
    stars.push({
      x: r1(x),
      y: r1(y),
      r: r1(0.4 + size ** 4 * 0.95),
      a: Math.round((0.2 + bright ** 2 * 0.7) * 100) / 100,
      tone: hue < 0.16 ? 1 : hue < 0.22 ? 2 : 0,
    })
  }
  return stars
}
