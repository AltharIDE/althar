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
 * Listening itself stops as the person leaves, and what was said up to then
 * is written down: a microphone kept open with no composer on screen would
 * be listening where nobody can see, and the window's shortcut would belong
 * to another composer by then.
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
}

/* How many bars the composer draws. */
export const BARS = 12

const QUIET: ReadonlyArray<number> = Array.from({ length: BARS }, () => 0)

const IDLE: Session = { phase: 'idle', seconds: 0, levels: QUIET, interim: '', at: 0, failed: null, arrived: null }

const sessions = new Map<string, Session>()
const handles = new Map<string, Handles>()
const listeners = new Map<string, Set<() => void>>()

export const sessionOf = (key: string): Session => sessions.get(key) ?? IDLE

export const handlesOf = (key: string): Handles => {
  const held = handles.get(key)
  if (held !== undefined) return held
  const fresh: Handles = { recording: null, writer: null, hearing: null, field: null, shown: 0 }
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
}

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
  }
  sessions.clear()
  handles.clear()
}
