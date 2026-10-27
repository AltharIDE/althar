import cupola from './plate/cupola.webp'

/*
 * The cabin: a photograph from inside a space station's observation dome,
 * looking up into its windows (a round one in the middle, six around it),
 * two astronauts floating at them. The windows are keyed out, so the Earth
 * shows through them, drawn behind (earth.ts) through the photograph's own
 * lens, so it stands where the glass is at any size.
 */

export const PLATE = {
  src: cupola,
  width: 3344,
  height: 1882,
  /** How tall a view the photograph's lens takes in, in degrees, top to bottom. */
  fov: 72,
  /** The windows' boxes, in the plate's px: the round one first. */
  windows: [
    { x: 1244, y: 480, w: 854, h: 836 },
    { x: 1280, y: 0, w: 794, h: 266 },
    { x: 616, y: 42, w: 556, h: 706 },
    { x: 2176, y: 40, w: 534, h: 710 },
    { x: 624, y: 1020, w: 516, h: 600 },
    { x: 2198, y: 1024, w: 450, h: 606 },
    { x: 1316, y: 1484, w: 704, h: 180 },
  ],
  /** The point kept in view when the screen crops the plate: the round window's top, where the sun comes up and the words are. */
  focus: { x: 1672, y: 760 },
  /** On a phone, the round window and the astronaut on the right. */
  phone: { x: 1900 },
} as const

/** All the glass, as one box in the plate's px: where the Earth needs drawing. */
export const GLASS = (() => {
  const x = Math.min(...PLATE.windows.map((w) => w.x))
  const y = Math.min(...PLATE.windows.map((w) => w.y))
  const r = Math.max(...PLATE.windows.map((w) => w.x + w.w))
  const b = Math.max(...PLATE.windows.map((w) => w.y + w.h))
  return { x, y, w: r - x, h: b - y }
})()
