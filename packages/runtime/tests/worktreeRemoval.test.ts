import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { vi } from 'vitest'

import * as spawner from '../src/spawner'
import { removeWorktree } from '../src/worktreeRemoval'

const worktree = () => {
  const root = mkdtempSync(join(tmpdir(), 'althar-worktree-removal-'))
  const git = (...args: Array<string>) =>
    execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@t.test', ...args], { cwd: root })
      .toString()
      .trim()
  git('init', '-q', '-b', 'main')
  writeFileSync(join(root, 'kept.txt'), 'Keep this work.\n')
  git('add', '.')
  git('commit', '-q', '-m', 'Keep it')
  const path = join(root, 'copy')
  git('worktree', 'add', '-b', 'task', path)
  return { root, path, git }
}

describe('removing a worktree before its checkout takes the branch', () => {
  it.effect('removes a clean worktree and keeps the branch available', () =>
    Effect.gen(function* () {
      const { root, path, git } = worktree()
      yield* removeWorktree(root, path)
      assert.isFalse(existsSync(path))
      assert.strictEqual(git('show', 'task:kept.txt'), 'Keep this work.')
      assert.notInclude(git('worktree', 'list', '--porcelain'), path.replaceAll('\\', '/'))
    }),
  )

  it.effect('uses forced removal for generated files while retaining the committed work', () =>
    Effect.gen(function* () {
      const { root, path, git } = worktree()
      writeFileSync(join(path, 'generated.log'), 'A generated build log.\n')
      yield* removeWorktree(root, path)
      assert.isFalse(existsSync(path))
      assert.strictEqual(git('show', 'task:kept.txt'), 'Keep this work.')
      assert.notInclude(git('worktree', 'list', '--porcelain'), path.replaceAll('\\', '/'))
    }),
  )

  it.effect('preserves a worktree locked between the first removal and its forced retry', () =>
    Effect.gen(function* () {
      const { root, path, git } = worktree()
      const spawn = spawner.startApart
      let first = true
      const mocked = vi.spyOn(spawner, 'startApart').mockImplementation((...args) => {
        const [command] = args
        if (first && command.command === 'git' && command.args.includes('remove') && command.args.includes(path)) {
          first = false
          git('worktree', 'lock', '--reason', 'Permission denied while in use', path)
          return {
            result: Promise.resolve({ code: 128, signal: null, error: null, over: false, stdout: '', stderr: 'Permission denied' }),
            stop: () => undefined,
          }
        }
        return spawn(...args)
      })
      const error = yield* Effect.flip(removeWorktree(root, path)).pipe(Effect.ensuring(Effect.sync(() => mocked.mockRestore())))
      if (error._tag !== 'GitFailed') assert.fail(`Expected GitFailed, got ${error._tag}`)
      assert.include(error.stderr, 'locked working tree')
      assert.isTrue(existsSync(path))
      assert.include(git('worktree', 'list', '--porcelain'), 'locked Permission denied while in use')
    }),
  )

  for (const refusal of ['Permission denied', 'Resource busy', 'Directory not empty', 'is not a working tree'])
    it.effect(`finishes removing the folder after git reports ${refusal}`, () =>
      Effect.gen(function* () {
        const { root, path, git } = worktree()
        const spawn = spawner.startApart
        let attempts = 0
        const mocked = vi.spyOn(spawner, 'startApart').mockImplementation((...args) => {
          const [command] = args
          if (command.command === 'git' && command.args.includes('remove') && command.args.includes(path)) {
            attempts++
            return {
              result: Promise.resolve({
                code: 128,
                signal: null,
                error: null,
                over: false,
                stdout: '',
                stderr: attempts === 1 ? 'Permission denied' : refusal,
              }),
              stop: () => undefined,
            }
          }
          return spawn(...args)
        })
        yield* removeWorktree(root, path).pipe(Effect.ensuring(Effect.sync(() => mocked.mockRestore())))
        assert.strictEqual(attempts, 2)
        assert.isFalse(existsSync(path))
        assert.notInclude(git('worktree', 'list', '--porcelain'), path.replaceAll('\\', '/'))
        assert.strictEqual(git('show', 'task:kept.txt'), 'Keep this work.')
        git('switch', 'task')
        assert.strictEqual(readFileSync(join(root, 'kept.txt'), 'utf8'), 'Keep this work.\n')
      }),
    )

  it.effect('preserves a locked worktree even when its reason mentions a busy filesystem', () =>
    Effect.gen(function* () {
      const { root, path, git } = worktree()
      git('worktree', 'lock', '--reason', 'Permission denied; resource busy', path)
      const error = yield* Effect.flip(removeWorktree(root, path))
      if (error._tag !== 'GitFailed') assert.fail(`Expected GitFailed, got ${error._tag}`)
      assert.include(error.stderr, 'locked working tree')
      assert.isTrue(existsSync(path))
      assert.include(git('worktree', 'list', '--porcelain'), 'locked Permission denied; resource busy')
    }),
  )

  for (const refusal of ['not a git repository', 'cannot remove a locked working tree: Permission denied'])
    it.effect(`keeps the folder when the forced removal says ${refusal}`, () =>
      Effect.gen(function* () {
        const { root, path } = worktree()
        const spawn = spawner.startApart
        const mocked = vi.spyOn(spawner, 'startApart').mockImplementation((...args) => {
          const [command] = args
          if (command.command === 'git' && command.args.includes('remove') && command.args.includes(path))
            return {
              result: Promise.resolve({ code: 128, signal: null, error: null, over: false, stdout: '', stderr: refusal }),
              stop: () => undefined,
            }
          return spawn(...args)
        })
        const error = yield* Effect.flip(removeWorktree(root, path)).pipe(Effect.ensuring(Effect.sync(() => mocked.mockRestore())))
        if (error._tag !== 'GitFailed') assert.fail(`Expected GitFailed, got ${error._tag}`)
        assert.strictEqual(error.stderr, refusal)
        assert.isTrue(existsSync(path))
        assert.strictEqual(readFileSync(join(path, 'kept.txt'), 'utf8'), 'Keep this work.\n')
      }),
    )
})
