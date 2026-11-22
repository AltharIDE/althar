import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { identify, removeTreeSync } from '@althar/testing'
import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { ALTHAR_IDENTITY, committerIdentity, identityIn, testIdentityWarning } from '../src/commitIdentity'
import { repository } from './support'

/*
 * A test identity (`T <t@t.test>`) in a repository's config is plainly not the person's: Althar says so, naming the file
 * and the value, and commits as itself instead.
 */

const some = (value: string, origin = '/home/you/.gitconfig') => ({ value, origin })

describe('a test identity', () => {
  it('is a name T, or an address on a .test domain, and nothing else', () => {
    assert.isNotNull(testIdentityWarning({ name: some('T'), email: null }))
    assert.isNotNull(testIdentityWarning({ name: null, email: some('t@t.test') }))
    assert.isNotNull(testIdentityWarning({ name: some('Fake'), email: some('fake@althar.test') }))
    assert.isNotNull(testIdentityWarning({ name: some('Ada'), email: some('ada@EXAMPLE.TEST ') }))
    assert.isNull(testIdentityWarning({ name: some('Tamás'), email: some('tamas@pm.me') }))
    assert.isNull(testIdentityWarning({ name: some('T. Smith'), email: some('t@testing.dev') }))
    assert.isNull(testIdentityWarning({ name: some('Ada'), email: some('ada@test.example.com') }))
    assert.isNull(testIdentityWarning({ name: null, email: null }))
  })

  it('is told with each value and the file it came from', () => {
    const said = testIdentityWarning({
      name: some('T', '/home/you/projects/althar/.git/config'),
      email: some('t@t.test', '/home/you/projects/althar/.git/config'),
    })
    assert.include(said, '“T” from /home/you/projects/althar/.git/config and “t@t.test” from /home/you/projects/althar/.git/config')
  })
})

/** A repository of its own, with git's global and system config set aside, so what git resolves is what a test put there. */
const ownConfig = Effect.acquireRelease(
  Effect.sync(() => {
    const path = repository()
    const nowhere = mkdtempSync(join(tmpdir(), 'althar-no-config-'))
    const names = [
      'GIT_CONFIG_GLOBAL',
      'GIT_CONFIG_NOSYSTEM',
      'GIT_COMMITTER_EMAIL',
      'GIT_AUTHOR_EMAIL',
      'GIT_COMMITTER_NAME',
      'GIT_AUTHOR_NAME',
    ]
    const before = names.map((name) => [name, process.env[name]] as const)
    for (const name of names) delete process.env[name]
    process.env.GIT_CONFIG_GLOBAL = join(nowhere, 'none')
    process.env.GIT_CONFIG_NOSYSTEM = '1'
    return { path, nowhere, before }
  }),
  ({ path, nowhere, before }) =>
    Effect.sync(() => {
      for (const [name, value] of before) {
        if (value === undefined) delete process.env[name]
        else process.env[name] = value
      }
      removeTreeSync(nowhere)
      removeTreeSync(path)
    }),
).pipe(Effect.map(({ path }) => path))

describe('who a commit of Althar’s is written as', () => {
  it.effect('is the person, where git has them', () =>
    Effect.gen(function* () {
      const path = yield* ownConfig
      identify(path, 'Ada', 'ada@pm.me')
      assert.deepStrictEqual(yield* committerIdentity(path), { as: [], warning: null })
    }),
  )

  it.effect('is Althar, where git has no one', () =>
    Effect.gen(function* () {
      const path = yield* ownConfig
      assert.deepStrictEqual(yield* committerIdentity(path), { as: ALTHAR_IDENTITY, warning: null })
    }),
  )

  it.effect('is Althar, and says so with the file, where git has a test’s', () =>
    Effect.gen(function* () {
      const path = yield* ownConfig
      identify(path, 'T', 't@t.test')
      const found = yield* identityIn(path)
      assert.strictEqual(found.name?.value, 'T')
      assert.strictEqual(found.email?.origin, join(path, '.git', 'config'))
      const said = yield* committerIdentity(path)
      assert.deepStrictEqual(said.as, ALTHAR_IDENTITY)
      assert.include(said.warning, `“t@t.test” from ${join(path, '.git', 'config')}`)
      // The repository's config is as the test left it: Althar never edits it.
      assert.strictEqual(execFileSync('git', ['config', '--local', '--get', 'user.name'], { cwd: path }).toString().trim(), 'T')
    }),
  )
})
