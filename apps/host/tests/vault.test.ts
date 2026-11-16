import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync, chmodSync, copyFileSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { Secrets } from '@althar/runtime'
import { Effect } from 'effect'

import { initializeVault, openVault } from '../src/vault'
import { temporary } from './support'

const location = () => {
  const root = temporary()
  return { profile: join(root, 'profile'), keyFile: join(root, 'credentials', 'master-key') }
}
const withSecrets = <A, E>(at: ReturnType<typeof location>, use: Effect.Effect<A, E, Secrets>) =>
  Effect.scoped(
    Effect.gen(function* () {
      const vault = yield* openVault(at)
      return yield* use.pipe(Effect.provide(vault.secrets))
    }),
  )

describe('headless encrypted secrets', () => {
  it.live('keeps only ciphertext in the profile, survives restarts, and initializes idempotently', () =>
    Effect.gen(function* () {
      const at = location()
      yield* initializeVault(at)
      const originalKey = readFileSync(at.keyFile)
      renameSync(at.keyFile, `${at.keyFile}.offline`)
      assert.strictEqual((yield* Effect.flip(initializeVault(at))).code, 'NotInitialized')
      assert.isFalse(existsSync(at.keyFile))
      renameSync(`${at.keyFile}.offline`, at.keyFile)
      yield* withSecrets(
        at,
        Effect.gen(function* () {
          const secrets = yield* Secrets
          assert.isNull(yield* secrets.get('connection.one'))
          yield* secrets.set('connection.one', 'a private provider token')
          assert.strictEqual(yield* secrets.get('connection.one'), 'a private provider token')
        }),
      )
      const sealed = readFileSync(join(at.profile, 'secrets', 'connection.one.json'), 'utf8')
      assert.notInclude(sealed, 'a private provider token')
      yield* initializeVault(at)
      assert.deepStrictEqual(readFileSync(at.keyFile), originalKey)
      yield* withSecrets(
        at,
        Effect.gen(function* () {
          const secrets = yield* Secrets
          assert.strictEqual(yield* secrets.get('connection.one'), 'a private provider token')
          yield* secrets.remove('connection.one')
          yield* secrets.remove('connection.one')
          assert.isNull(yield* secrets.get('connection.one'))
        }),
      )
      assert.deepStrictEqual(readdirSync(join(at.profile, 'secrets')), [])
    }),
  )

  it.live('refuses a missing or different key without replacing it or the encrypted store', () =>
    Effect.gen(function* () {
      const at = location()
      assert.strictEqual((yield* Effect.flip(Effect.scoped(openVault(at)))).code, 'NotInitialized')
      yield* initializeVault(at)
      yield* withSecrets(
        at,
        Effect.flatMap(Secrets, (secrets) => secrets.set('one', 'keep me')),
      )
      const originalKey = readFileSync(at.keyFile)
      writeFileSync(at.keyFile, Buffer.alloc(32, 7), { mode: 0o600 })
      assert.strictEqual((yield* Effect.flip(Effect.scoped(openVault(at)))).code, 'WrongKey')
      assert.strictEqual((yield* Effect.flip(initializeVault(at))).code, 'WrongKey')
      writeFileSync(at.keyFile, originalKey)
      assert.strictEqual(
        yield* withSecrets(
          at,
          Effect.flatMap(Secrets, (secrets) => secrets.get('one')),
        ),
        'keep me',
      )
    }),
  )

  it.live('authenticates the secret name and ciphertext and rejects malformed stored data', () =>
    Effect.gen(function* () {
      const at = location()
      yield* initializeVault(at)
      yield* withSecrets(
        at,
        Effect.gen(function* () {
          const secrets = yield* Secrets
          yield* secrets.set('one', 'keep me')
          copyFileSync(join(at.profile, 'secrets', 'one.json'), join(at.profile, 'secrets', 'two.json'))
          assert.isTrue((yield* Effect.flip(secrets.get('two'))).unreadable)
          writeFileSync(join(at.profile, 'secrets', 'one.json'), '{"version":999}')
          assert.isTrue((yield* Effect.flip(secrets.get('one'))).unreadable)
          assert.isTrue((yield* Effect.flip(secrets.set('../escape', 'value'))).unreadable)
          assert.isTrue((yield* Effect.flip(secrets.set('large', 'x'.repeat(1_048_577)))).unreadable)
        }),
      )
    }),
  )

  it.live.skipIf(process.platform === 'win32')('rejects exposed keys, links and keys kept with the backed-up profile', () =>
    Effect.gen(function* () {
      const at = location()
      yield* initializeVault(at)
      chmodSync(at.keyFile, 0o644)
      assert.strictEqual((yield* Effect.flip(Effect.scoped(openVault(at)))).code, 'UnsafePermissions')
      chmodSync(at.keyFile, 0o600)
      const linked = join(at.profile, 'linked-key')
      symlinkSync(at.keyFile, linked)
      assert.strictEqual((yield* Effect.flip(Effect.scoped(openVault({ ...at, keyFile: linked })))).code, 'UnsafeKeyLocation')
      yield* withSecrets(
        at,
        Effect.gen(function* () {
          const secrets = yield* Secrets
          symlinkSync(at.keyFile, join(at.profile, 'secrets', 'link.json'))
          assert.isTrue((yield* Effect.flip(secrets.get('link'))).unreadable)
          assert.isTrue((yield* Effect.flip(secrets.remove('link'))).unreadable)
        }),
      )
    }),
  )

  it.live('serializes concurrent operations and refuses use after its owner scope closes', () =>
    Effect.gen(function* () {
      const at = location()
      yield* initializeVault(at)
      const closed = yield* withSecrets(
        at,
        Effect.gen(function* () {
          const secrets = yield* Secrets
          yield* Effect.forEach(
            Array.from({ length: 12 }, (_, index) => index),
            (index) => secrets.set('shared', `value-${index}`),
            { concurrency: 'unbounded' },
          )
          assert.match((yield* secrets.get('shared')) ?? '', /^value-\d+$/)
          assert.deepStrictEqual(readdirSync(join(at.profile, 'secrets')), ['shared.json'])
          return secrets
        }),
      )
      assert.include((yield* Effect.flip(closed.set('shared', 'lost'))).reason, 'closed')
      assert.match(
        (yield* withSecrets(
          at,
          Effect.flatMap(Secrets, (secrets) => secrets.get('shared')),
        )) ?? '',
        /^value-\d+$/,
      )
    }),
  )

  it.live('refuses malformed keys, damaged metadata and unrecognized pre-existing desktop secrets', () =>
    Effect.gen(function* () {
      const at = location()
      yield* initializeVault(at)
      const key = readFileSync(at.keyFile)
      writeFileSync(at.keyFile, key.subarray(0, 31))
      assert.strictEqual((yield* Effect.flip(Effect.scoped(openVault(at)))).code, 'InvalidConfig')
      writeFileSync(at.keyFile, key)
      writeFileSync(join(at.profile, 'host-vault.json'), '{}')
      assert.strictEqual((yield* Effect.flip(initializeVault(at))).code, 'CorruptVault')
      assert.deepStrictEqual(readFileSync(at.keyFile), key)
      const desktop = location()
      mkdirSync(join(desktop.profile, 'secrets'), { recursive: true, mode: 0o700 })
      writeFileSync(join(desktop.profile, 'secrets', 'old.json'), 'desktop keyring ciphertext', { mode: 0o600 })
      assert.strictEqual((yield* Effect.flip(initializeVault(desktop))).code, 'CorruptVault')
      assert.isFalse(existsSync(desktop.keyFile))
    }),
  )

  it.live('rejects noncanonical encrypted fields, invalid Unicode and an unavailable secret directory', () =>
    Effect.gen(function* () {
      const at = location()
      yield* initializeVault(at)
      yield* withSecrets(
        at,
        Effect.gen(function* () {
          const secrets = yield* Secrets
          for (const iv of ['!bad', Buffer.alloc(11).toString('base64url')]) {
            writeFileSync(join(at.profile, 'secrets', 'bad.json'), JSON.stringify({ version: 1, iv, tag: '', ciphertext: '' }), {
              mode: 0o600,
            })
            assert.isTrue((yield* Effect.flip(secrets.get('bad'))).unreadable)
          }
          assert.isTrue((yield* Effect.flip(secrets.set('unicode', '\ud800'))).unreadable)
          renameSync(join(at.profile, 'secrets'), join(at.profile, 'secrets.offline'))
          assert.isUndefined((yield* Effect.flip(secrets.get('bad'))).unreadable)
        }),
      )
    }),
  )

  it.live.skipIf(process.platform === 'win32')('checks canonical worktree and key locations, including symlinked ancestors', () =>
    Effect.gen(function* () {
      const at = location()
      const worktrees = join(temporary(), 'worktrees')
      mkdirSync(worktrees, { mode: 0o700 })
      assert.strictEqual(
        (yield* Effect.flip(initializeVault({ ...at, worktrees, keyFile: join(worktrees, 'key') }))).code,
        'UnsafeKeyLocation',
      )
      const linked = join(temporary(), 'worktree-link')
      symlinkSync(worktrees, linked)
      assert.strictEqual(
        (yield* Effect.flip(initializeVault({ ...at, worktrees: linked, keyFile: join(worktrees, 'key') }))).code,
        'UnsafeKeyLocation',
      )
      const alias = join(temporary(), 'profile-link')
      symlinkSync(at.profile, alias)
      yield* initializeVault(at)
      const aliased = yield* Effect.flip(Effect.scoped(openVault({ ...at, keyFile: join(alias, 'key') })))
      assert.strictEqual(aliased.code, 'UnsafeKeyLocation')
    }),
  )
})
