// Scrappy: what the page shows: which direction, and the project's state as the picker under the window says.
import { useSyncExternalStore } from 'react'

export type Direction = 'Today' | 'F' | 'G' | 'H' | 'I' | 'J'
/**
 * Its trackers: none chosen, and Linear's DEV team found in its tasks' issues;
 * chosen, Linear's DEV team and Jira's OPS project; or none, and no task names an issue.
 */
export type Tracker = 'linear' | 'two' | 'none'
/** How its connections stand: all well, Linear not connected, GitHub signed out (its token expired). */
export type Connection = 'ok' | 'tracker' | 'host'
export type Notes = 'few' | 'many'
/** What is open: nothing, the settings, or their notes. */
export type Showing = 'closed' | 'open' | 'notes'

export interface Proto {
  readonly direction: Direction
  readonly tracker: Tracker
  readonly connection: Connection
  readonly notes: Notes
  readonly showing: Showing
  /** Without the switcher, for screenshots. */
  readonly bare: boolean
}

let state: Proto = {
  direction: 'F',
  tracker: 'linear',
  connection: 'ok',
  notes: 'many',
  showing: 'closed',
  bare: false,
}
const listeners = new Set<() => void>()
/** What starts again when the picker's trackers change: the trackers the page chose. */
export const trackerResets = new Set<() => void>()

export const proto = {
  get: () => state,
  set: (next: Partial<Proto>) => {
    const was = state.tracker
    state = { ...state, ...next }
    if (state.tracker !== was) for (const listener of trackerResets) listener()
    for (const listener of listeners) listener()
  },
  subscribe: (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}

export const useProto = () => useSyncExternalStore(proto.subscribe, proto.get)
