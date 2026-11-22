import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { assert, it } from '@effect/vitest'
import { Effect } from 'effect'
import { git, treeOf } from '../src/git'
import { acceptWorkerPatch, prepareWorkerWorkspace } from '../src/workerWorkspace'
import { repository } from './support'

it.live('transfers a task checkout, imports the worker’s original commit and keeps later uncommitted files', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const home = repository()
      const worker = repository()
      const source = yield* prepareWorkerWorkspace(home, 128 * 1024 * 1024)
      const exported = join(worker, '.git', 'input.bundle')
      const archive = yield* Effect.promise(async (signal) => {
        const chunks = []
        for await (const chunk of source.contents(signal)) chunks.push(chunk)
        return Buffer.concat(chunks)
      })
      assert.strictEqual(archive.length, source.size)
      writeFileSync(exported, archive)
      assert.match(yield* git(worker, 'bundle', 'list-heads', exported), /^[a-f0-9]+ refs\/althar\/worker-snapshot$/)
      yield* git(worker, '-c', 'protocol.file.allow=always', 'fetch', '--no-tags', exported, 'refs/althar/worker-snapshot')
      assert.strictEqual(yield* git(worker, 'rev-parse', 'FETCH_HEAD^'), source.head)
      const snapshotTree = yield* git(worker, 'rev-parse', 'FETCH_HEAD^{tree}')
      assert.strictEqual(snapshotTree, source.tree)
      writeFileSync(join(worker, 'README.md'), 'Remote committed edit\n')
      execFileSync('git', ['-c', 'user.name=Worker', '-c', 'user.email=worker@althar.test', 'commit', '-qam', 'Edit on the worker'], {
        cwd: worker,
      })
      writeFileSync(join(worker, 'draft.txt'), 'Uncommitted work\n')
      const head = yield* git(worker, 'rev-parse', 'HEAD')
      yield* git(worker, 'update-ref', 'refs/althar/worker-head', head)
      const received = join(home, '.git', 'received.bundle')
      yield* git(worker, 'bundle', 'create', received, 'refs/althar/worker-head', '^' + source.head)
      const tree = yield* treeOf(worker)
      const patch = execFileSync('git', ['diff', '--binary', source.tree, tree], { cwd: worker })
      const changes = { head, tree, patch, commits: readFileSync(received) }
      yield* acceptWorkerPatch(home, source, changes)
      assert.strictEqual(yield* git(home, 'rev-parse', 'HEAD'), head)
      assert.strictEqual(readFileSync(join(home, 'draft.txt'), 'utf8'), 'Uncommitted work\n')
      assert.strictEqual(yield* git(home, 'status', '--porcelain'), '?? draft.txt')
      writeFileSync(join(home, 'README.md'), 'A change made on the home\n')
      const conflict = yield* Effect.flip(
        acceptWorkerPatch(home, { head, tree }, { head, tree, patch: Buffer.alloc(0), commits: Buffer.alloc(0) }),
      )
      assert.include(conflict.reason, 'checkout changed on the home')
      assert.strictEqual(readFileSync(join(home, 'README.md'), 'utf8'), 'A change made on the home\n')
    }),
  ),
)
