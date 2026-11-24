import { useSyncExternalStore } from 'react'

import type { RunningOrder } from './lanes'

/*
 * The order the person picked for Running, kept by this window across
 * launches, for every project alike: it is their habit, as the lanes they
 * collapse are (folds). Storage that can't be read or written keeps it for
 * this window only.
 */

const STORED = 'althar.running'
const listeners = new Set<() => void>()
let held: RunningOrder | null = null

const read = (): RunningOrder => {
  if (held !== null) return held
  try {
    return window.localStorage.getItem(STORED) === 'status' ? 'status' : 'oldest'
  } catch {
    return 'oldest'
  }
}

const write = (order: RunningOrder) => {
  try {
    window.localStorage.setItem(STORED, order)
    held = null
  } catch {
    held = order
  }
  listeners.forEach((listener) => listener())
}

/** Forgets the order this window kept, as each test starts. */
export const forgetRunningOrder = () => {
  held = null
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

/** Running's order as the person picked it, and how to keep the next one they pick. */
export const useRunningOrder = (): readonly [RunningOrder, (order: RunningOrder) => void] => [useSyncExternalStore(subscribe, read), write]
