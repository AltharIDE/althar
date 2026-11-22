import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { afterEach, vi } from 'vitest'

import { RepositoryRefused } from '../src/errors'
import { makeRepository, placeRepository } from '../src/newRepository'
import { readFolder } from '../src/Projects'
import { words } from '../src/words'

/*
 * A project that starts from nothing: its repository placed in the folder the
 * person chose, named after the project, and made with a first commit, by the
 * person where git knows them and by Althar where it doesn't.
 */

const parent = () => realpathSync(mkdtempSync(join(tmpdir(), 'althar-new-')))

/** git, as the person has it: their identity in a config of the test's own, or none. */
const as = (identity: string | null) => {
  const config = join(parent(), 'gitconfig')
  // Only the config says who: git guesses no one from the computer's name.
  const who = identity === null ? '' : `\tname = ${identity}\n\temail = ${identity.toLowerCase()}@example.test\n`
  writeFileSync(config, `[user]\n${who}\tuseConfigOnly = true\n`)
  vi.stubEnv('GIT_CONFIG_GLOBAL', config)
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1')
  for (const key of ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL', 'EMAIL'])
    vi.stubEnv(key, undefined)
}

/**
 * Holds every git commit until `then`, a shell line, has run, as another
 * operation would act while this one waits on git: git itself, by a git of
 * the test's own first on the PATH. The runtime turns hooks off, so a hook
 * can't.
 */
const afterEachCommit = (then: string) => {
  const real = execFileSync('/bin/sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim()
  const bin = parent()
  writeFileSync(join(bin, 'git'), `#!/bin/sh\n'${real}' "$@"\nsaid=$?\ncase " $* " in *" commit "*) ${then} ;; esac\nexit $said\n`)
  chmodSync(join(bin, 'git'), 0o755)
  vi.stubEnv('PATH', `${bin}:${process.env.PATH ?? ''}`)
}

const log = (path: string, format: string) => execFileSync('git', ['log', `--format=${format}`], { cwd: path, encoding: 'utf8' }).trim()

afterEach(() => vi.unstubAllEnvs())

describe('a new repository, placed', () => {
  it.effect('goes in the folder chosen, named after the project, and is made of nothing yet', () =>
    Effect.gen(function* () {
      const at = parent()
      const placed = yield* placeRepository(at, 'Northwind Ops')
      assert.deepStrictEqual(placed, { name: 'northwind-ops', path: join(at, 'northwind-ops') })
      assert.isFalse(existsSync(placed.path))
    }),
  )

  it.effect('is refused where a folder of its name has something in it, and for a name that makes no folder', () =>
    Effect.gen(function* () {
      const at = parent()
      mkdirSync(join(at, 'northwind'))
      writeFileSync(join(at, 'northwind', 'notes.md'), 'mine')
      const taken = yield* Effect.flip(placeRepository(at, 'Northwind'))
      assert.instanceOf(taken, RepositoryRefused)
      assert.deepInclude(taken, { reason: 'taken', name: 'northwind' })
      assert.match(words(taken, (id) => id).message, /There’s a folder named northwind in althar-new-\w+ already/)
      writeFileSync(join(at, 'meridian'), 'a file')
      assert.deepInclude(yield* Effect.flip(placeRepository(at, 'Meridian')), { reason: 'taken' })
      assert.deepInclude(yield* Effect.flip(placeRepository(at, ' ✦ ')), { reason: 'no_name' })
    }),
  )

  it.effect('is refused where its name is a link, even to an empty folder, which it never follows', () =>
    Effect.gen(function* () {
      const at = parent()
      const outside = parent()
      symlinkSync(outside, join(at, 'tide-tables'))
      assert.deepInclude(yield* Effect.flip(placeRepository(at, 'Tide Tables')), { reason: 'taken', name: 'tide-tables' })
    }),
  )
})

describe('a new repository, made', () => {
  it.effect('is a repository on main with a first commit by the person, read as any other', () =>
    Effect.gen(function* () {
      as('Ada')
      const at = parent()
      const made = yield* makeRepository(at, 'Northwind Ops')
      assert.strictEqual(made.path, join(at, 'northwind-ops'))
      assert.strictEqual(log(made.path, '%an <%ae> %s'), 'Ada <ada@example.test> Initial commit')
      const read = yield* readFolder(made.path)
      assert.strictEqual(read.kind, 'repository')
      assert.deepInclude(read.repositories[0], { name: 'northwind-ops', branch: 'main', remote: null })
      // Made, its folder isn't free any more.
      assert.deepInclude(yield* Effect.flip(placeRepository(at, 'Northwind Ops')), { reason: 'taken' })
    }),
  )

  it.effect('is Althar’s first commit where git doesn’t know who the person is, and uses an empty folder of its name', () =>
    Effect.gen(function* () {
      as(null)
      const at = parent()
      mkdirSync(join(at, 'meridian'))
      const made = yield* makeRepository(at, 'Meridian')
      assert.strictEqual(log(made.path, '%an <%ae>'), 'Althar <althar@localhost>')
    }),
  )

  it.effect('never follows a link put where it goes: the folder it points at stays as it was', () =>
    Effect.gen(function* () {
      as('Ada')
      const at = parent()
      const outside = parent()
      symlinkSync(outside, join(at, 'tide-tables'))
      assert.deepInclude(yield* Effect.flip(makeRepository(at, 'Tide Tables')), { reason: 'taken' })
      assert.deepStrictEqual(readdirSync(outside), [])
      assert.deepStrictEqual(readdirSync(at), ['tide-tables'])
    }),
  )

  it.effect('is built beside where it goes and moved in whole: a clone that lands there first keeps it, and this takes only its own', () =>
    Effect.gen(function* () {
      const at = parent()
      const there = join(at, 'tide-tables')
      as('Ada')
      // Held after its first commit, a clone of the same name lands where it goes.
      afterEachCommit(`[ -e '${there}' ] || { mkdir '${there}' && echo theirs > '${there}/README.md'; }`)
      assert.deepInclude(yield* Effect.flip(makeRepository(at, 'Tide Tables')), { reason: 'taken', name: 'tide-tables' })
      // The clone's, as it landed: nothing of this one's in it, and this one's own folder gone.
      assert.deepStrictEqual(readdirSync(there), ['README.md'])
      assert.strictEqual(readFileSync(join(there, 'README.md'), 'utf8'), 'theirs\n')
      assert.deepStrictEqual(readdirSync(at), ['tide-tables'])
    }),
  )

  it.effect('takes an empty folder of its name, made since it was placed, as it would have before', () =>
    Effect.gen(function* () {
      const at = parent()
      const there = join(at, 'tide-tables')
      as('Ada')
      afterEachCommit(`mkdir -p '${there}'`)
      const made = yield* makeRepository(at, 'Tide Tables')
      assert.strictEqual(made.path, there)
      assert.strictEqual(log(there, '%s'), 'Initial commit')
      assert.deepStrictEqual(readdirSync(at), ['tide-tables'])
    }),
  )
})
