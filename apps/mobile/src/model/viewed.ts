import { useSyncExternalStore } from 'react'

/*
 * Which of a task's files the person has looked at, on this phone: marked
 * from a file's diff, counted in the list of changes. Kept in memory for
 * now; a file whose diff changes after it was viewed should count as unseen
 * again, which needs its digest from the runtime.
 */

const NONE: ReadonlySet<string> = new Set()
let viewed = new Map<string, ReadonlySet<string>>()
const listeners = new Set<() => void>()

const keyOf = (taskId: string) => taskId

export const viewedFiles = {
  of: (taskId: string): ReadonlySet<string> => viewed.get(keyOf(taskId)) ?? NONE,
  toggle: (taskId: string, path: string): void => {
    const now = new Set(viewed.get(keyOf(taskId)) ?? [])
    if (now.has(path)) now.delete(path)
    else now.add(path)
    viewed = new Map(viewed).set(keyOf(taskId), now)
    for (const listener of listeners) listener()
  },
  subscribe: (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  /** For tests. */
  reset: () => {
    viewed = new Map()
  },
}

export const useViewed = (taskId: string): ReadonlySet<string> =>
  useSyncExternalStore(
    viewedFiles.subscribe,
    () => viewedFiles.of(taskId),
    () => viewedFiles.of(taskId),
  )
