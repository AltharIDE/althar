import { useSyncExternalStore } from 'react'

import type { Range, Scope } from './measures.ts'

/*
 * What the lab's bar picks (the direction, dark, a narrow window) and what
 * the page's own controls pick (the period and the scope), kept across
 * directions and reloads; the address picks them on load, for a screenshot.
 */

export const DIRECTIONS = [
  { key: 'a', kbd: 'A', label: 'Receipts' },
  { key: 'b', kbd: 'B', label: 'The team' },
  { key: 'c', kbd: 'C', label: 'Plans' },
  { key: 'd', kbd: 'D', label: 'Compare' },
] as const
export type Direction = (typeof DIRECTIONS)[number]['key']

export interface LabState {
  readonly d: Direction
  readonly dark: boolean
  readonly narrow: boolean
  readonly range: Range
  /** The project the page is on's own, or every project; null: the project's. */
  readonly all: boolean
}

/** What the lab was on last, kept across reloads; what the address asks for, on load, comes first (for a screenshot). */
const KEPT = 'usage-lab'
const kept = ((): Partial<LabState> => {
  try {
    return JSON.parse(window.localStorage.getItem(KEPT) ?? '{}') as Partial<LabState>
  } catch {
    return {}
  }
})()
const params = new URLSearchParams(window.location.search)
const asked = params.get('d') ?? kept.d
const range = Number(params.get('range') ?? kept.range)
const flag = (name: string, on: string, was: boolean | undefined) => (params.has(name) ? params.get(name) === on : (was ?? false))
let state: LabState = {
  d: DIRECTIONS.find((one) => one.key === asked)?.key ?? 'a',
  dark: flag('theme', 'dark', kept.dark),
  narrow: flag('narrow', '1', kept.narrow),
  range: range === 7 || range === 90 ? range : 30,
  all: flag('all', '1', kept.all),
}
const listeners = new Set<() => void>()

const paint = () => {
  document.documentElement.dataset.theme = state.dark ? 'dark' : 'light'
}
paint()

/*
 * The address stays as loaded: the app's router keeps its place in the
 * address's hash and reads any change to the address as a navigation.
 */
export const lab = {
  get: () => state,
  set: (change: Partial<LabState>) => {
    state = { ...state, ...change }
    paint()
    window.localStorage.setItem(KEPT, JSON.stringify(state))
    for (const listener of listeners) listener()
  },
  subscribe: (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}

export const useLab = () => useSyncExternalStore(lab.subscribe, lab.get)

/** The scope the page reads, on a project: its own, or all. */
export const scopeOf = (projectName: string, all: boolean): Scope => (all ? 'all' : projectName === 'meridian' ? 'meridian' : 'althar')
