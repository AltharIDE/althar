import type { BoardCall, BoardSnapshot, BoardTask } from '@althar/contracts'

import { readyOf, standingCalls } from '../../shared/calls'

/*
 * Which lane of the board each task and call goes in (ADR-065). Up next:
 * what goes on by itself with no agent at work on it now, in the order it
 * will. First a task under way whose next turn waits for a free agent, which
 * continues; then a task started that waits for one before any agent has
 * worked on it, whatever its kind (a change with a plan, a quick task, a
 * review), in the order its project's line starts; then work under way
 * paused for a usage limit or the connection; then a plan waiting to start,
 * on its countdown or held. Running: work an agent is on, or whose checks
 * Althar sees through, and at its foot what was on and stopped, which its
 * count leaves out. Needs you: a task that waits on a call of yours, once,
 * as one card that says the call; a call no task on the board waits on (the
 * coordinator's own question, or one for a task held up next); and work
 * ready for the person, as `needsYou` says, a task that isn't a change and
 * finished among it until they settle it. Settled: what is done, most recent
 * first; and, behind a tab of its own beside it, what the person kept for
 * later, the latest kept first.
 *
 * While the person points at Up next or Running, or drags a row of the line,
 * a task that would move between the two stays where it was (`Held`), and
 * moves once they look away.
 */

/** A task that waits on the person, with the call it waits on: the oldest, where it has several; null for a moment, before its call is read. */
export interface Waiting {
  readonly task: BoardTask
  readonly call: BoardCall | null
}

/** A task started that waits for a free agent before any agent has worked on it, whatever its kind: it is in its project's line, up next. */
export const startsWhenFree = (task: BoardTask) => task.phase === 'running' && task.inLine === true && task.queued !== null

/** A task under way, none of its agents at work, whose next turn waits for a free agent: it continues, up next ahead of the line. */
export const continuesWhenFree = (task: BoardTask) => task.phase === 'running' && task.continues === true && task.queued !== null

/** A task under way held for a usage limit or the connection, none of its agents at work: paused, up next after what waits for an agent. */
export const pausedUpNext = (task: BoardTask) => task.phase === 'running' && task.continues === true && task.queued === null

/** Up next though it is under way or started: it goes on by itself, and no agent of it is at work. */
export const waitsUpNext = (task: BoardTask) => startsWhenFree(task) || (task.phase === 'running' && task.continues === true)

/** Where in Up next or Running a task stands: what continues, the line, what is paused, or Running. */
export type Group = 'continuing' | 'line' | 'paused' | 'running'

/** Where each task in those groups stood when the person's pointer came in, and its place there (its place in Up next, else its index). */
export type Held = ReadonlyMap<string, { readonly group: Group; readonly at: number }>

export interface Lanes {
  /** Up next in order: what continues, then the line, then what is paused, then plans on their countdown, then those held. */
  readonly next: ReadonlyArray<BoardTask>
  /** How many of `next`, from its start, continue when an agent is free. */
  readonly continuing: number
  /** How many of `next`, after those, start when an agent is free: the project's line. */
  readonly free: number
  /** How many of `next`, after the line, are paused for a usage limit or the connection. */
  readonly paused: number
  /** How many wait up next, as its head counts them: while the lanes are held, without what started meanwhile. */
  readonly upNext: number
  /** The line is in an order the person gave it, not the oldest first. */
  readonly reordered: boolean
  /** Running's cards: what is under way, then what stopped. */
  readonly running: ReadonlyArray<BoardTask>
  /** How many have an agent on them, or checks Althar sees through: Running's count, which leaves out what stopped and what waits. */
  readonly atWork: number
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

/** The group a task belongs in now; null where it is in neither Up next's waiting groups nor Running. */
const groupOf = (task: BoardTask): Group | null => {
  if (continuesWhenFree(task)) return 'continuing'
  if (startsWhenFree(task)) return 'line'
  if (pausedUpNext(task)) return 'paused'
  return task.phase === 'running' || task.phase === 'stopped' ? 'running' : null
}

/** When a paused task can go on: a usage limit's reset, the soonest first; the connection, whenever it is back, after them. */
const backAt = (task: BoardTask) => task.waits?.until ?? '￿'

/**
 * Up next's waiting groups and Running, from the tasks in them: each in the
 * group it belongs in, or, held, the one it stood in, and in order there.
 * What continues and the line go by their places in Up next (one held in
 * place by the one it had); what is paused by when it is back; Running by
 * the board's order, what stopped last. Held, what is paused and Running
 * keep the order they stood in, what came since after it.
 */
const arrange = (tasks: ReadonlyArray<BoardTask>, held: Held | null) => {
  const groups: Record<Group, Array<{ readonly task: BoardTask; readonly at: number; readonly kept: boolean }>> = {
    continuing: [],
    line: [],
    paused: [],
    running: [],
  }
  let upNext = 0
  let atWork = 0
  for (const task of tasks) {
    const natural = groupOf(task)
    if (natural === null) continue
    if (natural === 'running') {
      if (task.phase !== 'stopped') atWork += 1
    } else upNext += 1
    const was = held?.get(task.taskId)
    const group = was?.group ?? natural
    const kept = was !== undefined && was.group !== natural
    groups[group].push({ task, at: kept ? was.at : (task.place ?? Infinity), kept })
  }
  const index = (task: BoardTask) => held?.get(task.taskId)?.at ?? Infinity
  // By place, one held in its place before one that has come to it since; the oldest where neither has one.
  const placed = (list: typeof groups.line) =>
    list
      .toSorted((a, b) => a.at - b.at || Number(b.kept) - Number(a.kept) || a.task.createdAt.localeCompare(b.task.createdAt))
      .map((one) => one.task)
  const steady = (list: ReadonlyArray<BoardTask>) => (held === null ? list : list.toSorted((a, b) => index(a) - index(b)))
  const stopped = (task: BoardTask) => Number(task.phase === 'stopped' || groupOf(task) !== 'running')
  return {
    continuing: placed(groups.continuing),
    line: placed(groups.line),
    paused: steady(groups.paused.map((one) => one.task).toSorted((a, b) => backAt(a).localeCompare(backAt(b)))),
    running: steady(groups.running.map((one) => one.task).toSorted((a, b) => stopped(a) - stopped(b))),
    upNext,
    atWork,
  }
}

/** Up next's and Running's part of the lanes, from their tasks and the plans that wait, held or not. */
const laid = (tasks: ReadonlyArray<BoardTask>, plans: ReadonlyArray<BoardTask>, held: Held | null) => {
  const { continuing, line, paused, running, upNext, atWork } = arrange(tasks, held)
  return {
    // Next to go on first: what continues, the line, what is paused, then the plan whose countdown ends soonest, then the held, oldest first.
    next: [...continuing, ...line, ...paused, ...plans],
    continuing: continuing.length,
    free: line.length,
    paused: paused.length,
    upNext: upNext + plans.length,
    reordered: line.some((task) => task.reordered === true),
    running,
    atWork,
  }
}

const plansOf = (lanes: Lanes) => lanes.next.slice(lanes.continuing + lanes.free + lanes.paused)

export const lanesOf = (board: BoardSnapshot): Lanes => {
  const of = (...phases: ReadonlyArray<BoardTask['phase']>) => board.tasks.filter((task) => phases.includes(task.phase))
  // A waiting task's calls are one, its oldest (`standingCalls`, as the home counts them too).
  const standing = standingCalls(board.tasks, board.calls)
  const waiting = of('waiting').map((task) => ({ task, call: standing.find((call) => call.taskId === task.taskId) ?? null }))
  const folded = new Set(waiting.map(({ task }) => task.taskId))
  return {
    ...laid(
      of('running', 'stopped'),
      of('planned', 'held').toSorted((a, b) => (a.plan?.startsAt ?? '￿').localeCompare(b.plan?.startsAt ?? '￿')),
      null,
    ),
    waiting,
    calls: standing.filter((call) => call.taskId === null || !folded.has(call.taskId)),
    ready: readyOf(of('ready')),
    kept: of('kept').toSorted((a, b) => (b.keptAt ?? '').localeCompare(a.keptAt ?? '')),
    settled: of('settled').toSorted((a, b) => (b.settledAt ?? '').localeCompare(a.settledAt ?? '')),
    settledTotal: board.settledTotal,
  }
}

/** Where each task in Up next's waiting groups and Running stands now, to hold them there. */
export const heldOf = (lanes: Lanes): Held => {
  const groups: ReadonlyArray<readonly [Group, ReadonlyArray<BoardTask>]> = [
    ['continuing', lanes.next.slice(0, lanes.continuing)],
    ['line', lanes.next.slice(lanes.continuing, lanes.continuing + lanes.free)],
    ['paused', lanes.next.slice(lanes.continuing + lanes.free, lanes.continuing + lanes.free + lanes.paused)],
    ['running', lanes.running],
  ]
  return new Map(
    groups.flatMap(([group, tasks]) =>
      tasks.map((task, i) => [task.taskId, { group, at: group === 'continuing' || group === 'line' ? (task.place ?? i) : i }] as const),
    ),
  )
}

/** The lanes, with each task that would move between Up next and Running where it stood when they were held. */
export const holding = (lanes: Lanes, held: Held): Lanes => {
  const plans = plansOf(lanes)
  const tasks = [...lanes.next.filter((task) => !plans.includes(task)), ...lanes.running]
  return { ...lanes, ...laid(tasks, plans, held) }
}

/** How many cards are in Needs you: what waits on the person, each once. */
export const yoursOf = (lanes: Lanes) => lanes.waiting.length + lanes.calls.length + lanes.ready.length
