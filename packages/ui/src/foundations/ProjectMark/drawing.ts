/*
 * How a project's mark is drawn: a composition of four cells, generated from a
 * seed, in two depths of the project's ink on a tint of it. Each cell holds a
 * quarter circle, a half circle, a triangle, a circle or a square, turned to
 * one of four sides. The same seed always draws the same mark, so a project
 * keeps its mark without anyone choosing one.
 *
 * The cells are drawn on a 40 grid, each 20 square, in the top-left cell and
 * turned about that cell's centre.
 */

/** The inks a project can be drawn in. Each is a `--project-*` token. */
export enum ProjectInk {
  Clay = 'clay',
  Ochre = 'ochre',
  Olive = 'olive',
  Moss = 'moss',
  Teal = 'teal',
  Slate = 'slate',
  Rose = 'rose',
  Umber = 'umber',
}

export type CellShape = 'quarter' | 'half' | 'triangle' | 'circle' | 'square'

/** ink: the project's ink; deep: the ink darkened; paper: the page's near-white. */
export type CellFill = 'ink' | 'deep' | 'paper'

export interface MarkCell {
  shape: CellShape
  fill: CellFill
  /** Quarter turns clockwise, 0 to 3. */
  turn: number
}

/** A shape's outline in the top-left cell; the circle is drawn as a circle. */
export const CELL_PATHS: Record<Exclude<CellShape, 'circle'>, string> = {
  quarter: 'M0 0H20A20 20 0 0 1 0 20Z',
  half: 'M0 0H20A10 10 0 0 1 0 0Z',
  triangle: 'M0 0H20L0 20Z',
  square: 'M0 0H20V20H0Z',
}

/* What a cell is drawn from. Quarter circles come up most often: they make
   the composition read as one drawing rather than four tiles. */
const SHAPES: readonly CellShape[] = ['quarter', 'quarter', 'half', 'triangle', 'circle', 'quarter', 'square']
const FILLS: readonly CellFill[] = ['ink', 'deep', 'ink', 'paper']
const INKS: readonly ProjectInk[] = Object.values(ProjectInk)

/** FNV-1a: a seed's 32-bit hash. */
function hash(seed: string): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619)
  return h >>> 0
}

/** Murmur3's finaliser: every bit of the hash stirred into every other, so its low bits are as good as its high. */
function mix(h: number): number {
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return (h ^ (h >>> 16)) >>> 0
}

/** Mulberry32: numbers from 0 to 1, the same run for the same start. */
function random(start: number): () => number {
  let state = start
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function at<T>(items: readonly T[], index: number): T {
  const item = items[index]
  if (item === undefined) throw new RangeError(`No item at ${index}`)
  return item
}

const pick = <T>(items: readonly T[], next: () => number): T => at(items, Math.floor(next() * items.length))

/**
 * The four cells for a seed, left to right and top to bottom. At most one cell
 * is a full square and at most one is paper, so no mark is a block or a blank.
 */
export function composition(seed: string): MarkCell[] {
  const next = random(hash(seed))
  const cells: MarkCell[] = []
  for (let i = 0; i < 4; i++) {
    const shape = pick(SHAPES, next)
    const fill = pick(FILLS, next)
    const turn = Math.floor(next() * 4)
    const squared = shape === 'square' && cells.some((c) => c.shape === 'square')
    const papered = fill === 'paper' && cells.some((c) => c.fill === 'paper')
    cells.push({ shape: squared ? 'quarter' : shape, fill: papered ? 'deep' : fill, turn })
  }
  return cells
}

/**
 * An ink for a project nobody has given one. The seed chooses where to start, so
 * the same seed gets the same ink; an ink in `taken`, such as the other
 * projects' inks, is passed over while a free one is left.
 */
export function projectInk(seed: string, taken: readonly ProjectInk[] = []): ProjectInk {
  const start = mix(hash(seed)) % INKS.length
  for (let i = 0; i < INKS.length; i++) {
    const ink = at(INKS, (start + i) % INKS.length)
    if (!taken.includes(ink)) return ink
  }
  return at(INKS, start)
}
