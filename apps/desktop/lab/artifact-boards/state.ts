import { useEffect, useState, useSyncExternalStore } from 'react'

/*
 * What the lab's bar picks: the direction (A–D), a moment in it to start
 * from (1, 2, 3…), and the appearance (T). Kept in the address, so a reload
 * or a screenshot opens on the same. Everything after the moment is live:
 * the canvas, pointing, sharing and the conversation all work from there.
 */

export const DIRECTIONS = [
  { key: 'a', kbd: 'A', label: 'Beside the conversation', moments: ['Every board', 'Point and say', 'Switch', 'Share', 'Save to repo'] },
  { key: 'b', kbd: 'B', label: 'A room of its own', moments: ['Artifacts', 'In its room', 'Share'] },
  { key: 'c', kbd: 'C', label: 'A lot of work', moments: ['Every page', 'In its room'] },
  { key: 'd', kbd: 'D', label: 'Talk on the board', moments: ['Pins', 'A pin open', 'Shared'] },
  { key: 'e', kbd: 'E', label: 'Save to repo', moments: ['Path', 'Tree', 'Columns', 'Suggested', 'One place', 'First save', 'Setting'] },
] as const
export type Direction = (typeof DIRECTIONS)[number]['key']

/** How Save to repo picks the folder: E's moments, one each, the project's one place from the fifth on; every direction uses the one seen last. */
export const PICKERS = ['path', 'tree', 'columns', 'suggested', 'place'] as const
export type Picker = (typeof PICKERS)[number]
const pickerOf = (asked: string | null): Picker => PICKERS.find((one) => one === asked) ?? 'place'
const pickerAt = (m: number): Picker => PICKERS[Math.min(m, PICKERS.length - 1)] ?? 'place'

export interface LabState {
  readonly d: Direction
  /** Which moment of the direction, from 0. */
  readonly m: number
  readonly dark: boolean
  /** The folder picker in Save to repo. */
  readonly k: Picker
}

const params = new URLSearchParams(window.location.search)
const asked = params.get('d')
let state: LabState = {
  d: DIRECTIONS.find((one) => one.key === asked)?.key ?? 'a',
  m: Number(params.get('m') ?? '0') || 0,
  dark: params.get('theme') === 'dark',
  k: pickerOf(params.get('k')),
}
if (state.d === 'e') state = { ...state, k: pickerAt(state.m) }
const listeners = new Set<() => void>()

export const directionOf = (key: Direction) => DIRECTIONS.find((one) => one.key === key) ?? DIRECTIONS[0]

/** A count of how many times the moment was set: what a part keyed on it starts afresh with. */
let round = 0
export const roundOf = () => round

export const lab = {
  get: () => state,
  set: (change: Partial<LabState>) => {
    const next = { ...state, ...change }
    if (change.d !== undefined && change.d !== state.d && change.m === undefined) next.m = 0
    next.m = Math.max(0, Math.min(next.m, directionOf(next.d).moments.length - 1))
    if (next.d === 'e') next.k = pickerAt(next.m)
    // The same moment chosen again starts it again.
    if (change.dark === undefined) round += 1
    state = next
    const url = new URL(window.location.href)
    url.searchParams.set('d', state.d)
    url.searchParams.set('m', String(state.m))
    url.searchParams.set('k', state.k)
    if (state.dark) url.searchParams.set('theme', 'dark')
    else url.searchParams.delete('theme')
    window.history.replaceState(window.history.state, '', url)
    for (const listener of listeners) listener()
  },
  subscribe: (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}

export const useLab = () => useSyncExternalStore(lab.subscribe, lab.get)

/** Open a moment after it starts: a popover opened as the panel around it takes focus would close at once. */
export const useOpenSoon = (wanted: boolean): [boolean, (open: boolean) => void] => {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!wanted) return
    const timer = window.setTimeout(() => setOpen(true), 400)
    return () => window.clearTimeout(timer)
  }, [wanted])
  return [open, setOpen]
}
