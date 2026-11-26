import { useSyncExternalStore } from 'react'

/*
 * Whether this computer's load popover, from the meter in the window's bar,
 * is open. The meter keeps it here, so what else opens it (Up next's line
 * over what is held back) opens the same popover, in its place in the bar.
 */

let open = false
const listeners = new Set<() => void>()

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Opens or closes the popover. */
export const setLoadPeek = (now: boolean) => {
  if (open === now) return
  open = now
  for (const listener of listeners) listener()
}

/** Whether it is open now. */
export const useLoadPeek = () => useSyncExternalStore(subscribe, () => open)
