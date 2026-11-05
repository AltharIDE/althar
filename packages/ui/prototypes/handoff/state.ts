// Scrappy: what every take's page shares: the direction shown, and what the person answered on the page.
import { useSyncExternalStore } from 'react'

export type Direction = 'A' | 'B' | 'C' | 'D' | 'E' | 'Today'

/** The takes in the switcher's order, each with its key: 1 to 6. Each keeps the chat; they differ in where the handoff stands. */
export const DIRECTIONS: ReadonlyArray<{ readonly value: Direction; readonly name: string; readonly about: string }> = [
  {
    value: 'A',
    name: 'Calmer',
    about: 'The thread as it is, each part quieter; the lead’s latest turn says what it built, and what needs you ends it',
  },
  {
    value: 'B',
    name: 'Last word',
    about: 'All the work is faint lines; the lead’s handoff is the last message, what needs you its closing lines',
  },
  {
    value: 'C',
    name: 'One answer',
    about: 'One answer to each thing you asked: its work and reviews one line, its words what it built',
  },
  {
    value: 'D',
    name: 'Replies',
    about: 'The reviews hang under the message they reviewed; what needs you waits over the composer',
  },
  {
    value: 'E',
    name: 'Answer first',
    about: 'Your ask, then where it stands and what needs you; how it got here under them',
  },
  { value: 'Today', name: 'Today', about: 'The thread as built, on the same tasks' },
]

export interface Proto {
  readonly direction: Direction
  /** No strip under the window: for screenshots. */
  readonly bare: boolean
  /** What the person decided on the page, by what was asked: a finding of theirs, or a call. */
  readonly answers: Readonly<Record<string, string>>
  /** What the page opens on, for screenshots (?open=r2&scroll=top|end): a review opened, the thread at its start or its end. */
  readonly opening: { readonly review: number | null; readonly top: boolean; readonly end: boolean }
}

let state: Proto = { direction: 'B', bare: false, answers: {}, opening: { review: null, top: false, end: false } }
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
