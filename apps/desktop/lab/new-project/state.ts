import { useSyncExternalStore } from 'react'

/*
 * What the lab's bar picks: the direction, the home the window is on
 * (runner-1, or this Mac), light or dark, the app's narrowest window, and
 * whether the host's next clone drops midway. Kept in the address, so a
 * reload or a screenshot opens on the same.
 */

export const DIRECTIONS = [
  { key: 'a', kbd: 'A', label: 'Page' },
  { key: 'b', kbd: 'B', label: 'Steps' },
  { key: 'c', kbd: 'C', label: 'Pick' },
  { key: 'd', kbd: 'D', label: 'Agent' },
] as const
export type Direction = (typeof DIRECTIONS)[number]['key']

/** The welcome a home with no projects opens on, before the New project page; 0 is none, the direction's own empty home. */
export const WELCOMES = [
  { key: '1', label: 'Arrival' },
  { key: '2', label: 'Orbit' },
  { key: '3', label: 'Tour' },
  { key: '4', label: 'Ask' },
  { key: '0', label: 'None' },
] as const
export type WelcomeKey = (typeof WELCOMES)[number]['key']
export type HomeKey = 'runner' | 'mac'

export interface LabState {
  readonly w: WelcomeKey
  readonly d: Direction
  readonly home: HomeKey
  readonly dark: boolean
  readonly narrow: boolean
  /** The host's next clone drops partway, to show what a failure says and how it picks up. */
  readonly fail: boolean
  /** Settings on the home: as proposed (by whose each is), or as today. */
  readonly settings: 'proposed' | 'today'
}

const params = new URLSearchParams(window.location.search)
const asked = params.get('d')
const welcome = params.get('w')
let state: LabState = {
  w: WELCOMES.find((one) => one.key === welcome)?.key ?? '1',
  d: DIRECTIONS.find((one) => one.key === asked)?.key ?? 'a',
  home: params.get('home') === 'mac' ? 'mac' : 'runner',
  dark: params.get('theme') === 'dark',
  narrow: params.get('narrow') === '1',
  fail: params.get('fail') === '1',
  settings: params.get('settings') === 'today' ? 'today' : 'proposed',
}
const listeners = new Set<() => void>()

const urlOf = (next: LabState) => {
  const url = new URL(window.location.href)
  url.searchParams.set('w', next.w)
  url.searchParams.set('d', next.d)
  url.searchParams.set('home', next.home)
  for (const [key, on] of [
    ['narrow', next.narrow],
    ['fail', next.fail],
  ] as const)
    if (on) url.searchParams.set(key, '1')
    else url.searchParams.delete(key)
  if (next.settings === 'today') url.searchParams.set('settings', 'today')
  else url.searchParams.delete('settings')
  if (next.dark) url.searchParams.set('theme', 'dark')
  else url.searchParams.delete('theme')
  return url
}

export const lab = {
  get: () => state,
  set: (change: Partial<LabState>) => {
    state = { ...state, ...change }
    document.documentElement.dataset.theme = state.dark ? 'dark' : 'light'
    window.history.replaceState(window.history.state, '', urlOf(state))
    for (const listener of listeners) listener()
  },
  /** Starts the world over, on the home and direction given: the page loads again, with nothing made. */
  restart: (change: Partial<LabState> = {}) => {
    const url = urlOf({ ...state, ...change })
    url.hash = ''
    window.localStorage.removeItem('althar.tabs')
    window.location.assign(url)
  },
  /** Changes what's drawn once, as the page loads: the page loads again, where it is. */
  reload: (change: Partial<LabState>) => {
    state = { ...state, ...change }
    window.location.assign(urlOf(state))
  },
  subscribe: (listener: () => void) => {
    listeners.add(listener)
    return () => void listeners.delete(listener)
  },
}

document.documentElement.dataset.theme = state.dark ? 'dark' : 'light'

export const useLab = () => useSyncExternalStore(lab.subscribe, lab.get)
