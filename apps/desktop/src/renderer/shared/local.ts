import type { CheckoutWait } from '@althar/contracts'

/*
 * How a task working Local is said (ADR-086): in the person's own checkout,
 * one task at a time, rather than in a worktree of its own.
 */
export const localText = {
  /** Up next, what it waits for, in place of its place in line. */
  after: (wait: CheckoutWait) => (wait.why === 'taken' ? `After ${wait.by.title}` : `Once ${wait.repository}’s changes are committed`),
  /** On a card or in the header, what it waits for. */
  waits: (wait: CheckoutWait) =>
    wait.why === 'taken' ? `Waits for Local: ${wait.by.title} is there` : `Waits until ${wait.repository}’s changes are committed`,
  /** Its word, as a waiting card says it. */
  word: 'Waits for Local',
}
