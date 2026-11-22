import { useSyncExternalStore } from 'react'

/*
 * What the lab's bar picks: the direction (A Minimal, B Panels, C
 * Feature-first), the lens on (1–4), the feature whose timeline is open, and
 * the lens menu held open for a screenshot. Kept in the address, so a reload
 * or a screenshot opens on the same.
 */

export const DIRECTIONS = [
  { key: 'a', kbd: 'A', label: 'Minimal' },
  { key: 'b', kbd: 'B', label: 'Panels' },
  { key: 'c', kbd: 'C', label: 'Feature-first' },
] as const
export type Direction = (typeof DIRECTIONS)[number]['key']

export const ROLES = [
  { key: 'product', kbd: '1', label: 'Product' },
  { key: 'design', kbd: '2', label: 'Design' },
  { key: 'engineering', kbd: '3', label: 'Engineering' },
  { key: 'devops', kbd: '4', label: 'DevOps' },
] as const
export type Role = (typeof ROLES)[number]['key']
export const roleName = (role: Role) => ROLES.find((one) => one.key === role)?.label ?? role

export interface LabState {
  readonly d: Direction
  readonly role: Role
  /** The feature whose timeline is open in the board's place, by its slug. */
  readonly feature: string | null
  /** The lens menu, open: for a screenshot. */
  readonly menu: boolean
  /** Panels pinned beyond the lens's own (direction B), by their keys. */
  readonly pinned: ReadonlyArray<string>
  /** Panels of the lens's own taken off (direction B). */
  readonly unpinned: ReadonlyArray<string>
}

const params = new URLSearchParams(window.location.search)
const list = (name: string) => (params.get(name) ?? '').split(',').filter((one) => one !== '')
let state: LabState = {
  d: DIRECTIONS.find((one) => one.key === params.get('d'))?.key ?? 'a',
  role: ROLES.find((one) => one.key === params.get('role'))?.key ?? 'engineering',
  feature: params.get('feature'),
  menu: params.get('menu') === '1',
  pinned: list('pin'),
  unpinned: list('unpin'),
}
const listeners = new Set<() => void>()

export const lab = {
  get: () => state,
  set: (change: Partial<LabState>) => {
    state = { ...state, ...change }
    const url = new URL(window.location.href)
    url.searchParams.set('d', state.d)
    url.searchParams.set('role', state.role)
    const put = (name: string, value: string | null) =>
      value === null || value === '' ? url.searchParams.delete(name) : url.searchParams.set(name, value)
    put('feature', state.feature)
    put('menu', state.menu ? '1' : null)
    put('pin', state.pinned.join(','))
    put('unpin', state.unpinned.join(','))
    window.history.replaceState(window.history.state, '', url)
    for (const listener of listeners) listener()
  },
  subscribe: (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}

export const useLab = () => useSyncExternalStore(lab.subscribe, lab.get)
