/*
 * What waits on the person, by kind, in the words every place uses for it
 * (docs/glossary.md). The same rules as the desktop's
 * (apps/desktop/src/renderer/shared/calls.ts), so the phone and the Mac
 * can't disagree on what needs you: keep the two in step.
 */

export const kindWords = {
  permission: 'Permission',
  stuck: 'Stuck',
  question: 'Question',
  limit: 'Out of usage',
  ready: 'Ready to accept',
  unshipped: 'Ready for a new pull request',
  drafted: 'Review drafted',
  finished: 'Finished',
} as const

type Reviewing = { readonly posted: unknown; readonly waiting?: boolean | undefined } | null | undefined

/** A review whose review was posted, written to again, that its lead answered drafting nothing to post. */
export const isAnswered = (reviewing: Reviewing): boolean => reviewing != null && reviewing.posted != null && reviewing.waiting === false

export const isUnshipped = (task: { readonly unshipped?: unknown; readonly change?: { readonly state: string } | null | undefined }): boolean =>
  task.unshipped != null && task.change?.state !== 'open'

/** The word for work that is ready: to accept, a review drafted, a plain task finished, or handed back (stuck). */
export const readyKindOf = (task: {
  readonly handedBack?: string | null | undefined
  readonly kind?: string | undefined
  readonly unshipped?: unknown
  readonly change?: { readonly state: string } | null | undefined
  readonly reviewing?: Reviewing
}): string =>
  task.kind === 'review' && !isAnswered(task.reviewing)
    ? kindWords.drafted
    : task.kind === 'plain' || task.kind === 'review'
      ? kindWords.finished
      : task.handedBack != null
        ? kindWords.stuck
        : isUnshipped(task)
          ? kindWords.unshipped
          : kindWords.ready

/** A call's kind, in its word. */
export const callKindOf = (call: { readonly kind: string; readonly stuck: { readonly why: string } | null }): string =>
  call.kind === 'question'
    ? kindWords.question
    : call.stuck === null
      ? kindWords.permission
      : call.stuck.why === 'usage_limit'
        ? kindWords.limit
        : kindWords.stuck

/** Every ready task waits on the person; one kept for later doesn't. */
export const needsYou = (task: { readonly phase: string }): boolean => task.phase === 'ready'

/**
 * The calls that stand for what waits on the person: a task that waits on
 * several shows its oldest, once; calls no waiting task holds stand alone.
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
