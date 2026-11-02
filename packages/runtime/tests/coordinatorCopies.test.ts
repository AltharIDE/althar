import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { freshCopy, readsOf, refreshWithGit } from '../src/coordinatorFolder'

/*
 * The coordinator's copies of the project's repositories (ADR-058): each a
 * repository of its own, so what the coordinator's `git fetch` and `git tag`
 * write stays in the copy; and nothing it leaves there, in the git folder or
 * as a link, ever has Althar's own git reach the person's checkout.
 */

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@althar.test', ...args], { cwd, encoding: 'utf8' }).trim()

/** A path as git prints it, with `/` on Windows too. */
const asGit = (path: string) => path.split(sep).join('/')

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
      yield* freshCopy(person, copy, 'main', refreshWithGit)
      assert.strictEqual(git(copy, 'rev-parse', '--path-format=absolute', '--git-common-dir'), asGit(join(copy, '.git')))
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
      yield* freshCopy(person, copy, 'main', refreshWithGit)
      assert.notInclude(git(copy, 'tag', '-l'), 'try-1')
    }),
  )

  it.effect('make their git folder again every turn: a hook, config or ref the coordinator left is gone', () =>
    Effect.gen(function* () {
      const { person, copy } = place()
      yield* freshCopy(person, copy, 'main', refreshWithGit)
      git(copy, 'config', 'core.fsmonitor', 'touch ../../pwned')
      git(copy, 'config', 'alias.st', '!touch ../../pwned')
      mkdirSync(join(copy, '.git', 'hooks'), { recursive: true })
      writeFileSync(join(copy, '.git', 'hooks', 'post-checkout'), '#!/bin/sh\ntouch ../../pwned\n', { mode: 0o755 })
      writeFileSync(join(copy, 'scratch.md'), 'notes')
      yield* freshCopy(person, copy, 'main', refreshWithGit)
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
      yield* freshCopy(person, copy, 'main', refreshWithGit)
      // The git folder made a link to the person's: Althar's checkout and clean would run there.
      rmSync(join(copy, '.git'), { recursive: true })
      symlinkSync(join(person, '.git'), join(copy, '.git'))
      yield* freshCopy(person, copy, 'main', refreshWithGit)
      assert.isTrue(lstatSync(join(copy, '.git')).isDirectory())
      // A git folder that names the person's.
      rmSync(join(copy, '.git'), { recursive: true })
      writeFileSync(join(copy, '.git'), `gitdir: ${join(person, '.git')}\n`)
      yield* freshCopy(person, copy, 'main', refreshWithGit)
      assert.isTrue(lstatSync(join(copy, '.git')).isDirectory())
      // The copy itself made a link to the person's checkout.
      rmSync(copy, { recursive: true })
      symlinkSync(person, copy)
      yield* freshCopy(person, copy, 'main', refreshWithGit)
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
      assert.include(git(person, 'worktree', 'list'), asGit(copy))
      yield* freshCopy(person, copy, 'main', refreshWithGit)
      assert.notInclude(git(person, 'worktree', 'list'), asGit(copy))
      assert.strictEqual(git(copy, 'rev-parse', '--path-format=absolute', '--git-common-dir'), asGit(join(copy, '.git')))
      assert.strictEqual(readFileSync(join(copy, 'README.md'), 'utf8'), '# Meridian\n')
    }),
  )

  it.effect('leave every other worktree’s record alone, even one the copy’s git file names', () =>
    Effect.gen(function* () {
      const { home, person, copy } = place()
      const task = join(home, 'worktrees', 'meridian', 'retry')
      git(person, 'worktree', 'add', '-q', '-b', 'althar/retry', task, 'main')
      yield* freshCopy(person, copy, 'main', refreshWithGit)
      // The coordinator's git file names the task's worktree.
      rmSync(join(copy, '.git'), { recursive: true })
      writeFileSync(join(copy, '.git'), readFileSync(join(task, '.git'), 'utf8'))
      yield* freshCopy(person, copy, 'main', refreshWithGit)
      assert.include(git(person, 'worktree', 'list'), asGit(task))
      assert.strictEqual(git(task, 'branch', '--show-current'), 'althar/retry')
      assert.strictEqual(git(copy, 'rev-parse', '--path-format=absolute', '--git-common-dir'), asGit(join(copy, '.git')))
    }),
  )

  it.effect('fetch from a mirror Althar keeps beside the folder, so their fetch never reads the person’s checkout', () =>
    Effect.gen(function* () {
      const { home, person, copy } = place()
      const mirror = join(home, 'worktrees', 'meridian', '.coordinator-mirrors', 'meridian.git')
      yield* freshCopy(person, copy, 'main', refreshWithGit, mirror)
      assert.strictEqual(git(copy, 'remote', 'get-url', 'origin'), mirror)
      assert.strictEqual(git(mirror, 'rev-parse', '--is-bare-repository'), 'true')
      git(copy, 'fetch', '-q')
      assert.strictEqual(git(copy, 'log', '-1', '--format=%s', 'origin/feature/retry'), 'Retry')
      assert.deepStrictEqual(git(copy, 'tag', '-l').split('\n'), ['v0.1.0', 'v0.2.0'])
      // A branch the person makes after shows at the next turn.
      git(person, 'branch', 'later')
      yield* freshCopy(person, copy, 'main', refreshWithGit, mirror)
      git(copy, 'fetch', '-q')
      assert.include(git(copy, 'branch', '--list', 'later'), 'later')
    }),
  )

  it.effect('are the remote’s default branch as of now: a branch gone from the remote goes, and a remote of any name is fetched', () =>
    Effect.gen(function* () {
      const { remote, person, copy } = place()
      // The person names their remote otherwise, and has a commit on main they haven't pushed.
      git(person, 'remote', 'rename', 'origin', 'github')
      git(person, 'commit', '-q', '--allow-empty', '-m', 'Not pushed')
      const seed = join(remote, '..', 'seed')
      git(seed, 'switch', '-q', 'main')
      git(seed, 'commit', '-q', '--allow-empty', '-m', 'Pushed since')
      git(seed, 'push', '-q', 'origin', 'main')
      yield* freshCopy(person, copy, 'main', refreshWithGit)
      git(copy, 'fetch', '-q')
      assert.strictEqual(git(copy, 'log', '-1', '--format=%s', 'HEAD'), 'Pushed since')
      assert.strictEqual(git(copy, 'log', '-1', '--format=%s', 'github/feature/retry'), 'Retry')
      // A branch deleted on the remote isn't there at the next turn.
      git(seed, 'push', '-q', 'origin', '--delete', 'feature/retry')
      const made = yield* freshCopy(person, copy, 'main', refreshWithGit)
      assert.isNull(made.stale)
      git(copy, 'fetch', '-q', '--prune')
      assert.strictEqual(git(copy, 'branch', '-r', '--list', 'github/feature/retry'), '')
    }),
  )

  it.effect('say so where the remote couldn’t be fetched, and are its branch as last fetched, never what wasn’t pushed', () =>
    Effect.gen(function* () {
      const { remote, person, copy } = place()
      const fetched = git(person, 'rev-parse', 'origin/main')
      git(person, 'commit', '-q', '--allow-empty', '-m', 'Not pushed')
      // The remote is gone, as offline.
      rmSync(remote, { recursive: true, force: true })
      const made = yield* freshCopy(person, copy, 'main', refreshWithGit)
      assert.strictEqual(made.commit, fetched)
      assert.strictEqual(git(copy, 'rev-parse', 'HEAD'), fetched)
      assert.strictEqual(made.stale?.at, 'origin/main as last fetched')
      assert.match(made.stale?.why ?? '', /^Althar couldn't fetch origin: /)
      // With no remote at all, it is the branch as this computer has it, which nothing is ahead of.
      git(person, 'remote', 'remove', 'origin')
      const alone = yield* freshCopy(person, copy, 'main', refreshWithGit)
      assert.isNull(alone.stale)
      assert.strictEqual(git(copy, 'log', '-1', '--format=%s', 'HEAD'), 'Not pushed')
    }),
  )

  it.effect('are fetched as the refresh they are given says, so Althar’s sign-in can bring them', () =>
    Effect.gen(function* () {
      const { person, copy } = place()
      const asked: Array<string> = []
      const made = yield* freshCopy(person, copy, 'main', (repository) => {
        asked.push(repository)
        return Effect.succeed({ remote: 'origin', failed: [{ remote: 'origin', why: 'its sign-in has expired' }] })
      })
      assert.deepStrictEqual(asked, [person])
      assert.deepStrictEqual(made.stale, {
        why: "Althar couldn't fetch origin: its sign-in has expired",
        at: 'origin/main as last fetched',
      })
    }),
  )

  it('may read git’s config files but never its credential store, which is in the same folder', () => {
    const home = realpathSync(mkdtempSync(join(tmpdir(), 'althar-home-')))
    const projectFolder = join(home, 'worktrees', 'meridian')
    const place = { home, projectFolder, folder: join(projectFolder, '.coordinator'), mirrors: join(projectFolder, '.coordinator-mirrors') }
    const within = (path: string, places: ReadonlyArray<string>) => places.some((given) => path === given || path.startsWith(`${given}/`))
    const holds = (gitConfig: string, xdgConfig?: string) => {
      mkdirSync(gitConfig, { recursive: true })
      writeFileSync(join(gitConfig, 'config'), '[core]\n')
      writeFileSync(join(gitConfig, 'credentials'), 'https://dana:sentinel-token@github.com\n')
      const { allowed, denied } = readsOf({ ...place, xdgConfig, objects: [], repositories: [join(home, 'Projects', 'meridian')] })
      assert.isFalse(within(join(gitConfig, 'credentials'), allowed), 'the credential store is given back')
      assert.isTrue(within(join(gitConfig, 'credentials'), denied), 'the credential store isn’t held from it')
      assert.isTrue(within(join(gitConfig, 'config'), allowed), 'git’s config isn’t given back')
    }
    holds(join(home, '.config', 'git'))
    // Where XDG_CONFIG_HOME is set, outside the home folder, as git reads it.
    const elsewhere = realpathSync(mkdtempSync(join(tmpdir(), 'althar-xdg-')))
    holds(join(elsewhere, 'git'), elsewhere)
    rmSync(home, { recursive: true, force: true })
    rmSync(elsewhere, { recursive: true, force: true })
  })
})
