import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, it as effect } from '@effect/vitest'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { addReadCopy, git, gitIn, isReadCopy } from '../src/git'

/*
 * How a git command runs in a folder: where it is the document portal's FUSE
 * mount (inside a Flatpak), name the repository explicitly and use the stable
 * app home as cwd; everywhere else the process starts in the folder itself.
 */

describe('git in a folder', () => {
  it('starts in the folder itself, as it always has', () => {
    expect(gitIn('/home/me/project', ['status'])).toEqual({ args: ['status'], cwd: '/home/me/project' })
    expect(gitIn('/home/me/.var/app/dev.althar.app/data/althar/worktrees/p/t', ['status'])).toEqual({
      args: ['status'],
      cwd: '/home/me/.var/app/dev.althar.app/data/althar/worktrees/p/t',
    })
  })

  it('names the git directory and the work tree where it is the document portal’s FUSE mount, so nothing chdirs into it', () => {
    expect(gitIn('/run/flatpak/doc/abc/project', ['-c', 'x=y', 'status'])).toEqual({
      args: ['--git-dir', '/run/flatpak/doc/abc/project/.git', '--work-tree', '/run/flatpak/doc/abc/project', '-c', 'x=y', 'status'],
      cwd: homedir(),
    })
    expect(gitIn('/run/flatpak/doc', ['status'])).toEqual({
      args: ['--git-dir', '/run/flatpak/doc/.git', '--work-tree', '/run/flatpak/doc', 'status'],
      cwd: homedir(),
    })
    // A path that only begins like the portal is an ordinary folder.
    expect(gitIn('/run/flatpak/docx/project', ['status'])).toEqual({ args: ['status'], cwd: '/run/flatpak/docx/project' })
  })
})

/** A repository with one commit, in the object format given. */
const repository = (format: 'sha1' | 'sha256' = 'sha1') => {
  const path = mkdtempSync(join(tmpdir(), 'althar-read-copy-'))
  const run = (...args: Array<string>) =>
    execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@althar.test', ...args], { cwd: path })
      .toString()
      .trim()
  run('init', '-q', `--object-format=${format}`, '-b', 'main')
  writeFileSync(join(path, 'README.md'), '# Copied\n')
  run('add', '.')
  run('commit', '-q', '-m', 'Start')
  return { path, head: run('rev-parse', 'HEAD') }
}

describe('a copy to read someone else’s code', () => {
  effect.live('is a repository of its own, marked, at the commit, whatever object format the person’s repository uses', () =>
    Effect.gen(function* () {
      for (const format of ['sha1', 'sha256'] as const) {
        const { path, head } = repository(format)
        const copy = join(mkdtempSync(join(tmpdir(), 'althar-copies-')), 'copy')
        yield* addReadCopy(path, copy, head, { 'refs/althar/review/head': head })
        assert.isTrue(isReadCopy(copy), format)
        assert.strictEqual(yield* git(copy, 'rev-parse', 'HEAD', 'refs/althar/review/head'), `${head}\n${head}`)
        // Its git folder is its own, not the person's repository's.
        assert.strictEqual(yield* git(copy, 'rev-parse', '--git-common-dir'), '.git')
        assert.isFalse(isReadCopy(path))
      }
    }),
  )

  effect.live('goes only in a folder of its own, and leaves none behind where git couldn’t finish it', () =>
    Effect.gen(function* () {
      const { path, head } = repository()
      const taken = mkdtempSync(join(tmpdir(), 'althar-taken-'))
      mkdirSync(join(taken, 'keep'))
      const refused = yield* Effect.flip(addReadCopy(path, taken, head))
      assert.strictEqual(refused.stderr, 'The copy’s folder is taken.')
      assert.isTrue(existsSync(join(taken, 'keep')))
      const copy = join(mkdtempSync(join(tmpdir(), 'althar-copies-')), 'copy')
      yield* Effect.flip(addReadCopy(path, copy, '0'.repeat(40)))
      assert.isFalse(existsSync(copy))
    }),
  )
})
