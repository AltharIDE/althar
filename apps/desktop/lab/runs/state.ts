import { useSyncExternalStore } from 'react'

/*
 * What the lab's bar picks: the direction (0 today's, A–D), the world it
 * opens on (quiet, a failed run, many), a narrow window, and the theme. Kept
 * in the address, so a reload or a screenshot opens on the same.
 */

export const DIRECTIONS = [
  { key: 'today', kbd: '0', label: 'Today' },
  { key: 'a', kbd: 'A', label: 'Beside' },
  { key: 'b', kbd: 'B', label: 'Along the foot' },
  { key: 'c', kbd: 'C', label: 'In the thread' },
  { key: 'd', kbd: 'D', label: 'A tab of its own' },
] as const
export type Direction = (typeof DIRECTIONS)[number]['key']

export const SCENES = [
  { key: 'quiet', kbd: 'Q', label: 'Nothing ran' },
  { key: 'failed', kbd: 'F', label: 'A run failed' },
  { key: 'many', kbd: 'M', label: 'Many' },
] as const
export type Scene = (typeof SCENES)[number]['key']

export interface LabState {
  readonly d: Direction
  readonly scene: Scene
  readonly narrow: boolean
  readonly dark: boolean
}

const params = new URLSearchParams(window.location.search)
let state: LabState = {
  d: DIRECTIONS.find((one) => one.key === params.get('d'))?.key ?? 'a',
  scene: SCENES.find((one) => one.key === params.get('scene'))?.key ?? 'failed',
  narrow: params.get('narrow') === '1',
  dark: params.get('theme') === 'dark',
}
const listeners = new Set<() => void>()

const write = () => {
  const url = new URL(window.location.href)
  url.searchParams.set('d', state.d)
  url.searchParams.set('scene', state.scene)
  if (state.narrow) url.searchParams.set('narrow', '1')
  else url.searchParams.delete('narrow')
  if (state.dark) url.searchParams.set('theme', 'dark')
  else url.searchParams.delete('theme')
  window.history.replaceState(window.history.state, '', url)
  document.documentElement.dataset.theme = state.dark ? 'dark' : 'light'
}
write()

export const lab = {
  get: () => state,
  set: (change: Partial<LabState>) => {
    state = { ...state, ...change }
    write()
    for (const listener of listeners) listener()
  },
  subscribe: (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}

export const useLab = () => useSyncExternalStore(lab.subscribe, lab.get)
