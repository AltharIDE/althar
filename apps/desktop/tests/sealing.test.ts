import { describe, expect, it } from 'vitest'

import { Secrets, words } from '@althar/runtime'
import { Effect } from 'effect'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { keyringUnavailable } from '../src/main/keyring'
import { sealingWith } from '../src/runtime/sealing'

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
