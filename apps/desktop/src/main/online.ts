/*
 * Whether the computer is online, for the runtime (ADR-059): Electron's own
 * reading of the network, `net.isOnline()`, said once as the runtime starts
 * and whenever it changes. Electron gives the main process no event for it,
 * so it is read every couple of seconds, which costs nothing: it asks the
 * system, not the network.
 */

/** How often it is read. */
const EVERY = 2_000

/** Says whether the computer is online now and on each change; stop it with what it returns. */
export const watchOnline = (isOnline: () => boolean, tell: (online: boolean) => void, every = EVERY): (() => void) => {
  let last = isOnline()
  tell(last)
  const timer = setInterval(() => {
    const now = isOnline()
    if (now === last) return
    last = now
    tell(now)
  }, every)
  timer.unref()
  return () => clearInterval(timer)
}
