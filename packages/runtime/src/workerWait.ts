import { Data, Duration } from 'effect'

import type { WorkerExecutionPlatform } from './workerExecution'

/**
 * What keeps a worker from taking a lead's run now, where something does. A worker runs one agent at a time: another
 * task's run there, one being readied, or a run of this task's own that it hasn't said has stopped (as after a lost
 * connection, until it reconnects and reconciles) holds it; so does one that isn't connected now, for a while, as
 * between two runs or while it reconnects. Nothing where it is free to take the run.
 */
export type WorkerHold = { readonly kind: 'away'; readonly workspaceId?: string } | { readonly kind: 'busy'; readonly workspaceId?: string }

/** The worker as the home has it now, by its own list of the workers it enrolled where it has one, else the project's. */
export const holdOn = (platform: WorkerExecutionPlatform, projectId: string, workerId: string): WorkerHold | undefined => {
  const enrolled = platform.enrolled?.()?.find((one) => one.workerId === workerId)
  if (enrolled !== undefined) {
    const holding = enrolled.workspaceId === undefined ? {} : { workspaceId: enrolled.workspaceId }
    if (!enrolled.connected) return { kind: 'away', ...holding }
    return enrolled.busy ? { kind: 'busy', ...holding } : undefined
  }
  const listed = platform.list(projectId).find((one) => one.workerId === workerId)
  if (listed === undefined) return { kind: 'away' }
  return listed.busy ? { kind: 'busy' } : undefined
}

/**
 * How a start waits for its worker: how often it looks again; how long it waits for one that isn't connected before it
 * says so (a worker reconnects within half a minute of losing its connection); and how long it waits before the thread
 * says what it waits for, so a worker free again within moments, as between two runs, isn't said at all.
 */
export interface WorkerWait {
  readonly every: Duration.Duration
  readonly away: Duration.Duration
  readonly sayAfter: Duration.Duration
}

export const WORKER_WAIT: WorkerWait = { every: Duration.seconds(2), away: Duration.seconds(90), sayAfter: Duration.seconds(3) }

/** The task that holds a worker, by the workspace its run holds: this one's own, or another's by its title. */
export type WorkerHolder = { readonly own: true } | { readonly own: false; readonly title: string }

/** What the thread says while its lead waits for its worker: what holds it, and who. */
export const holdWords = (
  worker: string,
  hold: WorkerHold,
  holder: WorkerHolder | undefined,
): { readonly title: string; readonly description: string | null } => {
  if (hold.kind === 'away') return { title: `Waiting for ${worker} to connect again.`, description: null }
  if (holder?.own === true) return { title: `Waiting for ${worker} to stop this task’s last run there.`, description: null }
  return {
    title: holder === undefined ? `Waiting for ${worker}: another run holds it.` : `Waiting for ${worker}: “${holder.title}” runs there.`,
    description: 'The lead starts there once that one is done. A worker runs one agent at a time.',
  }
}

/**
 * A lead's start its worker turned away only because another run took it first, between looking and asking: the start
 * waits for the worker again (Sessions.ts), rather than failing or being tried again afresh.
 */
export class WorkerTaken extends Data.TaggedError('WorkerTaken')<{ readonly workerId: string; readonly reason: string }> {}
