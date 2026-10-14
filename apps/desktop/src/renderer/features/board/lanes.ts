import type { BoardCall, BoardSnapshot, BoardTask } from '@althar/contracts'

import { isFinished, readyOf } from '../../shared/calls'

/*
 * Which lane of the board each task and call goes in. Up next: a plan
 * waiting to start, on its countdown or held. Running: work an agent is on,
 * or was on and stopped. Needs you: a task that waits on a call of yours,
 * once, as one card that says the call; a call no task on the board waits
 * on (the coordinator's own question, or one for a task held up next); and
 * work ready for the person, as `needsYou` says. Settled: what is done, most
 * recent first, with a plain task that finished above it, until it is opened
 * (it asks nothing of the person, so it isn't in Needs you).
 */

/** A task that waits on the person, with the call it waits on: the oldest, where it has several; null for a moment, before its call is read. */
export interface Waiting {
  readonly task: BoardTask
  readonly call: BoardCall | null
}

export interface Lanes {
  readonly next: ReadonlyArray<BoardTask>
  readonly running: ReadonlyArray<BoardTask>
  /** Tasks that wait on a call of the person's, each once, with its call. */
  readonly waiting: ReadonlyArray<Waiting>
  /** Calls no task on the board waits on: the coordinator's questions, and a held plan's. */
  readonly calls: ReadonlyArray<BoardCall>
  /** Work ready for the person: the home lists these too. */
  readonly ready: ReadonlyArray<BoardTask>
  /** Plain tasks that finished, waiting to be seen: they ask nothing, so they are not among what needs the person. */
  readonly finished: ReadonlyArray<BoardTask>
  /** The most recently settled the board has loaded; `settledTotal` is how many there are in all. */
  readonly settled: ReadonlyArray<BoardTask>
  readonly settledTotal: number
}

export const lanesOf = (board: BoardSnapshot): Lanes => {
  const of = (...phases: ReadonlyArray<BoardTask['phase']>) => board.tasks.filter((task) => phases.includes(task.phase))
  const waiting = of('waiting').map((task) => ({ task, call: board.calls.find((call) => call.taskId === task.taskId) ?? null }))
  const folded = new Set(waiting.map(({ task }) => task.taskId))
  return {
    // Next to start first: the one whose countdown ends soonest, then the held, oldest first.
    next: of('planned', 'held').toSorted((a, b) => (a.plan?.startsAt ?? '￿').localeCompare(b.plan?.startsAt ?? '￿')),
    running: of('running', 'stopped'),
    waiting,
    calls: board.calls.filter((call) => call.taskId === null || !folded.has(call.taskId)),
    ready: readyOf(of('ready')),
    finished: of('ready').filter(isFinished),
    settled: of('settled').toSorted((a, b) => (b.settledAt ?? '').localeCompare(a.settledAt ?? '')),
    settledTotal: board.settledTotal,
  }
}

/** How many cards are in Needs you: what waits on the person, each once. */
export const yoursOf = (lanes: Lanes) => lanes.waiting.length + lanes.calls.length + lanes.ready.length
