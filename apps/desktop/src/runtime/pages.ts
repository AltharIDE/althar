import { randomUUID } from 'node:crypto'

import type { PageAnswer, PageCall, PageDone } from '@althar/runtime/pageBridge'
import { Duration, Effect } from 'effect'

/*
 * What the lead and the coordinator ask of the page beside their
 * conversation, carried to the main process, where the page is
 * (packages/runtime, pageBridge.ts; main/browser/bridge.ts answers): `ask`
 * posts one to it over the utility process's own channel, which only the
 * main process holds the other end of, and waits; `answer` takes what it
 * sends back. Main gives up on a page itself well before this does: the
 * longest a call waits is a minute, and a page asleep may take a few seconds
 * to wake first.
 */

/** The message the runtime posts to the main process for a call on a page, or to say it gave up on one. */
export type PageAsked =
  | {
      readonly type: 'page'
      readonly requestId: string
      /** The session's own task or project, never the agent's say. */
      readonly owner: string
      readonly call: PageCall
    }
  /** The agent's call was stopped, or waited too long: main doesn't do what hasn't begun, and stops what has at its next step. */
  | { readonly type: 'page-cancel'; readonly requestId: string }

/** How long the main process is given to answer, in seconds: more than the longest wait and a page's waking and loading. */
export const WITHIN_SECONDS = 120

export const pagesWith = (post: (message: PageAsked) => void) => {
  const pending = new Map<string, (done: PageDone) => void>()

  const ask = (owner: string, call: PageCall) =>
    Effect.callback<PageAnswer, string>((resume) => {
      const requestId = randomUUID()
      pending.set(requestId, (done) =>
        resume(done.value === undefined ? Effect.fail(done.error ?? 'Althar couldn’t reach the page.') : Effect.succeed(done.value)),
      )
      post({ type: 'page', requestId, owner, call })
      // Interrupted (the agent stopped, or the wait ran out) before the answer came: main hears it, so the page isn't driven for nobody.
      return Effect.sync(() => {
        if (pending.delete(requestId)) post({ type: 'page-cancel', requestId })
      })
    }).pipe(
      Effect.timeoutOrElse({
        duration: Duration.seconds(WITHIN_SECONDS),
        orElse: () => Effect.fail('Althar’s window didn’t answer.'),
      }),
    )

  const answer = (requestId: string, done: PageDone) => {
    pending.get(requestId)?.(done)
    pending.delete(requestId)
  }

  return { ask, answer }
}
