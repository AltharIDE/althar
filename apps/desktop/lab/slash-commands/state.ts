import { useSyncExternalStore } from 'react'

/*
 * What the lab's bar picks: the direction (0 today's, A–D), where the
 * composer is (a task, an aside, the coordinator), whether the commands still
 * to come are listed beside /goal ("More"), a narrow window, and the
 * appearance. Kept in the address, so a reload or a screenshot opens on the
 * same.
 */

export const DIRECTIONS = [
  { key: 'today', kbd: '0', label: 'Today' },
  { key: 'a', kbd: 'A', label: 'Menu and token' },
  { key: 'b', kbd: 'B', label: 'Command mode' },
  { key: 'c', kbd: 'C', label: 'In the field' },
  { key: 'd', kbd: 'D', label: 'Controls panel' },
] as const
export type Direction = (typeof DIRECTIONS)[number]['key']

export const PLACES = [
  { key: 'task', kbd: '1', label: 'Task' },
  { key: 'aside', kbd: '2', label: 'Aside' },
  { key: 'coordinator', kbd: '3', label: 'Coordinator' },
] as const
export type Place = (typeof PLACES)[number]['key']

export interface LabState {
  readonly d: Direction
  readonly place: Place
  /** The commands to come, listed beside /goal: the crowded case. */
  readonly more: boolean
  readonly narrow: boolean
  readonly dark: boolean
}

const params = new URLSearchParams(window.location.search)
const asked = params.get('d')
const place = params.get('place')
let state: LabState = {
  d: DIRECTIONS.find((one) => one.key === asked)?.key ?? 'a',
  place: PLACES.find((one) => one.key === place)?.key ?? 'task',
  more: params.get('more') === '1',
  narrow: params.get('narrow') === '1',
  dark: params.get('theme') === 'dark',
}
const listeners = new Set<() => void>()

const flag = (url: URL, name: string, on: boolean, value = '1') => {
  if (on) url.searchParams.set(name, value)
  else url.searchParams.delete(name)
}

export const lab = {
  get: () => state,
  set: (change: Partial<LabState>) => {
    state = { ...state, ...change }
    const url = new URL(window.location.href)
    url.searchParams.set('d', state.d)
    url.searchParams.set('place', state.place)
    flag(url, 'more', state.more)
    flag(url, 'narrow', state.narrow)
    flag(url, 'theme', state.dark, 'dark')
    window.history.replaceState(window.history.state, '', url)
    document.documentElement.dataset.theme = state.dark ? 'dark' : 'light'
    for (const listener of listeners) listener()
  },
  subscribe: (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}

document.documentElement.dataset.theme = state.dark ? 'dark' : 'light'

export const useLab = () => useSyncExternalStore(lab.subscribe, lab.get)
