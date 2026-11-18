import { useSyncExternalStore } from 'react'

/*
 * What the lab's bar picks: the exploration (A–E), and within it a moment
 * (1, 2, 3…), and for C the phone. Kept in the address, so a reload or a
 * screenshot opens on the same. Each exploration has who is at the window:
 * there is no multiplayer, so the lab is one person's Althar at a time.
 */

export const DIRECTIONS = [
  {
    key: 'a',
    kbd: 'A',
    label: 'First ten minutes',
    who: 'maya',
    moments: ['Opens the project', 'Points at the app', 'Her change, running'],
  },
  { key: 'b', kbd: 'B', label: 'Polish and hand off', who: 'maya', moments: ['Live preview', 'Hand off', 'Waiting on Ana'] },
  { key: 'c', kbd: 'C', label: 'Approve from evidence', who: 'ana', moments: ['On the board', 'The evidence', 'Approved'] },
  { key: 'd', kbd: 'D', label: 'Roles and guardrails', who: 'ana', moments: ['Who may do what', 'A guardrail, for Maya'] },
  { key: 'e', kbd: 'E', label: 'The team, from git', who: 'ana', moments: ['The board', 'Who’s on what'] },
] as const
export type Direction = (typeof DIRECTIONS)[number]['key']

export interface LabState {
  readonly d: Direction
  /** Which moment of the exploration, from 0. */
  readonly m: number
  /** C, on the engineer's phone. */
  readonly phone: boolean
}

const params = new URLSearchParams(window.location.search)
const asked = params.get('d')
let state: LabState = {
  d: DIRECTIONS.find((one) => one.key === asked)?.key ?? 'a',
  m: Number(params.get('m') ?? '0') || 0,
  phone: params.get('phone') === '1',
}
const listeners = new Set<() => void>()

export const directionOf = (key: Direction) => DIRECTIONS.find((one) => one.key === key) ?? DIRECTIONS[0]

export const lab = {
  get: () => state,
  set: (change: Partial<LabState>) => {
    const next = { ...state, ...change }
    if (change.d !== undefined && change.d !== state.d && change.m === undefined) next.m = 0
    next.m = Math.max(0, Math.min(next.m, directionOf(next.d).moments.length - 1))
    state = next
    const url = new URL(window.location.href)
    url.searchParams.set('d', state.d)
    url.searchParams.set('m', String(state.m))
    if (state.phone) url.searchParams.set('phone', '1')
    else url.searchParams.delete('phone')
    window.history.replaceState(window.history.state, '', url)
    for (const listener of listeners) listener()
  },
  subscribe: (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}

export const useLab = () => useSyncExternalStore(lab.subscribe, lab.get)
