/*
 * The footer's engraving (engraving/, made by scripts/engraving.ts): the
 * LinkedIn banner's scene, a landscape in the page's inks with a lighthouse
 * on its headland, its beam lit, canoes flying the labs' flags and Althar's
 * boats on the water, and colour under the water. Where things are in it, so
 * the footer can keep the lighthouse in view and the land under its words.
 */

/** It is 1916 by 821; where things are in it, as shares of its width and height. */
export const ASPECT = 1916 / 821
/** The lighthouse, across. */
export const LIGHTHOUSE_X = 1330 / 1916
/** The top of the landscape, the wooded cliffs at the left: above it is paper. */
export const LAND_Y = 0.4

/** A box of words, in the footer's px: its left and right, and its foot. */
export interface Clear {
  left: number
  right: number
  bottom: number
}

const FILES = import.meta.glob<string>('./engraving/*', { eager: true, query: '?url', import: 'default' })
/** One of its files, by name: engraving-1916.webp. */
export const engravingUrl = (file: string) => FILES[`./engraving/${file}`] ?? ''
