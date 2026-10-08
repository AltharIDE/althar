import type { Room } from '@althar/ui'

import type { Client } from '../../data/client'
import { type Kept, keptFrom, type Place } from './tabs'

/*
 * What the window's tabs keep: which projects have one, in order, where in
 * each the window last was, and which view each was last on, in this
 * window's storage, so they are there at the next launch; and, for this
 * launch only, which project each task read is in. One store a client, so every part of the window sees the same
 * tabs, and a test's window starts afresh.
 */

const STORED = 'althar.tabs'

export interface TabsState {
  /** Null until storage has something, or the window has chosen what to open first. */
  readonly kept: Kept | null
  /** Each task read, by its thread: its project. */
  readonly threads: Readonly<Record<string, string>>
  /** Views chosen before anything was kept, each project's last: kept once something is. */
  readonly pending: Readonly<Record<string, Room>>
}

export interface TabsStore {
  readonly subscribe: (listener: () => void) => () => void
  readonly get: () => TabsState
  /**
   * What opens before anything was kept, or when none of what was kept is a
   * project any more: projects removed since are forgotten.
   */
  readonly seed: (open: ReadonlyArray<string>, known: ReadonlySet<string>) => void
  readonly change: (next: (kept: Kept) => Kept) => void
  /** A task was read: which project it is in. */
  readonly visit: (threadId: string, projectId: string) => void
  /** A project is on a view: it opens on it again, from a tab or back from a task. */
  readonly view: (projectId: string, room: Room) => void
}

const read = (): Kept | null => {
  try {
    return keptFrom(window.localStorage.getItem(STORED))
  } catch {
    return null
  }
}

const write = (kept: Kept) => {
  try {
    window.localStorage.setItem(STORED, JSON.stringify(kept))
  } catch {
    // Kept for this window only.
  }
}

const make = (): TabsStore => {
  let state: TabsState = { kept: read(), threads: {}, pending: {} }
  const listeners = new Set<() => void>()
  const set = (next: TabsState) => {
    state = next
    listeners.forEach((listener) => listener())
  }
  const keep = (kept: Kept) => {
    write(kept)
    set({ ...state, kept })
  }
  return {
    subscribe: (listener) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    get: () => state,
    seed: (open, known) => {
      const { kept, pending } = state
      if (kept === null) return keep(Object.keys(pending).length === 0 ? { open, places: {} } : { open, places: {}, rooms: pending })
      const left = kept.open.filter((id) => known.has(id))
      if (left.length === kept.open.length) return
      const still = Object.entries(kept.rooms ?? {}).filter(([id]) => known.has(id))
      const rooms = still.length === 0 ? {} : { rooms: Object.fromEntries(still) }
      keep(
        left.length === 0
          ? { open, places: {}, ...rooms }
          : { open: left, places: Object.fromEntries(Object.entries(kept.places).filter(([id]) => known.has(id))), ...rooms },
      )
    },
    change: (next) => {
      if (state.kept !== null) keep(next(state.kept))
    },
    visit: (threadId, projectId) => {
      if (state.threads[threadId] !== projectId) set({ ...state, threads: { ...state.threads, [threadId]: projectId } })
    },
    view: (projectId, room) => {
      if (state.kept === null) return set({ ...state, pending: { ...state.pending, [projectId]: room } })
      if (state.kept.rooms?.[projectId] !== room) keep(viewed(projectId, room)(state.kept))
    },
  }
}

const stores = new WeakMap<Client, TabsStore>()

export const tabsStoreOf = (client: Client): TabsStore => {
  const found = stores.get(client)
  if (found !== undefined) return found
  const made = make()
  stores.set(client, made)
  return made
}

/** Going into a project gives it a tab, at the end, and keeps where in it the window is. */
export const arrived =
  (projectId: string, place: Place) =>
  (kept: Kept): Kept => ({
    ...kept,
    open: kept.open.includes(projectId) ? kept.open : [...kept.open, projectId],
    places: { ...kept.places, [projectId]: place },
  })

/** The view a project was last on, to open on again. */
export const viewed =
  (projectId: string, room: Room) =>
  (kept: Kept): Kept => ({ ...kept, rooms: { ...kept.rooms, [projectId]: room } })

/** A tab closes, and forgets where it was. */
export const closed =
  (projectId: string) =>
  (kept: Kept): Kept => ({
    ...kept,
    open: kept.open.filter((id) => id !== projectId),
    places: Object.fromEntries(Object.entries(kept.places).filter(([id]) => id !== projectId)),
  })
