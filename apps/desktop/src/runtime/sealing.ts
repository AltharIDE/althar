import { randomUUID } from 'node:crypto'

import { SecretsUnavailable } from '@althar/runtime'
import { Duration, Effect } from 'effect'

/**
 * What the main process answers to a seal or an open: the result, or why not.
 * Its marks, `keyring` (words.ts) and `unreadable` (a lost key), are why the
 * secret failed: the runtime must keep them, or a lost key reads as a keychain
 * that is away.
 */
export interface Sealed {
  readonly value?: string
  readonly error?: string
  readonly keyring?: boolean
  readonly unreadable?: boolean
}

/** The answer in a message from main, keeping only what it names. */
export const sealedOf = (data: Sealed): Sealed => ({
  ...(data.value === undefined ? {} : { value: data.value }),
  ...(data.error === undefined ? {} : { error: data.error }),
  ...(data.keyring === true ? { keyring: true } : {}),
  ...(data.unreadable === true ? { unreadable: true } : {}),
})

/** The sealed or opened value, or why not. */
export const resultOf = (answer: Sealed): Effect.Effect<string, SecretsUnavailable> =>
  answer.value === undefined
    ? Effect.fail(
        new SecretsUnavailable({
          reason: answer.error ?? 'Althar couldn’t open its keychain.',
          ...(answer.keyring === true ? { keyring: true } : {}),
          ...(answer.unreadable === true ? { unreadable: true } : {}),
        }),
      )
    : Effect.succeed(answer.value)

/**
 * Secrets the main process is sealing or opening, by request: `ask` posts one
 * to it, and `answer` takes what it sends back, whole, so that a refusal keeps
 * the marks that say why.
 */
export const sealingWith = (
  post: (message: { readonly type: 'seal' | 'open'; readonly requestId: string; readonly value: string }) => void,
) => {
  const pending = new Map<string, (answer: Sealed) => void>()

  /** Asks the main process to seal a secret, or open one; it alone holds the key. */
  const ask = (type: 'seal' | 'open', value: string) =>
    Effect.callback<string, SecretsUnavailable>((resume) => {
      const requestId = randomUUID()
      pending.set(requestId, (answer) => resume(resultOf(answer)))
      post({ type, requestId, value })
      return Effect.sync(() => void pending.delete(requestId))
    }).pipe(
      Effect.timeoutOrElse({
        duration: Duration.seconds(15),
        orElse: () => Effect.fail(new SecretsUnavailable({ reason: 'Althar’s keychain didn’t answer.' })),
      }),
    )

  const answer = (requestId: string, data: Sealed) => {
    pending.get(requestId)?.(sealedOf(data))
    pending.delete(requestId)
  }

  return { ask, answer }
}
