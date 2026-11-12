import type { ChangeSummary, TaskPhase } from './Api'
import { isBlocked, pushResolves, standingOf } from './standing'

/*
 * What waits on the person, the one rule every place counts and says it by:
 * the board's Needs you and its tabs, the home, the edge of the screen, the
 * bar's preview, a task's header, and the runtime's Dock badge, menu bar
 * count and notifications. A task's card says where it stands (its phase);
 * from its cards and the calls that wait, `waitingOn` places each task, and
 * `readyWordOf` says a ready one in a word. Asides, chats on Scratch, are
 * off it but for a call of theirs.
 */

/** What waits on the person, by kind, in the words every place uses for it (docs/glossary.md): one word a kind. */
export const kindWords = {
  /** A call asking whether an agent may do something. */
  permission: 'Permission',
  /** A call for a step that can't go on without the person. */
  stuck: 'Stuck',
  /** A lead that ended its turn to wait for the person's answer. */
  waiting: 'Waiting on you',
  /** A question an agent asks the person. */
  question: 'Question',
  /** What Althar asks before a Local task takes the person's checkout (ADR-091). */
  checkout: 'Local',
  /** A call for a step a usage limit stopped, which the person moves on or holds for the reset. */
  limit: 'Out of usage',
  /** Work done, waiting to be accepted. */
  ready: 'Ready to accept',
  /** A change its lead finished with nothing on its branch and no pull request: nothing to accept; the person settles it, answers, or discards it. */
  nothingBuilt: 'Nothing built',
  /** Work done with commits after its last pull request, in none yet: a new pull request is the person's to open. */
  unshipped: 'Ready for a new pull request',
  /** A review of someone else's pull request, drafted, waiting to be posted. */
  drafted: 'Review drafted',
  /** A task that isn't a change, its lead done: the person settles it (Done) or keeps it for later. */
  finished: 'Finished',
  /** What the person's turns with its lead committed waits on its branch for Ship (a task is a conversation plus parts). */
  notShipped: 'Not shipped',
  /** Its lead answered the person, who hasn't read it yet: it waits in Needs you until they open it. */
  replied: 'Replied',
  /** A task whose lead stopped with no agent on it: it waits for the person to carry on or abandon it. */
  stopped: 'Stopped',
  /** Issues its lead drafted, for the person to file. */
  issues: 'Issues to file',
  /** Changes its lead proposed to its issue, for the person to apply. */
  issueChanges: 'Issue changes to apply',
} as const

/** What a task's lead left for the person on a tracker, in a word: issues to file first, else changes to its issue. */
export const issuesWordOf = (issues: { readonly drafts: number; readonly changes: number } | undefined): string =>
  (issues?.drafts ?? 0) > 0 ? kindWords.issues : kindWords.issueChanges

/** A ready change's word, where it isn't plainly ready to accept. */
export const readyText = {
  /** A conflict its lead couldn't resolve, or that wasn't asked of it, or the checks on the merge it couldn't fix: the person's now. */
  mergeConflict: 'Merge conflict',
  /** A pull request with a conflict or a failed check in its way: not yet ready to accept. */
  blocked: 'Not ready to accept',
  /** A conflict the commits waiting to be pushed resolve: ready once the person pushes them. */
  readyOnPush: 'Ready once pushed',
  /** Its checks still run: not ready to accept until they pass, whichever pull request they are on. */
  checksRunning: 'Checks running',
}

/** What a review after a merge found, in a word: how many. */
export const foundWords = (n: number) => `Review found ${n}`

/** What a review task's card knows of its review: whether it was posted, and whether a draft waits since. */
export type Reviewing = { readonly posted: unknown; readonly waiting?: boolean | undefined } | null | undefined

/**
 * A review whose review was posted, written to again, that its lead answered
 * drafting nothing to post: finished, as a quick task is (ADR-051).
 */
export const isAnswered = (reviewing: Reviewing): boolean => reviewing != null && reviewing.posted != null && reviewing.waiting === false

/** Whether a task has commits after its last pull request merged or closed (or with none), and no pull request open to accept. */
export const isUnshipped = (task: {
  readonly unshipped?: unknown
  readonly change?: { readonly state: string } | null | undefined
}): boolean => task.unshipped != null && task.change?.state !== 'open'

/** What of a ready task its word is read from: the card's own fields, `change` the pull request it shows. */
export interface ReadyTask {
  readonly kind?: string | undefined
  readonly change?: ChangeSummary | null | undefined
  readonly reviewing?: Reviewing
  readonly handedBack?: string | null | undefined
  readonly conflictUnsent?: string | null | undefined
  readonly unshipped?: unknown
  readonly nothingBuilt?: boolean | undefined
  readonly held?: unknown
  readonly replied?: string | undefined
  readonly afterMerge?: { readonly state: string; readonly findings: number } | undefined
}

/**
 * A ready task in a word, as its card, its header, the home, the edge, the
 * bar and a notification all say it. What a review after a merge found
 * comes first; then a review drafted; what waits for Ship; a task that isn't
 * a change, finished. A change: its lead's answer, unread, where no open pull
 * request says more; a conflict that is the person's (its lead couldn't
 * resolve it, or wasn't asked); nothing built; commits for a new pull
 * request; its open pull request with something in its way, or what a push
 * puts right, or checks still running; else ready to accept.
 */
export const readyWordOf = (task: ReadyTask): string => {
  if (task.afterMerge?.state === 'found') return foundWords(task.afterMerge.findings)
  if (task.kind === 'review' && !isAnswered(task.reviewing)) return kindWords.drafted
  if (task.held !== undefined) return kindWords.notShipped
  if (task.kind === 'plain' || task.kind === 'review') return kindWords.finished
  const latest = task.change ?? null
  const change = task.unshipped == null || latest?.state === 'open' ? latest : null
  if (task.replied !== undefined && latest?.state !== 'open' && task.unshipped == null) return kindWords.replied
  if (task.handedBack != null || task.conflictUnsent != null) return readyText.mergeConflict
  if (task.nothingBuilt === true) return kindWords.nothingBuilt
  if (change === null && task.unshipped != null) return kindWords.unshipped
  if (change?.state !== 'open') return kindWords.ready
  const standing = standingOf(change)
  if (isBlocked(standing)) return readyText.blocked
  if (pushResolves(standing)) return readyText.readyOnPush
  // The open pull request's checks run, as a next one's do after the first merged: they say it, not "Ready to accept".
  if (standing.blockers.some((one) => one.kind === 'running')) return readyText.checksRunning
  return kindWords.ready
}

/** The pull request a task's card shows, out of all of them: the first still open, else the latest. */
export const shownChangeOf = <C extends { readonly state: string }>(changes: ReadonlyArray<C>): C | null =>
  changes.find((change) => change.state === 'open') ?? changes.at(-1) ?? null

/** Whether every pull request of these still open is in its merge queue: its host merges them, and none is the person's meanwhile. */
export const inMergeQueue = (changes: ReadonlyArray<Pick<ChangeSummary, 'state' | 'queued'>>): boolean => {
  const open = changes.filter((change) => change.state === 'open')
  return open.length > 0 && open.every((change) => change.queued === true)
}

/**
 * Whether the pull request a task's card shows, out of all of them, is in its merge queue, as the board, the home, its
 * header and its change card all say it: another of its, in another repository, may wait for that one to land.
 */
export const shownQueued = (changes: ReadonlyArray<Pick<ChangeSummary, 'state' | 'queued'>>): boolean => {
  const shown = shownChangeOf(changes)
  return shown !== null && inMergeQueue([shown])
}

/**
 * Whether a ready task is in its merge queue: the pull request its card shows
 * is queued, and another of its, in another repository, waits for that one
 * to land. Its host is at work on it, not the person, until it lands or the
 * queue takes it out.
 */
export const queuedToMerge = (task: {
  readonly phase: string | null
  readonly change: Pick<ChangeSummary, 'state' | 'queued'> | null
}): boolean => task.phase === 'ready' && task.change !== null && inMergeQueue([task.change])

/** What of a task's card placing it reads. */
export interface Placed {
  readonly taskId: string
  readonly phase: TaskPhase | null
  readonly change: Pick<ChangeSummary, 'state' | 'queued'> | null
  readonly scratch?: boolean | undefined
  /** Issues its lead drafted, and changes it proposed to its issue, waiting for the person. */
  readonly issues?: { readonly drafts: number; readonly changes: number } | undefined
}

/** What of a call placing it reads. */
export interface Asked {
  readonly id: string
  readonly taskId: string | null
  readonly createdAt: string
}

/** An aside, a chat on Scratch: off the board's lanes and every count, but for a call of its that waits, and once it is settled. */
export const isAside = (task: Pick<Placed, 'scratch' | 'phase'>): boolean =>
  task.scratch === true && task.phase !== 'waiting' && task.phase !== 'settled'

/**
 * The calls that stand for what waits on the person: a task that waits on
 * several shows its oldest, once (answering it brings the next), and the
 * calls no waiting task holds each stand alone. So a task with two calls is
 * one thing everywhere.
 */
export const standingCalls = <C extends Asked>(
  tasks: ReadonlyArray<{ readonly taskId: string; readonly phase: string | null }>,
  calls: ReadonlyArray<C>,
): ReadonlyArray<C> => {
  const waiting = new Set(tasks.filter((task) => task.phase === 'waiting').map((task) => task.taskId))
  const oldest = new Map<string, C>()
  for (const call of calls) {
    if (call.taskId === null || !waiting.has(call.taskId)) continue
    const held = oldest.get(call.taskId)
    if (held === undefined || call.createdAt < held.createdAt) oldest.set(call.taskId, call)
  }
  return calls.filter((call) => call.taskId === null || !waiting.has(call.taskId) || oldest.get(call.taskId) === call)
}

/** Where what waits on the person stands, each thing once. */
export interface WaitingOn<T, C> {
  /** Tasks that wait on a call of the person's, with the call that stands for them: its oldest. */
  readonly waiting: ReadonlyArray<{ readonly task: T; readonly call: C }>
  /** Tasks that wait on nothing but issues their lead drafted, or changes it proposed to their issue, for the person. */
  readonly issues: ReadonlyArray<T>
  /** Calls no waiting task holds: the coordinator's questions, a held plan's. */
  readonly calls: ReadonlyArray<C>
  /** Tasks whose lead stopped with no agent on them, for the person to carry on or abandon. */
  readonly stopped: ReadonlyArray<T>
  /** Work ready for the person: every ready task, but one its host is merging. */
  readonly ready: ReadonlyArray<T>
  /** Tasks said to wait whose call isn't read yet: under way until it is, never in Needs you for a moment (DEV-173). */
  readonly unread: ReadonlyArray<T>
}

/**
 * Where each task waits on the person, if it does, from its card and the
 * calls that wait: on a call (its oldest standing for it), on issues to file
 * or apply, stopped, or ready; an aside off all of it. `merging`: tasks the
 * person is merging, at work until they settle, as one in its merge queue.
 */
export const waitingOn = <T extends Placed, C extends Asked>(
  tasks: ReadonlyArray<T>,
  calls: ReadonlyArray<C>,
  merging: ReadonlySet<string> = new Set(),
): WaitingOn<T, C> => {
  const shown = tasks.filter((task) => !isAside(task))
  const standing = standingCalls(shown, calls)
  const held = new Map(standing.flatMap((call) => (call.taskId === null ? [] : [[call.taskId, call] as const])))
  const waits = shown.filter((task) => task.phase === 'waiting')
  const waiting = waits.flatMap((task) => {
    const call = held.get(task.taskId)
    return call === undefined ? [] : [{ task, call }]
  })
  const asked = (task: T) => (task.issues?.drafts ?? 0) + (task.issues?.changes ?? 0) > 0
  const issues = waits.filter((task) => !held.has(task.taskId) && asked(task))
  const folded = new Set(waits.map((task) => task.taskId))
  return {
    waiting,
    issues,
    calls: standing.filter((call) => call.taskId === null || !folded.has(call.taskId)),
    stopped: shown.filter((task) => task.phase === 'stopped'),
    ready: shown.filter((task) => task.phase === 'ready' && !queuedToMerge(task) && !merging.has(task.taskId)),
    unread: waits.filter((task) => !held.has(task.taskId) && !asked(task)),
  }
}

/** How many things wait on the person, each once: what the board's Needs you, its tab, the home, the edge and the Dock count. */
export const waitingCount = (on: Omit<WaitingOn<unknown, unknown>, 'unread'>): number =>
  on.waiting.length + on.issues.length + on.calls.length + on.stopped.length + on.ready.length

/**
 * How many things wait on the person in each project, by its id, as its board counts them: a project's dot, its tab, its
 * row on the home and the tabs a window opens with all take it, so none lights where a board's Needs you is empty.
 */
export const waitingIn = <T extends Placed & { readonly projectId: string }, C extends Asked & { readonly projectId: string }>(
  tasks: ReadonlyArray<T>,
  calls: ReadonlyArray<C>,
  merging: ReadonlySet<string> = new Set(),
): ReadonlyMap<string, number> => {
  const projects = new Map<string, { readonly tasks: Array<T>; readonly calls: Array<C> }>()
  const place = (projectId: string) => {
    const found = projects.get(projectId) ?? { tasks: [], calls: [] }
    projects.set(projectId, found)
    return found
  }
  for (const task of tasks) place(task.projectId).tasks.push(task)
  for (const call of calls) place(call.projectId).calls.push(call)
  return new Map([...projects].map(([projectId, one]) => [projectId, waitingCount(waitingOn(one.tasks, one.calls, merging))]))
}
