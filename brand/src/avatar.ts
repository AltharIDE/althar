import { GRID, BOUNDS } from './geometry'
import { type MarkStyle, markBody } from './mark'
import { COBALT, COBALT_ON_INK, INK, PAPER } from './palette'
import { svgDocument, num } from './svg'

/*
 * Avatars: a full square, which each place then cuts to its own shape: a
 * circle on X, LinkedIn and Discord, rounded corners on GitHub and Slack. So
 * the mark stays inside the circle that fits the square, and nothing sits in
 * the corners.
 */

export interface Ground extends MarkStyle {
  ground: string
}

/** The same three grounds as the app icon's cobalt, ink and paper. */
export const AVATAR_STYLES = {
  cobalt: { ground: COBALT, section: PAPER, point: null },
  ink: { ground: INK, section: PAPER, point: COBALT_ON_INK },
  paper: { ground: PAPER, section: INK, point: COBALT },
} as const satisfies Record<string, Ground>

export type AvatarName = keyof typeof AVATAR_STYLES

export const AVATAR_SIZE = 1024
/** The section's width as a share of the square: its corners then sit well inside the circle. */
const SPAN = 0.52

/** The grid's centre lands on the square's centre, as it does on the favicon. */
export function avatarSvg(style: Ground, size = AVATAR_SIZE): string {
  const k = (SPAN * size) / BOUNDS.width
  const origin = size / 2 - (GRID / 2) * k
  const mark = `<g transform="translate(${num(origin)} ${num(origin)}) scale(${num(k, 4)})">${markBody(style)}</g>`
  return svgDocument([0, 0, size, size], `<rect width="${size}" height="${size}" fill="${style.ground}"/>${mark}`, 'Althar')
}
