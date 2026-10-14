import { createContext, useCallback, useContext, useState, useSyncExternalStore, type ReactNode } from 'react'

/*
 * What the person did in a direction that every direction should keep: the
 * task they opened, the tab they chose, what they typed. It lives in the
 * workbench, not in the direction, so switching to another direction, or
 * standing them side by side, shows it there too.
 */

export class SharedValues {
  private readonly values = new Map<string, unknown>()
  private readonly listeners = new Set<() => void>()

  has(name: string) {
    return this.values.has(name)
  }
  get(name: string) {
    return this.values.get(name)
  }
  set(name: string, value: unknown) {
    this.values.set(name, value)
    for (const listener of this.listeners) listener()
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
}

/** Outside a workbench, such as in a test, a direction keeps its values for the page. */
const page = new SharedValues()
const Shared = createContext<SharedValues>(page)

export function SharedProvider({ values, children }: { values: SharedValues; children: ReactNode }) {
  return <Shared.Provider value={values}>{children}</Shared.Provider>
}

/**
 * State every direction shares, kept as the person switches between them: as
 * `useState`, by a name of the prototype's own. `useShared('opened', null)`
 * in two directions is the same value.
 */
export function useShared<T>(name: string, initial: T): [T, (next: T | ((previous: T) => T)) => void] {
  const values = useContext(Shared)
  // The first render's, as useState keeps it, so a fresh [] each render reads as the same value.
  const [first] = useState(initial)
  const read = () => (values.has(name) ? (values.get(name) as T) : first)
  const value = useSyncExternalStore(values.subscribe, read, read)
  const set = useCallback(
    (next: T | ((previous: T) => T)) => {
      const previous = values.has(name) ? (values.get(name) as T) : first
      values.set(name, typeof next === 'function' ? (next as (previous: T) => T)(previous) : next)
    },
    [values, name, first],
  )
  return [value, set]
}
