import { useSyncExternalStore } from 'react'

/*
 * Whether the status line along the window's foot shows at all, as the person
 * last set it from the project's ⋯ menu: this window's own, kept across
 * launches, and the same on every screen. Hidden, it takes the bar away
 * completely; showing it brings it back at once.
 */

const KEY = 'althar.foot'

const read = (): boolean => {
  try {
    return window.localStorage.getItem(KEY) !== 'false'
  } catch {
    return true
  }
}

let current = read()
const listeners = new Set<() => void>()

/** Whether the bar shows now. */
export const footShown = (): boolean => current

/** Shows or hides the bar, at once, and keeps it. */
export const setFootShown = (next: boolean): void => {
  if (next === current) return
  current = next
  try {
    window.localStorage.setItem(KEY, String(next))
  } catch {
    // Not kept across launches; it still holds for this window.
  }
  for (const listener of listeners) listener()
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

/** Whether the bar shows, and how to show or hide it. */
export const useFootShown = () => [useSyncExternalStore(subscribe, () => current), setFootShown] as const
