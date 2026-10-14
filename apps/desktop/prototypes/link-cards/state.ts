// Scrappy: what every page shares: which direction it draws, which message it shows, and what it opens on.
import { useSyncExternalStore } from 'react'

/** T is today's app; A to E the directions. */
export type Direction = 'T' | 'A' | 'B' | 'C' | 'D' | 'E'

/** The message the person sent: short with one link, long with one link, two links, or short with the agent's reply holding a link. */
export type Scenario = 'short' | 'long' | 'two' | 'agent'

export interface Proto {
  readonly direction: Direction
  readonly scenario: Scenario
  /** B and C: the raw address in the text is shortened to its key, as A does. */
  readonly short: boolean
  /** No strip of states under the window: for screenshots. */
  readonly bare: boolean
}

let state: Proto = { direction: 'T', scenario: 'short', short: false, bare: false }
const listeners = new Set<() => void>()

export const proto = {
  get: () => state,
  set: (next: Partial<Proto>) => {
    state = { ...state, ...next }
    for (const listener of listeners) listener()
  },
  subscribe: (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}

export const useProto = () => useSyncExternalStore(proto.subscribe, proto.get)
