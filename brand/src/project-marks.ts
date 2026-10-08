import { CELL_PATHS, type CellFill, type MarkCell, ProjectInk, composition, projectInk } from '@althar/ui/project-mark'

import { INK, PAPER } from './palette'
import { num, svgDocument } from './svg'

/*
 * Project marks: what the interface draws for a project nobody has given a
 * picture, as files. The drawing is the interface's own (drawing.ts in the UI
 * package, so a mark here is the one in the app); this file only gives it the
 * colours the app's stylesheet gives it. `bun run project-mark <name>` draws
 * the mark for any name.
 */

/** The `--project-*` tokens. */
export const INK_HEX: Record<ProjectInk, string> = {
  [ProjectInk.Clay]: '#b4532a',
  [ProjectInk.Ochre]: '#8a6d2f',
  [ProjectInk.Olive]: '#6b7330',
  [ProjectInk.Moss]: '#4f7a4a',
  [ProjectInk.Teal]: '#2f6f7a',
  [ProjectInk.Slate]: '#56616e',
  [ProjectInk.Rose]: '#a24d5c',
  [ProjectInk.Umber]: '#6e4b3a',
}

const RAISED = '#fcfbf8'

const channels = (hex: string): [number, number, number] =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]

/** CSS's `color-mix(in srgb, a share%, b)`. */
export function mix(a: string, share: number, b: string): string {
  const [ar, ag, ab] = channels(a)
  const [br, bg, bb] = channels(b)
  const at = (x: number, y: number): string =>
    Math.round(x * share + y * (1 - share))
      .toString(16)
      .padStart(2, '0')
  return `#${at(ar, br)}${at(ag, bg)}${at(ab, bb)}`
}

function fills(ink: ProjectInk): Record<CellFill, string> {
  const base = INK_HEX[ink]
  return { ink: base, deep: mix(base, 0.62, INK), paper: RAISED }
}

/** The corner on the 40 grid, as the interface rounds a mark of 32 or more. */
const CORNER = 10

function shapeOf(cell: MarkCell): string {
  return cell.shape === 'circle' ? '<circle cx="10" cy="10" r="6.5"/>' : `<path d="${CELL_PATHS[cell.shape]}"/>`
}

/** A mark's strokes on the 40 grid, for placing inside another drawing. `id` names its clip: unique within a document. */
export function projectMarkBody(seed: string, ink: ProjectInk, id: string): string {
  const fill = fills(ink)
  const cells = composition(seed)
    .map((cell, i) => {
      const at = `translate(${(i % 2) * 20} ${Math.floor(i / 2) * 20}) rotate(${cell.turn * 90} 10 10)`
      return `<g fill="${fill[cell.fill]}" transform="${at}">${shapeOf(cell)}</g>`
    })
    .join('')
  return (
    `<clipPath id="${id}"><rect width="40" height="40" rx="${CORNER}"/></clipPath>` +
    `<g clip-path="url(#${id})"><rect width="40" height="40" fill="${mix(INK_HEX[ink], 0.22, '#ffffff')}"/>${cells}</g>` +
    `<rect x=".5" y=".5" width="39" height="39" rx="${CORNER - 0.5}" fill="none" stroke="rgba(20,20,28,.07)"/>`
  )
}

export function projectMarkSvg(seed: string, ink: ProjectInk = projectInk(seed), title = seed): string {
  return svgDocument([0, 0, 40, 40], projectMarkBody(seed, ink, 'tile'), title)
}

/** The inks, for choosing one by name. */
export const INKS = Object.values(ProjectInk)

/** Names a person might give a repository, drawn as the app would draw them. */
export const SAMPLES: readonly string[] = [
  'althar',
  'meridian',
  'halyard',
  'tessera',
  'ferrous',
  'ledger',
  'billing-web',
  'meridian-api',
  'dotfiles',
  'infra',
  'mobile',
  'design-system',
  'search',
  'notifications',
  'docs',
  'ingest',
  'auth',
  'analytics',
  'cartographer',
  'lighthouse',
  'workbench',
  'atlas',
  'relay',
  'quarry',
]

/** Each sample with an ink, chosen as the app chooses one: the seed's own, passed over when another sample has it, until all eight are used. */
export function sampleMarks(): Array<{ seed: string; ink: ProjectInk }> {
  const taken: ProjectInk[] = []
  return SAMPLES.map((seed) => {
    if (taken.length === INKS.length) taken.length = 0
    const ink = projectInk(seed, taken)
    taken.push(ink)
    return { seed, ink }
  })
}

/** All the samples on one sheet, in rows of eight, for the folder's README and for a glance. */
export function sampleSheet(): string {
  const size = 120
  const gap = 24
  const cols = 8
  const marks = sampleMarks()
  const rows = Math.ceil(marks.length / cols)
  const width = cols * size + (cols + 1) * gap
  const height = rows * size + (rows + 1) * gap
  const tiles = marks
    .map(({ seed, ink }, i) => {
      const x = gap + (i % cols) * (size + gap)
      const y = gap + Math.floor(i / cols) * (size + gap)
      return `<g transform="translate(${x} ${y}) scale(${num(size / 40, 4)})">${projectMarkBody(seed, ink, `m${i}`)}</g>`
    })
    .join('')
  return svgDocument([0, 0, width, height], `<rect width="${width}" height="${height}" fill="${PAPER}"/>${tiles}`, 'Sample project marks')
}
