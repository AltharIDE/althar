import type { BoardCall, BoardSnapshot, BoardTask } from '@althar/contracts'

import { readyOf, standingCalls } from '../../shared/calls'

/*
 * Which lane of the board each task and call goes in. Up next: a task
 * started that waits for a free agent before any agent has worked on it,
 * whatever its kind (a change with a plan, a quick task, a review), in the
 * order its project's line starts (it isn't running), then a plan
 * waiting to start, on its countdown or held. Running: work an agent is on,
 * or was on and stopped. Needs you: a task that waits on a call of yours,
 * once, as one card that says the call; a call no task on the board waits
 * on (the coordinator's own question, or one for a task held up next); and
 * work ready for the person, as `needsYou` says, a task that isn't a change
 * and finished among it until they settle it. Settled: what is done, most
 * recent first; and, behind a tab of its own beside it, what the person kept
 * for later, the latest kept first.
 */

/** A task that waits on the person, with the call it waits on: the oldest, where it has several; null for a moment, before its call is read. */
export interface Waiting {
  readonly task: BoardTask
  readonly call: BoardCall | null
}

/**
 * A task started that waits for a free agent before any agent has worked on
 * it, whatever its kind: it is in its project's line, up next, not running.
 * One mid-work whose later turn waits for a place stays running: a short wait
 * doesn't move it between lanes.
 */
export const startsWhenFree = (task: BoardTask) => task.phase === 'running' && task.inLine === true && task.queued !== null

export interface Lanes {
  /** Up next in order: the tasks that start when an agent is free, then plans on their countdown, then those held. */
  readonly next: ReadonlyArray<BoardTask>
  /** How many of `next`, from its start, start when an agent is free: the project's line. */
  readonly free: number
  /** The line is in an order the person gave it, not the oldest first. */
  readonly reordered: boolean
  readonly running: ReadonlyArray<BoardTask>
  /** Tasks that wait on a call of the person's, each once, with its call. */
  readonly waiting: ReadonlyArray<Waiting>
  /** Calls no task on the board waits on: the coordinator's questions, and a held plan's. */
  readonly calls: ReadonlyArray<BoardCall>
  /** Work ready for the person: the home lists these too. */
  readonly ready: ReadonlyArray<BoardTask>
  /** Finished tasks that aren't changes, which the person kept for later: out of Needs you, the latest kept first. */
  readonly kept: ReadonlyArray<BoardTask>
  /** The most recently settled the board has loaded; `settledTotal` is how many there are in all. */
  readonly settled: ReadonlyArray<BoardTask>
  readonly settledTotal: number
}

export const lanesOf = (board: BoardSnapshot): Lanes => {
  const of = (...phases: ReadonlyArray<BoardTask['phase']>) => board.tasks.filter((task) => phases.includes(task.phase))
  // A waiting task's calls are one, its oldest (`standingCalls`, as the home counts them too).
  const standing = standingCalls(board.tasks, board.calls)
  const waiting = of('waiting').map((task) => ({ task, call: standing.find((call) => call.taskId === task.taskId) ?? null }))
  const folded = new Set(waiting.map(({ task }) => task.taskId))
  // The ones waiting for an agent in the order their line starts, as the runtime says it, the oldest where it can't.
  const free = of('running')
    .filter(startsWhenFree)
    .toSorted((a, b) => (a.place ?? Infinity) - (b.place ?? Infinity) || a.createdAt.localeCompare(b.createdAt))
  return {
    // Next to start first: those waiting for an agent, then the one whose countdown ends soonest, then the held, oldest first.
    next: [...free, ...of('planned', 'held').toSorted((a, b) => (a.plan?.startsAt ?? '￿').localeCompare(b.plan?.startsAt ?? '￿'))],
    free: free.length,
    reordered: free.some((task) => task.reordered === true),
    running: of('running', 'stopped').filter((task) => !startsWhenFree(task)),
    waiting,
    calls: standing.filter((call) => call.taskId === null || !folded.has(call.taskId)),
    ready: readyOf(of('ready')),
    kept: of('kept').toSorted((a, b) => (b.keptAt ?? '').localeCompare(a.keptAt ?? '')),
    settled: of('settled').toSorted((a, b) => (b.settledAt ?? '').localeCompare(a.settledAt ?? '')),
    settledTotal: board.settledTotal,
  }
}

/** How many cards are in Needs you: what waits on the person, each once. */
export const yoursOf = (lanes: Lanes) => lanes.waiting.length + lanes.calls.length + lanes.ready.length
