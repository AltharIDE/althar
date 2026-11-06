import { type Box, clamp, LABEL, labelWidth, meets, onOrbit, type Plate, sizeOf } from './plate'

/*
 * The system at a second: where each agent is on its orbit, how near and how
 * large, the way it came, and where its name is set. Every agent rides its
 * orbit prograde, the inner ones faster (plate.ts), passing behind the sun
 * and in front of it. A name stays on its side while there is room for it;
 * one that loses its room goes, quickly, and one without a place comes in
 * where room has held a moment, so no name comes in over another, and the
 * nearer always win. Plain numbers, so the hero draws them and the tests
 * run them.
 */

const DEG = Math.PI / 180
const r1 = (n: number) => Math.round(n * 10) / 10

export type Side = 'left' | 'right'

/** A body at a second. */
export interface At {
  x: number
  y: number
  /** How near: 1 at the nearest point of its orbit, -1 at the farthest. */
  d: number
  /** The disc's diameter. */
  size: number
  /** The way it came: a short arc along its orbit, from where it was (x1, y1) to where it is. */
  trail: string
  x1: number
  y1: number
}

/** A body `deg` round its orbit. */
export function bodyAt(p: Plate, orbit: number, deg: number): At {
  const o = p.orbits[orbit]!
  const [x, y] = onOrbit(p, o, deg)
  // Prograde, so it came from a little further round (a larger angle): a like length of arc on every orbit.
  const span = clamp(((p.phone ? 46 : 70) * p.scale) / o.rx, 0.12, 0.42) / DEG
  const steps = 16
  let trail = ''
  let x1 = x
  let y1 = y
  for (let k = 0; k <= steps; k++) {
    ;[x1, y1] = onOrbit(p, o, deg + (span * k) / steps)
    trail += `${k ? 'L' : 'M'}${r1(x1)} ${r1(y1)}`
  }
  return { x, y, d: Math.sin(deg * DEG), size: sizeOf(p, Math.sin(deg * DEG)), trail, x1, y1 }
}

/** Every body at second `t`. */
export const bodiesAt = (p: Plate, t: number): At[] => p.bodies.map((b) => bodyAt(p, b.orbit, b.at - p.orbits[b.orbit]!.speed * t))

/** A body's disc, as a box. */
const discOf = (b: At): Box => ({ l: b.x - b.size / 2, t: b.y - b.size / 2, r: b.x + b.size / 2, b: b.y + b.size / 2 })

/** Where a body's name is set on `side`. */
export function nameBox(b: Pick<At, 'x' | 'y' | 'size'>, name: string, side: Side): Box {
  const lw = labelWidth(name)
  const l = side === 'right' ? b.x + b.size / 2 + LABEL.gap : b.x - b.size / 2 - LABEL.gap - lw
  return { l, t: b.y - LABEL.height / 2, r: l + lw, b: b.y + LABEL.height / 2 }
}

/** The sides a name may take, in the order to try them: outward from the middle, then inward. */
export function sidesFor(p: Pick<Plate, 'cx'>, b: Pick<At, 'x'>): Side[] {
  const out: Side = b.x < p.cx ? 'left' : 'right'
  return [out, out === 'left' ? 'right' : 'left']
}

/** A name: the side it is set on, or none; whether it is going, having lost its room; the side it would take and since when; and how far it has faded in. */
export interface Name {
  side: Side | null
  going: boolean
  want: Side | null
  since: number
  alpha: number
}

export const unnamed = (p: Plate): Name[] =>
  p.bodies.map(() => ({ side: null, going: false, want: null, since: Number.NEGATIVE_INFINITY, alpha: 0 }))

/** How long a name takes to come in, and to go once it has lost its room; and how long room must hold before a name comes in. */
export const FADE = { in: 0.35, out: 0.18, settle: 0.3 }

/** Room kept round a name: from what is fixed and the other names, and from the discs. */
const CLEAR = { name: 8, disc: 6 }

/**
 * Sets every name for second `t`, `dt` after the last; with `dt` 0 at once,
 * as when the system opens, after a resize, or when motion stops.
 */
export function placeNames(p: Plate, at: At[], names: Name[], t: number, dt: number) {
  const order = at.map((_, i) => i).sort((a, b) => at[b]!.d - at[a]!.d)
  const discs = at.map(discOf)
  const edge = p.phone ? 10 : 16
  // What a name may not come near: what is fixed, and the names already settled this frame.
  const kept: Box[] = [...p.fixed]
  // The names going: no name comes in over them as they fade.
  const going: Box[] = []
  const room = (i: number, side: Side) => {
    const bx = nameBox(at[i]!, p.bodies[i]!.name, side)
    if (bx.l < edge || bx.r > p.w - edge || bx.b > p.foot - 6) return null
    // On a phone, a name across the middle crowds it.
    if (p.phone && bx.l < p.cx && bx.r > p.cx) return null
    if (kept.some((k) => meets(k, bx, CLEAR.name))) return null
    if (discs.some((k, j) => j !== i && meets(k, bx, CLEAR.disc))) return null
    return bx
  }

  // A name that is set keeps its place while there is room for it, nearest first.
  for (const i of order) {
    const n = names[i]!
    if (!n.side) continue
    const bx = room(i, n.side)
    if (bx) {
      n.going = false
      kept.push(bx)
    } else if (dt === 0) {
      n.side = null
      n.going = false
    } else {
      n.going = true
      going.push(nameBox(at[i]!, p.bodies[i]!.name, n.side))
    }
  }

  // One without a place takes the first side with room, once the room has held a moment; until then the room is kept for it.
  for (const i of order) {
    const n = names[i]!
    if (n.side) continue
    let pick: Side | null = null
    let box: Box | null = null
    for (const side of sidesFor(p, at[i]!)) {
      const bx = room(i, side)
      if (bx && !going.some((g) => meets(g, bx, CLEAR.name))) {
        pick = side
        box = bx
        break
      }
    }
    if (pick !== n.want) {
      n.want = pick
      n.since = t
    }
    if (!box) continue
    kept.push(box)
    if (dt === 0 || t - n.since >= FADE.settle) {
      n.side = pick
      n.going = false
      n.alpha = 0
    }
  }

  for (const n of names) {
    if (!n.side) n.alpha = 0
    else if (dt === 0) n.alpha = 1
    else if (!n.going) n.alpha = Math.min(1, n.alpha + dt / FADE.in)
    else {
      n.alpha = Math.max(0, n.alpha - dt / FADE.out)
      if (n.alpha > 0) continue
      // Gone: it waits for room again from here.
      n.side = null
      n.going = false
      n.want = null
      n.since = t
    }
  }
}
