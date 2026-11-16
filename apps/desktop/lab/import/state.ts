import { useSyncExternalStore } from 'react'

import type { Era } from './world'

/*
 * What the lab's bar picks: the direction, two sets of them, and where the
 * person is. Arriving (A–C), the project is being added: on the first run's
 * welcome (W) or in a New project tab (P), then its board. Later (1–3),
 * weeks on, from Settings. Kept in the address, so a reload or a screenshot
 * opens on the same.
 */

export const DIRECTIONS = [
  { key: 'a', kbd: 'A', label: 'A step', set: 'arriving' },
  { key: 'b', kbd: 'B', label: 'By place', set: 'arriving' },
  { key: 'c', kbd: 'C', label: 'On the board', set: 'arriving' },
  { key: '1', kbd: '1', label: 'Project settings', set: 'later' },
  { key: '2', kbd: '2', label: 'Althar’s settings', set: 'later' },
  { key: '3', kbd: '3', label: 'Keep in step', set: 'later' },
] as const
export type Direction = (typeof DIRECTIONS)[number]['key']

/** Where the lab's window is: the welcome, a New project tab, or the app. */
export type Place = 'welcome' | 'new' | 'app'

export interface LabState {
  readonly d: Direction
  readonly place: Place
  readonly dark: boolean
}

// Asked by the address once, as the page opens (for a screenshot), else kept from the last load; the address is then the app's alone.
const KEPT = 'import-lab'
const kept = new URLSearchParams(window.sessionStorage.getItem(KEPT) ?? '')
const params = window.location.search === '' ? kept : new URLSearchParams(window.location.search)
if (window.location.search !== '') window.history.replaceState(window.history.state, '', window.location.pathname + window.location.hash)
/** What the page was opened with, such as the welcome's step. */
export const opening = params
const asked = params.get('d')
const placeAsked = params.get('place')
let state: LabState = {
  d: DIRECTIONS.find((one) => one.key === asked)?.key ?? 'a',
  place: placeAsked === 'new' || placeAsked === 'app' ? placeAsked : 'welcome',
  dark: params.get('theme') === 'dark',
}
const listeners = new Set<() => void>()

const keep = () =>
  window.sessionStorage.setItem(
    KEPT,
    new URLSearchParams({ d: state.d, place: state.place, ...(state.dark ? { theme: 'dark' } : {}) }).toString(),
  )
keep()

export const eraOf = (d: Direction): Era => (DIRECTIONS.find((one) => one.key === d)?.set === 'later' ? 'later' : 'arriving')

export const lab = {
  get: () => state,
  set: (change: Partial<LabState>) => {
    state = { ...state, ...change }
    keep()
    document.documentElement.dataset.theme = state.dark ? 'dark' : 'light'
    for (const listener of listeners) listener()
  },
  subscribe: (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}

export const useLab = () => useSyncExternalStore(lab.subscribe, lab.get)
