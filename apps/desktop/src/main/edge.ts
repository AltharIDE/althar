import { execFile } from 'node:child_process'

import { readPreferences, writePreference } from './preferences'

/*
 * Where Althar shows while you work in another app (Linear DEV-10): round
 * the notch, as an island, on a Mac whose screen has one; otherwise as its
 * mark in the menu bar. Where there is a notch, the person may choose either,
 * kept in desktop.json; the island is where Althar starts. This file holds
 * the choice and finds the notch; edgeWindows.ts draws them.
 */

export const EDGE_PLACES = ['island', 'menu'] as const
export type EdgePlace = (typeof EDGE_PLACES)[number]
export const DEFAULT_EDGE: EdgePlace = 'island'

export const isEdgePlace = (value: unknown): value is EdgePlace =>
  typeof value === 'string' && (EDGE_PLACES as ReadonlyArray<string>).includes(value)

export const readEdge = async (profile: string): Promise<EdgePlace> => {
  const { edge } = await readPreferences(profile)
  return isEdgePlace(edge) ? edge : DEFAULT_EDGE
}

export const writeEdge = (profile: string, place: EdgePlace) => writePreference(profile, 'edge', place)

/** A screen's notch, in Electron's points: its top left, from the primary screen's, and its size. */
export interface Notch {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** Where it shows: an island needs a notch to go round, so without one it is the menu bar, whatever was chosen. */
export const edgeIn = (chosen: EdgePlace, notch: Notch | null): EdgePlace => (notch === null ? 'menu' : chosen)

/*
 * Electron has no word for the notch, but each screen tells AppKit: the top
 * of its safe area is the notch's height, and the two areas either side of
 * it end where the notch begins and ends. osascript reads them through
 * JavaScript's bridge to AppKit, with nothing to build and no permission to
 * ask, in a few tenths of a second. Each screen comes back in AppKit's
 * terms: from the primary screen's bottom left, upwards.
 */
const SCREENS = `
ObjC.import('AppKit')
const all = $.NSScreen.screens
const out = []
for (let i = 0; i < all.count; i++) {
  const screen = all.objectAtIndex(i)
  const frame = screen.frame
  const left = screen.auxiliaryTopLeftArea
  const right = screen.auxiliaryTopRightArea
  out.push({
    frame: [frame.origin.x, frame.origin.y, frame.size.width, frame.size.height],
    top: screen.safeAreaInsets.top,
    left: [left.origin.x, left.size.width],
    right: [right.origin.x, right.size.width],
  })
}
JSON.stringify(out)
`

interface ScreenReading {
  readonly frame: readonly [number, number, number, number]
  readonly top: number
  readonly left: readonly [number, number]
  readonly right: readonly [number, number]
}

const isNumbers = (value: unknown, length: number): value is ReadonlyArray<number> =>
  Array.isArray(value) && value.length === length && value.every((n) => typeof n === 'number' && Number.isFinite(n))

const isReading = (value: unknown): value is ScreenReading => {
  if (typeof value !== 'object' || value === null) return false
  const { frame, top, left, right } = value as Record<string, unknown>
  return isNumbers(frame, 4) && typeof top === 'number' && isNumbers(left, 2) && isNumbers(right, 2)
}

/**
 * The first screen's notch from what osascript said, in Electron's points
 * (from the primary screen's top left, downwards), or null where no screen
 * has one or what it said can't be read.
 */
export const notchIn = (said: string, primaryHeight: number): Notch | null => {
  let screens: unknown
  try {
    screens = JSON.parse(said)
  } catch {
    return null
  }
  if (!Array.isArray(screens)) return null
  for (const screen of screens) {
    if (!isReading(screen) || screen.top <= 0 || screen.left[1] <= 0 || screen.right[1] <= 0) continue
    const [, frameY, , frameHeight] = screen.frame
    const x = screen.left[0] + screen.left[1]
    const width = screen.right[0] - x
    if (width <= 0) continue
    return { x, y: primaryHeight - (frameY + frameHeight), width, height: screen.top }
  }
  return null
}

/** Asks AppKit for the notch; null off a Mac, on a Mac without one, or if asking fails. */
export const findNotch = (primaryHeight: number): Promise<Notch | null> =>
  process.platform !== 'darwin'
    ? Promise.resolve(null)
    : new Promise((resolve) => {
        execFile('osascript', ['-l', 'JavaScript', '-e', SCREENS], { timeout: 5_000 }, (error, said) =>
          resolve(error === null ? notchIn(said, primaryHeight) : null),
        )
      })
