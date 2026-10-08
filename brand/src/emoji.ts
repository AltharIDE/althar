import { COBALT, PAPER, VIOLET } from './palette'
import { markBody } from './mark'
import { svgDocument } from './svg'

/*
 * The product's two signals as emoji, for a chat that talks about it: cobalt
 * is work running right now, violet is something that needs a person. Beside
 * them, the mark on its cobalt tile, which reads on a light or a dark chat.
 */

const SIZE = 128

/** A round dot inside a 128 square, with the margin chat clients like. */
export function dotSvg(colour: string, label: string): string {
  return svgDocument([0, 0, SIZE, SIZE], `<circle cx="64" cy="64" r="52" fill="${colour}"/>`, label)
}

export const RUNNING = dotSvg(COBALT, 'Running')
export const NEEDS_YOU = dotSvg(VIOLET, 'Needs you')

/** The favicon: the section in paper on a cobalt tile, on the 24 grid, with the bore showing the tile. */
export function tileSvg(): string {
  const mark = markBody({ section: PAPER, point: null })
  return svgDocument(
    [0, 0, 24, 24],
    `<rect width="24" height="24" rx="5.25" fill="${COBALT}"/><g transform="translate(2.4 2.4) scale(.8)">${mark}</g>`,
    'Althar',
  )
}
