// Scrappy: what the page shows: which direction, the project's state as the picker under the window says, and whether its Settings view is on.
import { useSyncExternalStore } from 'react'

export type Direction = 'Today' | 'A' | 'B' | 'C' | 'D'
/**
 * Its trackers: none chosen, and Linear's DEV team found in its tasks' issues;
 * chosen, Linear's DEV team and Jira's OPS project; or none, and no task names an issue.
 */
export type Tracker = 'linear' | 'two' | 'none'
/** How its connections stand: all well, Linear not connected, GitHub signed out (its token expired). */
export type Connection = 'ok' | 'tracker' | 'host'
export type Notes = 'few' | 'many'
/** Today: its panel shut, open, or open at its notes. A to D: the project's Home, Conversation or Board as the bar says, or its Settings (notes: at Notes). */
export type Showing = 'closed' | 'open' | 'notes'
/** The project's settings, by what each is about. */
export type Section = 'general' | 'code' | 'rules' | 'running' | 'notes'
export const SECTIONS: ReadonlyArray<Section> = ['general', 'code', 'rules', 'running', 'notes']

export interface Proto {
  readonly direction: Direction
  readonly tracker: Tracker
  readonly connection: Connection
  readonly notes: Notes
  readonly showing: Showing
  /** The section open in Settings; in D, null is its overview. */
  readonly section: Section | null
  /** Without the switcher, for screenshots. */
  readonly bare: boolean
}

let state: Proto = {
  direction: 'A',
  tracker: 'linear',
  connection: 'ok',
  notes: 'many',
  showing: 'closed',
  section: 'general',
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
