/*
 * An element the person pointed at on a page beside the conversation, as the
 * overlay reads it in the page's isolated world (src/overlay) and the main
 * process checks it: a selector that finds it again, its words, where it is,
 * and how the page drew it. What a page can change about its own elements
 * it can change here too, so every field is read as untrusted: its kind and
 * its length are checked, and anything else is dropped.
 */

export interface Box {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface Picked {
  /** A CSS selector that finds this element, and no other, on the page as it was. */
  readonly selector: string
  /** The element at a glance: its tag and first class, `span.needs`. */
  readonly label: string
  /** Its words, on one line, cut short. */
  readonly text: string
  /** Where it is on the page, in the page's CSS pixels from the top left of what shows. */
  readonly rect: Box
  /** How the page drew it: its font (size, weight, family), its colour, and the colour behind it. */
  readonly font: string
  readonly colour: string
  readonly background: string
  /** The size of the page's viewport as it was pointed at. */
  readonly page: { readonly width: number; readonly height: number }
}

export const LIMITS = { selector: 4_000, label: 120, text: 300, style: 120 } as const

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const textIn = (value: unknown, limit: number): string | null =>
  typeof value === 'string' && value.length <= limit && !value.includes('\u0000') ? value : null

const numberIn = (value: unknown, min: number, max: number): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? Math.round(value) : null

const SIDE = 100_000

const boxIn = (value: unknown): Box | null => {
  if (!isRecord(value)) return null
  const x = numberIn(value.x, -SIDE, SIDE)
  const y = numberIn(value.y, -SIDE, SIDE)
  const width = numberIn(value.width, 0, SIDE)
  const height = numberIn(value.height, 0, SIDE)
  return x === null || y === null || width === null || height === null ? null : { x, y, width, height }
}

/** What the overlay said, as an element pointed at, where every part of it is what it should be; null for anything else. */
export const pickedOf = (said: unknown): Picked | null => {
  if (!isRecord(said)) return null
  const selector = textIn(said.selector, LIMITS.selector)
  const label = textIn(said.label, LIMITS.label)
  const text = textIn(said.text, LIMITS.text)
  const font = textIn(said.font, LIMITS.style)
  const colour = textIn(said.colour, LIMITS.style)
  const background = textIn(said.background, LIMITS.style)
  const rect = boxIn(said.rect)
  const page = isRecord(said.page)
    ? { width: numberIn(said.page.width, 1, SIDE), height: numberIn(said.page.height, 1, SIDE) }
    : { width: null, height: null }
  if (
    selector === null ||
    selector === '' ||
    label === null ||
    text === null ||
    font === null ||
    colour === null ||
    background === null ||
    rect === null ||
    page.width === null ||
    page.height === null
  )
    return null
  return { selector, label, text, rect, font, colour, background, page: { width: page.width, height: page.height } }
}

/**
 * The part of the page a comment's crop shows, in the page's CSS pixels: the
 * element and a margin round it, kept to what shows of the page, and at
 * most so tall that a long element is cropped at its top.
 */
export const cropOf = (rect: Box, page: { readonly width: number; readonly height: number }, margin = 12, tallest = 640): Box | null => {
  const x = Math.max(0, rect.x - margin)
  const y = Math.max(0, rect.y - margin)
  const right = Math.min(page.width, rect.x + rect.width + margin)
  const bottom = Math.min(page.height, rect.y + rect.height + margin, y + tallest)
  if (right - x < 1 || bottom - y < 1) return null
  return { x, y, width: right - x, height: bottom - y }
}

/** A box in the page's pixels, where the page is drawn `scale` times its size: as the view holds it, whole pixels round it. */
export const scaled = (box: Box, scale: number): Box => {
  const x = Math.floor(box.x * scale)
  const y = Math.floor(box.y * scale)
  return { x, y, width: Math.ceil((box.x + box.width) * scale) - x, height: Math.ceil((box.y + box.height) * scale) - y }
}
