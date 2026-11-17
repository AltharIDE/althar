import { useSyncExternalStore } from 'react'

/*
 * What the lab's bar picks: the direction (0 today's, A–D), where the task
 * stands with its pull request (none yet, one open, or a task that ends with
 * none, where nothing shows), a second issue for the crowded case, a narrow
 * window, and whether each issue is only part done. Kept in the address, so
 * a reload or a screenshot opens on the same.
 */

export const DIRECTIONS = [
  { key: 'today', kbd: '0', label: 'Today' },
  { key: 'a', kbd: 'A', label: 'Two words' },
  { key: 'b', kbd: 'B', label: 'Corner tag' },
  { key: 'c', kbd: 'C', label: 'Sentence' },
  { key: 'd', kbd: 'D', label: 'In Parts' },
] as const
export type Direction = (typeof DIRECTIONS)[number]['key']

export const ENDINGS = [
  { key: 'coming', kbd: '1', label: 'PR to come' },
  { key: 'open', kbd: '2', label: 'PR open' },
  { key: 'none', kbd: '3', label: 'No PR' },
] as const
export type Ending = (typeof ENDINGS)[number]['key']

export interface LabState {
  readonly d: Direction
  readonly ending: Ending
  /** A second issue, from another tracker: the crowded case (a task can come from several, PR #1006). */
  readonly two: boolean
  readonly narrow: boolean
  /** The issues the task does only part of, by key. */
  readonly partOf: Readonly<Record<string, boolean>>
}

const params = new URLSearchParams(window.location.search)
let state: LabState = {
  d: DIRECTIONS.find((one) => one.key === params.get('d'))?.key ?? 'a',
  ending: ENDINGS.find((one) => one.key === params.get('ending'))?.key ?? 'coming',
  two: params.get('two') === '1',
  narrow: params.get('narrow') === '1',
  partOf: Object.fromEntries((params.get('part') ?? '').split(',').flatMap((key) => (key === '' ? [] : [[key, true]]))),
}
const listeners = new Set<() => void>()

const flag = (url: URL, name: string, on: boolean) => (on ? url.searchParams.set(name, '1') : url.searchParams.delete(name))

export const lab = {
  get: () => state,
  set: (change: Partial<LabState>) => {
    state = { ...state, ...change }
    const url = new URL(window.location.href)
    url.searchParams.set('d', state.d)
    url.searchParams.set('ending', state.ending)
    flag(url, 'two', state.two)
    flag(url, 'narrow', state.narrow)
    const part = Object.keys(state.partOf).filter((key) => state.partOf[key] === true)
    if (part.length === 0) url.searchParams.delete('part')
    else url.searchParams.set('part', part.join(','))
    window.history.replaceState(window.history.state, '', url)
    for (const listener of listeners) listener()
  },
  /** Whether the task does only part of this issue; shown at once, as the app does. */
  setPart: (key: string, partOf: boolean) => lab.set({ partOf: { ...state.partOf, [key]: partOf } }),
  subscribe: (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}

export const useLab = () => useSyncExternalStore(lab.subscribe, lab.get)
