import { describe, expect, it } from 'vitest'

import { Secrets, words } from '@althar/runtime'
import { Effect } from 'effect'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { keyringUnavailable, sealFailure } from '../src/main/keyring'
import { resultOf, sealedOf, sealingWith } from '../src/runtime/sealing'

/*
 * A seal the main process refuses for want of a keyring (main.ts): the
 * runtime keeps the mark on the refusal, so the window shows main's words and
 * the seal isn't asked again.
 */

describe('a seal refused for want of a keyring', () => {
  it('reaches the window with the words to install one, and is asked of main once', async () => {
    const asked: Array<string> = []
    const sealing = sealingWith((message) => {
      asked.push(message.requestId)
      // What main sends on Linux with no safe backend.
      queueMicrotask(() => sealing.answer(message.requestId, { error: keyringUnavailable('linux'), keyring: true }))
    })
    const folder = join(mkdtempSync(join(tmpdir(), 'althar-sealing-')), 'secrets')
    const error = await Effect.runPromise(
      Effect.gen(function* () {
        const secrets = yield* Secrets
        return yield* Effect.flip(secrets.set('conn_1', 'x'))
      }).pipe(Effect.provide(Secrets.sealed(folder, { seal: (v) => sealing.ask('seal', v), open: (v) => sealing.ask('open', v) }))),
    )
    expect(error).toMatchObject({ _tag: 'SecretsUnavailable', keyring: true })
    expect(words(error, () => 'agent').message).toContain('install and start a keyring')
    expect(asked).toHaveLength(1)
  })

  it('without the mark is the generic sentence, as before', async () => {
    const sealing = sealingWith((message) => queueMicrotask(() => sealing.answer(message.requestId, { error: 'disk full' })))
    const error = await Effect.runPromise(Effect.flip(sealing.ask('seal', 'x')))
    expect(error.keyring).toBeUndefined()
    expect(words(error, () => 'agent').message).not.toContain('disk full')
  })
})

describe('what the runtime makes of main’s answer to a secret', () => {
  it('keeps a lost key as unreadable all the way from what safeStorage threw, so it is not read as a keychain that is away', async () => {
    // What main posts when decryptString throws, as the runtime receives it.
    const posted = { type: 'sealed', requestId: 'r', ...sealFailure('open', new Error('Error while decrypting the ciphertext.')) }
    const failure = await Effect.runPromise(Effect.flip(resultOf(sealedOf(posted))))
    expect(failure).toMatchObject({ _tag: 'SecretsUnavailable', reason: 'Error while decrypting the ciphertext.', unreadable: true })
    expect(failure.keyring).toBeUndefined()
  })

  it('keeps an unreadable mark through the request and its answer', async () => {
    const sealing = sealingWith((message) => queueMicrotask(() => sealing.answer(message.requestId, { error: 'lost', unreadable: true })))
    const failure = await Effect.runPromise(Effect.flip(sealing.ask('open', 'x')))
    expect(failure).toMatchObject({ reason: 'lost', unreadable: true })
  })

  it('gives the value of a secret sealed or opened, and a plain failure no mark', async () => {
    expect(await Effect.runPromise(resultOf(sealedOf({ value: 'abc' })))).toBe('abc')
    const failure = await Effect.runPromise(Effect.flip(resultOf(sealedOf({ error: 'Busy.' }))))
    expect(failure.unreadable).toBeUndefined()
    expect(failure.keyring).toBeUndefined()
  })
})
