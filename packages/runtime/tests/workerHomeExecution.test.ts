import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'

import { AgentRunOutcome, type AgentRunExit } from '@althar/worker-protocol'
import type { AgentWorkerPool, WorkerAgentProcess } from '@althar/worker-protocol/agent-runs'
import { assert, it } from '@effect/vitest'
import { Effect } from 'effect'

import { workerExecution } from '../src/workerHome/execution'
import { workerTestDirectory as temporary } from './workerTestFiles'

const request = (worktree: string) => ({
  workerId: 'wrk_' + '1'.repeat(32),
  projectId: 'proj_' + '2'.repeat(32),
  workspaceId: 'ws_' + '3'.repeat(32),
  providerId: 'codex',
  worktree,
  toolPort: 3200,
})

it.live('prepares a real task checkout and keeps the worker process scoped to the Althar session', () =>
  Effect.gen(function* () {
    const root = temporary()
    const worktree = join(root, 'repo')
    mkdirSync(worktree)
    const git = (...args: string[]) =>
      execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@althar.test', ...args], { cwd: worktree })
        .toString()
        .trim()
    git('init', '--quiet', '-b', 'main')
    writeFileSync(join(worktree, 'README.md'), 'Task files\n')
    git('add', 'README.md')
    git('commit', '--quiet', '-m', 'Initial')
    const head = git('rev-parse', 'HEAD')
    const tree = git('rev-parse', 'HEAD^{tree}')
    const input = request(worktree)
    const exit: AgentRunExit = {
      $typeName: 'althar.worker.v1.AgentRunExit',
      runId: 'war_' + '4'.repeat(32),
      outcome: AgentRunOutcome.STOPPED,
    }
    let outcome: (exit: AgentRunExit) => void = () => undefined
    let stopping = 0
    let reachable = true
    let toolsAvailable = true
    const written: Uint8Array[] = []
    const worker: WorkerAgentProcess = {
      workspacePath: '/worker/project',
      toolPort: 4517,
      output: new PassThrough(),
      exit: new Promise((resolve) => {
        outcome = resolve
      }),
      write: async (chunk) => {
        written.push(chunk)
      },
      startCommand: async () => assert.fail('No command expected'),
      stop: async () => {
        stopping += 1
        outcome(exit)
        return exit
      },
      ownsRun: () => true,
      readPatch: async (baseline, parent) => {
        if (!reachable) throw new Error('Worker disconnected.')
        assert.strictEqual(baseline, tree)
        assert.strictEqual(parent, head)
        return { tree, head, patch: Buffer.alloc(0), commits: Buffer.alloc(0) }
      },
    }
    const pool: AgentWorkerPool = {
      connect: () => assert.fail('No transport fixture needed'),
      connectPreview: () => assert.fail('No transport fixture needed'),
      openTools: () => undefined,
      list: () => [{ workerId: input.workerId, busy: false, capabilities: [{ projectId: input.projectId, providerId: input.providerId }] }],
      start: async (id, placement, options) => {
        assert.strictEqual(id, input.workerId)
        assert.deepStrictEqual(placement, { projectId: input.projectId, workspaceId: input.workspaceId, providerId: input.providerId })
        assert.strictEqual(options?.toolPort, input.toolPort)
        assert.strictEqual(options?.checkout?.head, head)
        if (toolsAvailable) return worker
        return {
          workspacePath: worker.workspacePath,
          output: worker.output,
          exit: worker.exit,
          write: worker.write,
          startCommand: worker.startCommand,
          stop: worker.stop,
          ownsRun: worker.ownsRun,
          readPatch: worker.readPatch,
        }
      },
    }
    const service = workerExecution(() => pool)
    assert.deepStrictEqual(service.list(input.projectId), [{ workerId: input.workerId, providers: ['codex'], busy: false }])
    yield* Effect.scoped(
      Effect.gen(function* () {
        const running = yield* service.open(input)
        assert.strictEqual(running.path, '/worker/project')
        assert.strictEqual(running.toolPort, 4517)
        yield* Effect.promise(() => running.transport.stdin.getWriter().write(Buffer.from('prompt')))
        assert.strictEqual(Buffer.from(written[0] ?? []).toString(), 'prompt')
        yield* running.checkpoint
        reachable = false
        assert.strictEqual((yield* Effect.flip(running.checkpoint)).message, 'Worker disconnected.')
      }),
    )
    assert.strictEqual(stopping, 1)
    toolsAvailable = false
    const missingTools = yield* Effect.scoped(Effect.flip(service.open(input)))
    assert.include(missingTools.reason, 'worker did not open the Althar tools connection')
    assert.strictEqual(stopping, 2)
  }),
)

it.live('refuses a worker start when its network listener is unavailable', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const offline = workerExecution(() => undefined)
      assert.deepStrictEqual(offline.list('project'), [])
      const failure = yield* Effect.flip(offline.open(request('/discarded')))
      assert.include(failure.reason, 'worker listener is unavailable')
    }),
  ),
)
