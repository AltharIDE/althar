import { randomUUID } from 'node:crypto'

import { SecretsUnavailable } from '@althar/runtime'
import { Duration, Effect } from 'effect'

/** What the main process answers to a seal or an open: the result, or why not, and whether the why is its keyring refusal (words.ts). */
export interface Sealed {
  readonly value?: string
  readonly error?: string
  readonly keyring?: boolean
}

/**
 * Secrets the main process is sealing or opening, by request: `ask` posts one
 * to it, and `answer` takes what it sends back, whole, so that a refusal keeps
 * the mark that says it is the keyring's.
 */
export const sealingWith = (
  post: (message: { readonly type: 'seal' | 'open'; readonly requestId: string; readonly value: string }) => void,
) => {
  const pending = new Map<string, (answer: Sealed) => void>()

  /** Asks the main process to seal a secret, or open one; it alone holds the key. */
  const ask = (type: 'seal' | 'open', value: string) =>
    Effect.callback<string, SecretsUnavailable>((resume) => {
      const requestId = randomUUID()
      pending.set(requestId, (answer) =>
        resume(
          answer.value === undefined
            ? Effect.fail(
                new SecretsUnavailable({
                  reason: answer.error ?? 'Althar couldn’t open its keychain.',
                  ...(answer.keyring === true ? { keyring: true } : {}),
                }),
              )
            : Effect.succeed(answer.value),
        ),
      )
      post({ type, requestId, value })
      return Effect.sync(() => void pending.delete(requestId))
    }).pipe(
      Effect.timeoutOrElse({
        duration: Duration.seconds(15),
        orElse: () => Effect.fail(new SecretsUnavailable({ reason: 'Althar’s keychain didn’t answer.' })),
      }),
    )

  const answer = (requestId: string, data: Sealed) => {
    pending.get(requestId)?.({
      ...(data.value === undefined ? {} : { value: data.value }),
      ...(data.error === undefined ? {} : { error: data.error }),
      ...(data.keyring === true ? { keyring: true } : {}),
    })
    pending.delete(requestId)
  }

  return { ask, answer }
}
