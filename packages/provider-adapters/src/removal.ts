import { rm } from 'node:fs/promises'

import { Effect, Schema } from 'effect'

/*
 * Removing files and folders, for the runtime and the agent adapters alike (ARCHITECTURE.md, Failures and
 * diagnostics). A folder can still be held a moment after the process that ran in it has gone: Windows keeps one busy
 * while the process's tree goes, or a scanner reads what was just written. So each removal is tried again over a second
 * and a half or so (Node's own `maxRetries`, waiting longer each time), without blocking while it waits.
 *
 * Removing what was there only for a while, after the work it was for, is best effort (`cleanUp`): it never fails, so
 * it never loses what the work found, and one that stays is logged and left. A removal that is the work itself, such
 * as a finished task's folder, says when it couldn't (`removeFully`). `lint/removal.js` keeps every removal in `src` to
 * these two.
 */

/** Something of what was removed is still there. */
export class RemoveFailed extends Schema.TaggedError<RemoveFailed>()('RemoveFailed', {
  path: Schema.String,
  reason: Schema.String,
}) {}

/** Tried again five times, 100 ms longer each time, where the system says the path is busy or not yet empty. */
const AGAIN = { recursive: true, force: true, maxRetries: 5 } as const

/** Removes a file, a link (never what it points at) or a folder with all in it; nothing there is removed already. Fails where any of it stays. */
export const removeFully = (path: string): Effect.Effect<void, RemoveFailed> =>
  Effect.tryPromise({ try: () => rm(path, AGAIN), catch: (error) => new RemoveFailed({ path, reason: String(error) }) })

/**
 * Removes what was there only for a while, `what` saying what it was for (`where an agent was asked its models`). It
 * never fails: one that stays is logged as a warning and left, and the work it followed stands.
 */
export const cleanUp = (path: string, what: string): Effect.Effect<void> =>
  removeFully(path).pipe(Effect.catch((failed) => Effect.logWarning(`Could not remove ${path}, ${what}; it is left there`, failed.reason)))
