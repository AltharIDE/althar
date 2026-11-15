import { useSyncExternalStore } from 'react'

/** A value the lab's pieces share, told to whoever listens as it changes. */
export const store = <A>(initial: A) => {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set: (next: A | ((now: A) => A)) => {
      const was = value
      value = typeof next === 'function' ? (next as (now: A) => A)(value) : next
      if (value !== was) for (const listener of listeners) listener()
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
  }
}

export type Store<A> = ReturnType<typeof store<A>>

export const useStore = <A>(one: { get: () => A; subscribe: (listener: () => void) => () => void }) =>
  useSyncExternalStore(one.subscribe, one.get)
