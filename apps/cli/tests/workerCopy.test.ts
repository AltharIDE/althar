import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { WorkerSnapshot, WorkerSnapshotChunkRequest } from '@althar/contracts'
import { removeTreeSync } from '@althar/testing'
import { assert, it } from '@effect/vitest'
import { Effect } from 'effect'

import { testWorkerCopy } from '../src/workerCopy'

it.live('tests the actual worker files in a separate checkout and keeps the copy on failure', () =>
  Effect.gen(function* () {
    const root = mkdtempSync(join(tmpdir(), 'althar-cli-test-copy-'))
    yield* Effect.addFinalizer(() => Effect.sync(() => removeTreeSync(root)))
    const source = join(root, 'worker')
    const into = join(root, 'local')
    mkdirSync(source)
    mkdirSync(into)
    const git = (...args: string[]) =>
      execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@althar.test', ...args], { cwd: source })
        .toString()
        .trim()
    git('init', '-qb', 'main')
    writeFileSync(join(source, 'input'), 'committed')
    git('add', 'input')
    git('commit', '-qm', 'Base')
    const head = git('rev-parse', 'HEAD')
    const index = git('write-tree')
    writeFileSync(join(source, 'input'), 'worker edit')
    git('add', 'input')
    const tree = git('write-tree')
    for (const [name, object] of [
      ['worker-index', index],
      ['worker-snapshot', tree],
    ] as const) {
      git('update-ref', 'refs/althar/' + name, git('commit-tree', object, '-p', head, '-m', name))
    }
    const bundle = join(root, 'worker.bundle')
    git('bundle', 'create', bundle, 'refs/althar/worker-index', 'refs/althar/worker-snapshot')
    const bytes = readFileSync(bundle)
    const input = { projectId: 'proj_' + '1'.repeat(32), taskId: 'task_' + '2'.repeat(32), source: 'worker' as const }
    const workspaceId = 'ws_' + '3'.repeat(32)
    const snapshot: WorkerSnapshot = {
      ...input,
      id: 'snap_' + '4'.repeat(32),
      repositories: [
        { name: 'project', workspaceId, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), head, tree, index },
      ],
    }
    let released = 0
    const api = {
      PrepareWorkerSnapshot: () => Effect.succeed(snapshot),
      ReadWorkerSnapshotChunk: ({ offset }: WorkerSnapshotChunkRequest) =>
        Effect.succeed({ bodyBase64: bytes.subarray(offset).toString('base64'), nextOffset: bytes.length, done: true }),
      ReleaseWorkerSnapshot: () =>
        Effect.sync(() => {
          released += 1
        }),
    }
    const program = (script: string) => ({ command: process.execPath, args: ['-e', script] })
    const saved = JSON.parse(
      yield* testWorkerCopy(
        api,
        input,
        into,
        workspaceId,
        program("const fs = require('node:fs'); fs.writeFileSync('result', fs.readFileSync('input', 'utf8') + ' tested')"),
      ),
    ) as { path: string }
    assert.strictEqual(readFileSync(join(saved.path, 'result'), 'utf8'), 'worker edit tested')
    assert.isFalse(existsSync(join(source, 'result')))
    const failure = yield* Effect.flip(testWorkerCopy(api, input, into, workspaceId, program('process.exit(7)')))
    assert.instanceOf(failure, Error)
    assert.include((failure as Error).message, 'exited with status 7')
    assert.strictEqual(released, 2)
    assert.lengthOf(
      readdirSync(into).filter((folder) => folder.startsWith('althar-copy-')),
      2,
    )
    assert.strictEqual(readFileSync(join(source, 'input'), 'utf8'), 'worker edit')
  }),
)
