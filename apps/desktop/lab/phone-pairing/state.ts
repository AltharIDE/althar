import { useSyncExternalStore } from 'react'

/*
 * What the lab's bar picks, kept in the address so a reload or a screenshot
 * opens on the same: the direction, the window's home (This Mac, or the
 * remote home studio), how many phones it has paired, whether a phone can
 * reach that home yet, the shorter code (no certificate in it), a narrow
 * window and dark.
 */

export const DIRECTIONS = [
  { key: 'a', kbd: 'A', label: 'Beside the workers' },
  { key: 'b', kbd: 'B', label: 'Part of the home' },
  { key: 'c', kbd: 'C', label: 'In the popover' },
  { key: 'd', kbd: 'D', label: 'From the homes menu' },
] as const
export type Direction = (typeof DIRECTIONS)[number]['key']

export type HomeKey = 'mac' | 'studio'
export type PhoneCount = 'none' | 'two' | 'many'

export interface LabState {
  readonly d: Direction
  readonly home: HomeKey
  readonly phones: PhoneCount
  /** A phone can reach the window's home: This Mac lets phones in, studio listens over HTTPS. */
  readonly reach: boolean
  /** The code without the home's certificate in it, so its QR is far less dense. */
  readonly short: boolean
  /** The QR is a link to althar.ai/pair with the code after #, so a phone's own camera opens Althar, or the page that gets it. */
  readonly link: boolean
  readonly narrow: boolean
  readonly dark: boolean
}

const params = new URLSearchParams(window.location.search)
const asked = params.get('d')
let state: LabState = {
  d: DIRECTIONS.find((one) => one.key === asked)?.key ?? 'a',
  home: params.get('home') === 'studio' ? 'studio' : 'mac',
  phones: params.get('phones') === 'none' ? 'none' : params.get('phones') === 'many' ? 'many' : 'two',
  reach: params.get('reach') !== '0',
  short: params.get('short') === '1',
  link: params.get('link') !== '0',
  narrow: params.get('narrow') === '1',
  dark: params.get('theme') === 'dark',
}
const listeners = new Set<() => void>()

const write = () => {
  const url = new URL(window.location.href)
  const set = (key: string, value: string | null) => (value === null ? url.searchParams.delete(key) : url.searchParams.set(key, value))
  set('d', state.d)
  set('home', state.home === 'studio' ? 'studio' : null)
  set('phones', state.phones === 'two' ? null : state.phones)
  set('reach', state.reach ? null : '0')
  set('short', state.short ? '1' : null)
  set('link', state.link ? null : '0')
  set('narrow', state.narrow ? '1' : null)
  set('theme', state.dark ? 'dark' : null)
  window.history.replaceState(window.history.state, '', url)
}

export const lab = {
  get: () => state,
  set: (change: Partial<LabState>) => {
    state = { ...state, ...change }
    write()
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
