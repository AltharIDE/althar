import capsule from './plate/capsule.webp'

/*
 * The cabin: a photograph from inside a crew capsule coming in, two
 * astronauts strapped in, seen from behind, a large window ahead and to the
 * right and a small one at the left. The windows are keyed out, so the fire
 * and the sky show through them, drawn behind (fire.ts) by the photograph's
 * own measure, so they stand where the glass is at any size.
 */

export const PLATE = {
  src: capsule,
  width: 3344,
  height: 1882,
  /** The windows' boxes, in the plate's px: the large one first. */
  windows: [
    { x: 1700, y: 48, w: 1610, h: 960 },
    { x: 674, y: 280, w: 438, h: 440 },
  ],
  /** The large window, where the words are. */
  big: { x: 1700, y: 48, w: 1610, h: 960 },
  /** The point kept in view when the screen crops the plate: between the astronauts and the large window. */
  focus: { x: 1850, y: 640 },
  /** On a phone, the large window, the words in it. */
  phone: { x: 2420 },
  /** The sky picture over the plate: a little larger than it, for the heat's shimmer and the drift, its horizon low in the large window. */
  sky: { x: -320, y: -365, w: 3846, h: 2164 },
} as const

/** All the glass, as one box in the plate's px: where the fire needs drawing. */
export const GLASS = (() => {
  const x = Math.min(...PLATE.windows.map((w) => w.x))
  const y = Math.min(...PLATE.windows.map((w) => w.y))
  const r = Math.max(...PLATE.windows.map((w) => w.x + w.w))
  const b = Math.max(...PLATE.windows.map((w) => w.y + w.h))
  return { x, y, w: r - x, h: b - y }
})()
