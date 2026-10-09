import { BORE, type Dot, PARTICLES, POINT_RADIUS } from '../../foundations/HalftoneMark/halftone'
import { COLUMNS } from '../../foundations/Light/columns'
import { spring } from '../../lib/spring'

export { spring, springEasing } from '../../lib/spring'

/*
 * When each part of the launch moves, as pure functions of time, so the
 * component only draws what they say.
 *
 * A light rises off the window's bottom, from the middle out, on a slow
 * spring, and sways a little while it stands (light.ts). The mark comes up
 * out of it as the README prints it, a halftone (halftone.ts): its dots rise
 * out of the light, the base first, each on its own spring, and settle in
 * place. Then a few particles close in on the bore one after another, and
 * the point grows there as they arrive. The mark holds a moment, to be seen.
 *
 * Once what it opens onto is ready, and has been drawn under the veil, the
 * light sinks back from the edges in, the dots fall back into it, the veil's
 * paper goes, and what it opens onto arrives piece by piece, top to bottom,
 * each on a spring.
 */

/** Milliseconds: from the start, or (`open`) from when the opening began. */
export const AT = {
  /** The light: when its middle starts up, how much later its edges do, and its spring. */
  light: { start: 40, spread: 300, response: 1.05, damping: 0.86 },
  /**
   * The mark's dots: each starts at `start`, later by up to `spread` the
   * higher it sits and by up to `jitter` more, from `rise` to `rise` +
   * `riseJitter` units below its place and up to half `drift` aside, and
   * settles on its spring.
   */
  dots: { start: 160, spread: 420, jitter: 220, rise: 8, riseJitter: 6, drift: 4, response: 0.95, damping: 0.84 },
  /** The point's particles close in on the bore, one every `apart`, each over `length`; the point grows as they arrive. */
  particles: { start: 760, apart: 34, length: 420 },
  point: { start: 1180, length: 320 },
  /** The earliest it opens: the mark set, and held a moment to be seen. */
  set: 1750,
  /** How long what it opens onto is ready before it opens, so it is drawn under the veil first. */
  settle: 120,
  open: {
    /** The light sinks, the edges at once and the middle `spread` later, each over `sink`; then it is gone over `fade`. */
    spread: 140,
    sink: 640,
    fade: { start: 360, length: 520 },
    /** The mark's dots fall back into the light, `depth` units, the base first and the tip `spread` later, each over `length`. */
    fall: { spread: 180, length: 420, depth: 9 },
    /** The veil's paper goes, and what is behind shows through it. */
    paper: { start: 120, length: 320 },
    /**
     * What is behind arrives: its pieces from `rise` px below, the first at
     * `start`, the rest later by where they sit, down the window over
     * `down` and across it over `across`; each fades in over `fade` and
     * settles on its spring.
     */
    arrive: { start: 140, down: 320, across: 120, rise: 24, scale: 0.985, fade: 340, response: 0.62, damping: 0.8 },
  },
  /** How long the veil stays once it opens: the light, the mark and the paper are gone. */
  through: 900,
  /** Opening at once, as after a reload or with motion reduced: how long the mark stays, and how long it fades. */
  quick: { hold: 160, fade: 220 },
} as const

export const clamp = (value: number, low = 0, high = 1) => Math.min(high, Math.max(low, value))
/** How far along [start, start + length] time `t` is, from 0 to 1. */
export const progress = (t: number, start: number, length: number) => clamp((t - start) / length)
export const lerp = (from: number, to: number, x: number) => from + (to - from) * x

export const easeInCubic = (x: number) => x * x * x
export const easeInOutCubic = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2)

/** The light at `t`, `open` being when the opening began, or null. */
export interface Light {
  /** Each column: how tall it stands, as a share of the light's height, and how far it has drifted aside, in px. */
  readonly columns: ReadonlyArray<{ readonly height: number; readonly drift: number }>
  /** How strongly the light shows, and its grain. */
  readonly strength: number
  readonly grain: number
}

export const lightAt = (t: number, open: number | null): Light => {
  const since = open === null ? -1 : t - open
  const { light } = AT
  const sunk = (d: number) => easeInOutCubic(progress(since, (1 - d) * AT.open.spread, AT.open.sink))
  const up = (d: number) => spring(t - (light.start + d * light.spread), light.response, light.damping)
  return {
    columns: COLUMNS.map((column) => ({
      height: column.height * up(column.d) * (1 + 0.04 * Math.sin(t / 640 + column.i * 1.7)) * (1 - sunk(column.d)),
      drift: 9 * Math.sin(t / 930 + column.i * 2.3),
    })),
    strength: 1 - easeInCubic(progress(since, AT.open.fade.start, AT.open.fade.length)),
    grain: 0.5 * spring(t - 200, 1, 1) * (1 - easeInOutCubic(progress(since, 80, 700))),
  }
}

/** Something of the mark to draw, in the mark's grid: where, how big, how strongly. */
export interface Speck {
  readonly x: number
  readonly y: number
  readonly r: number
  readonly alpha: number
}

/** How far a part of the mark `down` the section (0 the tip, 1 the base) has fallen back into the light, `since` the opening began. */
const fallOf = (down: number, since: number) => {
  const { fall } = AT.open
  return easeInCubic(progress(since, (1 - down) * fall.spread, fall.length))
}

/** A dot of the mark at `t`, `open` being when the opening began, or null: or nothing, before it starts and once it is gone. */
export const dotAt = (dot: Dot, t: number, open: number | null): Speck | null => {
  const { dots } = AT
  const settled = spring(t - (dots.start + (1 - dot.down) * dots.spread + dot.jitter[0] * dots.jitter), dots.response, dots.damping)
  if (settled <= 0) return null
  const fall = fallOf(dot.down, open === null ? -1 : t - open)
  const alpha = clamp(settled * 2.5) * (1 - Math.sqrt(fall))
  if (alpha <= 0) return null
  return {
    x: dot.x + (1 - settled) * (dot.jitter[1] - 0.5) * dots.drift,
    y: dot.y + (1 - settled) * (dots.rise + dot.jitter[2] * dots.riseJitter) + fall * AT.open.fall.depth,
    r: dot.r * clamp(0.35 + settled * 0.65),
    alpha,
  }
}

/** The point's particle `i` at `t`, closing in on the bore, or nothing before it sets out and once it has arrived. */
export const particleAt = (i: number, t: number): Speck | null => {
  const { particles } = AT
  const along = progress(t, particles.start + i * particles.apart, particles.length)
  const from = PARTICLES[i]
  if (along <= 0 || along >= 1 || from === undefined) return null
  const left = from.far * (1 - easeInOutCubic(along))
  return {
    x: BORE.x + Math.cos(from.angle) * left,
    y: BORE.y + Math.sin(from.angle) * left,
    r: lerp(0.26, 0.12, along),
    alpha: clamp(along * 4),
  }
}

/** The point at `t`, grown as its particles arrive, falling with the dots about it once it opens; or nothing before it starts. */
export const pointAt = (t: number, open: number | null): Speck | null => {
  const grown = progress(t, AT.point.start, AT.point.length)
  if (grown <= 0) return null
  const fall = fallOf((BORE.y - 5.5) / 13.7, open === null ? -1 : t - open)
  return { x: BORE.x, y: BORE.y + fall * AT.open.fall.depth, r: POINT_RADIUS * grown, alpha: 1 - Math.sqrt(fall) }
}

/** A time by which the mark is set, for drawing it so at once. */
export const SETTLED = 10_000

/** When a piece of what it opens onto starts to arrive, after the opening began, by where it sits (0 to 1, down and across the window). */
export const arrivalOf = (down: number, across: number) => {
  const { arrive } = AT.open
  return Math.round(arrive.start + clamp(down) * arrive.down + clamp(across) * arrive.across)
}
