/*
 * Which tasks have moved into Settled, kept by this window across launches:
 * a card moves there once, when it settles, and never again. Drawn in Settled
 * later (after a lane change it made back to work, a refresh, a new snapshot,
 * a reload, a restart, another tab of the shelf) it is just there. By task,
 * not by when it settled: a task its lead works on again and that settles
 * again has already arrived.
 */

const STORED = 'althar.arrived'
/** The most it remembers: the latest arrivals, as older ones are far down the shelf. */
const KEEP = 2000

let arrived: Set<string> | null = null

const load = (): Set<string> => {
  if (arrived !== null) return arrived
  arrived = new Set()
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORED) ?? 'null')
    if (Array.isArray(parsed)) for (const id of parsed) if (typeof id === 'string') arrived.add(id)
  } catch {
    // Storage that can't be read remembers nothing across launches; this window still does.
  }
  return arrived
}

/** Whether the task has moved into Settled before. */
export const hasArrived = (taskId: string): boolean => load().has(taskId)

/** Records tasks drawn in Settled: they have arrived. */
export const markArrived = (taskIds: ReadonlyArray<string>) => {
  const known = load()
  const fresh = taskIds.filter((id) => !known.has(id))
  if (fresh.length === 0) return
  for (const id of fresh) known.add(id)
  // Oldest first in a Set: what goes over the limit is the oldest.
  for (const id of known) {
    if (known.size <= KEEP) break
    known.delete(id)
  }
  try {
    window.localStorage.setItem(STORED, JSON.stringify([...known]))
  } catch {
    // Kept for this window only.
  }
}

/** Forgets what this window kept, as each test starts. */
export const forgetArrived = () => {
  arrived = null
}
