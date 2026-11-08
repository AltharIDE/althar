// Scrappy: what the page holds: the direction, the case, and what the person did to it here.
import { useSyncExternalStore } from 'react'

import { type Beat, caseOf } from './cases'

export type Direction = 'A' | 'B' | 'C'

export interface Proto {
  readonly direction: Direction
  readonly key: string
  /** Asks answered on this page, by their key: what was said. */
  readonly answered: Readonly<Record<string, string>>
  /** Lines the person's presses here added to the thread, by case. */
  readonly added: Readonly<Record<string, ReadonlyArray<Beat>>>
  /** No strip under the window: for screenshots. */
  readonly bare: boolean
  /** Something the page opens on, for screenshots: a strip's change, the outbox, a part. */
  readonly opening: string | null
}

let state: Proto = { direction: 'A', key: 'needs-one', answered: {}, added: {}, bare: false, opening: null }
const listeners = new Set<() => void>()
const set = (next: Partial<Proto>) => {
  state = { ...state, ...next }
  for (const listener of listeners) listener()
}

export const proto = {
  get: () => state,
  set,
  subscribe: (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  /** The case on screen, with what the person added to its thread here. */
  current: () => {
    const c = caseOf(state.key)
    const added = state.added[c.key] ?? []
    return added.length === 0 ? c : { ...c, thread: [...c.thread, ...added] }
  },
  answer: (key: string, said: string) => set({ answered: { ...state.answered, [key]: said } }),
  unanswer: (key: string) => set({ answered: Object.fromEntries(Object.entries(state.answered).filter(([one]) => one !== key)) }),
  /** A line the person's press adds to the thread: a part they changed. */
  say: (beat: Beat) => set({ added: { ...state.added, [state.key]: [...(state.added[state.key] ?? []), beat] } }),
  go: (key: string) => set({ key, opening: null }),
}

export const useProto = () => useSyncExternalStore(proto.subscribe, proto.get)
