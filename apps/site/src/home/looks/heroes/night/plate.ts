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

/** Where an agent rides: its orbit (0 the innermost) and how far round it, in degrees. */
type Seat = readonly [orbit: number, at: number]

/** On a wide screen: seven orbits, the two outer ones running off the sides; the agents spread round them so no two names meet. */
const WIDE = {
  orbits: 7,
  inner: 0.19,
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
  inner: 0.2,
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
  orbits: Orbit[]
  bodies: Body[]
  stars: Star[]
  /** The sun: the mark's size, its light, and how tall the light stands over the mark's middle. */
  sun: number
  rays: Ray[]
  tall: number
  /** The graduations along one orbit: near and far. */
  ticks: { near: string; far: string }
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))
const r1 = (n: number) => Math.round(n * 10) / 10

/** The orbits' colours: in the sun's light, and out in the cold. */
const WARM = [246, 228, 206] as const
const COLD = [170, 180, 255] as const
const mix = (a: readonly number[], b: readonly number[], t: number) => `rgb(${a.map((x, i) => Math.round(x + (b[i]! - x) * t)).join(' ')})`

/** Seen from a little above, in perspective: the near half of each orbit a little deeper than the far half. */
const FAR = 0.88
const NEAR = 1.12

/** The name's width, in px: JetBrains Mono's advance (0.6em) and the label's tracking (0.12em), at 10.5px. */
const LABEL = { size: 10.5, advance: 0.72, height: 12, gap: 7 }
const labelWidth = (name: string) => name.length * LABEL.size * LABEL.advance - LABEL.size * 0.12

interface Box {
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
      far: `M${L} ${y}A${r1(rx)} ${r1(ry * FAR)} 0 0 1 ${R} ${y}`,
      near: `M${R} ${y}A${r1(rx)} ${r1(ry * NEAR)} 0 0 1 ${L} ${y}`,
      // Brighter near the sun, fainter outward.
      bright: 0.5 - 0.2 * (i / (plan.orbits - 1)),
      tone: mix(WARM, COLD, Math.min(1, (i + 0.6) / (plan.orbits * 0.6))),
    }
  })

  const at = (o: Orbit, deg: number) => {
    const sin = Math.sin(deg * DEG)
    return [cx + o.rx * Math.cos(deg * DEG), cy + o.ry * sin * (sin > 0 ? NEAR : FAR)] as const
  }

  // The sun: the mark, and its light rising from behind it.
  const sun = phone ? 34 : Math.round(50 * scale)
  const tall = sun * (phone ? 2.4 : 2.7)
  const rays = raysOf(cx, cy, sun, tall)

  // The bodies, seated; then their names, set where there is room.
  const bodies: Body[] = AGENTS.map((agent, n) => {
    const [oi, deg] = plan.seats[agent.id] ?? [n % plan.orbits, (n * 137) % 360]
    const o = orbits[Math.min(oi, orbits.length - 1)]!
    const [x, y] = at(o, deg)
    const d = Math.sin(deg * DEG)
    const size = Math.round((phone ? 20 + 4 * d : 26 + 5 * d) * scale)
    // The way it came: prograde, so from a little further round (a larger angle); a like length of arc on every orbit.
    const span = clamp(((phone ? 46 : 70) * scale) / o.rx, 0.12, 0.42) / DEG
    const steps = 16
    const pts = Array.from({ length: steps + 1 }, (_, k) => at(o, deg + (span * k) / steps))
    const [x1, y1] = pts[steps]!
    return {
      id: agent.id,
      name: agent.name,
      x,
      y,
      d,
      size,
      mark: Math.round(size * 0.5),
      side: null,
      trail: { d: `M${pts.map(([px, py]) => `${r1(px)} ${r1(py)}`).join('L')}`, x1, y1 },
    }
  })

  // Names, nearest first: outward from the middle, or inward if that doesn't fit, or none.
  const kept: Box[] = [
    // The sun and its light.
    { l: cx - sun * 0.7, t: cy - tall, r: cx + sun * 0.7, b: cy + sun * 0.5 },
    // The bar under the nav, where the picture's top would meet it.
    { l: cx - 190, t: 0, r: cx + 190, b: f.top },
  ]
  const discs: Box[] = bodies.map((b) => ({ l: b.x - b.size / 2, t: b.y - b.size / 2, r: b.x + b.size / 2, b: b.y + b.size / 2 }))
  const order = [...bodies].sort((a, b) => b.d - a.d)
  for (const b of order) {
    const lw = labelWidth(b.name)
    const out: 'left' | 'right' = b.x < cx ? 'left' : 'right'
    const box = (side: 'left' | 'right'): Box => {
      const l = side === 'right' ? b.x + b.size / 2 + LABEL.gap : b.x - b.size / 2 - LABEL.gap - lw
      return { l, t: b.y - LABEL.height / 2, r: l + lw, b: b.y + LABEL.height / 2 }
    }
    // On a phone, only outward: a name across the middle crowds it.
    const sides: ('left' | 'right')[] = phone ? [out] : [out, out === 'left' ? 'right' : 'left']
    for (const side of sides) {
      const bx = box(side)
      const edge = phone ? 10 : 16
      if (bx.l < edge || bx.r > w - edge || bx.b > f.foot - 6) continue
      if (kept.some((k) => meets(k, bx, 8))) continue
      if (discs.some((k, i) => bodies[i] !== b && meets(k, bx, 6))) continue
      b.side = side
      kept.push(bx)
      break
    }
  }

  // Graduations along one orbit, square to it, longer every thirty degrees.
  const ticked = orbits[Math.min(phone ? 3 : 3, orbits.length - 1)]!
  const ticks = { near: '', far: '' }
  for (let deg = 0; deg < 360; deg += 5) {
    const [x, y] = at(ticked, deg)
    const sin = Math.sin(deg * DEG)
    const nx = Math.cos(deg * DEG) / ticked.rx
    const ny = sin / (ticked.ry * (sin > 0 ? NEAR : FAR))
    const len = Math.hypot(nx, ny)
    const l = deg % 30 === 0 ? 6 : deg % 10 === 0 ? 3.5 : 2
    const seg = `M${r1(x)} ${r1(y)}l${r1((nx / len) * l)} ${r1((ny / len) * l)}`
    if (sin > 0) ticks.near += seg
    else ticks.far += seg
  }

  return { w, h, cx, cy, orbits, bodies, stars: starsOf(w, h, f.foot, cx, cy, sun), sun, rays, tall, ticks }
}

/**
 * The sun's light, as the altar's in the footer: fine lines rising from
 * behind the mark, rooted along its two upper edges so it stands on them,
 * gathered toward the middle, whole low down and breaking up as they rise.
 */
function raysOf(cx: number, cy: number, sun: number, tall: number): Ray[] {
  const rand = seeded(29)
  const k = sun / 24
  // Across most of the mark's width, a line every two and a half px or so.
  const half = sun * 0.3
  const n = Math.max(9, Math.round((half * 2) / 2.6) | 1)
  return Array.from({ length: n }, (_, i) => {
    const u = (i / (n - 1)) * 2 - 1
    const dx = u * half + (rand() - 0.5) * 0.4
    const middle = 1 - Math.abs(u)
    // Its root: just inside the mark's upper edge where it is, so it stands on it. The edge is a face hollowed to a circle: the chord from the tip to a corner, and the hollow under it (on the 24 grid).
    const along = clamp((Math.abs(dx) / k - 0.42) / 7.47, 0, 1)
    const edge = 5.53 + along * 12.94 + 3.9 * 4 * along * (1 - along) + 0.9
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
function starsOf(w: number, h: number, band: number, cx: number, cy: number, sun: number): Star[] {
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
    if (Math.abs(x - cx) < sun * 1.6 && y > cy - sun * 4.5 && y < cy + sun) continue
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
