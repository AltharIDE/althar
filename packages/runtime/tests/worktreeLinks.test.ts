import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { git, mendingUnder } from '../src/git'

import { linkBroke, linkOf, takenFrom, worktreeAt } from '../src/worktreeLinks'

/*
 * The link between a worktree and its repository, read from git's own files
 * without git: the shapes the repair tests' real repositories don't reach,
 * written by hand.
 */

const place = () => mkdtempSync(join(tmpdir(), 'althar-links-'))

const write = (file: string, text: string) => {
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, text)
}

/** A repository's main checkout at `root/main` with a record `name` of a worktree, its HEAD and its back-link. */
const repository = (root: string, name: string, head: string, back: string | null) => {
  const record = join(root, 'main', '.git', 'worktrees', name)
  write(join(record, 'HEAD'), head)
  if (back !== null) write(join(record, 'gitdir'), back)
  return record
}

describe('linkOf', () => {
  it('reads a folder with no .git, or a .git folder, as not linked', () => {
    const root = place()
    assert.deepStrictEqual(linkOf(root), { state: 'not_linked' })
    mkdirSync(join(root, '.git'))
    assert.deepStrictEqual(linkOf(root), { state: 'not_linked' })
    assert.deepStrictEqual(linkOf(join(root, 'nowhere')), { state: 'missing' })
  })

  it('reads a .git file that names no git directory as a broken gitfile', () => {
    const root = place()
    write(join(root, '.git'), 'not a gitfile\n')
    assert.deepStrictEqual(linkOf(root), { state: 'broken', why: 'gitfile', gitdir: null })
  })

  it('reads a git directory with no back-link, as a submodule has, as fine', () => {
    const root = place()
    write(join(root, 'modules', 'one', 'HEAD'), 'ref: refs/heads/main\n')
    write(join(root, 'sub', '.git'), `gitdir: ${join(root, 'modules', 'one')}\n`)
    assert.deepStrictEqual(linkOf(join(root, 'sub')), { state: 'fine' })
  })

  it('reads an empty back-link, or one that can’t be read, as broken', () => {
    const root = place()
    const record = repository(root, 'task', 'ref: refs/heads/task\n', '')
    write(join(root, 'task', '.git'), `gitdir: ${record}\n`)
    assert.deepStrictEqual(linkOf(join(root, 'task')), { state: 'broken', why: 'back_link', gitdir: record })
    const other = repository(root, 'other', 'ref: refs/heads/other\n', null)
    mkdirSync(join(other, 'gitdir'))
    write(join(root, 'other', '.git'), `gitdir: ${other}\n`)
    assert.deepStrictEqual(linkOf(join(root, 'other')), { state: 'broken', why: 'back_link', gitdir: other })
  })
})

describe('takenFrom', () => {
  it('finds nothing where the main checkout isn’t a repository', () => {
    const root = place()
    const folder = join(root, 'task')
    write(join(folder, '.git'), 'gitdir: /nowhere\n')
    assert.isNull(takenFrom(folder, linkOf(folder), join(root, 'gone'), null))
    // A repository with no worktrees recorded.
    mkdirSync(join(root, 'plain', '.git'), { recursive: true })
    assert.isNull(takenFrom(folder, linkOf(folder), join(root, 'plain'), null))
    write(join(root, 'main', '.git'), 'nothing here\n')
    assert.isNull(takenFrom(folder, linkOf(folder), join(root, 'main'), null))
  })

  it('reads the records of a main checkout whose .git is a file, through its commondir or not', () => {
    const root = place()
    const common = join(root, 'store')
    const record = join(common, 'worktrees', 'task')
    write(join(record, 'HEAD'), 'ref: refs/heads/someone-else\n')
    write(join(record, 'gitdir'), `${join(root, 'gone', '.git')}\n`)
    write(join(common, 'checkout', 'commondir'), '..\n')
    write(join(root, 'main', '.git'), `gitdir: ${join(common, 'checkout')}\n`)
    const folder = join(root, 'task')
    write(join(folder, '.git'), `gitdir: ${record}\n`)
    assert.deepStrictEqual(takenFrom(folder, linkOf(folder), join(root, 'main'), 'task'), { branch: 'someone-else' })
    // With no commondir, the git directory the file names is the common one.
    write(join(root, 'bare', '.git'), `gitdir: ${common}\n`)
    assert.deepStrictEqual(takenFrom(folder, linkOf(folder), join(root, 'bare'), 'task'), { branch: 'someone-else' })
  })

  it('finds no record for a folder whose .git names none, or names one by a name the repository hasn’t', () => {
    const root = place()
    repository(root, 'kept', 'ref: refs/heads/kept\n', join(root, 'kept', '.git'))
    const folder = join(root, 'task')
    write(join(folder, '.git'), 'garbled\n')
    assert.isNull(takenFrom(folder, linkOf(folder), join(root, 'main'), 'task'))
    write(join(folder, '.git'), `gitdir: ${join(root, 'old', 'worktrees', 'unknown')}\n`)
    assert.isNull(takenFrom(folder, linkOf(folder), join(root, 'main'), 'task'))
  })

  it('takes a record by its name whose back-link is empty, and one on no branch, as free', () => {
    const root = place()
    repository(root, 'task', 'ref: refs/heads/task\n', '')
    const folder = join(root, 'task')
    write(join(folder, '.git'), `gitdir: ${join(root, 'old', 'worktrees', 'task')}\n`)
    assert.isNull(takenFrom(folder, linkOf(folder), join(root, 'main'), 'task'))
    repository(root, 'review', '0123456789abcdef0123456789abcdef01234567\n', join(root, 'gone', '.git'))
    const copy = join(root, 'review')
    write(join(copy, '.git'), `gitdir: ${join(root, 'old', 'worktrees', 'review')}\n`)
    assert.isNull(takenFrom(copy, linkOf(copy), join(root, 'main'), false))
  })
})

describe('worktreeAt', () => {
  it('finds the nearest folder with a .git, and none above where it looks', () => {
    const root = place()
    write(join(root, 'repo', '.git'), 'gitdir: x\n')
    mkdirSync(join(root, 'repo', 'a', 'b'), { recursive: true })
    assert.strictEqual(worktreeAt(join(root, 'repo', 'a', 'b'), root), join(root, 'repo'))
    mkdirSync(join(root, 'plain', 'c'), { recursive: true })
    assert.isNull(worktreeAt(join(root, 'plain', 'c'), join(root, 'plain')))
    assert.isNull(worktreeAt(join(root, 'plain'), join(root, 'repo')))
    assert.isNull(worktreeAt('/', '/'))
  })
})

describe('linkBroke', () => {
  it('heeds git’s own line, not a host’s or a hook’s', () => {
    assert.isTrue(linkBroke('fatal: not a git repository: /x/.git/worktrees/t\n'))
    assert.isFalse(linkBroke('remote: fatal: not a git repository\n'))
    assert.isFalse(linkBroke('fatal: Authentication failed\n'))
  })
})

describe('a git command in a worktree whose link broke', () => {
  const broken = () => {
    const root = place()
    const folder = join(root, 'task')
    write(join(folder, '.git'), 'gitdir: /nowhere/old/.git/worktrees/task\n')
    return { root, folder }
  }

  it.effect('fails with git’s line where no mender knows the folder', () =>
    Effect.gen(function* () {
      const { folder } = broken()
      const failed = yield* Effect.flip(git(folder, 'status'))
      assert.isTrue(linkBroke(failed.stderr))
    }),
  )

  it.live('asks the mender of the folder it is in, and runs once more only where it mended it', () =>
    Effect.gen(function* () {
      const { root, folder } = broken()
      const asked: Array<string> = []
      yield* mendingUnder(folder, (at) => Effect.sync(() => (asked.push(at), false)))
      yield* Effect.flip(git(folder, 'status'))
      assert.deepStrictEqual(asked, [folder])
      // A mender for the folders above: it puts this one's link right, and the command runs once more.
      const repository = join(root, 'repo')
      execFileSync('git', ['init', '-q', repository])
      const other = join(root, 'other')
      write(join(other, '.git'), 'gitdir: /nowhere/old/.git/worktrees/other\n')
      yield* mendingUnder(root, (at) =>
        Effect.sync(() => {
          write(join(at, '.git'), `gitdir: ${join(repository, '.git')}\n`)
          return true
        }),
      )
      assert.strictEqual(yield* git(other, 'rev-parse', '--is-inside-git-dir'), 'false')
    }).pipe(Effect.scoped),
  )
})
