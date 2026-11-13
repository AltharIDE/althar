/**
 * Where a new message from the person lands: taken as the next turn, or
 * waiting behind work already claimed. The runtime's `Sessions.placement`
 * and the window's optimistic send both use this, so a mid-turn message is
 * drawn where it will stay.
 *
 * What the person says takes a place at once when a session holds the
 * thread (Busy, order `person`), so a wait for an agent slot queues only a
 * thread with no session to take it: one still to start, or one between
 * sessions. Everything else is work already under way on the thread.
 */
export type Accepting = 'now' | 'queued'

/** Work on a thread that keeps the next message waiting its turn. */
export const acceptingOf = (work: {
  readonly turnRunning: boolean
  readonly handingOver: boolean
  readonly nextLead: boolean
  readonly moved: boolean
  readonly starting: boolean
  readonly claimed: boolean
  readonly compactQueued: boolean
  /** No session holds the thread, and it waits for a place or for its agent's usage. */
  readonly waitingForPlace: boolean
}): Accepting =>
  work.turnRunning ||
  work.handingOver ||
  work.nextLead ||
  work.moved ||
  work.starting ||
  work.claimed ||
  work.compactQueued ||
  work.waitingForPlace
    ? 'queued'
    : 'now'
