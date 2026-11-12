import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { commitsOf } from '../src/git'
import { refStamp } from '../src/refStamps'
import { repository } from './support'

/*
 * What a worktree's refs stand on (refStamps.ts), so the commits the board,
 * the home and a task's view read for each worktree on every read come from
 * git only when its refs moved: any move of HEAD, a branch, a remote's
 * branch or the packed refs gives a new stamp, and a stamp that holds gives
 * what git said under it.
 */

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@althar.test', ...args], { cwd, encoding: 'utf8' }).trim()

const commit = (cwd: string, file: string) => {
  writeFileSync(join(cwd, file), `${file}\n`)
  git(cwd, 'add', '.')
  git(cwd, 'commit', '-q', '-m', `Write ${file}`)
  return git(cwd, 'rev-parse', 'HEAD')
}

const stamp = (cwd: string, revisions: ReadonlyArray<string>) => Effect.promise(() => refStamp(cwd, revisions))

describe('what refs stand on', () => {
  it.live('holds while nothing moves, and changes with a commit, a branch, a switch and packing', () =>
    Effect.gen(function* () {
      const cwd = repository()
      const names = ['HEAD', 'main', 'origin/main']
      const first = yield* stamp(cwd, names)
      assert.isString(first)
      assert.strictEqual(yield* stamp(cwd, names), first)
      commit(cwd, 'one.txt')
      const committed = yield* stamp(cwd, names)
      assert.notStrictEqual(committed, first)
      git(cwd, 'branch', 'other')
      // A branch not asked about leaves it as it was.
      assert.strictEqual(yield* stamp(cwd, names), committed)
      git(cwd, 'switch', '-q', 'other')
      const switched = yield* stamp(cwd, names)
      assert.notStrictEqual(switched, committed)
      git(cwd, 'pack-refs', '--all')
      assert.notStrictEqual(yield* stamp(cwd, names), switched)
    }),
  )

  it.live("moves with a linked worktree's own HEAD, and with a commit by its id once the objects have it", () =>
    Effect.gen(function* () {
      const cwd = repository()
      const linked = join(realpathSync(mkdtempSync(join(tmpdir(), 'althar-linked-'))), 'work')
      git(cwd, 'worktree', 'add', '-q', '-b', 'althar/retry', linked)
      const before = yield* stamp(linked, ['HEAD', 'main'])
      assert.isString(before)
      const head = commit(linked, 'retry.ts')
      assert.notStrictEqual(yield* stamp(linked, ['HEAD', 'main']), before)
      // A commit by its id, made elsewhere and fetched: the objects it is among moved.
      const other = repository()
      const theirs = commit(other, 'theirs.txt')
      const missing = yield* stamp(cwd, [theirs])
      git(cwd, 'fetch', '-q', other, 'main')
      assert.notStrictEqual(yield* stamp(cwd, [theirs]), missing)
      assert.isString(head)
    }),
  )

  it.live('is none for what it cannot tell: an expression, a folder that is no repository', () =>
    Effect.gen(function* () {
      const cwd = repository()
      assert.isUndefined(yield* stamp(cwd, ['HEAD~1']))
      assert.isUndefined(yield* stamp(cwd, ['../main']))
      assert.isUndefined(yield* stamp(mkdtempSync(join(tmpdir(), 'althar-not-git-')), ['HEAD']))
    }),
  )
})

describe('the commits a worktree names', () => {
  it.live('are what git says now, read again only once its refs moved, and once for two asking at once', () =>
    Effect.gen(function* () {
      const cwd = repository()
      const start = git(cwd, 'rev-parse', 'HEAD')
      const [both, again] = yield* Effect.all([commitsOf(cwd, ['HEAD', 'main', 'nope']), commitsOf(cwd, ['HEAD', 'main', 'nope'])], {
        concurrency: 'unbounded',
      })
      assert.deepStrictEqual(both, [start, start, null])
      assert.deepStrictEqual(again, both)
      const next = commit(cwd, 'two.txt')
      assert.deepStrictEqual(yield* commitsOf(cwd, ['HEAD', 'main', 'nope']), [next, next, null])
      git(cwd, 'reset', '-q', '--hard', start)
      assert.deepStrictEqual(yield* commitsOf(cwd, ['HEAD', 'main', 'nope']), [start, start, null])
    }),
  )

  it.live('are asked of git again after it failed, though the refs never moved', () =>
    Effect.gen(function* () {
      const cwd = repository()
      const head = git(cwd, 'rev-parse', 'HEAD')
      const config = join(cwd, '.git', 'config')
      const kept = readFileSync(config, 'utf8')
      const before = yield* stamp(cwd, ['HEAD', 'main'])
      // Git can't read the repository for now, as for one that timed out or couldn't start: it fails, and says nothing of the refs.
      writeFileSync(config, '[core\n')
      assert.deepStrictEqual(yield* commitsOf(cwd, ['HEAD', 'main']), [null, null])
      writeFileSync(config, kept)
      assert.strictEqual(yield* stamp(cwd, ['HEAD', 'main']), before)
      assert.deepStrictEqual(yield* commitsOf(cwd, ['HEAD', 'main']), [head, head])
    }),
  )
})
