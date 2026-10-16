import { type RefObject, useCallback, useSyncExternalStore } from 'react'

import type { live } from './live'
import type { Recorded, Recording } from './recorder'

/*
 * Dictation in each thread, kept by the thread rather than by its composer,
 * so leaving doesn't lose what was said. What is being written down goes on
 * once the person leaves, and lands in that thread's draft (`drafts.ts`);
 * come back while it is still being written, and the composer shows it is;
 * come back after, and the words are there, with a quiet note that they
 * came while the person was away. What couldn't be written down is kept
 * here, to try again from the composer's tray.
 *
 * Listening goes on as the person leaves: they often go to look at what
 * they are talking about. What they say is then carried with them, in a pill
 * over the composer on screen, or at the window's foot where there is none
 * (`Carried.tsx`), always saying whose it is, until it is sent, kept for
 * later, thrown away, or they are back at its composer.
 */

export type Phase = 'idle' | 'listening' | 'writing'

export interface Said extends Recorded {
  readonly seconds: number
}

/** What a thread's composer shows of its dictation. */
export interface Session {
  readonly phase: Phase
  /** How long it has listened. */
  readonly seconds: number
  /** How loud, latest last, while it listens. */
  readonly levels: ReadonlyArray<number>
  /** What is heard and not yet written. */
  readonly interim: string
  /** Where in the draft what is said lands: the field's cursor as it started listening. */
  readonly at: number
  /** What was said and couldn't be written down, kept to try again. */
  readonly failed: Said | null
  /** The draft as it stood once what was said was written into it while the person was away; null where it was written with them there. */
  readonly arrived: string | null
  /** When the person left its composer while it listened or was written down: it is carried with them since. Null while its composer shows, or once dealt with. */
  readonly away: number | null
  /** What was written is being sent from the pill that carries it: once at a time, wherever the person goes meanwhile. */
  readonly sending: boolean
}

/** Whose a thread's dictation is, and how to get it there from elsewhere. */
export interface Destination {
  /** Whose it is: "To the coordinator · althar". */
  readonly to: string
  /** Its composer, to go back to. */
  readonly back: { readonly kind: 'coordinator'; readonly projectId: string } | { readonly kind: 'task'; readonly threadId: string }
  /** The thread it is sent to; null where it can't be sent from elsewhere, and only its own composer may send it (a task with no lead on it). */
  readonly threadId: string | null
  /** Sending it there: "Send to the coordinator". */
  readonly send: string
  /** Putting another thread's dictation in this one's composer instead: "Move it to this task". */
  readonly take: string
}

/** What a thread's dictation holds that nothing draws. */
export interface Handles {
  recording: Recording | null
  writer: ReturnType<typeof live> | null
  /** The microphone the recording was last told to hear. */
  hearing: string | null
  /** The thread's composer field, while it shows. */
  field: RefObject<HTMLTextAreaElement | null> | null
  /** How many of the thread's composers show. */
  shown: number
  /** Whose it is, as its composer last said. */
  to: Destination | null
  /** Writes down what was said, as the composer that listened writes it. */
  transcribe: ((said: Recorded) => Promise<string>) | null
  /** The clock while it listens, which goes on away from its composer. */
  clock: number | null
}

/* How many bars the composer draws. */
export const BARS = 12

const QUIET: ReadonlyArray<number> = Array.from({ length: BARS }, () => 0)

const IDLE: Session = {
  phase: 'idle',
  seconds: 0,
  levels: QUIET,
  interim: '',
  at: 0,
  failed: null,
  arrived: null,
  away: null,
  sending: false,
}

const sessions = new Map<string, Session>()
const handles = new Map<string, Handles>()
const listeners = new Map<string, Set<() => void>>()
/* Those who hear of any thread's change, or of composers coming and going. */
const everyone = new Set<() => void>()
/* The threads whose composer shows, the one shown last at the end. */
const showing: Array<string> = []
/* What `useCarrying` last read; undefined once anything changes. */
let carried: Carrying | undefined
let last: Carrying = { key: null, here: null }

/** Tells those who watch every thread. */
const told = () => {
  carried = undefined
  everyone.forEach((listener) => listener())
}

export const sessionOf = (key: string): Session => sessions.get(key) ?? IDLE

export const handlesOf = (key: string): Handles => {
  const held = handles.get(key)
  if (held !== undefined) return held
  const fresh: Handles = { recording: null, writer: null, hearing: null, field: null, shown: 0, to: null, transcribe: null, clock: null }
  handles.set(key, fresh)
  return fresh
}

/** Changes a thread's dictation, its composer on screen or not. */
export const changeSession = (key: string, change: Partial<Session> | ((now: Session) => Partial<Session>)) => {
  const was = sessionOf(key)
  const next = { ...was, ...(typeof change === 'function' ? change(was) : change) }
  if ((Object.keys(next) as Array<keyof Session>).every((field) => next[field] === was[field])) return
  sessions.set(key, next)
  listeners.get(key)?.forEach((listener) => listener())
  told()
}

/** The threads that listen now, wherever their composer is. */
export const listeningIn = (): ReadonlyArray<string> =>
  [...sessions].filter(([, session]) => session.phase === 'listening').map(([key]) => key)

/** A thread's composer shows, or stops showing. */
export const composerShown = (key: string, shown: boolean) => {
  const at = showing.lastIndexOf(key)
  if (at !== -1) showing.splice(at, 1)
  if (shown) showing.push(key)
  told()
}

/** What is carried, and where: the thread last left (if any is), and the thread whose composer is on screen. */
export interface Carrying {
  readonly key: string | null
  readonly here: string | null
}

const carrying = (): Carrying => {
  if (carried !== undefined) return carried
  let key: string | null = null
  let since = -Infinity
  for (const [thread, session] of sessions)
    if (session.away !== null && session.away > since) {
      key = thread
      since = session.away
    }
  const here = showing.at(-1) ?? null
  // The same while only what is said changes, so nothing redraws fifteen times a second for it.
  carried = last.key === key && last.here === here ? last : { key, here }
  last = carried
  return carried
}

const subscribeAll = (listener: () => void) => {
  everyone.add(listener)
  return () => {
    everyone.delete(listener)
  }
}

/** The dictation carried away from its composer, and the composer on screen, as they change. */
export const useCarrying = (): Carrying => useSyncExternalStore(subscribeAll, carrying)

const subscribe = (key: string, listener: () => void) => {
  const set = listeners.get(key) ?? new Set()
  listeners.set(key, set)
  set.add(listener)
  return () => {
    set.delete(listener)
    if (set.size === 0) listeners.delete(key)
  }
}

/** A thread's dictation, as it changes. */
export const useSession = (key: string): Session =>
  useSyncExternalStore(
    useCallback((listener: () => void) => subscribe(key, listener), [key]),
    () => sessionOf(key),
  )

/** Forgets every thread's dictation, as each test starts. */
export const forgetSessions = () => {
  for (const held of handles.values()) {
    held.recording?.cancel()
    held.writer?.close()
    if (held.clock !== null) window.clearInterval(held.clock)
  }
  sessions.clear()
  handles.clear()
  showing.length = 0
  told()
}
