import { useSyncExternalStore } from 'react'

/*
 * What the lab's bar picks: the direction (A–D), its moment (1–4), the
 * appearance and a narrow window; and what has been pressed in the moment
 * (the version shown, the compare open, a save, a pick), which a new moment
 * starts afresh. Read from the address as the page loads (`?d=b&m=2&theme=dark`),
 * so a screenshot opens on one. Moments 1–3 are Maya's Althar, a designer's;
 * moment 4 is Ana's, an engineer's.
 */

export const DIRECTIONS = [
  { key: 'a', kbd: 'A', label: 'In its versions' },
  { key: 'b', kbd: 'B', label: 'Side by side' },
  { key: 'c', kbd: 'C', label: 'Its chat says' },
  { key: 'd', kbd: 'D', label: 'One draft in git' },
] as const
export type Direction = (typeof DIRECTIONS)[number]['key']

export const MOMENTS: Readonly<Record<Direction, ReadonlyArray<string>>> = {
  a: ['Ana changed it', 'Both changed it', 'Save', 'Ana’s Althar'],
  b: ['Ana changed it', 'Both changed it', 'Save', 'Ana’s Althar'],
  c: ['Ana changed it', 'Both changed it', 'Save', 'Ana’s Althar'],
  d: ['Ana’s draft', 'Both changed it', 'Hand it on', 'Ana’s Althar'],
}

export type Person = 'maya' | 'ana'

export const PEOPLE: Readonly<Record<Person, { readonly name: string; readonly role: string; readonly ink: string }>> = {
  maya: { name: 'Maya', role: 'designer', ink: 'plum' },
  ana: { name: 'Ana', role: 'engineer', ink: 'ochre' },
}

/** What has been pressed in this moment, reset by a new one. */
export interface Pressed {
  /** The version the canvas shows, where the person stepped to one; null for the moment's own. */
  readonly shown: number | null
  /** B: the compare open, and which of its two views (the boards, or the files as git has them). */
  readonly compare: boolean | null
  readonly files: boolean | null
  /** B: where the save goes: Ana's open pull request, or one of its own. */
  readonly into: 'join' | 'own'
  /** B and C: the one clash, Gift this class, as the person called it. */
  readonly gift: 'keep' | 'out' | null
  /** B: what the compare took: both together, or theirs as it is. */
  readonly took: 'together' | 'theirs'
  /** A and B: the save pressed (saving, then done); D: the draft marked ready, then merged. */
  readonly saved: 'saving' | 'done' | null
  readonly ready: 'asked' | 'merged' | null
  /** A: Gift taken out after the chat kept it. */
  readonly takenOut: boolean
}

export interface LabState extends Pressed {
  readonly d: Direction
  /** Which moment, from 0. */
  readonly m: number
  readonly dark: boolean
  readonly narrow: boolean
}

const FRESH: Pressed = {
  shown: null,
  compare: null,
  files: null,
  into: 'join',
  gift: null,
  took: 'together',
  saved: null,
  ready: null,
  takenOut: false,
}

const params = new URLSearchParams(window.location.search)
const asked = params.get('d')
let state: LabState = {
  ...FRESH,
  d: DIRECTIONS.find((one) => one.key === asked)?.key ?? 'a',
  m: Math.max(0, Math.min(3, Number(params.get('m') ?? '1') - 1 || 0)),
  dark: params.get('theme') === 'dark',
  narrow: params.get('narrow') === '1',
  ...(params.get('files') === '1' ? { files: true } : {}),
  ...(params.get('compare') === '1' ? { compare: true } : {}),
}
const listeners = new Set<() => void>()

/** Whose Althar the window is, at a moment: Maya's, but for the last. */
export const whoOf = ({ m }: Pick<LabState, 'm'> = state): Person => (m === 3 ? 'ana' : 'maya')

const theme = () => {
  document.documentElement.dataset.theme = state.dark ? 'dark' : 'light'
}
theme()

export const lab = {
  get: () => state,
  set: (change: Partial<LabState>) => {
    const moved = (change.d !== undefined && change.d !== state.d) || (change.m !== undefined && change.m !== state.m)
    const next = { ...state, ...(moved ? FRESH : {}), ...change }
    next.m = Math.max(0, Math.min(3, next.m))
    state = next
    // The address is read as the page loads, never written after: the app's router takes any change to it as a navigation.
    theme()
    for (const listener of listeners) listener()
  },
  subscribe: (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}

export const useLab = () => useSyncExternalStore(lab.subscribe, lab.get)
