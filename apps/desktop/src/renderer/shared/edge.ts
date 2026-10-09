import type { EdgePlace } from '../../main/edge'

/*
 * Where Althar shows while the person works in another app, as Settings
 * offers it: round the notch, on a Mac whose screen has one, or in the menu
 * bar. The main process keeps the choice (main/edge.ts).
 */

export type { EdgePlace }

export const edgePlaces: ReadonlyArray<{ readonly value: EdgePlace; readonly title: string; readonly note: string }> = [
  { value: 'island', title: 'Round the notch', note: 'Point at it to see what needs you and what runs.' },
  { value: 'menu', title: 'In the menu bar', note: 'Click Althar’s mark to see what needs you and what runs.' },
]

export const isEdgePlace = (value: string): value is EdgePlace => edgePlaces.some((place) => place.value === value)
