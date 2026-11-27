import type { Client } from '../../data/client'

/*
 * What Althar's tab keeps, in this window's storage so it's there at the
 * next launch: the version whose news was last looked at, the one before it
 * (what the person updated from), and whether the tab was closed. One store a
 * client, so every part of the window sees the same, and a test's window
 * starts afresh.
 */

const STORED = 'althar.news'

export interface NewsState {
  /** The version whose news was looked at last; none before Althar's first launch with this. */
  readonly seen?: string
  /** The version the person had before it. */
  readonly from?: string
  /** The tab was closed: it stays so until there's news again. */
  readonly closed?: boolean
}

export interface NewsStore {
  readonly subscribe: (listener: () => void) => () => void
  readonly get: () => NewsState
  readonly set: (next: NewsState) => void
}

const text = (value: unknown): value is string => typeof value === 'string' && value !== ''

/** What storage kept, as far as it reads: nothing where it doesn't. */
export const newsFrom = (stored: string | null): NewsState => {
  if (stored === null) return {}
  try {
    const value: unknown = JSON.parse(stored)
    if (typeof value !== 'object' || value === null) return {}
    const { seen, from, closed } = value as Record<string, unknown>
    return {
      ...(text(seen) ? { seen } : {}),
      ...(text(from) ? { from } : {}),
      ...(closed === true ? { closed: true } : {}),
    }
  } catch {
    return {}
  }
}

const read = (): NewsState => {
  try {
    return newsFrom(window.localStorage.getItem(STORED))
  } catch {
    return {}
  }
}

const write = (state: NewsState) => {
  try {
    window.localStorage.setItem(STORED, JSON.stringify(state))
  } catch {
    // Kept for this window only.
  }
}

const make = (): NewsStore => {
  let state = read()
  const listeners = new Set<() => void>()
  return {
    subscribe: (listener) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    get: () => state,
    set: (next) => {
      state = next
      write(next)
      listeners.forEach((listener) => listener())
    },
  }
}

const stores = new WeakMap<Client, NewsStore>()

export const newsStoreOf = (client: Client): NewsStore => {
  const found = stores.get(client)
  if (found !== undefined) return found
  const made = make()
  stores.set(client, made)
  return made
}
