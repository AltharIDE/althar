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
})
