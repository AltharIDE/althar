import type { Clear, Ground } from './engrave'

/*
 * The footer's engraving (engraving/): a landscape made once, in the page's
 * two inks, without the light. Where things are in it, so whatever shows it
 * (the footer, the link previews) can stand the light on its altar.
 */

/** It is 1916 by 821; where things are in it, as shares of its width and height. */
export const ASPECT = 1916 / 821
export const ALTAR_X = 1330 / 1916
const TABLE_Y = 503 / 821
const TABLE_W = 100 / 1916
const WATER_Y = 641 / 821
/** The top of the landscape, the wooded cliffs at the left: above it is paper. */
export const LAND_Y = 0.4
/** As high as the light reached where it was engraved. */
const LIGHT_Y = 0.04

const FILES = import.meta.glob<string>('./engraving/*', { eager: true, query: '?url', import: 'default' })
/** One of its files, by name: engraving-1916.webp. */
export const engravingUrl = (file: string) => FILES[`./engraving/${file}`] ?? ''

/** The ground the light stands on, for the engraving drawn at `left`, `top`, `iw` by `ih` in a box `w` by `h` whose words are `clear`. */
export function groundAt(left: number, top: number, iw: number, ih: number, w: number, h: number, clear: Clear[]): Ground {
  const altarTop = top + TABLE_Y * ih
  return {
    w,
    h,
    // The light was made for a table 70 px wide.
    k: (TABLE_W * iw) / 70,
    top,
    tall: h - top,
    water: top + WATER_Y * ih + 2,
    ax: left + ALTAR_X * iw,
    ground: altarTop,
    altarTop,
    // Under the words, and no higher than the engraving's own light reached.
    clear: [...clear, { left: 0, right: w, bottom: top + LIGHT_Y * ih }],
  }
}
