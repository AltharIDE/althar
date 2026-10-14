// Scrappy: which direction this page shows, for the seams that swap the app's settings and its tabs.
import { useSyncExternalStore } from 'react'

/**
 * Today; the first round, A to E; the second, F to I; and the third, shown
 * on the live page as A to E again: a quick panel, and Settings as a tab.
 */
export type Direction = 'today' | 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'A3' | 'B3' | 'C3' | 'D3' | 'E3'

/** The third round's directions, as the live page's switcher has them. */
export const ROUND3 = ['A3', 'B3', 'C3', 'D3', 'E3'] as const
export type Round3 = (typeof ROUND3)[number]
export const isRound3 = (direction: Direction): direction is Round3 => (ROUND3 as ReadonlyArray<string>).includes(direction)

let direction: Direction = 'today'
const listeners = new Set<() => void>()

export const proto = {
  get: () => direction,
  set: (next: Direction) => {
    direction = next
    for (const listener of listeners) listener()
  },
  subscribe: (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}

export const useDirection = () => useSyncExternalStore(proto.subscribe, proto.get)
