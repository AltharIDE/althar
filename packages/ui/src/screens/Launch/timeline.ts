/*
 * When each part of the launch moves, as pure functions of time, so the
 * component only draws what they say.
 *
 * It draws the mark the way it was made: the three sides swing in and run
 * out past the window's edges, the compass swings the three circles that
 * hollow its faces, a scale runs along each side, the outline is traced and
 * inked, the bore is cut and the point set. What is being drawn is cobalt,
 * as work under way is, and settles into ink as the ink spreads. All the
 * while the camera eases back a little. Then, once what it opens onto is ready, the camera goes in through
 * the bore: the bore opens past the window's edges, the point (which has no
 * size) slips by, and what was behind it comes into focus.
 */

/** Milliseconds from the start: when each part begins, and how long it takes. */
export const AT = {
  /** The sides swing in from this far round, as an iris's blades close. */
  sides: { start: 60, each: 640, apart: 70, swing: -0.9 },
  circles: { start: 380, each: 640, apart: 110 },
  scale: { start: 420, unitsPerMs: 0.12 },
  outline: { start: 700, length: 460 },
  ink: { start: 1020, length: 340 },
  bore: { start: 1240, length: 240 },
  point: { start: 1340, length: 300 },
  /** The earliest the camera goes in: everything is drawn. */
  drawn: 1640,
  /** How long going in takes. */
  through: 780,
  /** Opening at once, as after a reload or with motion reduced: how long the mark stays, and how long it fades. */
  quick: { hold: 160, fade: 220 },
} as const

export const clamp = (value: number, low = 0, high = 1) => Math.min(high, Math.max(low, value))
/** How far along [start, start + length] time `t` is, from 0 to 1. */
export const progress = (t: number, start: number, length: number) => clamp((t - start) / length)

export const easeOutCubic = (x: number) => 1 - (1 - x) ** 3
export const easeOutQuart = (x: number) => 1 - (1 - x) ** 4
export const easeInOutCubic = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2)
/** Out, with a touch of overshoot: a point set down. */
export const easeOutBack = (x: number) => {
  const c = 1.4
  return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2
}

const lerp = (from: number, to: number, x: number) => from + (to - from) * x

/** Far enough from the bore's middle to cover the section's tips, in grid units. */
export const INK_REACH = 10.5

/** What the drawing looks like at `t` milliseconds. */
export interface Drawing {
  /** How far the camera has pulled back: 1 at rest, larger closer. */
  readonly camera: number
  /** How far each side runs from its middle, in grid units, and how far round it still is, in radians. */
  readonly sides: ReadonlyArray<number>
  readonly swings: ReadonlyArray<number>
  /** How much of each circle is drawn, from 0 to 1. */
  readonly circles: ReadonlyArray<number>
  /** How far the scale runs either way from each side's middle, in grid units. */
  readonly scale: number
  readonly outline: number
  /** How far the ink has spread from the bore's middle, in grid units. */
  readonly ink: number
  /** How far the bore is cut, 0 to 1 of its radius. */
  readonly bore: number
  /** How big the point is, 0 to about 1.1 of its radius. */
  readonly point: number
  /** The ring that spreads as the point is set: its radius in point radii, and how strong it is. */
  readonly ring: { readonly radius: number; readonly strength: number }
  /** How strongly the construction shows behind the mark: it steps back once the mark is inked. */
  readonly construction: number
  /** How far what is drawn has settled from cobalt, work under way, into ink, 0 to 1. */
  readonly settled: number
}

/** The drawing at `t`; `reach` is how far the sides need to run to leave the window, in grid units. */
export const drawingAt = (t: number, reach: number): Drawing => {
  const { sides, circles, scale, outline, ink, bore, point } = AT
  const pointIn = progress(t, point.start, point.length)
  const ringIn = progress(t, point.start + 40, 620)
  return {
    camera: lerp(1.1, 1, easeOutQuart(progress(t, 0, AT.drawn))),
    sides: [0, 1, 2].map((i) => reach * easeOutCubic(progress(t, sides.start + i * sides.apart, sides.each))),
    swings: [0, 1, 2].map((i) => sides.swing * (1 - easeOutQuart(progress(t, sides.start + i * sides.apart, sides.each + 160)))),
    circles: [0, 1, 2].map((i) => easeInOutCubic(progress(t, circles.start + i * circles.apart, circles.each))),
    scale: Math.max(0, (t - scale.start) * scale.unitsPerMs),
    outline: easeInOutCubic(progress(t, outline.start, outline.length)),
    ink: INK_REACH * easeInOutCubic(progress(t, ink.start, ink.length)),
    bore: easeOutBack(progress(t, bore.start, bore.length)),
    point: pointIn === 0 ? 0 : easeOutBack(pointIn),
    ring: { radius: lerp(1, 4.2, easeOutCubic(ringIn)), strength: ringIn === 0 ? 0 : 0.3 * (1 - ringIn) },
    construction: lerp(1, 0.45, easeOutCubic(progress(t, ink.start, 500))),
    settled: easeInOutCubic(progress(t, ink.start - 80, 520)),
  }
}

/** Going in through the bore, at `x` from 0 to 1. */
export interface Through {
  /** How many times larger the drawing is about the bore. */
  readonly zoom: number
  /** How strongly the construction still shows. */
  readonly construction: number
  /** How strongly the point still shows. */
  readonly point: number
  /** What it opens onto: how much larger it still is, how blurred (px), and how strongly it shows. */
  readonly behind: { readonly scale: number; readonly blur: number; readonly strength: number }
  /** The veil is past the window's edges: it can go. */
  readonly gone: boolean
}

/**
 * `cover` is how many times the bore must grow to leave the window. It grows
 * slowly, then fast, and is past the edges by about two thirds of the way;
 * what is behind comes into focus over the whole.
 */
export const throughAt = (x: number, cover: number): Through => {
  const opening = clamp(x / 0.68)
  const zoom = Math.exp(Math.log(cover) * opening ** 2.2)
  const focus = easeOutCubic(x)
  return {
    zoom,
    construction: 1 - easeOutCubic(clamp(x / 0.35)),
    point: 1 - clamp(x / 0.28),
    behind: { scale: lerp(1.06, 1, focus), blur: lerp(10, 0, focus), strength: lerp(0.55, 1, easeOutCubic(clamp(x / 0.5))) },
    gone: opening >= 1,
  }
}
