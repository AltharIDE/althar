import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { type Conflict, onlyTheResolution } from '../src/conflicts'
import { repository } from './support'

/*
 * What Althar takes for a lead's resolution of a conflict, where
 * conflicts.test.ts doesn't go: a merge the branch it conflicted with has
 * already is nothing of the lead's to push.
 */

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@t.test', ...args], { cwd })
    .toString()
    .trim()

describe('a conflict’s resolution', () => {
  it.effect('isn’t a merge that the branch it conflicted with has already', () =>
    Effect.gen(function* () {
      const root = repository()
      git(root, 'checkout', '-q', '-b', 'task')
      writeFileSync(join(root, 'a.txt'), 'task\n')
      git(root, 'add', '.')
      git(root, 'commit', '-q', '-m', 'Task')
      const from = git(root, 'rev-parse', 'HEAD')
      git(root, 'checkout', '-q', 'main')
      writeFileSync(join(root, 'a.txt'), 'main\n')
      git(root, 'add', '.')
      git(root, 'commit', '-q', '-m', 'Main')
      const target = git(root, 'rev-parse', 'HEAD')
      git(root, 'checkout', '-q', 'task')
      try {
        git(root, 'merge', '-q', '--no-edit', 'main')
      } catch {
        // It conflicts, as it should.
      }
      writeFileSync(join(root, 'a.txt'), 'task\nmain\n')
      git(root, 'add', '.')
      git(root, 'commit', '-q', '--no-edit')
      const merge = git(root, 'rev-parse', 'HEAD')
      const conflict: Conflict = { repository: 'api', name: 'api', branch: 'main', ref: 'main', target, from, files: ['a.txt'] }
      assert.strictEqual(yield* onlyTheResolution(root, conflict, merge), 'merge')
      // The branch it conflicted with took the merge itself since: nothing of it is the lead's own.
      assert.isNull(yield* onlyTheResolution(root, { ...conflict, target: merge }, merge))
    }),
  )
})
