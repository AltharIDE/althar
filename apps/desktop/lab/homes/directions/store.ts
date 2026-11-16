import { useEffect, useSyncExternalStore } from 'react'

import type { HomesHost } from '../../../src/homes'

/** A little shared state between what a direction puts in the bar and what it opens over the window. */
export const store = <S extends object>(initial: S) => {
  let state = initial
  const listeners = new Set<() => void>()
  const subscribe = (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }
  const get = () => state
  return {
    get,
    set: (change: Partial<S>) => {
      state = { ...state, ...change }
      for (const listener of listeners) listener()
    },
    use: () => useSyncExternalStore(subscribe, get),
  }
}

/** The File menu's Homes… (⌘⇧H), and anything in the app that asks for the homes (#982's showHomes). */
export const useShowHomes = (homes: HomesHost | undefined, show: () => void) => {
  useEffect(() => {
    const off = homes?.onOpen(show)
    window.addEventListener('althar:show-homes', show)
    return () => {
      off?.()
      window.removeEventListener('althar:show-homes', show)
    }
  }, [homes, show])
}
