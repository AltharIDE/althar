import { BORE, BOUNDS, POINT, SECTION } from './geometry'
import { BLACK, COBALT, COBALT_ON_INK, INK, PAPER, WHITE } from './palette'
import { type Box, num, svgDocument } from './svg'

/**
 * How the mark is coloured: its section, and the point in the bore. A point
 * with no colour of its own is drawn in the section's; `null` leaves the bore
 * open, so the ground shows through it.
 */
export interface MarkStyle {
  section: string
  point?: string | null
}

/**
 * The marks as files. `ink` and `paper` are the full-colour pair, for light
 * and dark grounds; `on-cobalt` is for Althar's own ground, where the open bore
 * shows the cobalt, as on the app icon; the rest are one colour, for when a
 * ground, a print or a licence allows no more.
 */
export const MARK_STYLES = {
  ink: { section: INK, point: COBALT },
  paper: { section: PAPER, point: COBALT_ON_INK },
  'on-cobalt': { section: PAPER, point: null },
  'mono-black': { section: BLACK },
  'mono-white': { section: WHITE },
  'mono-cobalt': { section: COBALT },
} as const satisfies Record<string, MarkStyle>

export type MarkName = keyof typeof MARK_STYLES

/** The mark's strokes, without a document around them: for placing inside another drawing. */
export function markBody(style: MarkStyle): string {
  const point = style.point === undefined ? style.section : style.point
  const dot = point === null ? '' : `<circle fill="${point}" cx="${POINT.cx}" cy="${POINT.cy}" r="${POINT.r}"/>`
  return `<path fill="${style.section}" fill-rule="evenodd" d="${SECTION}${BORE}"/>${dot}`
}

const TIGHT: Box = [BOUNDS.x, BOUNDS.y, BOUNDS.width, BOUNDS.height]

/** The mark on its own, with its box cut to the section. */
export function markSvg(style: MarkStyle): string {
  return svgDocument(TIGHT, markBody(style), 'Althar')
}

/** The mark scaled and moved so that its grid lands at `x`, `y` with `scale` units per grid unit. */
export function placedMark(style: MarkStyle, x: number, y: number, scale: number): string {
  return `<g transform="translate(${num(x)} ${num(y)}) scale(${num(scale, 4)})">${markBody(style)}</g>`
}
