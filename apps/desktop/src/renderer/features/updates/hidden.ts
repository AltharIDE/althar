import { useSyncExternalStore } from 'react'

import type { UpdateKind } from '@althar/ui'

/*
 * The updates the person put aside in the bar's Updates, each until its next
 * release: by what it is (Althar's, the home's, its workers'), the release it
 * offered then. This window's own, kept across launches; a newer release than
 * the one put aside shows again.
 */

const KEY = 'althar.updates.hidden'

type Hidden = Partial<Record<UpdateKind, string>>

const read = (): Hidden => {
  try {
    const kept: unknown = JSON.parse(window.localStorage.getItem(KEY) ?? '{}')
    if (typeof kept !== 'object' || kept === null) return {}
    return Object.fromEntries(
      Object.entries(kept).filter(
        ([kind, version]) => (kind === 'app' || kind === 'home' || kind === 'workers') && typeof version === 'string',
      ),
    )
  } catch {
    return {}
  }
}

let current: Hidden = read()
const listeners = new Set<() => void>()

/** Puts an update aside until a release newer than `version`, at once, and keeps it. */
export const hideUpdate = (kind: UpdateKind, version: string): void => {
  current = { ...current, [kind]: version }
  try {
    window.localStorage.setItem(KEY, JSON.stringify(current))
  } catch {
    // Not kept across launches; it still holds for this window.
  }
  for (const listener of listeners) listener()
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

/** What's put aside now, by kind: the release each was put aside at. */
export const useHiddenUpdates = (): Hidden => useSyncExternalStore(subscribe, () => current)

/** For tests: forgets what's put aside, here and where it's kept. */
export const forgetHiddenUpdates = (): void => {
  current = {}
  try {
    window.localStorage.removeItem(KEY)
  } catch {
    // Nothing kept to forget.
  }
  for (const listener of listeners) listener()
}
