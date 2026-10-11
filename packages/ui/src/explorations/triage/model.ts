import { useEffect, useState } from 'react'

/*
 * What a triage moment is, for the exploration: after a little groundwork a
 * task's lead says how it means to go about the work and what it is
 * assuming, and carries on by itself when the time runs out unless the
 * person corrects something. Only when a wrong guess would be expensive does
 * it ask instead, and then the task waits on the person.
 *
 * Prototype only: the stories hold this state, and nothing in the app does.
 */

/** Something the lead takes as given, so it doesn't have to ask. */
export interface Assumption {
  id: string
  /** What it takes as given, in a line. */
  says: string
  /** Why it thinks so: a file, a project note, the brief. */
  because?: string
  /** Where it applies, for direction D: words in the brief, or a file. */
  anchor?: { quote: string } | { file: string }
}

/** Why a question blocks rather than being assumed. Nothing else may block. */
export enum Stakes {
  /** A wrong guess redoes much of the work. */
  Redo = 'redo',
  /** It reaches outside the project: a partner, a customer, production. */
  Outward = 'outward',
  /** It can't be undone. */
  Irreversible = 'irreversible',
}

/** Where the triage moment is. */
export enum Phase {
  /** Groundwork: reading before it says anything. */
  Looking = 'looking',
  /** The checkpoint is up and its time is running. */
  Open = 'open',
  /** You held it: its time stops until you say. */
  Held = 'held',
  /** It carried on, on its own or because you said so. */
  Continued = 'continued',
  /** It asked a real question, and waits on you. */
  Asking = 'asking',
  /** You answered, and it carried on. */
  Answered = 'answered',
}

export interface Checkpoint {
  phase: Phase
  /** Seconds left before it carries on by itself. */
  left: number
  /** What you said instead, by assumption. */
  corrections: Readonly<Record<string, string>>
  /** The assumption whose correction is being written. */
  correcting?: string
  /** How it carried on: when its time ran out, or when you said. */
  by?: 'time' | 'you'
}

export interface CheckpointActions {
  correct: (id: string) => void
  cancel: () => void
  send: (id: string, words: string) => void
  undo: (id: string) => void
  hold: () => void
  /** Carry on now, or after a hold. */
  go: () => void
  answer: () => void
}

/** The checkpoint a moment shows, from a few words: a state's fields, the rest at rest. */
export const checkpoint = (phase: Phase, rest: Partial<Omit<Checkpoint, 'phase'>> = {}): Checkpoint => ({
  phase,
  left: 102,
  corrections: {},
  ...rest,
})

const without = (all: Readonly<Record<string, string>>, id: string) => Object.fromEntries(Object.entries(all).filter(([k]) => k !== id))

/**
 * The story's own copy of a checkpoint, with its clock. The clock stops
 * while a correction is being written, and when you hold it. `ticking`
 * off keeps a moment still, for the sheets of states.
 */
export function useCheckpoint(start: Checkpoint, ticking = false): [Checkpoint, CheckpointActions] {
  const [c, set] = useState(start)
  const counting = ticking && c.phase === Phase.Open && c.correcting === undefined
  useEffect(() => {
    if (!counting) return
    /* the last second carries it on, so the clock never shows zero */
    const id = window.setTimeout(
      () => set((was) => (was.left <= 1 ? { ...was, phase: Phase.Continued, by: 'time', left: 0 } : { ...was, left: was.left - 1 })),
      1000,
    )
    return () => window.clearTimeout(id)
  }, [counting, c.left])
  return [
    c,
    {
      correct: (id) => set((was) => ({ ...was, correcting: id })),
      cancel: () => set((was) => ({ ...was, correcting: undefined })),
      send: (id, words) => set((was) => ({ ...was, correcting: undefined, corrections: { ...was.corrections, [id]: words } })),
      undo: (id) => set((was) => ({ ...was, corrections: without(was.corrections, id) })),
      hold: () => set((was) => ({ ...was, phase: Phase.Held, correcting: undefined })),
      go: () => set((was) => ({ ...was, phase: Phase.Continued, by: 'you', correcting: undefined })),
      answer: () => set((was) => ({ ...was, phase: Phase.Answered })),
    },
  ]
}

/** Seconds as the clock shows them: 1:42. */
export const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`

/** How many things, in words: 1 thing, 3 things. */
export const things = (n: number, one = 'thing', many = 'things') => `${n} ${n === 1 ? one : many}`
