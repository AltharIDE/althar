import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, it } from '@effect/vitest'
import { Effect, Exit } from 'effect'
import { git, treeOf } from '../src/git'
import { acceptWorkerPatch, prepareWorkerWorkspace, sendSizeWords, sentWords, verifyWorkerIndex } from '../src/workerWorkspace'
import { repository } from './support'

it.live('transfers a task checkout, imports the worker’s original commit and keeps later uncommitted files', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const home = repository()
      const worker = repository()
      const source = yield* prepareWorkerWorkspace(home, { maxBytes: 128 * 1024 * 1024 })
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
      const tooSmall = yield* Effect.flip(prepareWorkerWorkspace(home, { maxBytes: 7 }))
      assert.include(tooSmall.reason, 'the worker takes at most 7 bytes in one send')
      const mismatch = yield* Effect.flip(acceptWorkerPatch(home, source, { ...changes, tree: source.tree }))
      assert.include(mismatch.reason, 'does not match its reported checkout')
      assert.strictEqual(yield* git(home, 'rev-parse', 'HEAD'), source.head)
      assert.strictEqual(yield* treeOf(home), source.tree)
      let checks = 0
      const revoked = yield* Effect.flip(acceptWorkerPatch(home, source, changes, () => ++checks === 1))
      assert.include(revoked.reason, 'no longer owns this run')
      assert.strictEqual(yield* git(home, 'rev-parse', 'HEAD'), source.head)
      assert.strictEqual(yield* treeOf(home), source.tree)
      // Its commits as the worker pool hands them over: in the file they were received into.
      yield* acceptWorkerPatch(home, source, { ...changes, commits: { file: received, size: changes.commits.byteLength } })
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
      const archive = yield* prepareWorkerWorkspace(home, { maxBytes: 128 * 1024 * 1024 }, true, index)
      assert.strictEqual(archive.index, index)
      assert.strictEqual(archive.head, head)
      assert.include((yield* Effect.flip(verifyWorkerIndex(home, base, { tree: staged, patch: Buffer.alloc(0) }))).reason, 'do not match')
      assert.include((yield* Effect.flip(verifyWorkerIndex(home, base, { tree: base, patch }))).reason, 'do not match')
    }),
  ),
)

/** A send's bytes, as the worker receives them. */
const bytesOf = (source: { readonly contents: (signal: AbortSignal) => AsyncIterable<Uint8Array> }) =>
  Effect.promise(async (signal) => {
    const chunks = []
    for await (const chunk of source.contents(signal)) chunks.push(chunk)
    return Buffer.concat(chunks)
  })

const commitAll = (cwd: string, message: string) => {
  execFileSync('git', ['add', '-A'], { cwd })
  execFileSync('git', ['-c', 'user.name=Home', '-c', 'user.email=home@althar.test', 'commit', '-qm', message], { cwd })
}

it.live('sends a worker that keeps the history only what its copy lacks, and it builds the checkout from both', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const home = repository()
      // History the worker will hold: a large file that later sends must not carry again.
      writeFileSync(join(home, 'assets.bin'), randomBytes(2 * 1024 * 1024))
      commitAll(home, 'Large history')
      const first = yield* prepareWorkerWorkspace(home, { maxBytes: 2 ** 32 - 1, keeps: true, known: [] })
      assert.isFalse(first.thin)
      assert.isAbove(first.size, 2 * 1024 * 1024)
      // The worker's copy of the history, as it keeps it after its first send.
      const copy = mkdtempSync(join(tmpdir(), 'althar-worker-history-'))
      execFileSync('git', ['init', '-q', '--bare', copy])
      const firstBundle = join(copy, 'first.bundle')
      writeFileSync(firstBundle, yield* bytesOf(first))
      yield* git(copy, 'fetch', '--no-tags', firstBundle, `refs/althar/worker-snapshot:refs/althar/known/${first.head}`)
      yield* git(copy, 'update-ref', `refs/althar/known/${first.head}`, first.head)

      writeFileSync(join(home, 'README.md'), '# Meridian, again\n')
      commitAll(home, 'A new commit on the task')
      writeFileSync(join(home, 'draft.txt'), 'Not committed yet\n')
      // A commit the home doesn't have is left alone; one it does is left out.
      const second = yield* prepareWorkerWorkspace(home, { maxBytes: 2 ** 32 - 1, keeps: true, known: ['b'.repeat(40), first.head] })
      assert.isTrue(second.thin)
      assert.isBelow(second.size, 64 * 1024)
      assert.isBelow(second.size * 20, first.size)
      const secondBundle = join(copy, 'second.bundle')
      writeFileSync(secondBundle, yield* bytesOf(second))
      assert.include(yield* git(copy, 'bundle', 'verify', secondBundle), first.head)
      yield* git(copy, 'fetch', '--no-tags', secondBundle, 'refs/althar/worker-snapshot:refs/althar/incoming')
      assert.strictEqual(yield* git(copy, 'rev-parse', 'refs/althar/incoming^'), second.head)
      assert.strictEqual(yield* git(copy, 'rev-parse', 'refs/althar/incoming^{tree}'), second.tree)
      assert.strictEqual(yield* git(copy, 'show', 'refs/althar/incoming:draft.txt'), 'Not committed yet')

      // A worker that hasn't the history can't take the thin send.
      const fresh = mkdtempSync(join(tmpdir(), 'althar-worker-fresh-'))
      execFileSync('git', ['init', '-q', '--bare', fresh])
      assert.isTrue(Exit.isFailure(yield* Effect.exit(git(fresh, 'fetch', '--no-tags', secondBundle, 'refs/althar/worker-snapshot'))))
    }),
  ),
)

it.live('says what makes a send too large for the worker, and what to do', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const home = repository()
      writeFileSync(join(home, 'history.bin'), randomBytes(256 * 1024))
      commitAll(home, 'History')
      // Too large for a worker that doesn't keep history: updating it is the way.
      const older = yield* Effect.flip(prepareWorkerWorkspace(home, { maxBytes: 64 * 1024 }))
      assert.match(
        older.reason ?? '',
        /^The task’s Git history and changes come to \d+ KB; the worker takes at most 64 KB in one send\. Update the worker/,
      )
      // Too large for one that does: its history is, so it runs on the home.
      const keeping = yield* Effect.flip(prepareWorkerWorkspace(home, { maxBytes: 64 * 1024, keeps: true }))
      assert.include(keeping.reason, 'Run this task on the home instead.')
      // A large file nobody committed or ignored is most of it: named, with what to do.
      writeFileSync(join(home, 'dump.sql'), randomBytes(1024 * 1024))
      const stray = yield* Effect.flip(prepareWorkerWorkspace(home, { maxBytes: 512 * 1024, keeps: true }))
      assert.include(stray.reason, 'Most of it is dump.sql (1 MB), which isn’t committed or ignored: add it to .gitignore')
    }),
  ),
)

it('says how much a send was and what it carried', () => {
  assert.strictEqual(sendSizeWords(512), '512 bytes')
  assert.strictEqual(sendSizeWords(12 * 1024 + 300), '12 KB')
  assert.strictEqual(sendSizeWords(3.42 * 1024 ** 2), '3.4 MB')
  assert.strictEqual(sendSizeWords(81 * 1024 ** 2), '81 MB')
  assert.strictEqual(sendSizeWords(1.25 * 1024 ** 3), '1.3 GB')
  assert.strictEqual(
    sentWords({ bytes: 12 * 1024, thin: true, keeps: true }, 'Niko’s box'),
    'Sent 12 KB to Niko’s box: only what’s new to the history it keeps.',
  )
  assert.include(
    sentWords({ bytes: 81 * 1024 ** 2, thin: false, keeps: true }, 'Niko’s box'),
    'Sent 81 MB to Niko’s box: the project’s history',
  )
  assert.include(sentWords({ bytes: 81 * 1024 ** 2, thin: false, keeps: false }, 'Niko’s box'), 'Update the worker')
})
