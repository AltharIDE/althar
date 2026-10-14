import type { BoardCall, BoardSnapshot, BoardTask } from '@althar/contracts'

import { isFinished } from '../../shared/calls'

/*
 * Which lane of the board each task and call goes in. Up next: a task
 * started whose first step waits for a free agent, in the order they will
 * start (it isn't running; nothing of it has had an agent), then a plan
 * waiting to start, on its countdown or held. Running: work an agent is on,
 * or was on and stopped. Needs you: a task that waits on a call of yours,
 * once, as one card that says the call; a call no task on the board waits
 * on (the coordinator's own question, or one for a task held up next); and
 * work ready, a plain task that finished among it. Settled: what is done,
 * most recent first.
 */

/** A task that waits on the person, with the call it waits on: the oldest, where it has several; null for a moment, before its call is read. */
export interface Waiting {
  readonly task: BoardTask
  readonly call: BoardCall | null
}

/**
 * A task started whose first step waits for a free agent: no step has had an
 * agent yet, so it is up next, not running. One mid-work whose later turn waits
 * for a place stays running: a short wait doesn't move it between lanes.
 */
export const startsWhenFree = (task: BoardTask) => task.phase === 'running' && task.planWaits === true && task.queued !== null

export interface Lanes {
  /** Up next in order: the tasks that start when an agent is free, then plans on their countdown, then those held. */
  readonly next: ReadonlyArray<BoardTask>
  /** How many of `next`, from its start, start when an agent is free. */
  readonly free: number
  readonly running: ReadonlyArray<BoardTask>
  /** Tasks that wait on a call of the person's, each once, with its call. */
  readonly waiting: ReadonlyArray<Waiting>
  /** Calls no task on the board waits on: the coordinator's questions, and a held plan's. */
  readonly calls: ReadonlyArray<BoardCall>
  readonly ready: ReadonlyArray<BoardTask>
  /** The most recently settled the board has loaded; `settledTotal` is how many there are in all. */
  readonly settled: ReadonlyArray<BoardTask>
  readonly settledTotal: number
}

export const lanesOf = (board: BoardSnapshot): Lanes => {
  const of = (...phases: ReadonlyArray<BoardTask['phase']>) => board.tasks.filter((task) => phases.includes(task.phase))
  const waiting = of('waiting').map((task) => ({ task, call: board.calls.find((call) => call.taskId === task.taskId) ?? null }))
  const folded = new Set(waiting.map(({ task }) => task.taskId))
  // The ones waiting for an agent start in the order the runtime will start them, the oldest where it can't say.
  const free = of('running')
    .filter(startsWhenFree)
    .toSorted((a, b) => (a.place ?? Infinity) - (b.place ?? Infinity) || a.createdAt.localeCompare(b.createdAt))
  return {
    // Next to start first: those waiting for an agent, then the one whose countdown ends soonest, then the held, oldest first.
    next: [...free, ...of('planned', 'held').toSorted((a, b) => (a.plan?.startsAt ?? '￿').localeCompare(b.plan?.startsAt ?? '￿'))],
    free: free.length,
    running: of('running', 'stopped').filter((task) => !startsWhenFree(task)),
    waiting,
    calls: board.calls.filter((call) => call.taskId === null || !folded.has(call.taskId)),
    ready: of('ready'),
    settled: of('settled').toSorted((a, b) => (b.settledAt ?? '').localeCompare(a.settledAt ?? '')),
    settledTotal: board.settledTotal,
  }
}

/** How many cards are in Needs you. */
export const inYoursOf = (lanes: Lanes) => lanes.waiting.length + lanes.calls.length + lanes.ready.length

/** What waits on the person: every card in Needs you but a plain task that finished, which asks nothing of them. */
export const yoursOf = (lanes: Lanes) => inYoursOf(lanes) - lanes.ready.filter(isFinished).length
