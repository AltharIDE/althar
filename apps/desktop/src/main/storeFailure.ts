import { shownAt } from './repositories'

/*
 * A store the runtime can't serve, as it says it: an update that couldn't
 * move it (what stopped, a migration or the copy before it, and where the
 * copy from before the update is), or a profile another runtime has open;
 * and what was said. The main process keeps it, starts no
 * other runtime, and every window shows it instead of opening. The window
 * gets where the copy is as the person knows the place; showing it in the
 * file manager goes through here, so the page never sends a path.
 */

export interface StoreFailure {
  readonly stopped: 'moving' | 'copying' | 'held'
  /** The copy's path; null where none was made. */
  readonly backup: string | null
  readonly reason: string
}

/**
 * The runtime's message, checked; undefined for anything else. A profile
 * another runtime has open (`profile-in-use`) is a failure that moves and
 * copies nothing: `held`, in the words the runtime has for it.
 */
export const storeFailureOf = (message: unknown): StoreFailure | undefined => {
  if (typeof message !== 'object' || message === null) return undefined
  const { type, stopped, backup, reason } = message as Record<string, unknown>
  if (type === 'profile-in-use') return typeof reason === 'string' ? { stopped: 'held', backup: null, reason } : undefined
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
