import capsule from './plate/capsule.webp'
import capsuleTall from './plate/capsule-tall.webp'

/*
 * The cabin: a photograph from inside a crew capsule coming in, seen from
 * behind its two seats, an astronaut either side and one large window
 * straight ahead, dead centre; and the same cabin taken tall, for a phone,
 * the window above the astronauts' heads. The window is keyed out, so the
 * fire and the sky show through it, drawn behind (fire.ts) by the
 * photograph's own measure, so they stand where the glass is at any size.
 */

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export interface Plate {
  src: string
  width: number
  height: number
  /** The window, in the plate's px: where the words are and the fire is drawn. */
  window: Box
  /** The point kept in view when the screen crops the plate: the window's upper middle, where the words are. */
  focus: { x: number; y: number }
  /** The sky picture over the plate: wider than the window, for the heat's shimmer and the drift, its horizon low in it. */
  sky: Box
  /** How large the fire is drawn on it, against the wide photograph (fire.ts). */
  unit: number
}

/** The wide photograph, for anything wider than a phone. */
export const WIDE: Plate = {
  src: capsule,
  width: 3344,
  height: 1882,
  window: { x: 442, y: 134, w: 2460, h: 1116 },
  focus: { x: 1672, y: 640 },
  sky: { x: 222, y: 80, w: 2900, h: 1632 },
  unit: 1,
}

/** The tall one, for a phone: its px are smaller on the screen, so the fire is drawn larger on it. */
export const TALL: Plate = {
  src: capsuleTall,
  width: 1882,
  height: 3344,
  window: { x: 0, y: 416, w: 1882, h: 1406 },
  focus: { x: 941, y: 1150 },
  sky: { x: -836, y: 346, w: 3554, h: 2000 },
  unit: 1.75,
}

/** Where the tall photograph takes over: the stylesheet's phone width. */
export const PHONE = '(max-width: 760px)'
