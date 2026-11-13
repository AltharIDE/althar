/*
 * Which tasks have moved into Settled, kept by this window across launches:
 * a card moves there once, when it settles, and never again. Drawn in Settled
 * later (after a lane change it made back to work, a refresh, a new snapshot,
 * a reload, a restart, another tab of the shelf) it is just there. By task,
 * not by when it settled: a task its lead works on again and that settles
 * again has already arrived.
 *
 * It moves in only where this window watched it settle: it was drawn outside
 * Settled (`watch`) and has now come in. A task that first shows up settled,
 * in a snapshot that comes later, an older page, or from before this was
 * kept, settled before this window looked, so it is drawn there as it is.
 * Every task drawn in Settled is kept, none forgotten: an id is a few bytes,
 * and one forgotten would move in again.
 */

const STORED = 'althar.arrived'

let arrived: Set<string> | null = null
/** Tasks drawn outside Settled in this window, so far. */
let watched = new Set<string>()

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
  try {
    window.localStorage.setItem(STORED, JSON.stringify([...known]))
  } catch {
    // Kept for this window only.
  }
}

/** Records tasks drawn outside Settled: if one settles now, this window watched it do so. */
export const watch = (taskIds: ReadonlyArray<string>) => {
  for (const id of taskIds) watched.add(id)
}

/** Whether a task drawn in Settled is just there: it arrived before, or this window never saw it outside Settled. */
export const arrivesQuietly = (taskId: string): boolean => hasArrived(taskId) || !watched.has(taskId)

/** Forgets what this window kept, as each test starts. */
export const forgetArrived = () => {
  arrived = null
  watched = new Set()
}
