import { shownAt } from './repositories'

/*
 * An update that couldn't move the store, as the runtime says it: what
 * stopped (a migration, or the copy before it), where the copy from before
 * the update is, and what was said. The main process keeps it, starts no
 * other runtime, and every window shows it instead of opening. The window
 * gets where the copy is as the person knows the place; showing it in the
 * file manager goes through here, so the page never sends a path.
 */

export interface StoreFailure {
  readonly stopped: 'moving' | 'copying'
  /** The copy's path; null where none was made. */
  readonly backup: string | null
  readonly reason: string
}

/** The runtime's message, checked; undefined for anything else. */
export const storeFailureOf = (message: unknown): StoreFailure | undefined => {
  if (typeof message !== 'object' || message === null) return undefined
  const { type, stopped, backup, reason } = message as Record<string, unknown>
  if (type !== 'store-failed' || (stopped !== 'moving' && stopped !== 'copying') || typeof reason !== 'string') return undefined
  if (backup !== null && typeof backup !== 'string') return undefined
  return { stopped, backup, reason }
}

/** What the window shows: the copy where the person knows it, from ~. */
export const failureForWindow = (failure: StoreFailure, home: string) => ({
  stopped: failure.stopped,
  backup: failure.backup === null ? null : shownAt(failure.backup, home),
  reason: failure.reason,
})
