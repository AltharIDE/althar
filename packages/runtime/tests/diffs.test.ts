import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { baseOf, changedFiles, changedStretch, fileDiff, parseDiff } from '../src/diffs'
import { NotFound } from '../src/errors'

/** A repository whose task changed a file, moved one, deleted one, added two (one not yet added to git), and a picture. */
const changed = () => {
  const root = mkdtempSync(join(tmpdir(), 'althar-diffs-'))
  const git = (...args: Array<string>) =>
    execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@t.test', ...args], { cwd: root })
      .toString()
      .trim()
  git('init', '-q', '-b', 'main')
  writeFileSync(
    join(root, 'retry.ts'),
    ['const tries = 3', 'const wait = 100', '', 'export function retry() {', '  return tries', '}', ''].join('\n'),
  )
  writeFileSync(join(root, 'old.md'), '# Notes\n\nKeep these.\nAnd these.\nAnd more.\n')
  writeFileSync(join(root, 'gone.txt'), 'bye\n')
  writeFileSync(join(root, 'mark.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 1]))
  git('add', '.')
  git('commit', '-q', '-m', 'Start')
  const base = git('rev-parse', 'HEAD')
  // Committed on the task's branch.
  writeFileSync(
    join(root, 'retry.ts'),
    ['const tries = 5', 'const wait = 100', '', 'export function retry() {', '  return tries * wait', '}', ''].join('\n'),
  )
  renameSync(join(root, 'old.md'), join(root, 'notes.md'))
  rmSync(join(root, 'gone.txt'))
  mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'src', 'added.ts'), 'export const added = true\n')
  git('add', '-A')
  git('commit', '-q', '-m', 'Change')
  // Left in the worktree: a further edit, a new file nobody added, and a new picture.
  writeFileSync(join(root, 'mark.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 2]))
  writeFileSync(join(root, 'scratch.md'), 'one\ntwo\n')
  writeFileSync(join(root, 'empty.txt'), '')
  writeFileSync(join(root, 'tail.txt'), 'a\nb')
  writeFileSync(join(root, 'new.bin'), Buffer.from([1, 0, 2]))
  return { root, base }
}

describe('what a task changed', () => {
  it.effect('lists each file with how it changed, how much, and whether all of it is committed', () =>
    Effect.gen(function* () {
      const { root, base } = changed()
      const files = yield* changedFiles(root, base)
      assert.deepStrictEqual(
        files.map((file) => [file.path, file.status, file.from, file.add, file.del, file.binary, file.uncommitted]),
        [
          ['empty.txt', 'added', null, 0, 0, false, true],
          ['gone.txt', 'deleted', null, 0, 1, false, false],
          ['mark.png', 'modified', null, 0, 0, true, true],
          ['new.bin', 'added', null, 0, 0, true, true],
          ['notes.md', 'renamed', 'old.md', 0, 0, false, false],
          ['retry.ts', 'modified', null, 2, 2, false, false],
          ['scratch.md', 'added', null, 2, 0, false, true],
          ['src/added.ts', 'added', null, 1, 0, false, false],
          ['tail.txt', 'added', null, 2, 0, false, true],
        ],
      )
    }),
  )

  it.effect('gives a file’s lines in hunks, with line numbers and what differs marked', () =>
    Effect.gen(function* () {
      const { root, base } = changed()
      const diff = yield* fileDiff(root, base, 'retry.ts')
      assert.isFalse(diff.truncated)
      assert.deepStrictEqual(diff.lines, [
        { kind: 'hunk', text: '@@ -1,6 +1,6 @@' },
        { kind: 'removed', old: 1, text: 'const tries = 3', changed: ['3'] },
        { kind: 'added', new: 1, text: 'const tries = 5', changed: ['5'] },
        { kind: 'context', old: 2, new: 2, text: 'const wait = 100' },
        { kind: 'context', old: 3, new: 3, text: '' },
        { kind: 'context', old: 4, new: 4, text: 'export function retry() {' },
        // Only added to: nothing of the old line is marked.
        { kind: 'removed', old: 5, text: '  return tries' },
        { kind: 'added', new: 5, text: '  return tries * wait', changed: [' * wait'] },
        { kind: 'context', old: 6, new: 6, text: '}' },
      ])
    }),
  )

  it.effect('gives the whole file, unchanged lines and all, for the window to fold and open in place', () =>
    Effect.gen(function* () {
      const { root } = changed()
      // A long file whose one change is far from both ends.
      const long = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`)
      writeFileSync(join(root, 'long.txt'), `${long.join('\n')}\n`)
      execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@t.test', 'add', 'long.txt'], { cwd: root })
      execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@t.test', 'commit', '-q', '-m', 'Long'], { cwd: root })
      const from = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString().trim()
      writeFileSync(join(root, 'long.txt'), `${long.map((line, i) => (i === 19 ? 'line twenty' : line)).join('\n')}\n`)
      const diff = yield* fileDiff(root, from, 'long.txt')
      assert.deepStrictEqual(diff.lines[0], { kind: 'hunk', text: '@@ -1,40 +1,40 @@' })
      assert.deepStrictEqual(diff.lines[1], { kind: 'context', old: 1, new: 1, text: 'line 1' })
      assert.deepStrictEqual(diff.lines.at(-1), { kind: 'context', old: 40, new: 40, text: 'line 40' })
      assert.lengthOf(diff.lines, 42)
      // Too long to read whole, it comes in hunks, so a change far down is never lost behind its context.
      const huge = Array.from({ length: 25_000 }, (_, i) => `row ${i + 1}`)
      writeFileSync(join(root, 'huge.txt'), `${huge.join('\n')}\n`)
      execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@t.test', 'add', 'huge.txt'], { cwd: root })
      execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@t.test', 'commit', '-q', '-m', 'Huge'], { cwd: root })
      const before = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString().trim()
      writeFileSync(join(root, 'huge.txt'), `${huge.map((line, i) => (i === 24_000 ? 'row changed' : line)).join('\n')}\n`)
      const cut = yield* fileDiff(root, before, 'huge.txt')
      assert.isFalse(cut.truncated)
      assert.deepStrictEqual(cut.lines[0], { kind: 'hunk', text: '@@ -23998,7 +23998,7 @@ row 23997' })
      assert.isTrue(cut.lines.some((line) => line.kind === 'added' && line.text === 'row changed'))
    }),
  )

  it.effect('shows a new file nobody added yet as all new, a picture as binary, and nothing it didn’t change', () =>
    Effect.gen(function* () {
      const { root, base } = changed()
      const scratch = yield* fileDiff(root, base, 'scratch.md')
      assert.deepStrictEqual(scratch.lines, [
        { kind: 'hunk', text: '@@ -0,0 +1,2 @@' },
        { kind: 'added', new: 1, text: 'one' },
        { kind: 'added', new: 2, text: 'two' },
      ])
      // One without a newline at its end loses no line.
      const tail = yield* fileDiff(root, base, 'tail.txt')
      assert.deepStrictEqual(tail.lines.slice(1), [
        { kind: 'added', new: 1, text: 'a' },
        { kind: 'added', new: 2, text: 'b' },
      ])
      assert.isTrue((yield* fileDiff(root, base, 'new.bin')).file.binary)
      const added = yield* fileDiff(root, base, 'src/added.ts')
      assert.deepStrictEqual(added.lines.slice(1), [{ kind: 'added', new: 1, text: 'export const added = true' }])
      const gone = yield* fileDiff(root, base, 'gone.txt')
      assert.deepStrictEqual(gone.lines.slice(1), [{ kind: 'removed', old: 1, text: 'bye' }])
      const picture = yield* fileDiff(root, base, 'mark.png')
      assert.isTrue(picture.file.binary)
      assert.lengthOf(picture.lines, 0)
      // Moved without a change: no lines, and it says where it was.
      const moved = yield* fileDiff(root, base, 'notes.md')
      assert.strictEqual(moved.file.from, 'old.md')
      assert.lengthOf(moved.lines, 0)
      // A file the task didn't change, or one outside the worktree, isn't read.
      for (const path of ['README.md', '../../etc/hosts']) {
        const refused = yield* Effect.flip(fileDiff(root, base, path))
        assert.instanceOf(refused, NotFound)
      }
    }),
  )
})

/** A repository with one commit on main, and a git command for it. */
const started = () => {
  const root = mkdtempSync(join(tmpdir(), 'althar-diffs-'))
  const git = (...args: Array<string>) =>
    execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@t.test', ...args], { cwd: root })
      .toString()
      .trim()
  git('init', '-q', '-b', 'main')
  writeFileSync(join(root, 'README.md'), '# Meridian\n')
  git('add', '.')
  git('commit', '-q', '-m', 'Start')
  return { root, git, base: git('rev-parse', 'HEAD') }
}

describe('what a task changed, carefully', () => {
  it.effect('shows a new link as git would add it, its target, never what it points at; and reads nothing that isn’t a file', () =>
    Effect.gen(function* () {
      const { root, base } = started()
      const outside = join(mkdtempSync(join(tmpdir(), 'althar-secret-')), 'secrets.env')
      writeFileSync(outside, 'AWS_SECRET=abc123\n')
      symlinkSync(outside, join(root, 'notes.txt'))
      execFileSync('mkfifo', [join(root, 'pipe')])
      const files = yield* changedFiles(root, base)
      assert.deepStrictEqual(
        files.map((file) => [file.path, file.add]),
        [['notes.txt', 1]],
      )
      const link = yield* fileDiff(root, base, 'notes.txt')
      assert.deepStrictEqual(link.lines.slice(1), [{ kind: 'added', new: 1, text: outside }])
      assert.notInclude(JSON.stringify(link), 'abc123')
      // Asked for anyway, the pipe is nothing the task changed, and isn't waited on.
      assert.instanceOf(yield* Effect.flip(fileDiff(root, base, 'pipe')), NotFound)
    }),
  )

  it.effect('counts from where the branch meets its default branch, so upstream work merged in isn’t the task’s', () =>
    Effect.gen(function* () {
      const { root, git, base } = started()
      git('checkout', '-q', '-b', 'task')
      writeFileSync(join(root, 'mine.ts'), 'export const mine = 1\n')
      git('add', '.')
      git('commit', '-q', '-m', 'Mine')
      git('checkout', '-q', 'main')
      writeFileSync(join(root, 'upstream.ts'), 'export const theirs = 1\n')
      git('add', '.')
      git('commit', '-q', '-m', 'Theirs')
      git('checkout', '-q', 'task')
      git('merge', '-q', '--no-edit', 'main')
      const from = yield* baseOf(root, 'main', base)
      assert.deepStrictEqual(
        (yield* changedFiles(root, from)).map((file) => file.path),
        ['mine.ts'],
      )
      // Where the worktree started counts upstream's too; without a default branch to meet, that's what there is.
      assert.lengthOf(yield* changedFiles(root, base), 2)
      assert.strictEqual(yield* baseOf(root, null, base), base)
      assert.strictEqual(yield* baseOf(root, 'origin/gone', base), base)
    }),
  )

  it.effect('counts the lines of the first few dozen new files only, and reads a path as itself, not a pattern', () =>
    Effect.gen(function* () {
      const { root, base } = started()
      mkdirSync(join(root, 'out'))
      for (let index = 0; index < 55; index += 1) writeFileSync(join(root, 'out', `${String(index).padStart(2, '0')}.js`), 'x\n')
      writeFileSync(join(root, 'a[1].ts'), 'one\n')
      writeFileSync(join(root, 'a1.ts'), 'other\n')
      const files = yield* changedFiles(root, base)
      assert.lengthOf(files, 57)
      assert.lengthOf(
        files.filter((file) => file.add === 0),
        7,
      )
      const exact = yield* fileDiff(root, base, 'a[1].ts')
      assert.deepStrictEqual(exact.lines.slice(1), [{ kind: 'added', new: 1, text: 'one' }])
    }),
  )
})

describe('reading a diff', () => {
  it('cuts a long one short, and says so', () => {
    const long = ['@@ -1,0 +1,10 @@', ...Array.from({ length: 10 }, (_, index) => `+line ${index}`)].join('\n')
    const cut = parseDiff(long, 5)
    assert.isTrue(cut.truncated)
    assert.lengthOf(cut.lines, 5)
    assert.isFalse(parseDiff(long).truncated)
  })

  it('pairs a removed line with the added one after it, run by run', () => {
    const lines = parseDiff(['@@ -1,2 +1,2 @@', '+const a = 1', '-const b = 1', '+const b = 2'].join('\n')).lines
    assert.deepStrictEqual(
      lines.map((line) => [line.kind, 'changed' in line ? line.changed : undefined]),
      [
        ['hunk', undefined],
        ['added', undefined],
        ['removed', ['1']],
        ['added', ['2']],
      ],
    )
  })

  it('stops at the next file’s header', () => {
    const text = ['@@ -1 +1 @@', '-a', '+b', 'diff --git a/y b/y', '@@ -1 +1 @@', '-c'].join('\n')
    assert.deepStrictEqual(
      parseDiff(text).lines.map((line) => line.kind),
      ['hunk', 'removed', 'added', 'hunk', 'removed'],
    )
  })

  it('leaves out what isn’t a line of the file', () => {
    const text = ['diff --git a/x b/x', '--- a/x', '+++ b/x', '@@ -1 +1 @@', '-a', '\\ No newline at end of file', '+b', ''].join('\n')
    assert.deepStrictEqual(
      parseDiff(text).lines.map((line) => line.kind),
      ['hunk', 'removed', 'added'],
    )
  })

  it('marks what differs only where enough of the line stayed', () => {
    assert.deepStrictEqual(changedStretch('const wait = 100', 'const wait = 250'), [['100'], ['250']])
    assert.deepStrictEqual(changedStretch('const tries = 3', 'const tries = 5'), [['3'], ['5']])
    assert.deepStrictEqual(changedStretch('return a', 'throw new Error()'), [[], []])
    assert.deepStrictEqual(changedStretch('items', 'items.sort()'), [[], ['.sort()']])
    // What only spaces tell apart isn't marked.
    assert.deepStrictEqual(changedStretch('foo  ', 'foo'), [[], []])
  })
})
