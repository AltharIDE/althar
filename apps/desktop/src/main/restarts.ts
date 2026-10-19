/** Restarts allowed within a minute before a crashing runtime ends the app instead. */
export const RESTARTS_PER_MINUTE = 3

export interface Exited {
  /** Althar is quitting: the runtime was asked to stop. */
  readonly quitting: boolean
  /** The runtime stopped itself on a store it can't serve (an update that couldn't move it, a profile in use): starting it again would say the same. */
  readonly stopped: boolean
  /** The person asked to try again: the runtime was stopped to start a new one. */
  readonly retrying: boolean
  /** When the runtime's restarts were, in ms, before this exit. */
  readonly restarts: ReadonlyArray<number>
  readonly now: number
}

/**
 * What the main process does when the runtime has exited: nothing (quitting,
 * or a store it can't serve, which the window says), start it (a crash is
 * survivable, or the person tried again), or give up after too many crashes.
 */
export const afterExit = ({ quitting, stopped, retrying, restarts, now }: Exited) => {
  if (quitting) return { next: 'stay' as const, restarts }
  if (retrying) return { next: 'start' as const, restarts }
  if (stopped) return { next: 'stay' as const, restarts }
  const recent = [...restarts.filter((at) => at >= now - 60_000), now]
  return { next: recent.length <= RESTARTS_PER_MINUTE ? ('start' as const) : ('give-up' as const), restarts: recent }
}
