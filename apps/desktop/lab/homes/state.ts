import { useSyncExternalStore } from 'react'

/*
 * What the lab's bar picks: the direction (0 as #982 has it, A–D), the
 * chip's Manage homes dialog (1–3), which
 * window is in front (this computer's, or a home's), light or dark, the
 * app's narrowest window, many saved homes for the crowded case, and a home
 * with no projects yet. Kept in the address, so a reload or a screenshot
 * opens on the same. `open` and `conn` are read once, at load, for a
 * screenshot: what is open (homes, connect, checked, refused, palette) and
 * how the home's window is connected (connecting, dropped, failed).
 */

export const DIRECTIONS = [
  { key: 'pr', kbd: '0', label: 'As #982' },
  { key: 'a', kbd: 'A', label: 'Chip' },
  { key: 'b', kbd: 'B', label: 'Home tab' },
  { key: 'c', kbd: 'C', label: 'Homes on Home' },
  { key: 'd', kbd: 'D', label: 'Palette' },
] as const
export type Direction = (typeof DIRECTIONS)[number]['key']

/** The chip's Manage homes dialog, three ways. */
export const MANAGES = [
  { key: '1', kbd: '1', label: 'Rows' },
  { key: '2', kbd: '2', label: 'Panes' },
  { key: '3', kbd: '3', label: 'Menu' },
] as const
export type Manage = (typeof MANAGES)[number]['key']

export interface LabState {
  readonly d: Direction
  /** The chip's Manage homes dialog. */
  readonly m: Manage
  /** The window in front: 'local', or a saved home's id. */
  readonly w: string
  readonly theme: 'light' | 'dark'
  readonly narrow: boolean
  readonly many: boolean
  /** The home has no projects yet. */
  readonly empty: boolean
}

const params = new URLSearchParams(window.location.search)
const asked = params.get('d')

/** What a screenshot opens on, once. */
export const opening = {
  open: params.get('open'),
  conn: params.get('conn'),
  /** Manage's home in view: the row open, the home picked, or the one whose connection is being changed. */
  pick: params.get('pick'),
} as const

let state: LabState = {
  d: DIRECTIONS.find((one) => one.key === asked)?.key ?? 'a',
  m: MANAGES.find((one) => one.key === params.get('m'))?.key ?? '1',
  w: params.get('w') ?? 'local',
  theme: params.get('theme') === 'dark' ? 'dark' : 'light',
  narrow: params.get('narrow') === '1',
  many: params.get('many') === '1',
  empty: params.get('empty') === '1',
}
const listeners = new Set<() => void>()

const flag = (url: URL, key: string, on: boolean) => (on ? url.searchParams.set(key, '1') : url.searchParams.delete(key))

export const lab = {
  get: () => state,
  set: (change: Partial<LabState>) => {
    state = { ...state, ...change }
    const url = new URL(window.location.href)
    url.searchParams.set('d', state.d)
    url.searchParams.set('m', state.m)
    url.searchParams.set('w', state.w)
    if (state.theme === 'dark') url.searchParams.set('theme', 'dark')
    else url.searchParams.delete('theme')
    flag(url, 'narrow', state.narrow)
    flag(url, 'many', state.many)
    flag(url, 'empty', state.empty)
    url.searchParams.delete('open')
    url.searchParams.delete('conn')
    url.searchParams.delete('at')
    window.history.replaceState(window.history.state, '', url)
    for (const listener of listeners) listener()
  },
  subscribe: (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}

export const useLab = () => useSyncExternalStore(lab.subscribe, lab.get)
