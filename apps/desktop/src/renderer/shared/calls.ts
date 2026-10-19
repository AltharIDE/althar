/*
 * What waits on the person, by kind, in the words every place uses for it:
 * the board's cards, the dock, the bar's preview and the home
 * (docs/glossary.md). One word a kind, so the same call never reads two ways.
 */

export const kindWords = {
  /** A call asking whether an agent may do something. */
  permission: 'Permission',
  /** A call for a step that can't go on without the person. */
  stuck: 'Stuck',
  /** A question an agent asks the person. */
  question: 'Question',
  /** A call for a step a usage limit stopped, which the person moves on or holds for the reset. */
  limit: 'Out of usage',
  /** Work done, waiting to be accepted. */
  ready: 'Ready to accept',
  /** Work done with commits after its last pull request, in none yet: a new pull request is the person's to open. */
  unshipped: 'Ready for a new pull request',
  /** A review of someone else's pull request, drafted, waiting to be posted. */
  drafted: 'Review drafted',
  /** A task that isn't a change, its lead done: the person settles it (Done) or keeps it for later. */
  finished: 'Finished',
} as const

/**
 * The word for work that is ready: ready to accept; a review, drafted; a
 * plain task, finished; or, where its lead couldn't resolve a conflict, or
 * fix the checks on the merge, and it is the person's now, stuck, as any step
 * that can't go on without them is.
 */
export const readyKindOf = (task: {
  readonly handedBack?: string | null | undefined
  readonly kind?: string | undefined
  readonly unshipped?: unknown
  readonly change?: { readonly state: string } | null | undefined
}): string =>
  task.kind === 'review'
    ? kindWords.drafted
    : task.kind === 'plain'
      ? kindWords.finished
      : task.handedBack != null
        ? kindWords.stuck
        : isUnshipped(task)
          ? kindWords.unshipped
          : kindWords.ready

/** Whether a task has commits after its last pull request merged or closed (or with none), and no pull request open to accept. */
export const isUnshipped = (task: {
  readonly unshipped?: unknown
  readonly change?: { readonly state: string } | null | undefined
}): boolean => task.unshipped != null && task.change?.state !== 'open'

/** A call's kind, in its word: an agent's question; out of usage or stuck if it is about a step; else a permission. */
export const callKindOf = (call: { readonly kind: string; readonly stuck: { readonly why: string } | null }): string =>
  call.kind === 'question'
    ? kindWords.question
    : call.stuck === null
      ? kindWords.permission
      : call.stuck.why === 'usage_limit'
        ? kindWords.limit
        : kindWords.stuck

/** Where a call waits, in words: its task, or the conversation with the coordinator, for a question the coordinator asks. */
export const whereOf = (call: { readonly taskTitle: string | null }): string => call.taskTitle ?? 'Coordinator'

/**
 * A plain task that finished (DEV-96): it waits in Needs you, as Finished,
 * counted as any work ready, until the person settles it (Done) or keeps it
 * for later. Opening it moves nothing.
 */
export const isFinished = (task: { readonly kind: string; readonly phase: string }): boolean =>
  task.kind === 'plain' && task.phase === 'ready'

/**
 * Whether a task is the person's to settle with Done or Keep for later: a
 * finished task that isn't a change, waiting in Needs you or kept for later.
 * A review only keeps: it settles as its draft is posted.
 */
export const isSettleable = (task: { readonly kind: string; readonly phase: string }): boolean =>
  task.kind !== 'change' && (task.phase === 'ready' || task.phase === 'kept')

/**
 * Whether a task waits on the person as work ready for them: a change to
 * accept (its checks passed or failed, with commits to push), commits after
 * its last pull request to open a new one for, a review drafted to post, a
 * task that isn't a change finished, or work its lead handed back: every
 * ready task. One the person kept for later is `kept`, not ready, so it is
 * out of it until they write to it again. The one rule for the board's
 * Needs you, the home's list, count and project lines, the edge of the
 * screen and the tabs, so they can't disagree on it. Calls are the other
 * half of what waits on them, and each of those does.
 */
export const needsYou = <T extends { readonly kind: string; readonly phase: string }>(task: T): boolean => task.phase === 'ready'

/** The tasks among these that wait on the person as work ready for them. */
export const readyOf = <T extends { readonly kind: string; readonly phase: string }>(tasks: ReadonlyArray<T>): ReadonlyArray<T> =>
  tasks.filter(needsYou)

/**
 * The calls that stand for what waits on the person: a task that waits on
 * several shows its oldest, once (answering it brings the next), and the
 * calls no waiting task holds each stand alone. The one rule for how calls
 * are counted, on the board's Needs you, the home, the edge and each
 * project's line, so a task with two calls is one thing everywhere.
 */
export const standingCalls = <C extends { readonly taskId: string | null; readonly createdAt: string }>(
  tasks: ReadonlyArray<{ readonly taskId: string; readonly phase: string }>,
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
