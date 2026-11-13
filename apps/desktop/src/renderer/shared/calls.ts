import { kindWords, type Reviewing, isAnswered } from '@althar/contracts'

/*
 * What waits on the person, by kind, in the words every place uses for it:
 * the board's cards, the dock, the bar's preview and the home
 * (docs/glossary.md). One word a kind (`kindWords`, in contracts, which the
 * runtime's notifications say too), so the same call never reads two ways.
 */

export { isAnswered, isUnshipped, kindWords } from '@althar/contracts'

/** A call's kind, in its word: an agent's question; out of usage or stuck if it is about a step; else a permission. */
export const callKindOf = (call: { readonly kind: string; readonly stuck: { readonly why: string } | null }): string =>
  call.kind === 'question'
    ? kindWords.question
    : call.kind === 'checkout'
      ? kindWords.checkout
      : call.stuck === null
        ? kindWords.permission
        : call.stuck.why === 'usage_limit'
          ? kindWords.limit
          : call.stuck.why === 'waiting_on_person'
            ? kindWords.waiting
            : kindWords.stuck

/** Where a call waits, in words: its task, or the conversation with the coordinator, for a question the coordinator asks. */
export const whereOf = (call: { readonly taskTitle: string | null }): string => call.taskTitle ?? 'Coordinator'

/**
 * A plain task that finished (DEV-96), or a review answered: it waits in
 * Needs you, as Finished, counted as any work ready, until the person
 * settles it (Done) or keeps it for later. Opening it moves nothing.
 */
export const isFinished = (task: { readonly kind: string; readonly phase: string; readonly reviewing?: Reviewing }): boolean =>
  (task.kind === 'plain' || (task.kind === 'review' && isAnswered(task.reviewing))) && task.phase === 'ready'

/**
 * Whether a task is the person's to settle with Done or Keep for later: a
 * finished task that isn't a change, or a change that built nothing (Done
 * only), waiting in Needs you or kept for later. A review with a draft only
 * keeps: it settles as its draft is posted.
 */
export const isSettleable = (task: {
  readonly kind: string
  readonly phase: string
  readonly nothingBuilt?: boolean | undefined
}): boolean =>
  (task.kind !== 'change' || (task.nothingBuilt === true && task.phase === 'ready')) && (task.phase === 'ready' || task.phase === 'kept')

/**
 * What a finished lead's report leaves to the person, in a line: the last line of it that asks, else its last line. Null where
 * it said nothing. Bullets and numbers its options come in are dropped.
 */
export const askOf = (summary: string | null | undefined): string | null => {
  const lines = (summary ?? '')
    .split('\n')
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim())
    .filter((line) => line !== '')
  return lines.findLast((line) => line.endsWith('?')) ?? lines.at(-1) ?? null
}

/** Whether a settleable task takes Done: a plain one, a change that built nothing, or a review answered; a review with a draft settles as it is posted. */
export const takesDone = (task: {
  readonly kind: string
  readonly reviewing?: Reviewing
  readonly nothingBuilt?: boolean | undefined
}): boolean => task.kind === 'plain' || task.nothingBuilt === true || (task.kind === 'review' && isAnswered(task.reviewing))
