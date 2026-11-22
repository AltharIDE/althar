import { useSyncExternalStore } from 'react'

/*
 * What the lab's bar picks, and where the update stands in the window: the
 * direction (A–D), a narrow window, and whether the person came from 0.8.0
 * (two releases new to them) rather than 0.9.0. Then what the window holds:
 * whether What's new has a tab, whether its line or dot still shows, and
 * whether the home has the notes open in place. The bar's choices are kept
 * in the address, so a reload or a screenshot opens on the same.
 */

export const DIRECTIONS = [
  { key: 'a', kbd: 'A', label: 'Opens as a tab' },
  { key: 'b', kbd: 'B', label: 'Offered in the bar' },
  { key: 'c', kbd: 'C', label: 'The home says it' },
  { key: 'd', kbd: 'D', label: 'Althar, like a project' },
] as const
export type Direction = (typeof DIRECTIONS)[number]['key']

/** What's new's two views: what this update brought, and what's coming next. D switches them in its bar; A, B and C open Coming next from the bar's 4–6 and go back from its crumb. */
export type View = 'new' | 'coming'

/** How What's new looks, in every direction: Althar's light, the real thing, or the site's flight log. */
export const LOOKS = [
  { key: 'launch', kbd: '1', label: 'Light' },
  { key: 'live', kbd: '2', label: 'The real thing' },
  { key: 'log', kbd: '3', label: 'Flight log' },
] as const
export type Look = (typeof LOOKS)[number]['key']

/** How Coming next looks: on the horizon of Althar's light, as Althar's own board at work, or for the person to shape. */
export const COMINGS = [
  { key: 'horizon', kbd: '4', label: 'Horizon' },
  { key: 'workshop', kbd: '5', label: 'The workshop' },
  { key: 'shape', kbd: '6', label: 'Shape it' },
] as const
export type Coming = (typeof COMINGS)[number]['key']

export interface LabState {
  readonly d: Direction
  readonly narrow: boolean
  /** Updated from 0.8.0, so 0.9.0 is new to the person too. */
  readonly skipped: boolean
  /** What's new has a tab (A, B; D's is always there). */
  readonly tab: boolean
  /** The update hasn't been looked at: B's line in the bar, what C's home says, D's dot on its tab. */
  readonly unseen: boolean
  /** C: the home has the notes open in its place. */
  readonly homeNotes: boolean
  /** The view What's new is on: D's bar switches it; elsewhere Coming next opens from the lab's bar. */
  readonly view: View
  /** How the page looks. */
  readonly look: Look
  /** How Coming next looks. */
  readonly coming: Coming
}

const params = new URLSearchParams(window.location.search)
const asked = params.get('d')
const d: Direction = DIRECTIONS.find((one) => one.key === asked)?.key ?? 'a'

/** How each direction stands as the window opens on 0.10.0 for the first time. */
export const arrival = (direction: Direction): Pick<LabState, 'tab' | 'unseen' | 'homeNotes' | 'view'> => ({
  tab: direction === 'a' || direction === 'd',
  unseen: direction !== 'a',
  homeNotes: false,
  view: 'new',
})

let state: LabState = {
  d,
  narrow: params.get('narrow') === '1',
  skipped: params.get('from') === '0.8.0',
  ...arrival(d),
  look: LOOKS.find((one) => one.key === params.get('look'))?.key ?? 'launch',
  coming: COMINGS.find((one) => one.key === params.get('coming'))?.key ?? 'horizon',
  // Opened on What's new's own address, its tab is open and it has been seen.
  ...(window.location.hash === '#/whats-new' && d !== 'c' ? { tab: true, unseen: false } : {}),
  ...(params.get('notes') === '1' ? { homeNotes: true, unseen: false } : {}),
  ...(params.get('view') === 'coming' ? { view: 'coming' as const } : {}),
}
const listeners = new Set<() => void>()

export const lab = {
  get: () => state,
  set: (change: Partial<LabState>) => {
    state = { ...state, ...change }
    const url = new URL(window.location.href)
    url.searchParams.set('d', state.d)
    url.searchParams.set('look', state.look)
    url.searchParams.set('coming', state.coming)
    for (const [key, on, value] of [
      ['narrow', state.narrow, '1'],
      ['from', state.skipped, '0.8.0'],
    ] as const)
      if (on) url.searchParams.set(key, value)
      else url.searchParams.delete(key)
    url.searchParams.delete('notes')
    if (state.view === 'coming') url.searchParams.set('view', 'coming')
    else url.searchParams.delete('view')
    window.history.replaceState(window.history.state, '', url)
    for (const listener of listeners) listener()
  },
  subscribe: (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}

export const useLab = () => useSyncExternalStore(lab.subscribe, lab.get)
