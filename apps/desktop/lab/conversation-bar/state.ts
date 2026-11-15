import { useSyncExternalStore } from 'react'

/*
 * What the lab's bar picks: the direction (0 today's, A–E), "Many" asides for
 * the crowded case, and a narrow window. Kept in the address, so a reload or
 * a screenshot opens on the same.
 */

export const DIRECTIONS = [
  { key: 'today', kbd: '0', label: 'Today' },
  { key: 'a', kbd: 'A', label: 'Segmented' },
  { key: 'b', kbd: 'B', label: 'Underline' },
  { key: 'c', kbd: 'C', label: 'Heading and menu' },
  { key: 'd', kbd: 'D', label: 'In the project’s row' },
  { key: 'e', kbd: 'E', label: 'Folder tabs' },
] as const
export type Direction = (typeof DIRECTIONS)[number]['key']

export interface LabState {
  readonly d: Direction
  readonly many: boolean
  readonly narrow: boolean
}

const params = new URLSearchParams(window.location.search)
const asked = params.get('d')
let state: LabState = {
  d: DIRECTIONS.find((one) => one.key === asked)?.key ?? 'a',
  many: params.get('many') === '1',
  narrow: params.get('narrow') === '1',
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
    window.history.replaceState(window.history.state, '', url)
    for (const listener of listeners) listener()
  },
  subscribe: (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}

export const useLab = () => useSyncExternalStore(lab.subscribe, lab.get)
