import capsule from './plate/capsule.webp'

/*
 * The cabin: a photograph from inside a crew capsule coming in, seen from
 * behind its two seats, an astronaut either side and one large window
 * straight ahead, dead centre. The window is keyed out, so the fire and the
 * sky show through it, drawn behind (fire.ts) by the photograph's own
 * measure, so they stand where the glass is at any size.
 */

export const PLATE = {
  src: capsule,
  width: 3344,
  height: 1882,
  /** The windows' boxes, in the plate's px. */
  windows: [{ x: 442, y: 134, w: 2460, h: 1116 }],
  /** The window, where the words are. */
  big: { x: 442, y: 134, w: 2460, h: 1116 },
  /** The point kept in view when the screen crops the plate: the window's upper middle, where the words are. */
  focus: { x: 1672, y: 640 },
  /** On a phone, the window's middle too: the astronauts fall off the sides. */
  phone: { x: 1672 },
  /** The sky picture over the plate: wider than the window, for the heat's shimmer and the drift, its horizon low in it. */
  sky: { x: 222, y: 80, w: 2900, h: 1632 },
} as const

/** All the glass, as one box in the plate's px: where the fire needs drawing. */
export const GLASS = (() => {
  const x = Math.min(...PLATE.windows.map((w) => w.x))
  const y = Math.min(...PLATE.windows.map((w) => w.y))
  const r = Math.max(...PLATE.windows.map((w) => w.x + w.w))
  const b = Math.max(...PLATE.windows.map((w) => w.y + w.h))
  return { x, y, w: r - x, h: b - y }
})()
