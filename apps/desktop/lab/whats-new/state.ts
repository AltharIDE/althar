import { useSyncExternalStore } from 'react'

/*
 * Where the update stands in the window, and what the lab's bar sets: whether
 * Althar's tab still has its dot (the update not yet looked at), the view its
 * page is on, a narrow window, and whether the person came from 0.8.0 (two
 * releases new to them) rather than 0.9.0. The bar's choices are kept in the
 * address, so a reload or a screenshot opens on the same.
 */

/** Althar's page's two views: what this update brought, and what's coming next. */
export type View = 'new' | 'coming'

export interface LabState {
  /** The update hasn't been looked at: the dot on Althar's tab. */
  readonly unseen: boolean
  readonly view: View
  readonly narrow: boolean
  /** Updated from 0.8.0, so 0.9.0 is new to the person too. */
  readonly skipped: boolean
}

const params = new URLSearchParams(window.location.search)

/** As the window opens on 0.10.0 for the first time: the dot on Althar's tab, its page on What's new. */
export const arrival: Pick<LabState, 'unseen' | 'view'> = { unseen: true, view: 'new' }

let state: LabState = {
  ...arrival,
  narrow: params.get('narrow') === '1',
  skipped: params.get('from') === '0.8.0',
  // Opened on Althar's own page, it has been seen.
  ...(window.location.hash === '#/whats-new' ? { unseen: false } : {}),
  ...(params.get('view') === 'coming' ? { view: 'coming' as const } : {}),
}
const listeners = new Set<() => void>()

export const lab = {
  get: () => state,
  set: (change: Partial<LabState>) => {
    state = { ...state, ...change }
    const url = new URL(window.location.href)
    for (const [key, on, value] of [
      ['narrow', state.narrow, '1'],
      ['from', state.skipped, '0.8.0'],
      ['view', state.view === 'coming', 'coming'],
    ] as const)
      if (on) url.searchParams.set(key, value)
      else url.searchParams.delete(key)
    window.history.replaceState(window.history.state, '', url)
    for (const listener of listeners) listener()
  },
  subscribe: (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}

export const useLab = () => useSyncExternalStore(lab.subscribe, lab.get)
