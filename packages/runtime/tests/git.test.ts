import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, it as effect } from '@effect/vitest'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import {
  addReadCopy,
  commitRecord,
  commitsOf,
  defaultBranch,
  fetchInto,
  git,
  gitIn,
  gitOutcome,
  indexStamp,
  isReadCopy,
  remoteOf,
  treeOf,
} from '../src/git'

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

/** Runs git in a folder as the test, with an author: its output. */
const run = (cwd: string, ...args: Array<string>) =>
  execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@althar.test', ...args], { cwd })
    .toString()
    .trim()

describe('a repository’s default branch', () => {
  effect.live('is what origin says, as git last saw it or by asking it', () =>
    Effect.gen(function* () {
      const remote = repository()
      run(remote.path, 'branch', '-m', 'main', 'trunk')
      const { path } = repository()
      run(path, 'remote', 'add', 'origin', remote.path)
      // Never fetched: origin is asked.
      assert.strictEqual(yield* defaultBranch(path), 'trunk')
      // Fetched, git knows it.
      run(path, 'fetch', '-q', 'origin')
      run(path, 'remote', 'set-head', 'origin', 'trunk')
      assert.strictEqual(yield* defaultBranch(path), 'trunk')
    }),
  )

  effect.live('is the first of the usual names this repository has without a remote that says, else main', () =>
    Effect.gen(function* () {
      const { path } = repository()
      run(path, 'branch', '-m', 'main', 'feature')
      assert.strictEqual(yield* defaultBranch(path), 'main')
      run(path, 'branch', 'develop')
      assert.strictEqual(yield* defaultBranch(path), 'develop')
      run(path, 'branch', 'master')
      assert.strictEqual(yield* defaultBranch(path), 'master')
    }),
  )
})

describe('the remote a repository’s work goes to', () => {
  effect.live('is the one its default branch follows, else origin, else its only one; none of several, or none at all', () =>
    Effect.gen(function* () {
      const { path } = repository()
      assert.isNull(yield* remoteOf(path, 'main'))
      run(path, 'remote', 'add', 'upstream', 'https://github.test/meridian/api.git')
      assert.strictEqual(yield* remoteOf(path, 'main'), 'upstream')
      run(path, 'remote', 'add', 'fork', 'https://github.test/you/api.git')
      assert.isNull(yield* remoteOf(path, 'main'))
      run(path, 'remote', 'add', 'origin', 'https://github.test/team/api.git')
      assert.strictEqual(yield* remoteOf(path, 'main'), 'origin')
      run(path, 'config', 'branch.main.remote', 'fork')
      run(path, 'config', 'branch.main.merge', 'refs/heads/main')
      assert.strictEqual(yield* remoteOf(path, 'main'), 'fork')
      // A default branch that follows a branch here follows no remote.
      run(path, 'config', 'branch.main.remote', '.')
      assert.strictEqual(yield* remoteOf(path, 'main'), 'origin')
    }),
  )
})

describe('a commit’s record', () => {
  /** Writes a commit object as given, as git takes it without checking it. */
  const written = (cwd: string, text: string) =>
    execFileSync('git', ['hash-object', '-w', '-t', 'commit', '--literally', '--stdin'], { cwd, input: text }).toString().trim()

  effect.live('keeps a message in another encoding, and a signature, as what making it again would lose or change', () =>
    Effect.gen(function* () {
      const { path, head } = repository()
      const tree = run(path, 'rev-parse', 'HEAD^{tree}')
      const plain = yield* commitRecord(path, head)
      assert.deepInclude(plain, { tree, parents: [], message: 'Start\n', keeps: false, signed: false })
      assert.deepInclude(plain.author, { name: 'T', email: 't@althar.test' })
      const who = 'T <t@althar.test> 1760000000 +0200'
      const latin = written(path, `tree ${tree}\nparent ${head}\nauthor ${who}\ncommitter ${who}\nencoding ISO-8859-1\n\nCaf\u00e9\n`)
      assert.deepInclude(yield* commitRecord(path, latin), { parents: [head], keeps: true, signed: false })
      const utf8 = written(path, `tree ${tree}\nauthor ${who}\ncommitter ${who}\nencoding UTF-8\n\nCaf\u00e9\n`)
      assert.deepInclude(yield* commitRecord(path, utf8), { keeps: false })
      const signed = written(
        path,
        `tree ${tree}\nauthor ${who}\ncommitter ${who}\ngpgsig -----BEGIN PGP SIGNATURE-----\n \n -----END PGP SIGNATURE-----\n\nSigned\n`,
      )
      const record = yield* commitRecord(path, signed)
      assert.deepInclude(record, { signed: true, keeps: false, message: 'Signed\n' })
      assert.deepStrictEqual(record.committer, { name: 'T', email: 't@althar.test', date: '1760000000 +0200' })
      // One with no message at all has an empty one.
      const bare = written(path, `tree ${tree}\nauthor ${who}\ncommitter ${who}\n`)
      assert.strictEqual((yield* commitRecord(path, bare)).message, '')
    }),
  )

  effect.live('fails, saying so, for a commit whose author git can’t read', () =>
    Effect.gen(function* () {
      const { path } = repository()
      const tree = run(path, 'rev-parse', 'HEAD^{tree}')
      const broken = written(path, `tree ${tree}\nauthor someone\ncommitter T <t@althar.test> 1760000000 +0200\n\nBroken\n`)
      const failed = yield* Effect.flip(commitRecord(path, broken))
      assert.strictEqual(failed.stderr, 'A commit git could not be read.')
    }),
  )
})

describe('names of commits', () => {
  effect.live('are each read as one commit, never as an option, and null where git doesn’t know one here', () =>
    Effect.gen(function* () {
      const { path, head } = repository()
      assert.deepStrictEqual(yield* commitsOf(path, ['HEAD', 'main', 'nope', '--all', 'two words', 'HEAD^{tree}']), [
        head,
        head,
        null,
        null,
        null,
        null,
      ])
      // None that is one name asks git nothing.
      assert.deepStrictEqual(yield* commitsOf(path, ['two words', 'a:b']), [null, null])
      // Outside a repository, none is known.
      assert.deepStrictEqual(yield* commitsOf(mkdtempSync(join(tmpdir(), 'althar-not-a-repo-')), ['HEAD']), [null])
    }),
  )
})

describe('what a worktree holds', () => {
  effect.live('is a tree of its files, staged or not, even before anything was ever staged', () =>
    Effect.gen(function* () {
      const path = mkdtempSync(join(tmpdir(), 'althar-fresh-'))
      run(path, 'init', '-q', '-b', 'main')
      writeFileSync(join(path, 'new.txt'), 'new\n')
      const tree = yield* treeOf(path)
      assert.strictEqual(run(path, 'ls-tree', '--name-only', tree), 'new.txt')
      // The worktree's own staging is as it was: nothing.
      assert.strictEqual(run(path, 'ls-files'), '')
    }),
  )

  effect.live('has an index stamp that changes as it stages, in a linked worktree too, and none where there is no index', () =>
    Effect.gen(function* () {
      const { path } = repository()
      const linked = join(mkdtempSync(join(tmpdir(), 'althar-linked-')), 'linked')
      run(path, 'worktree', 'add', '-q', '-b', 'other', linked)
      const before = yield* indexStamp(linked)
      assert.notStrictEqual(before, '')
      writeFileSync(join(linked, 'more.txt'), 'more\n')
      run(linked, 'add', 'more.txt')
      assert.notStrictEqual(yield* indexStamp(linked), before)
      assert.notStrictEqual(yield* indexStamp(path), '')
      assert.strictEqual(yield* indexStamp(mkdtempSync(join(tmpdir(), 'althar-not-a-repo-'))), '')
    }),
  )
})

describe('a git command whose failure says something', () => {
  effect.live('gives its exit code and output, and 128 where git couldn’t even start there', () =>
    Effect.gen(function* () {
      const { path, head } = repository()
      assert.deepStrictEqual(yield* gitOutcome(path, 'rev-parse', 'HEAD'), { code: 0, stdout: head })
      assert.strictEqual((yield* gitOutcome(path, 'merge-base', '--is-ancestor', head, '0'.repeat(40))).code, 128)
      assert.strictEqual((yield* gitOutcome(path, 'config', '--get', 'no.such')).code, 1)
      assert.strictEqual((yield* gitOutcome(join(path, 'gone'), 'status')).code, 128)
    }),
  )
})

describe('a branch fetched from a remote by its URL', () => {
  effect.live('is fetched into a ref here, signed in or not, and is nothing where the remote hasn’t it', () =>
    Effect.gen(function* () {
      const remote = repository()
      const { path } = repository()
      const signed = { url: remote.path, header: 'Authorization: Basic eDp5' }
      assert.strictEqual(yield* fetchInto(path, signed, 'main', 'refs/althar/base/main'), remote.head)
      assert.strictEqual(run(path, 'rev-parse', 'refs/althar/base/main'), remote.head)
      assert.strictEqual(yield* fetchInto(path, { url: remote.path, header: null }, 'main', 'refs/althar/other'), remote.head)
      assert.isNull(yield* fetchInto(path, signed, 'nope', 'refs/althar/nope'))
    }),
  )
})
