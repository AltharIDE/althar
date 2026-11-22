import { readFile } from 'node:fs/promises'

import { BOARDS_ENTRY, type CanvasBoards, readBoards } from '@althar/contracts'
import { artifactPath, isDigest } from '@althar/runtime/artifacts'

import type { Box, Picked } from '../browser/picked'
import type { GroundChange, GroundPin, GroundState, GroundTool, GroundView } from '../../overlay/ground'
import { fileIn, manifestAt } from './serve'

/*
 * A canvas of boards as the main process holds it (ADR-104): its pages and
 * boards, read from its entry in the artifact store, for the ground the view
 * draws them on (src/overlay/ground.ts); and what goes between the ground and
 * Althar's window: what the window asks of it, checked, and what the ground
 * says back, as the window hears it.
 */

/** A canvas's pages and boards, from the version's canvas.json, or null where the version isn't a canvas of boards. */
export const boardsAt = async (root: string, manifest: string): Promise<CanvasBoards | null> => {
  const read = await manifestAt(root, manifest)
  if (read === null || read.entry !== BOARDS_ENTRY) return null
  const entry = fileIn(read, BOARDS_ENTRY)
  if (entry === null || !isDigest(entry.sha256)) return null
  const bytes = await readFile(artifactPath(root, entry.sha256)).catch(() => null)
  if (bytes === null) return null
  const paths = new Set(read.files.map((file) => file.path))
  const boards = readBoards(bytes.toString('utf8'), (path) => paths.has(path))
  return boards.ok ? boards.boards : null
}

/** A part of a board the person pointed at, with a picture of the canvas to write the comment over, as the window gets it. */
export interface CanvasPointed {
  readonly page: string
  readonly board: string
  readonly picked: Picked
  /** The part and a margin round it, as a PNG's data address; null where none of it shows. */
  readonly crop: string | null
  readonly cropSize: { readonly width: number; readonly height: number } | null
  /** The canvas as it shows, as a picture the window shows in its place while the comment is written; empty where there is none. */
  readonly still: string
  /** Where the part is in that picture, in the window's pixels from its top left. */
  readonly at: Box
}

/** What the ground says, as the window hears it: how it stands, a part pointed at, a pin pressed, or a key the window acts on. */
export type CanvasGroundNews =
  | { readonly kind: 'state'; readonly state: GroundState }
  | { readonly kind: 'pointed'; readonly pointed: CanvasPointed }
  | { readonly kind: 'pin'; readonly n: number }
  | { readonly kind: 'key'; readonly key: 'escape' | 'older' | 'newer' | 'open' | 'close' }

const VIEWS: ReadonlyArray<GroundView> = ['every', 'one']
const TOOLS: ReadonlyArray<GroundTool> = ['point', 'hand', 'use']
const LONGEST = 400

const whole = (value: unknown, low: number, high: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= low && value <= high

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

/** What the window asks the ground to change, each part what it should be; null for anything else. */
export const groundChangeOf = (value: unknown): GroundChange | null => {
  if (!isRecord(value)) return null
  const change: { -readonly [K in keyof GroundChange]: GroundChange[K] } = {}
  if (value.view !== undefined) {
    if (!VIEWS.includes(value.view as GroundView)) return null
    change.view = value.view as GroundView
  }
  if (value.tool !== undefined) {
    if (!TOOLS.includes(value.tool as GroundTool)) return null
    change.tool = value.tool as GroundTool
  }
  if (value.page !== undefined) {
    if (!whole(value.page, -1, 1_000)) return null
    change.page = value.page
  }
  if (value.board !== undefined) {
    if (!isRecord(value.board) || !whole(value.board.page, 0, 1_000) || !whole(value.board.board, 0, 1_000)) return null
    change.board = { page: value.board.page, board: value.board.board }
  }
  if (value.step !== undefined) {
    if (value.step !== 1 && value.step !== -1) return null
    change.step = value.step
  }
  if (value.zoom !== undefined) {
    if (value.zoom === 'fit' || value.zoom === 'in' || value.zoom === 'out') change.zoom = value.zoom
    else if (typeof value.zoom === 'number' && Number.isFinite(value.zoom) && value.zoom > 0 && value.zoom <= 8) change.zoom = value.zoom
    else return null
  }
  return change
}

const nameIn = (value: unknown): value is string => typeof value === 'string' && value !== '' && value.length <= LONGEST

/** The pins the window asks the ground to draw, each what it should be; null for anything else. */
export const groundPinsOf = (value: unknown): ReadonlyArray<GroundPin> | null => {
  if (!Array.isArray(value) || value.length > 200) return null
  const pins: Array<GroundPin> = []
  for (const one of value) {
    if (!isRecord(one) || !whole(one.n, 1, 10_000) || !nameIn(one.page) || !nameIn(one.board)) return null
    if (typeof one.selector !== 'string' || one.selector === '' || one.selector.length > 4_000) return null
    pins.push({
      n: one.n,
      page: one.page,
      board: one.board,
      selector: one.selector,
      answered: one.answered === true,
      draft: one.draft === true,
    })
  }
  return pins
}

/** A part the window asks the ground to find again: its page, board and selector; null for anything else. */
export const groundPartOf = (value: unknown): { readonly page: string; readonly board: string; readonly selector: string } | null => {
  if (!isRecord(value) || !nameIn(value.page) || !nameIn(value.board)) return null
  if (typeof value.selector !== 'string' || value.selector === '' || value.selector.length > 4_000) return null
  return { page: value.page, board: value.board, selector: value.selector }
}
