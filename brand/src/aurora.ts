/*
 * What the Aurora wallpaper is drawn from: the launch's own light and dots
 * (packages/ui/src/screens/Launch), as the app draws them, and the page that
 * lays them out (wallpapers/aurora.html). The export hands this to the page,
 * and writes down what it drew from, so a test notices when the launch or the
 * page changes and the committed wallpapers don't.
 */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { BORE, DOTS, POINT_RADIUS } from '../../packages/ui/src/screens/Launch/halftone'
import { COLUMNS } from '../../packages/ui/src/screens/Launch/light'
import { COBALT } from './palette'

/* Rounded to a millionth of a grid unit: engines differ in the last digits of Math.sin, and the export (Bun) and the tests (Node) must agree. */
const rounded = <T>(value: T): T =>
  JSON.parse(JSON.stringify(value, (_, v: unknown) => (typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v))) as T

export const AURORA = rounded({
  columns: COLUMNS,
  dots: DOTS.map(({ x, y, r }) => ({ x, y, r })),
  point: { ...BORE, r: POINT_RADIUS },
  cobalt: COBALT,
})

export const PAGE = resolve(import.meta.dirname, '../wallpapers/aurora.html')
/** Where the export writes down what it drew from. */
export const DRAWN_FROM = resolve(import.meta.dirname, '../wallpapers/drawn-from.json')

const hash = (text: string): string => createHash('sha256').update(text).digest('hex').slice(0, 16)

/** A short fingerprint of the light, the dots and the page, as they are now. */
export const drawnFrom = (): { launch: string; page: string } => ({
  launch: hash(JSON.stringify(AURORA)),
  page: hash(readFileSync(PAGE, 'utf8')),
})
