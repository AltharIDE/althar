import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import type { CodeRoot } from '../src/code'
import { searchFiles } from '../src/searchFiles'

/** A repository with a committed file in each package, then one added and one ignored after the commit. */
const repository = () => {
  const root = mkdtempSync(join(tmpdir(), 'althar-search-'))
  const git = (...args: Array<string>) =>
    execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@t.test', ...args], { cwd: root })
      .toString()
      .trim()
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  git('init', '-q', '-b', 'main')
  write('packages/runtime/src/Runs.ts', 'export {}\n')
  write('packages/ui/src/model.ts', 'export {}\n')
  write('.gitignore', 'dist/\n')
  git('add', '.')
  git('commit', '-q', '-m', 'Start')
  const commit = git('rev-parse', 'HEAD')
  write('packages/runtime/src/Fresh.ts', 'export {}\n')
  write('dist/out.js', '')
  return { root, commit }
}

const rootOf = (path: string, more: Partial<CodeRoot> = {}): CodeRoot => ({
  slug: 'althar',
  name: 'althar',
  branch: 'main',
  path,
  commit: null,
  base: null,
  within: null,
  seen: [],
  editor: path,
  ...more,
})

describe('the names search offers', () => {
  it.effect('a task’s worktree offers what is in it now, new files too, and not what Git ignores', () =>
    Effect.gen(function* () {
      const { root } = repository()
      const { files } = yield* searchFiles({ kind: 'task', roots: [rootOf(root)] })
      assert.sameMembers(
        [...files],
        ['.gitignore', 'packages/runtime/src/Fresh.ts', 'packages/runtime/src/Runs.ts', 'packages/ui/src/model.ts'],
      )
    }),
  )

  it.effect('the default branch offers what its commit holds, only under the folder the project is about', () =>
    Effect.gen(function* () {
      const { root, commit } = repository()
      const { files } = yield* searchFiles({ kind: 'default', roots: [rootOf(root, { commit, within: 'packages/runtime' })] })
      assert.deepStrictEqual([...files], ['packages/runtime/src/Runs.ts'])
    }),
  )

  it.effect('more than one repository names each file under its own, once', () =>
    Effect.gen(function* () {
      const { root, commit } = repository()
      const { files } = yield* searchFiles({
        kind: 'default',
        roots: [rootOf(root, { slug: 'one', commit, within: 'packages/ui' }), rootOf(root, { slug: 'two', commit, within: 'packages/ui' })],
      })
      assert.deepStrictEqual([...files], ['one/packages/ui/src/model.ts', 'two/packages/ui/src/model.ts'])
    }),
  )
})
