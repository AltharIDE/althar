import { randomUUID } from 'node:crypto'

import type { Screenshot, Shot } from '@althar/runtime'
import { Duration, Effect } from 'effect'

/** What the main process answers to a screenshot: the picture, or why not, in words for the agent. */
export interface Taken {
  readonly value?: Screenshot
  readonly error?: string
}

/**
 * Screenshots the main process takes for the runtime, by request
 * (main/screenshots.ts): `ask` posts one to it and waits, `answer` takes
 * what it sends back. Main gives up on a page itself well before this does.
 */
export const screenshotsWith = (
  post: (message: { readonly type: 'screenshot'; readonly requestId: string; readonly shot: Shot }) => void,
) => {
  const pending = new Map<string, (answer: Taken) => void>()

  const ask = (shot: Shot) =>
    Effect.callback<Screenshot, string>((resume) => {
      const requestId = randomUUID()
      pending.set(requestId, (answer) =>
        resume(answer.value === undefined ? Effect.fail(answer.error ?? 'Althar couldn’t draw the page.') : Effect.succeed(answer.value)),
      )
      post({ type: 'screenshot', requestId, shot })
      return Effect.sync(() => void pending.delete(requestId))
    }).pipe(
      Effect.timeoutOrElse({
        duration: Duration.seconds(60),
        orElse: () => Effect.fail('Althar’s window for screenshots didn’t answer.'),
      }),
    )

  const answer = (requestId: string, taken: Taken) => {
    pending.get(requestId)?.(taken)
    pending.delete(requestId)
  }

  return { ask, answer }
}
