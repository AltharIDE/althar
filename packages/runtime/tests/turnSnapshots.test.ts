import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { takeSnapshot, planRestore, applyRestore, rollBackRestore } from '../src/turnSnapshots'
import { repository } from './support'

const run = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@althar.test', ...args], { cwd })
    .toString()
    .trim()
const read = (cwd: string, path = 'README.md') => readFileSync(join(cwd, path), 'utf8')

describe('the files of a chat turn', () => {
  it.live('restores edits, additions, deletions and binary files, preserving unrelated work and Git history', () =>
    Effect.gen(function* () {
      const cwd = repository()
      writeFileSync(join(cwd, 'deleted.txt'), 'keep me')
      writeFileSync(join(cwd, 'binary'), Buffer.from([0, 1, 255]))
      run(cwd, 'add', '.')
      run(cwd, 'commit', '-qm', 'Before')
      // A dirty file at the boundary belongs in the checkpoint too.
      writeFileSync(join(cwd, 'README.md'), 'The person’s uncommitted work\n')
      const before = yield* takeSnapshot(cwd, 'refs/althar/test/before')
      writeFileSync(join(cwd, 'README.md'), 'Agent’s change\n')
      writeFileSync(join(cwd, 'new.txt'), 'new')
      writeFileSync(join(cwd, 'binary'), Buffer.from([0, 128]))
      rmSync(join(cwd, 'deleted.txt'))
      run(cwd, 'add', '.')
      run(cwd, 'commit', '-qm', 'Agent turn')
      const after = yield* takeSnapshot(cwd, 'refs/althar/test/after')
      writeFileSync(join(cwd, 'unrelated.txt'), 'Written afterwards')
      const plan = yield* planRestore(cwd, before, after, 'refs/althar/test/recovery')
      yield* applyRestore(plan)
      assert.strictEqual(read(cwd), 'The person’s uncommitted work\n')
      assert.strictEqual(read(cwd, 'deleted.txt'), 'keep me')
      assert.deepStrictEqual(readFileSync(join(cwd, 'binary')), Buffer.from([0, 1, 255]))
      assert.isFalse(existsSync(join(cwd, 'new.txt')))
      assert.strictEqual(read(cwd, 'unrelated.txt'), 'Written afterwards')
      assert.strictEqual(run(cwd, 'rev-parse', 'HEAD'), after.head)
      assert.strictEqual(run(cwd, 'diff', '--cached'), '')
      yield* rollBackRestore(plan)
      assert.strictEqual(read(cwd), 'Agent’s change\n')
      assert.strictEqual(read(cwd, 'new.txt'), 'new')
    }),
  )

  it.live('refuses overlapping later edits before changing any file', () =>
    Effect.gen(function* () {
      const cwd = repository()
      const before = yield* takeSnapshot(cwd, 'refs/althar/test/before')
      writeFileSync(join(cwd, 'README.md'), 'Agent')
      writeFileSync(join(cwd, 'added'), 'Agent')
      const after = yield* takeSnapshot(cwd, 'refs/althar/test/after')
      writeFileSync(join(cwd, 'README.md'), 'Manual edit afterwards')
      const refused = yield* Effect.flip(planRestore(cwd, before, after, 'refs/althar/test/recovery'))
      assert.strictEqual(refused._tag, 'UndoRefused')
      assert.strictEqual(read(cwd), 'Manual edit afterwards')
      assert.strictEqual(read(cwd, 'added'), 'Agent')
    }),
  )

  it.live('does not overwrite staging or restore onto another branch', () =>
    Effect.gen(function* () {
      const cwd = repository()
      const before = yield* takeSnapshot(cwd, 'refs/althar/test/before')
      writeFileSync(join(cwd, 'README.md'), 'Agent')
      const after = yield* takeSnapshot(cwd, 'refs/althar/test/after')
      run(cwd, 'add', 'README.md')
      assert.strictEqual((yield* Effect.flip(planRestore(cwd, before, after, 'refs/althar/test/recovery')))._tag, 'UndoRefused')
      run(cwd, 'reset', '-q')
      run(cwd, 'switch', '-qc', 'other')
      assert.strictEqual((yield* Effect.flip(planRestore(cwd, before, after, 'refs/althar/test/recovery')))._tag, 'UndoRefused')
    }),
  )

  it.live('checks again before writing and refuses a parent replaced by a symlink', () =>
    Effect.gen(function* () {
      const cwd = repository()
      mkdirSync(join(cwd, 'folder'))
      writeFileSync(join(cwd, 'folder/file'), 'Before')
      const before = yield* takeSnapshot(cwd, 'refs/althar/test/before')
      writeFileSync(join(cwd, 'folder/file'), 'After')
      const after = yield* takeSnapshot(cwd, 'refs/althar/test/after')
      const plan = yield* planRestore(cwd, before, after, 'refs/althar/test/recovery')
      const outside = repository()
      writeFileSync(join(outside, 'file'), 'Outside')
      rmSync(join(cwd, 'folder'), { recursive: true })
      symlinkSync(outside, join(cwd, 'folder'), process.platform === 'win32' ? 'junction' : 'dir')
      assert.strictEqual((yield* Effect.flip(applyRestore(plan)))._tag, 'UndoRefused')
      assert.strictEqual(read(outside, 'file'), 'Outside')
    }),
  )

  it.live('keeps a later manual edit when recovery of an interrupted undo cannot safely finish', () =>
    Effect.gen(function* () {
      const cwd = repository()
      const before = yield* takeSnapshot(cwd, 'refs/althar/test/before')
      writeFileSync(join(cwd, 'README.md'), 'Agent')
      const after = yield* takeSnapshot(cwd, 'refs/althar/test/after')
      const plan = yield* planRestore(cwd, before, after, 'refs/althar/test/recovery')
      yield* applyRestore(plan)
      writeFileSync(join(cwd, 'README.md'), 'Manual edit after the interrupted undo')
      assert.strictEqual((yield* Effect.flip(rollBackRestore(plan)))._tag, 'UndoRefused')
      assert.strictEqual(read(cwd), 'Manual edit after the interrupted undo')
      assert.strictEqual(run(cwd, 'show', `${plan.recovery.ref}:README.md`), 'Agent')
    }),
  )

  it.live('refuses recovery after either the branch or HEAD moves and retains the saved contents', () =>
    Effect.gen(function* () {
      const cwd = repository()
      const before = yield* takeSnapshot(cwd, 'refs/althar/test/before')
      writeFileSync(join(cwd, 'README.md'), 'Agent')
      const after = yield* takeSnapshot(cwd, 'refs/althar/test/after')
      const plan = yield* planRestore(cwd, before, after, 'refs/althar/test/recovery')
      yield* applyRestore(plan)
      run(cwd, 'switch', '-qc', 'another-branch')
      assert.strictEqual((yield* Effect.flip(rollBackRestore(plan)))._tag, 'UndoRefused')
      run(cwd, 'switch', '-q', '-')
      writeFileSync(join(cwd, 'new-commit.txt'), 'Later commit')
      run(cwd, 'add', 'new-commit.txt')
      run(cwd, 'commit', '-qm', 'Later commit')
      assert.strictEqual((yield* Effect.flip(rollBackRestore(plan)))._tag, 'UndoRefused')
      assert.strictEqual(run(cwd, 'show', `${plan.recovery.ref}:README.md`), 'Agent')
      assert.strictEqual(read(cwd, 'new-commit.txt'), 'Later commit')
    }),
  )

  it.live('rejects invalid restore paths before writing inside or outside the repository', () =>
    Effect.gen(function* () {
      const cwd = repository()
      const before = yield* takeSnapshot(cwd, 'refs/althar/test/before')
      writeFileSync(join(cwd, 'README.md'), 'Agent')
      const after = yield* takeSnapshot(cwd, 'refs/althar/test/after')
      for (const path of ['.', '..', '../outside.txt']) {
        const error = yield* Effect.flip(planRestore(cwd, before, after, 'refs/althar/test/recovery', [path]))
        // Git itself rejects some out-of-tree pathspecs before the filesystem check is reached.
        assert.oneOf(error._tag, ['UndoRefused', 'GitFailed'])
        if (path === '.') assert.strictEqual(error._tag, 'UndoRefused')
      }
      assert.strictEqual(read(cwd), 'Agent')
    }),
  )

  it.live('preserves an ignored file that reappeared after the turn deleted it', () =>
    Effect.gen(function* () {
      const cwd = repository()
      writeFileSync(join(cwd, 'local.txt'), 'Before the turn')
      const before = yield* takeSnapshot(cwd, 'refs/althar/test/before')
      rmSync(join(cwd, 'local.txt'))
      writeFileSync(join(cwd, '.gitignore'), 'local.txt\n')
      const after = yield* takeSnapshot(cwd, 'refs/althar/test/after')
      writeFileSync(join(cwd, 'local.txt'), 'Manual contents after the turn')
      assert.strictEqual((yield* Effect.flip(planRestore(cwd, before, after, 'refs/althar/test/recovery')))._tag, 'UndoRefused')
      assert.strictEqual(read(cwd, 'local.txt'), 'Manual contents after the turn')
      assert.strictEqual(read(cwd, '.gitignore'), 'local.txt\n')
    }),
  )

  it.live('preserves a directory that replaced an affected file', () =>
    Effect.gen(function* () {
      const cwd = repository()
      const before = yield* takeSnapshot(cwd, 'refs/althar/test/before')
      writeFileSync(join(cwd, 'README.md'), 'Agent')
      const after = yield* takeSnapshot(cwd, 'refs/althar/test/after')
      rmSync(join(cwd, 'README.md'))
      mkdirSync(join(cwd, 'README.md'))
      writeFileSync(join(cwd, 'README.md/note.txt'), 'Manual contents')
      assert.strictEqual((yield* Effect.flip(planRestore(cwd, before, after, 'refs/althar/test/recovery')))._tag, 'UndoRefused')
      assert.strictEqual(read(cwd, 'README.md/note.txt'), 'Manual contents')
    }),
  )

  it.live('refuses a checkpoint that would restore a symlink, even when the current file is plain', () =>
    Effect.gen(function* () {
      const cwd = repository()
      writeFileSync(join(cwd, 'link'), 'README.md')
      run(cwd, 'add', 'link')
      const blob = run(cwd, 'rev-parse', ':link')
      // Store the old symlink as a Git tree, portable to hosts that cannot create filesystem symlinks.
      run(cwd, 'update-index', '--cacheinfo', `120000,${blob},link`)
      const tree = run(cwd, 'write-tree')
      const commit = run(cwd, 'commit-tree', tree, '-p', 'HEAD', '-m', 'Old link checkpoint')
      run(cwd, 'update-ref', 'refs/althar/test/before', commit)
      const before = {
        ref: 'refs/althar/test/before',
        head: run(cwd, 'rev-parse', 'HEAD'),
        branch: run(cwd, 'rev-parse', '--symbolic-full-name', 'HEAD'),
      }
      run(cwd, 'reset', '-q', 'HEAD', '--', 'link')
      writeFileSync(join(cwd, 'link'), 'Plain file after the turn')
      const after = yield* takeSnapshot(cwd, 'refs/althar/test/after')
      const error = yield* Effect.flip(planRestore(cwd, before, after, 'refs/althar/test/recovery'))
      assert.strictEqual(error._tag, 'UndoRefused')
      assert.strictEqual(read(cwd, 'link'), 'Plain file after the turn')
      assert.strictEqual(run(cwd, 'diff', '--cached'), '')
    }),
  )
})
