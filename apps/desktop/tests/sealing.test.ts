import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { sealFailure } from '../src/main/keyring'
import { resultOf, sealedOf } from '../src/runtime/sealing'

describe('what the runtime makes of main’s answer to a secret', () => {
  it('keeps a lost key as unreadable all the way from what safeStorage threw, so it is not read as a keychain that is away', async () => {
    // What main posts when decryptString throws, as the runtime receives it.
    const posted = { type: 'sealed', requestId: 'r', ...sealFailure('open', new Error('Error while decrypting the ciphertext.')) }
    const failure = await Effect.runPromise(Effect.flip(resultOf(sealedOf(posted))))
    expect(failure).toMatchObject({ _tag: 'SecretsUnavailable', reason: 'Error while decrypting the ciphertext.', unreadable: true })
    expect(failure.keyring).toBeUndefined()
  })

  it('keeps main’s refusal for want of a keyring, which it used to drop', async () => {
    const posted = { type: 'sealed', requestId: 'r', error: 'Install and start a keyring.', keyring: true }
    const failure = await Effect.runPromise(Effect.flip(resultOf(sealedOf(posted))))
    expect(failure).toMatchObject({ reason: 'Install and start a keyring.', keyring: true })
    expect(failure.unreadable).toBeUndefined()
  })

  it('gives the value of a secret sealed or opened, and a plain failure no mark', async () => {
    expect(await Effect.runPromise(resultOf(sealedOf({ value: 'abc' })))).toBe('abc')
    const failure = await Effect.runPromise(Effect.flip(resultOf(sealedOf({ error: 'Busy.' }))))
    expect(failure.unreadable).toBeUndefined()
    expect(failure.keyring).toBeUndefined()
  })
})
