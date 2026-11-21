import { useSyncExternalStore } from 'react'

/*
 * What streams to the window on a thread while it listens, an agent's words
 * as it writes them and a command's output as it prints it, held apart from
 * the screen the thread is on: what hears it writes here (`useStreamed`,
 * `useOutputs`), and only what shows it reads it (`useHeard`). A word
 * streamed, twenty a second while an agent writes, draws the thread, not the
 * screen around it: its header, its composer, its board.
 */

/** What is held of a thread's streams, by item, and the way to hear each change of it. */
export interface Heard<T> {
  readonly read: () => ReadonlyMap<string, T>
  readonly subscribe: (listener: () => void) => () => void
}

/** What hears a thread's streams: it changes what is held, and those reading it hear so. */
export interface Hearing<T> extends Heard<T> {
  /** Changes what is held; returning what was there changes nothing. */
  readonly change: (next: (held: ReadonlyMap<string, T>) => ReadonlyMap<string, T>) => void
}

/** Nothing held: what a thread shows the moment another replaces it. */
const NOTHING: ReadonlyMap<string, never> = new Map<string, never>()

export const hearing = <T>(): Hearing<T> => {
  let held: ReadonlyMap<string, T> = NOTHING
  const listeners = new Set<() => void>()
  return {
    read: () => held,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    change: (next) => {
      const now = next(held)
      if (now === held) return
      held = now
      for (const listener of listeners) listener()
    },
  }
}

/** Nothing heard, nor ever to be: a thread shown from a read alone. */
export const NOTHING_HEARD: Heard<never> = { read: () => NOTHING, subscribe: () => () => {} }

/** What is held of a thread's streams, as it changes: only what calls this is drawn again for it. */
export const useHeard = <T>(heard: Heard<T>): ReadonlyMap<string, T> => useSyncExternalStore(heard.subscribe, heard.read)
