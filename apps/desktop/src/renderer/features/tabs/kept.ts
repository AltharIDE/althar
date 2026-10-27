import { useLayoutEffect } from 'react'

import type { Client } from '../../data/client'
import { useServices } from '../../data/services'
import type { ProjectSearch } from '../project/search'

/*
 * The screens the window keeps, so going back to a place is instant: the
 * home's, and the last few projects' and tasks' screens the person was on,
 * each as they left it (scrolled where it was, the view it was on, what it was reading).
 * The route of the place on show says so; the others stay mounted and
 * hidden (`KeptScreens`), doing nothing, until the person goes back to one or it
 * falls out: past the last `KEEP` of its kind, or once its project has no tab.
 */

/** How many screens of each kind are kept, the one on show among them. */
export const KEEP = { home: 1, project: 4, thread: 3 } as const

/** A place whose screen is kept: the home, a project, with what its address last asked of it, or a task's thread. */
export type KeptPlace =
  | { readonly kind: 'home' }
  | { readonly kind: 'project'; readonly projectId: string; readonly search: ProjectSearch }
  | { readonly kind: 'thread'; readonly threadId: string }

export interface KeptScreen {
  readonly key: string
  readonly place: KeptPlace
  /** Counts the times its route asked for it: a project's screen takes what its address asks anew each time. */
  readonly visit: number
}

export interface KeptState {
  /** In the order they were first shown, which never changes while kept: a screen moved in the page would lose its scroll. */
  readonly screens: ReadonlyArray<KeptScreen>
  /** The key of the one on show, if any is. */
  readonly shown: string | null
}

export interface KeptStore {
  readonly subscribe: (listener: () => void) => () => void
  readonly get: () => KeptState
  /** Its route shows a place: its screen is kept from now, and the oldest of its kind past `KEEP` goes. */
  readonly show: (place: KeptPlace) => void
  /** Its route no longer shows it: it stays, hidden. */
  readonly hide: (key: string) => void
  /** Only what `keeps` says stays; the one on show always does. */
  readonly keepOnly: (keeps: (place: KeptPlace) => boolean) => void
}

export const keyOf = (place: KeptPlace) =>
  place.kind === 'home' ? 'home:' : place.kind === 'project' ? `project:${place.projectId}` : `thread:${place.threadId}`

const make = (): KeptStore => {
  let state: KeptState = { screens: [], shown: null }
  // Keys, the most recently shown last.
  let recent: ReadonlyArray<string> = []
  const listeners = new Set<() => void>()
  const set = (next: KeptState) => {
    if (next.screens === state.screens && next.shown === state.shown) return
    state = next
    listeners.forEach((listener) => listener())
  }
  return {
    subscribe: (listener) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    get: () => state,
    show: (place) => {
      const key = keyOf(place)
      const was = state.screens.find((screen) => screen.key === key)
      const screen = { key, place, visit: (was?.visit ?? 0) + 1 }
      recent = [...recent.filter((one) => one !== key), key]
      const kind = recent.filter((one) => one.startsWith(`${place.kind}:`))
      const gone = new Set(kind.slice(0, Math.max(0, kind.length - KEEP[place.kind])))
      recent = recent.filter((one) => !gone.has(one))
      // One already kept stays where it is in the page; a new one goes after the others.
      const screens = was === undefined ? [...state.screens, screen] : state.screens.map((one) => (one.key === key ? screen : one))
      set({ screens: screens.filter((one) => !gone.has(one.key)), shown: key })
    },
    hide: (key) => {
      if (state.shown === key) set({ ...state, shown: null })
    },
    keepOnly: (keeps) => {
      const left = state.screens.filter((screen) => screen.key === state.shown || keeps(screen.place))
      if (left.length === state.screens.length) return
      const keys = new Set(left.map((screen) => screen.key))
      recent = recent.filter((key) => keys.has(key))
      set({ ...state, screens: left })
    },
  }
}

const stores = new WeakMap<Client, KeptStore>()

/** One store a client, as the tabs' is: a test's window starts with none kept. */
export const keptStoreOf = (client: Client): KeptStore => {
  const found = stores.get(client)
  if (found !== undefined) return found
  const made = make()
  stores.set(client, made)
  return made
}

/** A route says its place is on show, while it is: its screen shows, kept from then on. */
export const useShown = (place: KeptPlace) => {
  const store = keptStoreOf(useServices().client)
  const key = keyOf(place)
  const search = place.kind === 'project' ? place.search : null
  // Before the frame is painted, so the screen that shows is never a frame behind the address.
  useLayoutEffect(() => {
    store.show(place)
    return () => store.hide(key)
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- the place is its key and, for a project, what its address asks
  }, [store, key, search])
}
