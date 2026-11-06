import { Agent, AGENTS } from '../../content/agents'
import { seeded } from '../../shared/footer/random'

/*
 * The first screen's drawing, as plain numbers: Althar at the middle as the
 * system's sun, its light rising from it in fine lines as the altar's does
 * in the footer, and the agents you already pay for each on an orbit round
 * it. The orbits are circles seen from a little above their plane, so flat
 * ellipses, spaced wider outward, the outer ones running off both sides.
 * Each agent starts at a seat chosen for the frame (0° at the right, 90°
 * nearest, 180° at the left, 270° farthest), so the names open well spread;
 * system.ts moves them on from there. The same numbers every time; worked
 * out again only when the size does.
 */

const DEG = Math.PI / 180

/** Where an agent starts: its orbit (0 the innermost) and how far round it, in degrees. */
type Start = readonly [orbit: number, at: number]

/**
 * On a wide screen: seven orbits, the two outer ones running off the sides;
 * the agents spread round them so no two names meet. Seen from a little
 * above (`flat`, the orbits' height to their width), the outermost between
 * `reach` of the frame's width: flatter where the screen is short and wide,
 * so the outer ones still run off the sides, and rounder up to `round` where
 * it is tall, so they don't run so far off that the agents riding them are
 * mostly off screen.
 */
const WIDE = {
  orbits: 7,
  inner: 0.23,
  flat: 0.22,
  round: 0.3,
  reach: [0.7, 0.8],
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
  } as Partial<Record<Agent, Start>>,
}

/** On a phone: six orbits, seen from higher and smaller, the outer ones running off; the agents start near the nearest and farthest points, where the orbits are on screen. */
const PHONE = {
  orbits: 6,
  inner: 0.25,
  flat: 0.27,
  round: 0.36,
  reach: [0.8, 0.9],
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
  } as Partial<Record<Agent, Start>>,
}

/** The frame: its size, where the picture may start (under the nav), and where the words' band begins. */
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

/** An agent on its orbit (0 the innermost), and how far round it at second 0, in degrees. */
export interface Seat {
  id: Agent
  name: string
  orbit: number
  at: number
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

export interface Box {
  l: number
  t: number
  r: number
  b: number
}

export interface Plate {
  w: number
  h: number
  /** The sun's middle, the bore's: the middle of every orbit. */
  cx: number
  cy: number
  /** How far above the orbits' plane the system is seen from, in radians; the sun is tipped toward you as far. */
  tilt: number
  phone: boolean
  /** How large the bodies are drawn, and where the band's words begin. */
  scale: number
  foot: number
  /** What no name may cover: the sun and its light, and the nav. */
  fixed: Box[]
  orbits: Orbit[]
  bodies: Seat[]
  stars: Star[]
  /** The sun: the mark's size (its 24 grid, in px), its light, how tall the light stands over the bore, its warmth, and the box the light and its warmth take. */
  sun: number
  rays: Ray[]
  tall: number
  warmth: { x: number; y: number; r: number }
  glow: Box
  /** The graduations along one orbit: near and far. */
  ticks: { near: string; far: string }
}

export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))
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

/** A name, in px: JetBrains Mono's advance (0.6em) and the label's tracking (0.12em) at 10.5px, its line, and its gap from the disc (Hero.module.css). */
export const LABEL = { size: 10.5, advance: 0.72, height: 12, gap: 7 }

/** A name's width on the screen, in px. */
export const labelWidth = (name: string) => name.length * LABEL.size * LABEL.advance

/** Whether two boxes come within `m` px of each other. */
export const meets = (a: Box, b: Box, m: number) => a.l < b.r + m && b.l < a.r + m && a.t < b.b + m && b.t < a.b + m

/** The nav's glass, which no name goes under: 640px wide at most, its foot 58px down (shared/Nav.module.css). */
const NAV = { half: 330, foot: 64 }

/** Works out the drawing for a frame. */
export function plate(f: Frame): Plate {
  const { w, h, phone } = f
  const plan = phone ? PHONE : WIDE
  const cx = w / 2
  // The orrery fills the room between the nav and the band, its nearest edge clear of the band's rule; where it can't without seeming seen from too high, it stands in the middle of the room.
  const room = Math.max(160, f.foot - f.top - (phone ? 16 : 26))
  const fill = room / (FAR + NEAR)
  const rxMost = clamp(fill / plan.flat, w * plan.reach[0]!, w * plan.reach[1]!)
  const flat = Math.min(plan.round, fill / rxMost)
  const ryMost = rxMost * flat
  const cy = f.top + (room - ryMost * (FAR + NEAR)) / 2 + ryMost * FAR
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

  // The sun: the mark, standing as an object in the middle, and its light rising from behind it, no higher than the picture's top.
  const sun = phone ? 72 : Math.round(124 * scale)
  const tall = Math.min(sun * 2.4, cy - f.top + 6)
  const rays = raysOf(cx, cy, sun, tall)
  const warmth = { x: cx, y: r1(cy - sun * 0.2), r: r1(sun * 1.25) }
  const glow = {
    l: Math.floor(cx - warmth.r),
    t: Math.floor(Math.min(cy - tall, warmth.y - warmth.r)),
    r: Math.ceil(cx + warmth.r),
    b: Math.ceil(warmth.y + warmth.r),
  }
  const fixed: Box[] = [
    // The sun and its light.
    { l: cx - sun * 0.7, t: cy - tall, r: cx + sun * 0.7, b: cy + sun * 0.45 },
    { l: cx - NAV.half, t: 0, r: cx + NAV.half, b: NAV.foot },
  ]

  // Every agent Althar runs, seated.
  const bodies: Seat[] = AGENTS.map((agent, n) => {
    const [oi, deg] = plan.seats[agent.id] ?? [n % plan.orbits, (n * 137) % 360]
    return { id: agent.id, name: agent.name, orbit: Math.min(oi, orbits.length - 1), at: deg }
  })

  // Graduations along one orbit, square to it, longer every thirty degrees.
  const ticked = orbits[Math.min(3, orbits.length - 1)]!
  const ticks = { near: '', far: '' }
  for (let deg = 0; deg < 360; deg += 5) {
    const [x, y] = onOrbit({ cx, cy }, ticked, deg)
    const sin = Math.sin(deg * DEG)
    const nx = Math.cos(deg * DEG) / ticked.rx
    const ny = sin / (ticked.ry * (sin > 0 ? NEAR : FAR))
    const len = Math.hypot(nx, ny)
    const l = deg % 30 === 0 ? 6 : deg % 10 === 0 ? 3.5 : 2
    const seg = `M${r1(x)} ${r1(y)}l${r1((nx / len) * l)} ${r1((ny / len) * l)}`
    if (sin > 0) ticks.near += seg
    else ticks.far += seg
  }

  const stars = starsOf(w, h, f.foot, cx, cy, sun, tall)
  return {
    w,
    h,
    cx,
    cy,
    tilt: Math.asin(flat),
    phone,
    scale,
    foot: f.foot,
    fixed,
    orbits,
    bodies,
    stars,
    sun,
    rays,
    tall,
    warmth,
    glow,
    ticks,
  }
}

/** A point on an orbit, `deg` round it. */
export const onOrbit = (p: Pick<Plate, 'cx' | 'cy'>, o: Pick<Orbit, 'rx' | 'ry'>, deg: number) => {
  const sin = Math.sin(deg * DEG)
  return [p.cx + o.rx * Math.cos(deg * DEG), p.cy + o.ry * sin * (sin > 0 ? NEAR : FAR)] as const
}

/** A disc's diameter, by how near it is (1 nearest, -1 farthest). */
export const sizeOf = (p: Pick<Plate, 'phone' | 'scale'>, d: number) => Math.round((p.phone ? 20 + 4 * d : 26 + 5 * d) * p.scale * 10) / 10

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
