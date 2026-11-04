// Scrappy: what every direction's page shares: the direction shown, and what the person answered on the page.
import { useSyncExternalStore } from 'react'

export type Direction = 'A' | 'B' | 'C' | 'Today'

/** The directions in the switcher's order, each with its key: 1 to 4. */
export const DIRECTIONS: ReadonlyArray<{ readonly value: Direction; readonly name: string; readonly about: string }> = [
  { value: 'A', name: 'Thread, tidied', about: 'In order, each review one card, the handoff last and open, the thread opened on it' },
  {
    value: 'B',
    name: 'Where it stands',
    about: 'A page first: what needs you, what it built, every finding, the pull request; the conversation behind it',
  },
  {
    value: 'C',
    name: 'One ask, one answer',
    about: 'The reviews are the lead’s work: one answer to what you asked, its rounds a rail, the handoff its words',
  },
  { value: 'Today', name: 'Today', about: 'The thread as built, on the same tasks' },
]

export interface Proto {
  readonly direction: Direction
  /** No strip under the window: for screenshots. */
  readonly bare: boolean
  /** What the person decided on the page, by what was asked: a finding of theirs, or a call. */
  readonly answers: Readonly<Record<string, string>>
}

let state: Proto = { direction: 'C', bare: false, answers: {} }
const listeners = new Set<() => void>()

export const proto = {
  get: () => state,
  set: (next: Partial<Proto>) => {
    state = { ...state, ...next }
    for (const listener of listeners) listener()
  },
  answer: (id: string, said: string | null) => {
    const answers = { ...state.answers }
    if (said === null) delete answers[id]
    else answers[id] = said
    proto.set({ answers })
  },
  subscribe: (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}

export const useProto = () => useSyncExternalStore(proto.subscribe, proto.get)
