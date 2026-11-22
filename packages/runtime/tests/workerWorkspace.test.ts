import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { assert, it } from '@effect/vitest'
import { Effect } from 'effect'
import { git, treeOf } from '../src/git'
import { acceptWorkerPatch, prepareWorkerWorkspace, verifyWorkerIndex } from '../src/workerWorkspace'
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
      const absentPatch = yield* Effect.flip(acceptWorkerPatch(home, source, { ...changes, patch: Buffer.alloc(0) }))
      assert.include(absentPatch.reason, 'reported a new tree without a patch')
      const absentCommits = yield* Effect.flip(acceptWorkerPatch(home, source, { ...changes, commits: Buffer.alloc(0) }))
      assert.include(absentCommits.reason, 'commit transfer does not match')
      const wrongCommit = yield* Effect.flip(acceptWorkerPatch(home, source, { ...changes, head: 'a'.repeat(40) }))
      assert.include(wrongCommit.reason, 'sent a different commit')
      const notOwned = yield* Effect.flip(acceptWorkerPatch(home, source, changes, () => false))
      assert.include(notOwned.reason, 'no longer owns')
      const tooSmall = yield* Effect.flip(prepareWorkerWorkspace(home, 7))
      assert.include(tooSmall.reason, 'exceed the worker bundle size')
      const mismatch = yield* Effect.flip(acceptWorkerPatch(home, source, { ...changes, tree: source.tree }))
      assert.include(mismatch.reason, 'does not match its reported checkout')
      assert.strictEqual(yield* git(home, 'rev-parse', 'HEAD'), source.head)
      assert.strictEqual(yield* treeOf(home), source.tree)
      let checks = 0
      const revoked = yield* Effect.flip(acceptWorkerPatch(home, source, changes, () => ++checks === 1))
      assert.include(revoked.reason, 'no longer owns this run')
      assert.strictEqual(yield* git(home, 'rev-parse', 'HEAD'), source.head)
      assert.strictEqual(yield* treeOf(home), source.tree)
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

it.live('reconstructs a worker index in private Git objects and leaves the home’s staging area alone', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const home = repository()
      const worker = repository()
      const base = yield* git(home, 'write-tree')
      const head = yield* git(home, 'rev-parse', 'HEAD')
      assert.strictEqual(yield* verifyWorkerIndex(home, base, { tree: base, patch: Buffer.alloc(0) }), base)
      writeFileSync(join(worker, 'README.md'), 'from the staging area\n')
      yield* git(worker, 'add', 'README.md')
      const staged = yield* git(worker, 'write-tree')
      writeFileSync(join(worker, 'README.md'), 'different unstaged changes\n')
      const patch = execFileSync('git', ['diff', '--binary', base, staged], { cwd: worker })
      const index = yield* verifyWorkerIndex(home, base, { tree: staged, patch })
      assert.strictEqual(index, staged)
      assert.strictEqual(yield* git(home, 'write-tree'), base)
      assert.strictEqual(readFileSync(join(home, 'README.md'), 'utf8'), '# Meridian\n')
      const archive = yield* prepareWorkerWorkspace(home, 128 * 1024 * 1024, true, index)
      assert.strictEqual(archive.index, index)
      assert.strictEqual(archive.head, head)
      assert.include((yield* Effect.flip(verifyWorkerIndex(home, base, { tree: staged, patch: Buffer.alloc(0) }))).reason, 'do not match')
      assert.include((yield* Effect.flip(verifyWorkerIndex(home, base, { tree: base, patch }))).reason, 'do not match')
    }),
  ),
)
