import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { freshCopy } from '../src/coordinatorFolder'

/*
 * The coordinator's copies of the project's repositories (ADR-056): each a
 * repository of its own, so what the coordinator's `git fetch` and `git tag`
 * write stays in the copy; and nothing it leaves there, in the git folder or
 * as a link, ever has Althar's own git reach the person's checkout.
 */

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@althar.test', ...args], { cwd, encoding: 'utf8' }).trim()

/** A remote with `main`, a branch and a tag, the person's clone of it, and where the coordinator's copy goes. */
const place = () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'althar-copies-')))
  const remote = join(home, 'remote.git')
  const seed = join(home, 'seed')
  git(home, 'init', '-q', '--bare', '-b', 'main', remote)
  git(home, 'clone', '-q', remote, seed)
  writeFileSync(join(seed, 'README.md'), '# Meridian\n')
  git(seed, 'add', '.')
  git(seed, 'commit', '-qm', 'Start')
  git(seed, 'tag', 'v0.1.0')
  git(seed, 'push', '-q', 'origin', 'main', 'v0.1.0')
  const person = join(home, 'meridian')
  git(home, 'clone', '-q', remote, person)
  // The remote moves on after the person's clone: a new branch, and a tag on it.
  git(seed, 'switch', '-qc', 'feature/retry')
  writeFileSync(join(seed, 'retry.ts'), 'export const retry = 3\n')
  git(seed, 'add', '.')
  git(seed, 'commit', '-qm', 'Retry')
  git(seed, 'tag', 'v0.2.0')
  git(seed, 'push', '-q', 'origin', 'feature/retry', 'v0.2.0')
  const folder = join(home, 'worktrees', 'meridian', '.coordinator')
  mkdirSync(folder, { recursive: true })
  return { home, remote, person, copy: join(folder, 'meridian') }
}

describe("the coordinator's copies", () => {
  it.effect('are repositories of their own: a tag or a fetch there writes only the copy, and brings what Althar fetched', () =>
    Effect.gen(function* () {
      const { person, copy } = place()
      yield* freshCopy(person, copy, 'main')
      assert.strictEqual(git(copy, 'rev-parse', '--path-format=absolute', '--git-common-dir'), join(copy, '.git'))
      // Its only remote is the person's repository: no network, and no other folder.
      assert.strictEqual(git(copy, 'remote', 'get-url', 'origin'), person)
      // What the remote has, as Althar fetched it into the person's repository before the turn.
      git(copy, 'fetch', '-q')
      assert.strictEqual(git(copy, 'log', '-1', '--format=%s', 'origin/feature/retry'), 'Retry')
      assert.deepStrictEqual(git(copy, 'tag', '-l').split('\n'), ['v0.1.0', 'v0.2.0'])
      assert.strictEqual(git(copy, 'describe', '--tags', '--abbrev=0', 'origin/feature/retry'), 'v0.2.0')
      // A tag made in the copy stays there.
      git(copy, 'tag', 'try-1')
      assert.include(git(copy, 'tag', '-l'), 'try-1')
      assert.notInclude(git(person, 'tag', '-l'), 'try-1')
      // Thrown away with the rest at the next turn.
      yield* freshCopy(person, copy, 'main')
      assert.notInclude(git(copy, 'tag', '-l'), 'try-1')
    }),
  )

  it.effect('make their git folder again every turn: a hook, config or ref the coordinator left is gone', () =>
    Effect.gen(function* () {
      const { person, copy } = place()
      yield* freshCopy(person, copy, 'main')
      git(copy, 'config', 'core.fsmonitor', 'touch ../../pwned')
      git(copy, 'config', 'alias.st', '!touch ../../pwned')
      mkdirSync(join(copy, '.git', 'hooks'), { recursive: true })
      writeFileSync(join(copy, '.git', 'hooks', 'post-checkout'), '#!/bin/sh\ntouch ../../pwned\n', { mode: 0o755 })
      writeFileSync(join(copy, 'scratch.md'), 'notes')
      yield* freshCopy(person, copy, 'main')
      assert.isFalse(existsSync(join(copy, '.git', 'hooks', 'post-checkout')))
      assert.throws(() => git(copy, 'config', '--local', 'core.fsmonitor'))
      assert.throws(() => git(copy, 'config', '--local', 'alias.st'))
      assert.isFalse(existsSync(join(copy, 'scratch.md')))
      assert.isFalse(existsSync(join(copy, '..', '..', 'pwned')))
      // The person's own signing config doesn't sign the coordinator's tags.
      assert.strictEqual(git(copy, 'config', '--local', 'tag.gpgSign'), 'false')
    }),
  )

  it.effect("never reach the person's checkout through a link left in their place", () =>
    Effect.gen(function* () {
      const { person, copy } = place()
      writeFileSync(join(person, 'work.md'), 'the person’s work, not committed')
      const head = git(person, 'rev-parse', 'HEAD')
      yield* freshCopy(person, copy, 'main')
      // The git folder made a link to the person's: Althar's checkout and clean would run there.
      rmSync(join(copy, '.git'), { recursive: true })
      symlinkSync(join(person, '.git'), join(copy, '.git'))
      yield* freshCopy(person, copy, 'main')
      assert.isTrue(lstatSync(join(copy, '.git')).isDirectory())
      // A git folder that names the person's.
      rmSync(join(copy, '.git'), { recursive: true })
      writeFileSync(join(copy, '.git'), `gitdir: ${join(person, '.git')}\n`)
      yield* freshCopy(person, copy, 'main')
      assert.isTrue(lstatSync(join(copy, '.git')).isDirectory())
      // The copy itself made a link to the person's checkout.
      rmSync(copy, { recursive: true })
      symlinkSync(person, copy)
      yield* freshCopy(person, copy, 'main')
      assert.isTrue(lstatSync(copy).isDirectory())
      assert.strictEqual(readFileSync(join(person, 'work.md'), 'utf8'), 'the person’s work, not committed')
      assert.strictEqual(git(person, 'rev-parse', 'HEAD'), head)
      assert.strictEqual(git(person, 'status', '--porcelain'), '?? work.md')
    }),
  )

  it.effect('take over a copy made as a worktree before, and drop it from the repository’s worktrees', () =>
    Effect.gen(function* () {
      const { person, copy } = place()
      git(person, 'worktree', 'add', '-q', '--detach', copy, 'main')
      assert.include(git(person, 'worktree', 'list'), copy)
      yield* freshCopy(person, copy, 'main')
      assert.notInclude(git(person, 'worktree', 'list'), copy)
      assert.strictEqual(git(copy, 'rev-parse', '--path-format=absolute', '--git-common-dir'), join(copy, '.git'))
      assert.strictEqual(readFileSync(join(copy, 'README.md'), 'utf8'), '# Meridian\n')
    }),
  )

  it.effect('leave every other worktree’s record alone, even one the copy’s git file names', () =>
    Effect.gen(function* () {
      const { home, person, copy } = place()
      const task = join(home, 'worktrees', 'meridian', 'retry')
      git(person, 'worktree', 'add', '-q', '-b', 'althar/retry', task, 'main')
      yield* freshCopy(person, copy, 'main')
      // The coordinator's git file names the task's worktree.
      rmSync(join(copy, '.git'), { recursive: true })
      writeFileSync(join(copy, '.git'), readFileSync(join(task, '.git'), 'utf8'))
      yield* freshCopy(person, copy, 'main')
      assert.include(git(person, 'worktree', 'list'), task)
      assert.strictEqual(git(task, 'branch', '--show-current'), 'althar/retry')
      assert.strictEqual(git(copy, 'rev-parse', '--path-format=absolute', '--git-common-dir'), join(copy, '.git'))
    }),
  )
})
