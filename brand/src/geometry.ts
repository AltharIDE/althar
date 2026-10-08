/*
 * Althar's mark, drawn once. The section through an architect's triangular
 * scale ruler, bored through the middle, with a point in the bore. On a 24
 * grid; the same drawing is in the UI package's Logo and in the pitch, the
 * favicons and the banners, and tests/drift.test.ts keeps every copy equal to
 * this one.
 */

/** The grid the mark is drawn on. */
export const GRID = 24

/** The ruler's section: an equilateral triangle about the centroid, faces hollowed, tips cut flat. */
export const SECTION =
  'M12.42 5.53A15.36 15.36 0 0 0 19.89 18.47L19.47 19.2A15.36 15.36 0 0 0 4.53 19.2L4.11 18.47A15.36 15.36 0 0 0 11.58 5.53Z'

/** The bore, to be cut from the section with the even-odd rule. */
export const BORE = 'M10.2 14.4a1.8 1.8 0 1 0 3.6 0a1.8 1.8 0 1 0-3.6 0Z'

/** The point in the bore. */
export const POINT = { cx: 12, cy: 14.4, r: 0.8 } as const

/** What the section covers on the grid: its flat base sits on y = 19.2. */
export const BOUNDS = { x: 4.11, y: 5.53, width: 15.78, height: 13.67 } as const

/** The grid line the section stands on: the baseline when the mark sits beside a name. */
export const BASELINE = 19.2
