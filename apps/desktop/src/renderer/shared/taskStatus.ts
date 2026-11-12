import type { TaskPhase } from '@althar/contracts'
import { TaskStatus } from '@althar/ui'

/*
 * Where a task stands, as its card on the board, its line on the home and
 * its header in its own view all say it: one reading, from what its card
 * says (the runtime's `cardFor`, which the board and the view's head share),
 * so none of them says a task waits on the person while another says it
 * runs. Each says it in its own words beside it.
 */

/** What of a task's card says where it stands. */
export interface Standing {
  readonly phase: TaskPhase | null
  /** How many calls of its wait on the person, where what says it knows: one standing is theirs, whatever the card said a moment before. */
  readonly calls?: number
  /** Waiting for a free agent: every one this machine runs at once is busy. */
  readonly queued: unknown
  /** Held for an agent's usage limit, until it resets. */
  readonly waits: unknown
  /** Held for an agent's connection, until it is back (ADR-060). */
  readonly reconnects?: unknown
  /** Started Local, waiting for its checkout (ADR-091). */
  readonly waitsForCheckout?: unknown
  /** Accepted, in its branch's merge queue: its host merges it once the queue's checks pass. */
  readonly inMergeQueue?: boolean
  /** Its folder coming back from its branch, set up again, before anything it was asked goes on (ADR-056): its view says so. */
  readonly folder?: string | undefined
}

/**
 * Its status: waiting on the person first, as a call or a draft of theirs
 * comes before anything (ADR-034); then held for a limit or the connection,
 * which goes on by itself; then waiting its turn for an agent; then by its
 * phase, but while its folder comes back. A plan counting down, or held, is
 * under way, never stopped.
 */
export const taskStatusOf = (task: Standing): TaskStatus => {
  if (task.phase === 'waiting' || (task.calls ?? 0) > 0) return TaskStatus.Yours
  if (task.waits != null || task.reconnects != null) return TaskStatus.Paused
  if (task.queued != null || task.waitsForCheckout != null) return TaskStatus.Queued
  if (task.folder === 'returning') return TaskStatus.Running
  switch (task.phase) {
    case 'ready':
      return task.inMergeQueue === true ? TaskStatus.Running : TaskStatus.Yours
    case 'kept':
      return TaskStatus.Paused
    case 'settled':
      return TaskStatus.Done
    case 'stopped':
      return TaskStatus.Stopped
    case 'running':
    case 'planned':
    case 'held':
    case 'drafting':
    case null:
      return TaskStatus.Running
  }
}
