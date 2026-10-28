import { useSyncExternalStore } from 'react'

/*
 * Whether the computer is online, as the window hears it: Chromium's own
 * reading of the network, the same the runtime is told from the main
 * process, so the window's line and the work's waiting agree (ADR-060).
 */

const subscribe = (changed: () => void) => {
  window.addEventListener('online', changed)
  window.addEventListener('offline', changed)
  return () => {
    window.removeEventListener('online', changed)
    window.removeEventListener('offline', changed)
  }
}

export const useOnline = (): boolean => useSyncExternalStore(subscribe, () => navigator.onLine)
