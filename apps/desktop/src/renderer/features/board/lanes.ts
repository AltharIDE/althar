import type { BoardCall, BoardSnapshot, BoardTask } from '@charrette/contracts'

/*
 * Which lane of the board each task and call goes in. Up next: a plan
 * waiting to start, on its countdown or held. Running: work an agent is on,
 * or was on and stopped, and work that waits on a call of yours, which says
 * so. Needs you: every call, and work ready to accept. Settled: what is done,
 * most recent first.
 */

export interface Lanes {
  readonly next: ReadonlyArray<BoardTask>
  readonly running: ReadonlyArray<BoardTask>
  readonly calls: ReadonlyArray<BoardCall>
  readonly ready: ReadonlyArray<BoardTask>
  readonly settled: ReadonlyArray<BoardTask>
}

export const lanesOf = (board: BoardSnapshot): Lanes => {
  const of = (...phases: ReadonlyArray<BoardTask['phase']>) => board.tasks.filter((task) => phases.includes(task.phase))
  return {
    // Next to start first: the one whose countdown ends soonest, then the held, oldest first.
    next: of('planned', 'held').toSorted((a, b) => (a.plan?.startsAt ?? '￿').localeCompare(b.plan?.startsAt ?? '￿')),
    running: of('running', 'waiting', 'stopped'),
    calls: board.calls,
    ready: of('ready'),
    settled: of('settled').toSorted((a, b) => (b.settledAt ?? '').localeCompare(a.settledAt ?? '')),
  }
}

/** Calls and ready work: what waits on the person. */
export const yoursOf = (lanes: Lanes) => lanes.calls.length + lanes.ready.length
