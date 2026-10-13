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
} as const

/**
 * The word for work that is ready: ready to accept; or, where its lead couldn't
 * resolve a conflict, or fix the checks on the merge, and it is the person's
 * now, stuck, as any step that can't go on without them is.
 */
export const readyKindOf = (task: { readonly handedBack?: string | null | undefined }): string =>
  task.handedBack == null ? kindWords.ready : kindWords.stuck

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
