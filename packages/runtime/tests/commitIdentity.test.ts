import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { identify, removeTreeSync, setConfig } from '@althar/testing'
import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import {
  ALTHAR,
  type Committer,
  type Identity,
  committerIdentity,
  configuredIn,
  identityIn,
  testIdentityIn,
  testIdentityWarning,
} from '../src/commitIdentity'
import { repository } from './support'

/*
 * A test identity (`T <t@t.test>`) in a repository's config, or in Althar's environment, is plainly not the person's:
 * Althar says so, naming the key, the value and where it came from, and writes that role of the commit as itself. Git
 * resolves the author and the committer each on its own, the environment over `author.*`/`committer.*` over `user.*`,
 * so the tests look at what a real commit is written as.
 */

const some = (value: string, key = 'user.email', origin = '/home/you/.gitconfig') => ({ value, key, origin })
/** One role as git resolves it from these sources, its name `Ada` where none is given. */
const person = (name: ReturnType<typeof some> | null, email: ReturnType<typeof some> | null) => ({
  resolved: { name: name?.value ?? 'Ada', email: email?.value ?? '' },
  name,
  email,
})
const both = (name: ReturnType<typeof some> | null, email: ReturnType<typeof some> | null): Identity => ({
  author: person(name, email),
  committer: person(name, email),
})

describe('a test identity', () => {
  it('is a name T, or an address on a .test domain, and nothing else', () => {
    assert.isNotNull(testIdentityWarning(both(some('T', 'user.name'), null)))
    assert.isNotNull(testIdentityWarning(both(null, some('t@t.test'))))
    assert.isNotNull(testIdentityWarning(both(some('Fake', 'user.name'), some('fake@althar.test'))))
    assert.isNotNull(testIdentityWarning(both(some('Ada', 'user.name'), some('ada@EXAMPLE.TEST '))))
    assert.isNull(testIdentityWarning(both(some('Tamás', 'user.name'), some('tamas@pm.me'))))
    assert.isNull(testIdentityWarning(both(some('T. Smith', 'user.name'), some('t@testing.dev'))))
    assert.isNull(testIdentityWarning(both(some('Ada', 'user.name'), some('ada@test.example.com'))))
    assert.isNull(testIdentityWarning(both(null, null)))
  })

  it('is told with each value, its key and the file it came from, once though both roles read it', () => {
    const file = '/home/you/projects/althar/.git/config'
    const said = testIdentityWarning(both(some('T', 'user.name', file), some('t@t.test', 'user.email', file)))
    assert.strictEqual(said?.split(file).length, 3)
    assert.include(said, `“T” (user.name) from ${file} and “t@t.test” (user.email) from ${file}`)
  })

  it('is told by its variable where Althar’s environment holds it', () => {
    const said = testIdentityWarning({
      author: person(null, { value: 't@t.test', key: 'GIT_AUTHOR_EMAIL', origin: 'the environment' }),
      committer: person(null, some('ada@pm.me')),
    })
    assert.include(said, '“t@t.test” from GIT_AUTHOR_EMAIL in Althar’s environment')
  })
})

const IDENTITY_VARIABLES = ['GIT_COMMITTER_EMAIL', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_AUTHOR_NAME']

/** A repository of its own, with git's global and system config and identity variables set aside: what git resolves is what a test put there. */
const ownConfig = Effect.acquireRelease(
  Effect.sync(() => {
    const path = repository()
    const nowhere = mkdtempSync(join(tmpdir(), 'althar-no-config-'))
    const names = ['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', ...IDENTITY_VARIABLES]
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

/**
 * Who a real commit is written as, made with `environment` as Althar's own and `as` over it, as Althar's git runs
 * (`gitWith`): `author | committer`.
 */
const committed = (path: string, environment: Record<string, string>, as: Committer) => {
  const env = { ...process.env, ...environment, ...as, GIT_CONFIG_NOSYSTEM: '1' }
  execFileSync('git', ['-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', 'Work'], { cwd: path, env, stdio: 'ignore' })
  return execFileSync('git', ['log', '-1', '--format=%an <%ae> | %cn <%ce>'], { cwd: path, env }).toString().trim()
}

describe('who a commit of Althar’s is written as', () => {
  it.effect('is the person, where git has them', () =>
    Effect.gen(function* () {
      const path = yield* ownConfig
      identify(path, 'Ada', 'ada@pm.me')
      const said = yield* committerIdentity(path)
      assert.deepStrictEqual(said, { as: {}, warning: null })
      assert.strictEqual(committed(path, {}, said.as), 'Ada <ada@pm.me> | Ada <ada@pm.me>')
    }),
  )

  it.effect('is Althar, where git has no one', () =>
    Effect.gen(function* () {
      const path = yield* ownConfig
      const said = yield* committerIdentity(path)
      assert.deepStrictEqual(said, { as: ALTHAR, warning: null })
      assert.strictEqual(committed(path, {}, said.as), 'Althar <althar@localhost> | Althar <althar@localhost>')
    }),
  )

  it.effect('is Althar, and says so with the file, where the repository’s config has a test’s', () =>
    Effect.gen(function* () {
      const path = yield* ownConfig
      identify(path, 'T', 't@t.test')
      const found = yield* identityIn(path)
      assert.strictEqual(found.author.name?.value, 'T')
      assert.strictEqual(found.committer.email?.origin, join(path, '.git', 'config'))
      const said = yield* committerIdentity(path)
      assert.deepStrictEqual(said.as, ALTHAR)
      assert.include(said.warning, `“t@t.test” (user.email) from ${join(path, '.git', 'config')}`)
      assert.strictEqual(committed(path, {}, said.as), 'Althar <althar@localhost> | Althar <althar@localhost>')
      // The repository's config is as the test left it: Althar never edits it.
      assert.strictEqual(execFileSync('git', ['config', '--local', '--get', 'user.name'], { cwd: path }).toString().trim(), 'T')
    }),
  )

  it.effect('finds a test author in author.* though user.* is the person’s, and writes only the author as Althar', () =>
    Effect.gen(function* () {
      const path = yield* ownConfig
      identify(path, 'Ada', 'ada@pm.me')
      setConfig(path, 'author.email', 't@t.test')
      const said = yield* committerIdentity(path)
      assert.include(said.warning, `“t@t.test” (author.email) from ${join(path, '.git', 'config')}`)
      assert.strictEqual(committed(path, {}, said.as), 'Althar <althar@localhost> | Ada <ada@pm.me>')
    }),
  )

  it.effect('finds a test author in the environment beside a real committer there, and writes the author as Althar', () =>
    Effect.gen(function* () {
      const path = yield* ownConfig
      identify(path, 'Ada', 'ada@pm.me')
      const environment = {
        GIT_AUTHOR_NAME: 'T',
        GIT_AUTHOR_EMAIL: 't@t.test',
        GIT_COMMITTER_NAME: 'Bea',
        GIT_COMMITTER_EMAIL: 'bea@pm.me',
      }
      // Without the guard, the environment wins over the config, and the commit is the test's.
      assert.strictEqual(committed(path, environment, {}), 'T <t@t.test> | Bea <bea@pm.me>')
      const said = yield* committerIdentity(path, { ...process.env, ...environment })
      assert.include(said.warning, '“t@t.test” from GIT_AUTHOR_EMAIL in Althar’s environment')
      assert.strictEqual(committed(path, environment, said.as), 'Althar <althar@localhost> | Bea <bea@pm.me>')
    }),
  )

  it.effect('finds a test author in the config beside a real committer in the environment', () =>
    Effect.gen(function* () {
      const path = yield* ownConfig
      identify(path, 'T', 't@t.test')
      const environment = { GIT_COMMITTER_NAME: 'Bea', GIT_COMMITTER_EMAIL: 'bea@pm.me' }
      const said = yield* committerIdentity(path, { ...process.env, ...environment })
      assert.isNotNull(said.warning)
      assert.strictEqual(committed(path, environment, said.as), 'Althar <althar@localhost> | Bea <bea@pm.me>')
    }),
  )

  it.effect('judges what git resolves, so a test address in angle brackets in the config is found', () =>
    Effect.gen(function* () {
      const path = yield* ownConfig
      identify(path, 'Ada', '<t@t.test>')
      // Git itself reads it as t@t.test.
      assert.strictEqual(committed(path, {}, {}), 'Ada <t@t.test> | Ada <t@t.test>')
      const said = yield* committerIdentity(path)
      assert.include(said.warning, `“<t@t.test>” (user.email) from ${join(path, '.git', 'config')}`)
      assert.strictEqual(committed(path, {}, said.as), 'Althar <althar@localhost> | Althar <althar@localhost>')
    }),
  )

  it.effect('writes the author as Althar where the environment empties its address, though the config is the person’s', () =>
    Effect.gen(function* () {
      const path = yield* ownConfig
      identify(path, 'Ada', 'ada@pm.me')
      const environment = { GIT_AUTHOR_EMAIL: '' }
      // Without the guard, the empty variable wins over the config: the author has no address.
      assert.strictEqual(committed(path, environment, {}), 'Ada <> | Ada <ada@pm.me>')
      const said = yield* committerIdentity(path, { ...process.env, ...environment })
      assert.strictEqual(said.warning, null)
      assert.strictEqual(committed(path, environment, said.as), 'Althar <althar@localhost> | Ada <ada@pm.me>')
    }),
  )

  it.effect('writes the author as Althar where the environment empties its name, which git would refuse', () =>
    Effect.gen(function* () {
      const path = yield* ownConfig
      identify(path, 'Ada', 'ada@pm.me')
      const environment = { GIT_AUTHOR_NAME: '' }
      assert.throws(() => committed(path, environment, {}))
      const said = yield* committerIdentity(path, { ...process.env, ...environment })
      assert.strictEqual(committed(path, environment, said.as), 'Althar <althar@localhost> | Ada <ada@pm.me>')
    }),
  )

  it('reads each key of git’s config with where it came from, a value given on the command line or left out too', () => {
    const keys = configuredIn(
      '/work/repo',
      ['file:.git/config\tuser.name T', 'command line:\tuser.email t@t.test', 'file:/home/ada/.gitconfig\tAuthor.Name', ''].join('\n'),
    )
    assert.deepStrictEqual(keys.get('user.name'), { value: 'T', key: 'user.name', origin: resolve('/work/repo', '.git/config') })
    assert.deepStrictEqual(keys.get('user.email'), { value: 't@t.test', key: 'user.email', origin: 'command line:' })
    assert.deepStrictEqual(keys.get('author.name'), { value: '', key: 'author.name', origin: resolve('/home/ada/.gitconfig') })
    assert.strictEqual(keys.size, 3)
  })

  it('says a test value git made up itself, which no config or variable holds, as git’s own default', () => {
    const made = { resolved: { name: 'Ada', email: 'ada@host.test' }, name: some('Ada', 'user.name'), email: null }
    assert.deepStrictEqual(testIdentityIn({ author: made, committer: made }), [
      { value: 'ada@host.test', key: 'user.email', origin: 'git’s own default' },
    ])
  })
})
