import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Account } from '../src/Accounts'
import { causeGone, causeKnown, causeOf, codexHomeOf, localFoundIn, localWords } from '../src/startCause'

/*
 * A local cause in the window's words (DEV-285): each kind, with the path in the way where the agent named one and its
 * own words where it didn't; and what a stuck call keeps of it.
 */
describe('local causes in words', () => {
  it('names the path in the way for each kind', () => {
    const at = (kind: Parameters<typeof localWords>[0]['kind']) => localWords({ kind, path: '~/p/.codex', said: 'x' })
    assert.strictEqual(at('not_a_folder'), '`~/p/.codex` is a file, not a folder.')
    assert.strictEqual(at('is_a_folder'), '`~/p/.codex` is a folder, not a file.')
    assert.strictEqual(at('no_permission'), 'it may not open `~/p/.codex`.')
    assert.strictEqual(at('read_only'), '`~/p/.codex` is on a read-only disk.')
    assert.match(at('config'), /^`~\/p\/\.codex` can't be read: x/)
  })

  it('says what the agent said where it names no path', () => {
    const at = (kind: Parameters<typeof localWords>[0]['kind']) => localWords({ kind, said: 'it broke' })
    assert.match(at('not_a_folder'), /a file stands where it reads a folder \(it broke\)/i)
    assert.match(at('is_a_folder'), /a folder stands where it reads a file \(it broke\)/i)
    assert.match(at('no_permission'), /it may not open a file it needs \(it broke\)/i)
    assert.match(at('read_only'), /a file it writes is on a read-only disk \(it broke\)/i)
    assert.match(at('config'), /its settings can't be read: it broke/i)
  })

  it('finds no cause in a provider’s failure, and keys one without a checkout by its path or words', async () => {
    assert.isUndefined(await localFoundIn('codex', 'stream error: 500 Internal Server Error', null))
    const withPath = await localFoundIn(
      'claude-code',
      "EISDIR: illegal operation on a directory, read '/srv/p/.claude/settings.json'",
      null,
    )
    assert.strictEqual(withPath?.kind, 'is_a_folder')
    assert.strictEqual(withPath?.key, 'is_a_folder:/srv/p/.claude/settings.json')
    const bare = await localFoundIn('opencode', 'EROFS: read-only file system', null)
    assert.strictEqual(bare?.kind, 'read_only')
    assert.isUndefined(bare?.path)
    assert.strictEqual(bare?.key, `read_only:${bare?.said}`)
  })

  it('keys a relative path by itself, the checkout not consulted for it', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'althar-words-'))
    try {
      const found = await localFoundIn('claude-code', "EACCES: permission denied, open 'relative/file'", folder)
      assert.strictEqual(found?.kind, 'no_permission')
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  })

  it('keeps of a stuck call’s cause only its path and when the coordinator was asked', () => {
    assert.deepStrictEqual(causeOf(undefined), {})
    assert.deepStrictEqual(causeOf('text'), {})
    assert.deepStrictEqual(causeOf({ key: 'k', path: 3, askedAt: null }), {})
    assert.deepStrictEqual(causeOf({ key: 'k', path: '~/p', askedAt: 'now' }), { path: '~/p', askedAt: 'now' })
  })

  it.effect('reads an account’s Codex home, else the usual one', () =>
    Effect.gen(function* () {
      const account = { id: 'a' } as unknown as Account
      const homeOf = codexHomeOf({
        get: (id) => (id === 'a' ? Effect.succeed(account) : Effect.fail('missing')),
        env: (one) => (one === account ? { CODEX_HOME: '/accounts/a/codex' } : {}),
      })
      assert.strictEqual(yield* homeOf('a'), '/accounts/a/codex')
      const usual = yield* homeOf(null)
      assert.strictEqual(yield* homeOf('gone'), usual)
      const plain = codexHomeOf({ get: () => Effect.succeed(account), env: () => ({}) })
      assert.strictEqual(yield* plain('a'), usual)
    }),
  )

  it('knows a cause gone only where the checkout can show it: a file or a folder in the way, no longer there', async () => {
    assert.isTrue(causeKnown('not_a_folder:.codex'))
    assert.isTrue(causeKnown('is_a_folder:/p/settings.json'))
    assert.isFalse(causeKnown('config:.codex/config.toml'))
    assert.isFalse(causeKnown('something:else'))
    const folder = mkdtempSync(join(tmpdir(), 'althar-gone-'))
    try {
      const stray = join(folder, '.codex')
      writeFileSync(stray, '')
      assert.isFalse(await Effect.runPromise(causeGone('not_a_folder:.codex', stray)))
      assert.isFalse(await Effect.runPromise(causeGone('not_a_folder:.codex', undefined)))
      assert.isFalse(await Effect.runPromise(causeGone('unknown:.codex', stray)))
      rmSync(stray)
      mkdirSync(stray)
      assert.isTrue(await Effect.runPromise(causeGone('not_a_folder:.codex', stray)))
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  })
})
