import { useSyncExternalStore } from 'react'

/*
 * What the lab's bar picks: the direction (0 today's, A–E, and C again in
 * 1–4), "Many" asides for the crowded case, a narrow window, and asides that
 * named themselves in a few words. Kept in the address, so a reload or a
 * screenshot opens on the same.
 */

export const DIRECTIONS = [
  { key: 'today', kbd: '0', label: 'Today', round: 1 },
  { key: 'a', kbd: 'A', label: 'Segmented', round: 1 },
  { key: 'b', kbd: 'B', label: 'Underline', round: 1 },
  { key: 'c', kbd: 'C', label: 'Heading', round: 1 },
  { key: 'd', kbd: 'D', label: 'Project row', round: 1 },
  { key: 'e', kbd: 'E', label: 'Folder tabs', round: 1 },
  { key: 'c1', kbd: '1', label: 'Search', round: 2 },
  { key: 'c2', kbd: '2', label: 'Recents', round: 2 },
  { key: 'c3', kbd: '3', label: 'Lane heading', round: 2 },
  { key: 'c4', kbd: '4', label: 'Panel', round: 2 },
] as const
export type Direction = (typeof DIRECTIONS)[number]['key']

export interface LabState {
  readonly d: Direction
  readonly many: boolean
  readonly narrow: boolean
  /** The asides as they would name themselves: in a few words, rather than the person's first line. */
  readonly named: boolean
}

const params = new URLSearchParams(window.location.search)
const asked = params.get('d')
let state: LabState = {
  d: DIRECTIONS.find((one) => one.key === asked)?.key ?? 'a',
  many: params.get('many') === '1',
  narrow: params.get('narrow') === '1',
  named: params.get('named') === '1',
}
const listeners = new Set<() => void>()

export const lab = {
  get: () => state,
  set: (change: Partial<LabState>) => {
    state = { ...state, ...change }
    const url = new URL(window.location.href)
    url.searchParams.set('d', state.d)
    if (state.many) url.searchParams.set('many', '1')
    else url.searchParams.delete('many')
    if (state.narrow) url.searchParams.set('narrow', '1')
    else url.searchParams.delete('narrow')
    if (state.named) url.searchParams.set('named', '1')
    else url.searchParams.delete('named')
    window.history.replaceState(window.history.state, '', url)
    for (const listener of listeners) listener()
  },
  subscribe: (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}

export const useLab = () => useSyncExternalStore(lab.subscribe, lab.get)
