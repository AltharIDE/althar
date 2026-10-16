import { SecretsUnavailable } from '@althar/runtime'
import { Effect } from 'effect'

/*
 * What the main process answers when the runtime asks it to seal or open a
 * secret (main.ts, keyring.ts), and what the runtime makes of the answer.
 * Its marks, `keyring` and `unreadable`, are why the secret failed: the
 * runtime must keep them, or a lost key reads as a keychain that is away.
 */

/** An answer, as the runtime holds it. */
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
