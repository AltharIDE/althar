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
  /** Work done, waiting to be accepted. */
  ready: 'Ready to accept',
} as const

/** A call's kind, in its word: an agent's question, a step that is stuck, else a permission. */
export const callKindOf = (call: { readonly kind: string; readonly stuck: unknown }): string =>
  call.kind === 'question' ? kindWords.question : call.stuck === null ? kindWords.permission : kindWords.stuck
