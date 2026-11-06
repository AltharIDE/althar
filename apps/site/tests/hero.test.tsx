import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vite-plus/test'

import { AGENTS } from '../src/content/agents'
import { HERO } from '../src/content/home'
import { Hero } from '../src/home/Hero'
import { modelOf, pose, rest } from '../src/home/hero/gl'
import { type Box, type Frame, meets, plate } from '../src/home/hero/plate'
import { DEPTH, type Mesh, point, POINT_RADIUS, solid } from '../src/home/hero/solid'
import { type At, bodiesAt, FADE, nameBox, type Name, placeNames, unnamed } from '../src/home/hero/system'

/** Frames the first screen meets, as Hero.tsx measures them in a browser: its size (100svh, 640 to 1060 tall; on a short phone taller, to keep the orrery's room), where the picture starts and where the words' band begins. */
const FRAMES: Record<string, Frame> = {
  laptop: { w: 1280, h: 800, top: 104, foot: 511, phone: false },
  desktop: { w: 1440, h: 900, top: 104, foot: 589, phone: false },
  wide: { w: 1920, h: 1060, top: 104, foot: 727, phone: false },
  ultrawide: { w: 2560, h: 1060, top: 104, foot: 727, phone: false },
  short: { w: 1180, h: 640, top: 104, foot: 365, phone: false },
  tablet: { w: 820, h: 1060, top: 104, foot: 731, phone: false },
  phone: { w: 390, h: 844, top: 96, foot: 423, phone: true },
  small: { w: 360, h: 770, top: 96, foot: 336, phone: true },
}

const disc = (b: At): Box => ({ l: b.x - b.size / 2, t: b.y - b.size / 2, r: b.x + b.size / 2, b: b.y + b.size / 2 })

/** Runs the system for `seconds` at 30 frames a second from second 0, as the hero does, calling `look` on each frame. */
function run(f: Frame, seconds: number, look: (at: At[], names: Name[], t: number) => void) {
  const p = plate(f)
  const names = unnamed(p)
  const dt = 1 / 30
  for (let k = 0; k <= seconds * 30; k++) {
    const t = k * dt
    const at = bodiesAt(p, t)
    placeNames(p, at, names, t, k ? dt : 0)
    look(at, names, t)
  }
  return p
}

describe('the first screen’s plate', () => {
  it('draws the same every time for a frame', () => {
    expect(plate(FRAMES.laptop!)).toEqual(plate(FRAMES.laptop!))
  })

  for (const [name, f] of Object.entries(FRAMES))
    it(`fits the system between the nav and the words, ${name}`, () => {
      const p = plate(f)
      expect(p.bodies.map((b) => b.id)).toEqual(AGENTS.map((a) => a.id))
      for (const b of p.bodies) expect(b.orbit).toBeLessThan(p.orbits.length)
      // The sun in the middle, its light no higher than the picture's top, its foot above the words.
      expect(p.cx).toBe(f.w / 2)
      expect(p.cy - p.tall).toBeGreaterThanOrEqual(f.top - 6)
      expect(p.cy + p.sun * 0.6).toBeLessThan(f.foot)
      // The nearest point of every orbit clear of the band's rule.
      for (const o of p.orbits) expect(p.cy + o.ry * 1.12).toBeLessThanOrEqual(f.foot - (f.phone ? 16 : 26) + 0.01)
      // The outer orbits run off the sides.
      expect(p.orbits.at(-1)!.rx).toBeGreaterThan(f.w / 2)
      // No star in the sun's light.
      for (const s of p.stars)
        expect(Math.abs(s.x - p.cx) < p.sun * 0.95 && s.y > p.cy - p.tall - 24 && s.y < p.cy + p.sun * 0.6).toBe(false)
    })

  it('turns the inner orbits faster, as Kepler found the planets do', () => {
    const p = plate(FRAMES.desktop!)
    for (let i = 1; i < p.orbits.length; i++) {
      const [inner, outer] = [p.orbits[i - 1]!, p.orbits[i]!]
      expect(outer.rx).toBeGreaterThan(inner.rx)
      expect(outer.speed).toBeLessThan(inner.speed)
      // A year goes as the orbit's size to the power of one and a half.
      expect(outer.speed * outer.rx ** 1.5).toBeCloseTo(inner.speed * inner.rx ** 1.5, 6)
    }
  })

  it('passes each body behind the sun and in front of it, larger and nearer in front', () => {
    const p = plate(FRAMES.desktop!)
    const year = 360 / p.orbits[0]!.speed
    const sides = new Set<boolean>()
    for (let t = 0; t < year; t += year / 24) {
      const b = bodiesAt(p, t)[p.bodies.findIndex((one) => one.orbit === 0)]!
      sides.add(b.d >= 0)
      expect(b.size).toBeGreaterThan(0)
    }
    expect(sides).toEqual(new Set([true, false]))
    const [near, far] = [bodiesAt(p, 0)[0]!, bodiesAt(p, year / 2)[0]!]
    expect(Math.sign(near.d)).not.toBe(Math.sign(far.d))
    expect(near.d > far.d ? near.size > far.size : far.size > near.size).toBe(true)
  })
})

describe('the agents’ names', () => {
  for (const [name, f] of Object.entries(FRAMES))
    it(`never show over one another, the sun, the nav, another disc or the words, ${name}`, () => {
      const p = plate(f)
      const edge = f.phone ? 10 : 16
      let shown = 0
      let frames = 0
      // Two minutes: nearly two years of the innermost orbit, and every pass of one body by another in it.
      run(f, 120, (at, names) => {
        frames++
        // A name half faded in or more is one you read.
        const read = names.flatMap((n, i) => (n.side && n.alpha >= 0.3 ? [{ i, box: nameBox(at[i]!, p.bodies[i]!.name, n.side) }] : []))
        shown += read.length
        for (const { i, box } of read) {
          // Set clear of the screen's edge; going, it may pass a little into that margin, never near the edge itself.
          expect(box.l).toBeGreaterThanOrEqual(edge / 2)
          expect(box.r).toBeLessThanOrEqual(f.w - edge / 2)
          expect(box.b).toBeLessThanOrEqual(f.foot)
          for (const k of p.fixed) expect(meets(k, box, 0)).toBe(false)
          for (const [j, b] of at.entries()) if (j !== i) expect(meets(disc(b), box, 0)).toBe(false)
          for (const other of read) if (other.i !== i) expect(meets(other.box, box, 0)).toBe(false)
        }
      })
      // Most of them are named most of the time on a wide screen; on a phone, where a name takes a quarter of the width, three or so.
      expect(shown / frames).toBeGreaterThan(f.phone ? 2.75 : 6)
    })

  it('opens with most of them named at once, where their seats were chosen', () => {
    for (const f of [FRAMES.laptop!, FRAMES.desktop!, FRAMES.wide!]) {
      const p = plate(f)
      const names = unnamed(p)
      placeNames(p, bodiesAt(p, 0), names, 0, 0)
      expect(names.filter((n) => n.side && n.alpha === 1).length).toBeGreaterThanOrEqual(8)
    }
  })

  it('fades a name in where room has held, and out quickly where it is lost, never flickering', () => {
    const p = plate(FRAMES.laptop!)
    const names = unnamed(p)
    const changes = names.map(() => 0)
    let last = names.map(() => false)
    for (let k = 0; k <= 120 * 30; k++) {
      const t = k / 30
      placeNames(p, bodiesAt(p, t), names, t, k ? 1 / 30 : 0)
      const now = names.map((n) => n.side !== null)
      now.forEach((on, i) => void (on !== last[i] && changes[i]!++))
      last = now
    }
    // A name comes and goes a few times a minute at most: it waits for room to hold before it comes in.
    for (const n of changes) expect(n).toBeLessThan(40)
    expect(FADE.out).toBeLessThan(FADE.in)
  })

  it('keeps the names clear across a resize, set again at once', () => {
    const before = plate(FRAMES.desktop!)
    const names = unnamed(before)
    for (let k = 0; k <= 300; k++) placeNames(before, bodiesAt(before, k / 30), names, k / 30, k ? 1 / 30 : 0)
    const after = plate(FRAMES.phone!)
    const at = bodiesAt(after, 10)
    placeNames(after, at, names, 10, 0)
    const read = names.flatMap((n, i) => (n.side ? [nameBox(at[i]!, after.bodies[i]!.name, n.side)] : []))
    for (const [i, a] of read.entries()) for (const b of read.slice(i + 1)) expect(meets(a, b, 0)).toBe(false)
    for (const n of names) expect(n.alpha === 0 || n.alpha === 1).toBe(true)
  })
})

describe('the sun', () => {
  const piece = solid()

  it('turns every triangle outward, as its normals say, so the faces turned away can be left undrawn', () => {
    for (const mesh of [piece, point()]) expect(turnedIn(mesh)).toBe(0)
  })

  it('is a solid piece: every corner indexed, every normal of unit length, closed round the mark’s section', () => {
    const n = piece.data.length / 6
    expect(n).toBeLessThan(65536)
    for (const i of piece.index) expect(i).toBeLessThan(n)
    for (let v = 0; v < n; v++) expect(Math.hypot(piece.data[v * 6 + 3]!, piece.data[v * 6 + 4]!, piece.data[v * 6 + 5]!)).toBeCloseTo(1, 5)
    const P = (i: number) => [piece.data[i * 6]!, piece.data[i * 6 + 1]!, piece.data[i * 6 + 2]!] as const
    let volume = 0
    for (let k = 0; k < piece.index.length; k += 3) {
      const [A, B, C] = [P(piece.index[k]!), P(piece.index[k + 1]!), P(piece.index[k + 2]!)]
      volume += (A[0] * (B[1] * C[2] - B[2] * C[1]) - A[1] * (B[0] * C[2] - B[2] * C[0]) + A[2] * (B[0] * C[1] - B[1] * C[0])) / 6
    }
    // Closed and turned outward, it encloses the mark's section drawn out to its depth, less a little at its rounded edges.
    const section = sectionArea()
    expect(volume).toBeGreaterThan(section * DEPTH * 0.88)
    expect(volume).toBeLessThan(section * DEPTH)
  })

  it('stands on the mark’s grid, centred on the bore', () => {
    const xs: number[] = []
    const ys: number[] = []
    const zs: number[] = []
    for (let v = 0; v < piece.data.length; v += 6) {
      xs.push(piece.data[v]!)
      ys.push(piece.data[v + 1]!)
      zs.push(piece.data[v + 2]!)
    }
    expect(Math.min(...xs)).toBeCloseTo(-7.89, 1)
    expect(Math.max(...xs)).toBeCloseTo(7.89, 1)
    expect(Math.max(...ys)).toBeCloseTo(14.4 - 5.53, 1)
    expect(Math.min(...ys)).toBeCloseTo(14.4 - 19.2, 1)
    expect(Math.max(...zs)).toBeCloseTo(DEPTH / 2, 5)
    expect(Math.min(...zs)).toBeCloseTo(-DEPTH / 2, 5)
    const ball = point()
    for (let v = 0; v < ball.data.length; v += 6)
      expect(Math.hypot(ball.data[v]!, ball.data[v + 1]!, ball.data[v + 2]!)).toBeCloseTo(POINT_RADIUS, 5)
  })

  it('is tipped toward you as far as the orbits are seen from above, rounder on a phone', () => {
    const [wide, phone] = [plate(FRAMES.desktop!), plate(FRAMES.phone!)]
    // The orbits' height to their width is how far above their plane they are seen from.
    for (const p of [wide, phone]) for (const o of p.orbits) expect(o.ry / o.rx).toBeCloseTo(Math.sin(p.tilt), 6)
    expect(phone.tilt).toBeGreaterThan(wide.tilt)
    expect(rest(wide.tilt).pitch).toBe(wide.tilt)
  })

  it('sways gently, and turns only by rotation', () => {
    const tilt = plate(FRAMES.desktop!).tilt
    for (let t = 0; t < 120; t += 0.5) {
      const q = pose(t, tilt)
      expect(Math.abs(q.yaw)).toBeLessThan(0.6)
      expect(Math.abs(q.pitch - tilt)).toBeLessThanOrEqual(0.05)
      expect(Math.abs(q.lift)).toBeLessThanOrEqual(0.55)
      // A rotation: its columns stay of unit length.
      const m = modelOf(q)
      for (let c = 0; c < 3; c++) expect(Math.hypot(m[c * 4]!, m[c * 4 + 1]!, m[c * 4 + 2]!)).toBeCloseTo(1, 5)
    }
    expect(rest(tilt).lift).toBe(0)
  })
})

describe('the first screen in the prerender', () => {
  it('renders with no window: the headline, the lead and every agent’s name, the drawing left to the browser', () => {
    const html = renderToString(<Hero />)
    expect(html).toContain('<h1')
    expect(html).toContain(HERO.last)
    for (const a of AGENTS) expect(html).toContain(a.name)
    expect(html).not.toContain('<canvas')
  })
})

/** How many of a mesh's triangles turn against their normals: wound clockwise seen from the side they face. Triangles with no area are left out. */
function turnedIn(mesh: Mesh) {
  const P = (i: number) => [mesh.data[i * 6]!, mesh.data[i * 6 + 1]!, mesh.data[i * 6 + 2]!] as const
  const N = (i: number) => [mesh.data[i * 6 + 3]!, mesh.data[i * 6 + 4]!, mesh.data[i * 6 + 5]!] as const
  let wrong = 0
  for (let k = 0; k < mesh.index.length; k += 3) {
    const [a, b, c] = [mesh.index[k]!, mesh.index[k + 1]!, mesh.index[k + 2]!]
    const [A, B, C] = [P(a), P(b), P(c)]
    const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]]
    const w = [C[0] - A[0], C[1] - A[1], C[2] - A[2]]
    const g = [u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!]
    const n = [0, 1, 2].map((x) => N(a)[x]! + N(b)[x]! + N(c)[x]!)
    if (Math.hypot(g[0]!, g[1]!, g[2]!) > 1e-9 && g[0]! * n[0]! + g[1]! * n[1]! + g[2]! * n[2]! <= 0) wrong++
  }
  return wrong
}

/** The mark's section, LOGO_SECTION less its bore, in grid units squared: counted on a fine grid. */
function sectionArea() {
  const C = [
    [12.42, 5.53],
    [19.89, 18.47],
    [19.47, 19.2],
    [4.53, 19.2],
    [4.11, 18.47],
    [11.58, 5.53],
  ] as const
  const B = [12, 14.4]
  const R = 15.36
  const hollow = (a: readonly number[], b: readonly number[]) => {
    const [dx, dy] = [b[0]! - a[0]!, b[1]! - a[1]!]
    const l = Math.hypot(dx, dy)
    const m = [(a[0]! + b[0]!) / 2, (a[1]! + b[1]!) / 2]
    let n = [-dy / l, dx / l]
    if (n[0]! * (m[0]! - B[0]!) + n[1]! * (m[1]! - B[1]!) < 0) n = [-n[0]!, -n[1]!]
    const off = Math.sqrt(R * R - (l / 2) ** 2)
    return [m[0]! + n[0]! * off, m[1]! + n[1]! * off]
  }
  const H = [0, 2, 4].map((i) => hollow(C[i]!, C[i + 1]!))
  const inside = (x: number, y: number) => {
    for (let i = 0; i < 6; i++) {
      const [a, b] = [C[i]!, C[(i + 1) % 6]!]
      if ((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]) < 0) return false
    }
    if (H.some((o) => Math.hypot(x - o[0]!, y - o[1]!) < R)) return false
    return Math.hypot(x - B[0]!, y - B[1]!) > 1.8
  }
  let n = 0
  const s = 0.02
  for (let x = 0; x < 24; x += s) for (let y = 0; y < 24; y += s) if (inside(x, y)) n++
  return n * s * s
}
