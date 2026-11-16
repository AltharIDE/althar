import { execFileSync } from 'node:child_process'
import { renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { countBetween, isUnder, logBetween } from '../src/git'
import { StandsOn } from '../src/standsOn'
import { repository } from './support'

/*
 * What git says of commits named by their ids never changes, so it is asked
 * once, and an answer worked out from it (a card held for Ship) is kept as
 * any other, rather than starting git on every read. Shown by taking the
 * repository away after the first answer: kept, the same answer comes.
 */

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@althar.test', ...args], { cwd, encoding: 'utf8' }).trim()

const commit = (cwd: string, file: string) => {
  writeFileSync(join(cwd, file), `${file}\n`)
  git(cwd, 'add', '.')
  git(cwd, 'commit', '-q', '-m', `Write ${file}`)
  return git(cwd, 'rev-parse', 'HEAD')
}

describe('what git says of commits by their ids', () => {
  it.effect('is asked once, and kept', () =>
    Effect.gen(function* () {
      const cwd = repository()
      const base = git(cwd, 'rev-parse', 'HEAD')
      commit(cwd, 'one.txt')
      const head = commit(cwd, 'two.txt')
      assert.strictEqual(yield* countBetween(cwd, base, head), 2)
      assert.strictEqual(yield* logBetween(cwd, base, head, '%s'), 'Write one.txt\nWrite two.txt')
      assert.isTrue(yield* isUnder(cwd, base, head))
      assert.isFalse(yield* isUnder(cwd, head, base))
      // Gone from where it was: only what was kept can answer.
      renameSync(cwd, `${cwd}-moved`)
      assert.strictEqual(yield* countBetween(cwd, base, head), 2)
      assert.strictEqual(yield* logBetween(cwd, base, head, '%s'), 'Write one.txt\nWrite two.txt')
      assert.isTrue(yield* isUnder(cwd, base, head))
      assert.isFalse(yield* isUnder(cwd, head, base))
    }),
  )

  it.effect('leaves what is worked out from it sure, so it can be kept', () =>
    Effect.gen(function* () {
      const cwd = repository()
      const base = git(cwd, 'rev-parse', 'HEAD')
      const head = commit(cwd, 'one.txt')
      const on = { looks: [], unsure: null, until: Infinity }
      yield* Effect.provideService(
        Effect.all([countBetween(cwd, base, head), isUnder(cwd, base, head), logBetween(cwd, base, head, '%s')]),
        StandsOn,
        on,
      )
      assert.isNull(on.unsure)
    }),
  )

  it.effect('is asked again where a name could move, as a branch or HEAD can', () =>
    Effect.gen(function* () {
      const cwd = repository()
      const base = git(cwd, 'rev-parse', 'HEAD')
      commit(cwd, 'one.txt')
      assert.strictEqual(yield* countBetween(cwd, base, 'HEAD'), 1)
      commit(cwd, 'two.txt')
      assert.strictEqual(yield* countBetween(cwd, base, 'HEAD'), 2)
      assert.isTrue(yield* isUnder(cwd, base, 'HEAD'))
    }),
  )
})
