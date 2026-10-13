import interior from './plate/interior.webp'
import view from './plate/view.webp'

/*
 * The carriage: a photograph from inside a modern train, a man and a child
 * at the window, its windows keyed out so the landscape shows through them. Where
 * its windows are is measured from the plate, in its own px, so the words
 * and the landscape can be set where the glass is at any size.
 */

export interface Pane {
  x: number
  y: number
  w: number
  h: number
  /** Its corners' radius. */
  r: number
}

export const PLATE = {
  src: interior,
  /** The middle window's view as the train sets off, as the landscape's first frame draws it: the glass shows it until the landscape is in, and without scripts. */
  view,
  width: 3344,
  height: 1882,
  /** The middle window, then the next ones either side. */
  windows: [
    { x: 571, y: 111, w: 2316, h: 1106, r: 123 },
    { x: 0, y: 108, w: 217, h: 559, r: 108 },
    { x: 3242, y: 110, w: 102, h: 551, r: 106 },
  ],
  /** The point kept in view when the screen crops the plate: the window's upper middle, so the words never leave it. */
  focus: { x: 1728, y: 610 },
  /** On a phone, the man and the window's near side. */
  phone: { x: 1120 },
} as const
