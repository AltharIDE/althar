import type { Font, GlyphPosition } from 'fontkit'

import { BASELINE, BOUNDS } from './geometry'
import { inter } from './fonts'
import { type MarkStyle, markBody } from './mark'
import { type Box, num, svgDocument } from './svg'

/*
 * The mark and the name, as one drawing with the name's letters turned to
 * outlines, so it looks the same wherever it is opened. The name is Inter at
 * weight 650, set tight, as the site and the pitch set it; the mark's section
 * stands on the baseline beside it, as it does in the interface.
 */

export interface TypeSetting {
  weight: number
  /** Optical size, in points: Inter's display cut from 32. */
  opsz: number
  /** Added after each letter, in em. */
  tracking: number
  /** The alternates the interface turns on: a tailed l, a single-storey a, round punctuation. */
  features: readonly string[]
}

export const WORDMARK: TypeSetting = { weight: 650, opsz: 32, tracking: -0.045, features: ['cv05', 'cv11', 'ss03'] }

/** Units to the em in a lockup's own coordinates. */
export const EM = 1000

/** Text as outlines: its path in the lockup's coordinates, with the baseline at y = 0 and the first letter's origin at x = 0. */
export interface Outline {
  d: string
  /** Where the ink starts and ends along the baseline, and how far it rises above it. */
  left: number
  right: number
  top: number
}

export async function outline(text: string, setting: TypeSetting = WORDMARK, font?: Font): Promise<Outline> {
  const face = (font ?? (await inter())).getVariation({ wght: setting.weight, opsz: setting.opsz })
  const k = EM / face.unitsPerEm
  const run = face.layout(text, [...setting.features])
  const parts: string[] = []
  let pen = 0
  let left = Infinity
  let right = -Infinity
  let top = 0
  run.glyphs.forEach((glyph, i) => {
    const place = run.positions[i] as GlyphPosition // the run has one position for each glyph
    const x0 = pen + place.xOffset * k
    const y0 = -place.yOffset * k
    for (const { command, args } of glyph.path.commands) {
      const points: string[] = []
      for (let j = 0; j < args.length; j += 2) {
        const [px, py] = args.slice(j, j + 2) as [number, number]
        points.push(`${num(x0 + px * k, 1)} ${num(y0 - py * k, 1)}`)
      }
      parts.push(`${LETTER[command]}${points.join(' ')}`)
    }
    const { minX, maxX, maxY } = glyph.bbox
    if (glyph.path.commands.length > 0) {
      left = Math.min(left, x0 + minX * k)
      right = Math.max(right, x0 + maxX * k)
      top = Math.max(top, maxY * k - y0)
    }
    pen += place.xAdvance * k + setting.tracking * EM
  })
  return { d: parts.join(''), left, right, top }
}

const LETTER: Record<string, string> = { moveTo: 'M', lineTo: 'L', quadraticCurveTo: 'Q', bezierCurveTo: 'C', closePath: 'Z' }

export type LockupLayout = 'horizontal' | 'stacked'

/** The mark's section and the text share one colour unless the style gives the point its own. */
export interface LockupStyle extends MarkStyle {
  text: string
}

/** How far the section sits from the first letter: the mark's right edge to the name, in em. */
const GAP = 0.1655
/** The grid unit in em, so the section stands 0.68 em tall beside the name. */
const UNIT = 0.05
/** Stacked, the mark is twice as large and sits above the name with this much between them, in em. */
const STACK_UNIT = 0.1
const STACK_GAP = 0.42

export async function lockupSvg(layout: LockupLayout, style: LockupStyle, name = 'Althar'): Promise<string> {
  const text = await outline(name)
  const word = `<path fill="${style.text}" d="${text.d}"/>`
  if (layout === 'horizontal') {
    const unit = UNIT * EM
    const markX = -BOUNDS.x * unit
    const markY = -BASELINE * unit
    const textX = BOUNDS.width * unit + GAP * EM - text.left
    const left = 0
    const right = textX + text.right
    const top = Math.max(text.top, (BASELINE - BOUNDS.y) * unit)
    const box: Box = [left, -top, right - left, top]
    const mark = `<g transform="translate(${num(markX, 1)} ${num(markY, 1)}) scale(${unit})">${markBody(style)}</g>`
    return svgDocument(box, `${mark}<g transform="translate(${num(textX, 1)} 0)">${word}</g>`, name)
  }
  const unit = STACK_UNIT * EM
  const markWidth = BOUNDS.width * unit
  const markHeight = BOUNDS.height * unit
  const width = Math.max(markWidth, text.right - text.left)
  const markX = (width - markWidth) / 2 - BOUNDS.x * unit
  const markTop = 0
  const baseline = markHeight + STACK_GAP * EM + text.top
  const textX = (width - (text.right - text.left)) / 2 - text.left
  const mark = `<g transform="translate(${num(markX, 1)} ${num(markTop - BOUNDS.y * unit, 1)}) scale(${unit})">${markBody(style)}</g>`
  const box: Box = [0, 0, width, baseline]
  return svgDocument(box, `${mark}<g transform="translate(${num(textX, 1)} ${num(baseline, 1)})">${word}</g>`, name)
}
