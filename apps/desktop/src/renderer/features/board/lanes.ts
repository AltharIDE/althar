import {
  type BoardCall,
  type BoardSnapshot,
  type BoardTask,
  blockerAbandoned,
  type HomeSnapshot,
  isAside,
  waitingCount,
  waitingIn,
  waitingOn,
} from '@althar/contracts'

import { TaskStatus } from '@althar/ui'

import { asMerging } from '../../data/merges'
import { taskStatusOf } from '../../shared/taskStatus'

/*
 * Which lane of the board each task and call goes in (ADR-065). Up next:
 * what goes on by itself with no agent at work on it now, in the order it
 * will. First what waits for a free agent, in the one order Althar gives
 * places in: a task under way whose next turn waits, which continues, and a
 * task started that waits before any agent has worked on it, whatever its
 * kind (a change with a plan, a quick task, a review), the person's order
 * where they gave one, else what continues first; then a plan waiting to
 * start, on its countdown or held, which starts where the person moves it
 * among them; stopped work waits beside those plans with Resume; then work under way paused for a usage limit or the
 * connection, which waits for no agent's place but its own. Running: work an agent is on, or whose checks
 * Althar sees through. Needs you: a task that waits on a call of yours, once,
 * as one card that says the call; a call no task on the board waits on (the
 * coordinator's own question, or one for a task held up next); a task
 * that waits on issues its lead drafted, or changes to its issue, for the
 * person; and work ready for the person, a task that isn't a change and
 * finished among it until they settle it. Which task waits on the person,
 * and how, is `waitingOn`'s (in contracts), the one rule the home, the edge,
 * the tabs and the runtime's Dock badge count by too. Settled: what is done, most recent
 * first; and, behind a tab of its own beside it, what the person kept for
 * later, the latest kept first.
 *
 * A task only drafted, before its plan is proposed, is on neither lane: it
 * shows once its plan comes, as its card in the coordinator's thread does.
 */

/** A task that waits on the person, with the call it waits on: the oldest, where it has several. One whose call isn't read yet isn't among them. */
export interface Waiting {
  readonly task: BoardTask
  readonly call: BoardCall
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
type Group = 'continuing' | 'line' | 'paused' | 'running'

export interface Lanes {
  /**
   * Chats on Scratch (a task is a conversation plus parts, "Asides"): off the lanes, the latest first, unless a
   * call of theirs waits on the person, which Needs you shows.
   */
  readonly scratch: ReadonlyArray<BoardTask>
  /**
   * Up next in order: what waits for a free agent, what continues and the line in the one order places are given in; then
   * plans on their countdown, then those held; then what is paused.
   */
  readonly next: ReadonlyArray<BoardTask>
  /** How many of `next`'s first `continuing + free` continue when an agent is free. */
  readonly continuing: number
  /** How many of them start when an agent is free: the project's line. */
  readonly free: number
  /** How many of `next`, at its end, are paused for a usage limit or the connection. */
  readonly paused: number
  /** How many wait up next, as its head counts them. */
  readonly upNext: number
  /** The line is in an order the person gave it, not the oldest first. */
  readonly reordered: boolean
  /** Running's cards: what is under way. */
  readonly running: ReadonlyArray<BoardTask>
  /** How many have an agent on them, or checks Althar sees through: Running's count, which leaves out what waits. */
  readonly atWork: number
  /** Tasks that wait on a call of the person's, each once, with its call. */
  readonly waiting: ReadonlyArray<Waiting>
  /** Tasks that wait on nothing but issues their lead drafted, or changes to their issue, for the person to file or apply. */
  readonly issues: ReadonlyArray<BoardTask>
  /** Stopped tasks held Up next for Resume, the latest stopped first; outside Needs you. */
  readonly stopped: ReadonlyArray<BoardTask>
  /** Calls no task on the board waits on: the coordinator's questions, and a held plan's. */
  readonly calls: ReadonlyArray<BoardCall>
  /** Work ready for the person: the home lists these too. */
  readonly ready: ReadonlyArray<BoardTask>
  /** Plans that wait for a task that was abandoned (tasks wait for their blockers): out of Up next, the person's in Needs you. */
  readonly abandoned: ReadonlyArray<BoardTask>
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
  return task.phase === 'running' ? 'running' : null
}

/**
 * When a paused task can go on: a usage limit's reset, the soonest first; the connection, whenever it is back, after them;
 * last, one started Local that waits for its checkout, under a divider of its own (ADR-091).
 */
const backAt = (task: BoardTask) => `${task.waitsForCheckout == null ? 0 : 1}${task.waits?.until ?? '￿'}`

/** Up next follows admission order. Running and paused keep their own order. */
const laid = (tasks: ReadonlyArray<BoardTask>, plans: ReadonlyArray<BoardTask>) => {
  const groups: Record<Group, BoardTask[]> = { continuing: [], line: [], paused: [], running: [] }
  for (const task of tasks) {
    const group = groupOf(task)
    if (group !== null) groups[group].push(task)
  }
  const waiting = [...groups.continuing, ...groups.line].toSorted(
    (a, b) => (a.place ?? Infinity) - (b.place ?? Infinity) || a.createdAt.localeCompare(b.createdAt),
  )
  const paused = groups.paused.toSorted((a, b) => backAt(a).localeCompare(backAt(b)))
  return {
    next: [...waiting, ...plans, ...paused],
    continuing: groups.continuing.length,
    free: groups.line.length,
    paused: paused.length,
    upNext: waiting.length + paused.length + plans.length,
    reordered: waiting.some((task) => task.reordered === true),
    running: groups.running,
    atWork: groups.running.length,
  }
}

/** The lanes, with each ready task in `merging` at work, merging or in its merge queue, until it settles. */
export const lanesOf = (
  board: BoardSnapshot,
  merging: ReadonlySet<string> = new Set(),
  /** Of those, the tasks going into their merge queue, in it from just after the press. */
  queuing: ReadonlySet<string> = new Set(),
): Lanes => {
  const every = asMerging(board.tasks, merging, queuing)
  // A chat stays off the lanes, but for a call of its that waits on the person, and once it is settled.
  const scratch = every.filter(isAside)
  const tasks = every.filter((task) => !isAside(task))
  const of = (...phases: ReadonlyArray<BoardTask['phase']>) => tasks.filter((task) => phases.includes(task.phase))
  const waits = waitingOn(tasks, board.calls)
  const stopped = waits.stopped.toSorted((a, b) => (b.stopped?.at ?? '').localeCompare(a.stopped?.at ?? ''))
  const arranged = laid(
    // One whose call isn't read yet has nothing to say: it stays under way until it is.
    [...of('running'), ...waits.unread.map((task) => ({ ...task, phase: 'running' as const }))],
    of('planned', 'held')
      .filter((task) => !blockerAbandoned(task))
      .toSorted((a, b) => (a.plan?.startsAt ?? '￿').localeCompare(b.plan?.startsAt ?? '￿')),
  )
  return {
    // By their latest exchange, the latest first; one with nothing said yet, by when it began.
    scratch: scratch.toSorted((a, b) => (b.latest?.at ?? b.createdAt).localeCompare(a.latest?.at ?? a.createdAt)),
    ...arranged,
    upNext: arranged.upNext + stopped.length,
    waiting: waits.waiting,
    issues: waits.issues,
    stopped,
    calls: waits.calls,
    ready: waits.ready,
    abandoned: waits.abandoned,
    kept: of('kept').toSorted((a, b) => (b.keptAt ?? '').localeCompare(a.keptAt ?? '')),
    settled: of('settled').toSorted((a, b) => (b.settledAt ?? '').localeCompare(a.settledAt ?? '')),
    settledTotal: board.settledTotal,
  }
}

/** The orders Running can be in, as the person picks one: the oldest first, as the board has it, or by where each stands. */
export type RunningOrder = 'oldest' | 'status'

/** Where a card in Running stands, as it says it, at work first: waiting on something outside, paused, waiting for an agent, stopped. */
const standingRank = (task: BoardTask): number => {
  const status = taskStatusOf(task)
  if (status === TaskStatus.Running) return task.externalWait === undefined ? 0 : 1
  return STATUS_RANK[status]
}

const STATUS_RANK: Record<TaskStatus, number> = {
  [TaskStatus.Running]: 0,
  [TaskStatus.Paused]: 2,
  [TaskStatus.Queued]: 3,
  [TaskStatus.Stopped]: 4,
  [TaskStatus.Yours]: 5,
  [TaskStatus.Done]: 6,
}

/** Running's cards in the order the person picked; by status, each keeps its place among those that stand as it does. */
export const runningIn = (running: ReadonlyArray<BoardTask>, order: RunningOrder): ReadonlyArray<BoardTask> =>
  order === 'oldest' ? running : running.toSorted((a, b) => standingRank(a) - standingRank(b))

/** How many cards are in Needs you: what waits on the person, each once. */
export const yoursOf = (lanes: Lanes) => waitingCount(lanes)

/**
 * What waits on the person in each project, as its board counts it: the same
 * lanes, over the home's tasks and calls, which are the same cards. A
 * project's dot, the switcher and Elsewhere take it, so none of them lights
 * where a board's Needs you is empty, or stays dark where it isn't.
 */
export const yoursByProject = (home: HomeSnapshot, merging: ReadonlySet<string> = new Set()): ReadonlyMap<string, number> =>
  waitingIn(home.tasks, home.calls, merging)

/**
 * The moves the runtime is asked for, in turn, as the person puts a row of Up next at `to`, from 0, among the others: what
 * waits for a place first, then the plans. Every row above one that waits waits too, so a plan left above a row put below it
 * starts, at its place, the row going first to its place among what waits and each such plan then before it, top down. A plan
 * put among what waits, or at the head of the plans, starts there; one put further down among the plans moves nothing: they
 * stand by when they start, and hold no place until then.
 */
export const movesInLine = (
  waiting: ReadonlyArray<string>,
  plans: ReadonlyArray<string>,
  id: string,
  to: number,
): ReadonlyArray<readonly [string, number]> => {
  const others = [...waiting, ...plans].filter((one) => one !== id)
  const at = Math.max(0, Math.min(others.length, Math.floor(to)))
  const waits = new Set(waiting.filter((one) => one !== id))
  if (!waiting.includes(id)) return at <= waits.size ? [[id, at]] : []
  const order = [...others.slice(0, at), id, ...others.slice(at)]
  const starting = order.slice(0, at).filter((one) => !waits.has(one))
  if (starting.length === 0) return [[id, at]]
  // Its place among what waits now, then each plan above it at its own, counting what waits and what started before it.
  const lined = new Set(waits)
  const moves: Array<readonly [string, number]> = [[id, order.slice(0, at).filter((one) => waits.has(one)).length]]
  lined.add(id)
  for (const plan of starting) {
    moves.push([plan, order.slice(0, order.indexOf(plan)).filter((one) => lined.has(one) && one !== id).length])
    lined.add(plan)
  }
  return moves
}
