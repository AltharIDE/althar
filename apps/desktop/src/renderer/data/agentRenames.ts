import { useSyncExternalStore } from 'react'

/*
 * The title an agent (a lead, or the coordinator) last gave each task, as the
 * change feed says it, from the rename's own record: the person's own rename,
 * here or in another window, clears it. A surface types a title in only
 * while the title it is given is this one (useTypedTitle).
 */

const renames = new Map<string, string>()
const listeners = new Set<() => void>()

/** A task was renamed: by an agent to `title`, or (`null`) by the person. */
export function heardRename(taskId: string, title: string, byAgent: boolean) {
  const next = byAgent ? title : null
  if ((renames.get(taskId) ?? null) === next) return
  if (next === null) renames.delete(taskId)
  else renames.set(taskId, next)
  for (const listener of listeners) listener()
}

/** What an agent last renamed the task to, while that is still its title. */
export function useAgentRename(taskId: string | null | undefined): string | null {
  return useSyncExternalStore(
    (changed) => {
      listeners.add(changed)
      return () => void listeners.delete(changed)
    },
    () => (taskId == null ? null : (renames.get(taskId) ?? null)),
    () => null,
  )
}
