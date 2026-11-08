// Scrappy: what the page holds: the direction, the case, and what the person did to it here. A press is an edit: a case → a case, kept
// per case, so the parts, the access and the changes move with the thread, and every screen reads the same case.
import { useSyncExternalStore } from 'react'

import { caseOf, type Case } from './cases'
import { needOf } from './need'

export type Direction = 'A' | 'B' | 'C'

/** What a press does to a case: its changes, parts, access or thread, in one step. */
export type Edit = (c: Case) => Case

export interface Proto {
  readonly direction: Direction
  readonly key: string
  /** Asks answered on this page, by their key: what was said. */
  readonly answered: Readonly<Record<string, string>>
  /** What the person's presses (and what they started) did to each case, in order. */
  readonly edits: Readonly<Record<string, ReadonlyArray<Edit>>>
  /** An answer, by its key: how many edits its case had when it was given, so Undo goes back to there. */
  readonly marks: Readonly<Record<string, number>>
  /** No strip under the window: for screenshots. */
  readonly bare: boolean
  /** Something the page opens on, for screenshots: a strip's change, the outbox, a part. */
  readonly opening: string | null
  /** Counts every change to the case, so the screens read again. */
  readonly rev: number
}

let state: Proto = { direction: 'A', key: 'needs-one', answered: {}, edits: {}, marks: {}, bare: false, opening: null, rev: 0 }
const listeners = new Set<() => void>()
const set = (next: Partial<Proto>) => {
  state = { ...state, ...next }
  for (const listener of listeners) listener()
}
const bump = (next: Partial<Proto>) => set({ ...next, rev: state.rev + 1 })

/** What is under way for a case (a Ship's steps): stopped when the case starts over or an answer is taken back. */
const timers = new Map<string, Set<number>>()
const stopTimers = (key: string) => {
  for (const timer of timers.get(key) ?? []) window.clearTimeout(timer)
  timers.delete(key)
}

/** The case with its edits, kept while they don't change. */
let made: {
  readonly list: ReadonlyArray<Edit> | undefined
  readonly key: string
  readonly answered: Proto['answered']
  readonly out: Case
} | null = null

/** A case that was changed here sits in the lane its one next step says: a card waiting on the person is in Needs you. */
const inItsLane = (c: Case): Case => {
  if (c.lane === 'settled' || c.lane === 'scratch') return c
  const need = needOf(c, state.answered)
  const lane = need.tone === 'you' || need.tone === 'bad' ? 'you' : need.tone === 'live' ? 'running' : c.lane
  return lane === c.lane ? c : { ...c, lane }
}

export const proto = {
  get: () => state,
  set,
  subscribe: (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  /** The case on screen, with what the person did to it here. */
  current: (): Case => {
    const list = state.edits[state.key]
    if (made !== null && made.list === list && made.key === state.key && made.answered === state.answered) return made.out
    const edited = (list ?? []).reduce((c, edit) => edit(c), caseOf(state.key))
    const out = list === undefined ? edited : inItsLane(edited)
    made = { list, key: state.key, answered: state.answered, out }
    return out
  },
  /** Do this to a case (the one on screen, unless named). */
  edit: (edit: Edit, key = state.key) => bump({ edits: { ...state.edits, [key]: [...(state.edits[key] ?? []), edit] } }),
  /** Do this to a case after a while: a step of something under way. */
  later: (ms: number, edit: Edit, key = state.key) => {
    const timer = window.setTimeout(() => {
      timers.get(key)?.delete(timer)
      proto.edit(edit, key)
    }, ms)
    timers.set(key, (timers.get(key) ?? new Set()).add(timer))
  },
  /** Do something to the page after a while, for a case: stopped with the case's other steps. */
  afterwards: (ms: number, run: () => void, key = state.key) => {
    const timer = window.setTimeout(() => {
      timers.get(key)?.delete(timer)
      run()
    }, ms)
    timers.set(key, (timers.get(key) ?? new Set()).add(timer))
  },
  /** An answer to an ask, with what it does. */
  answer: (key: string, said: string, edit?: Edit) =>
    bump({
      answered: { ...state.answered, [key]: said },
      marks: { ...state.marks, [key]: (state.edits[state.key] ?? []).length },
      ...(edit === undefined ? {} : { edits: { ...state.edits, [state.key]: [...(state.edits[state.key] ?? []), edit] } }),
    }),
  /** Take an answer back: the ask is open again, and what the answer did is undone. */
  unanswer: (key: string) => {
    const at = state.marks[key]
    stopTimers(state.key)
    bump({
      answered: Object.fromEntries(Object.entries(state.answered).filter(([one]) => one !== key)),
      ...(at === undefined ? {} : { edits: { ...state.edits, [state.key]: (state.edits[state.key] ?? []).slice(0, at) } }),
    })
  },
  /** An ask asked again: its answer is forgotten, and nothing it did is undone. */
  reopen: (key: string) => bump({ answered: Object.fromEntries(Object.entries(state.answered).filter(([one]) => one !== key)) }),
  /** A case starts over: what was done to it here is gone. */
  reset: (key: string) => {
    stopTimers(key)
    const edits = { ...state.edits }
    delete edits[key]
    bump({
      edits,
      answered: Object.fromEntries(Object.entries(state.answered).filter(([one]) => !one.startsWith(`${key}:`))),
    })
  },
  /** To a case, fresh. */
  go: (key: string) => {
    proto.reset(key)
    set({ key, opening: null })
  },
  /** Whether the case on screen has been changed here. */
  touched: () => (state.edits[state.key] ?? []).length > 0 || Object.keys(state.answered).some((one) => one.startsWith(`${state.key}:`)),
}

export const useProto = () => useSyncExternalStore(proto.subscribe, proto.get)
