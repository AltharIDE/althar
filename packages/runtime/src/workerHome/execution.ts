import { Readable } from 'node:stream'
import { AgentRequestFailed, AgentStartFailed } from '@althar/provider-adapters'
import { acceptWorkerPatch, prepareWorkerWorkspace } from '../workerWorkspace'
import type { WorkerExecutionPlatform } from '../workerExecution'
import { AgentRunOutcome } from '@althar/worker-protocol'
import { MAX_WORKER_BUNDLE_BYTES, type AgentWorkerPool } from '@althar/worker-protocol/agent-runs'
import { Effect, Semaphore } from 'effect'

const unavailable = (error: unknown): string => {
  if (error instanceof Error) return error.message
  return typeof error === 'string' ? error : 'The worker connection was lost.'
}

export const workerExecution = (active: () => AgentWorkerPool | undefined): WorkerExecutionPlatform => ({
  list: (projectId) =>
    (active()?.list(projectId) ?? []).map(({ workerId, busy, capabilities }) => ({
      workerId,
      providers: capabilities.map(({ providerId }) => providerId),
      busy,
    })),
  open: (input) =>
    Effect.gen(function* () {
      const { workerId, projectId, workspaceId, providerId, worktree, toolPort } = input
      const failed = (error: unknown) => new AgentStartFailed({ command: providerId, reason: unavailable(error) })
      const pool = active()
      if (pool === undefined) return yield* failed(new Error('The home’s worker listener is unavailable.'))
      const made = Effect.scoped(
        Effect.gen(function* () {
          const checkout = yield* prepareWorkerWorkspace(worktree, MAX_WORKER_BUNDLE_BYTES)
          const agent = yield* Effect.tryPromise({
            try: (signal) => pool.start(workerId, { projectId, workspaceId, providerId }, { signal, checkout, toolPort }),
            catch: failed,
          })
          return { agent, base: { head: checkout.head, tree: checkout.tree } }
        }),
      ).pipe(Effect.mapError(failed))
      const stop = (agent: Awaited<ReturnType<AgentWorkerPool['start']>>) =>
        Effect.promise(() =>
          agent.stop().then(
            () => undefined,
            () => undefined,
          ),
        )
      const { agent, base: prepared } = yield* Effect.acquireRelease(made, ({ agent }) => stop(agent))
      if (agent.toolPort === undefined) return yield* failed(new Error('The worker did not open the Althar tools connection.'))
      const writes = yield* Semaphore.make(1)
      let base = prepared
      const checkpoint = writes.withPermits(1)(
        Effect.gen(function* () {
          const incoming = yield* Effect.tryPromise({ try: () => agent.readPatch(base.tree, base.head), catch: unavailable })
          yield* acceptWorkerPatch(worktree, base, incoming)
          base = { head: incoming.head, tree: incoming.tree }
        }).pipe(
          Effect.mapError(
            (error) => new AgentRequestFailed({ method: 'workspace/checkpoint', failure: 'transient', message: unavailable(error) }),
          ),
        ),
      )
      return {
        transport: {
          _tag: 'Remote',
          stdin: new WritableStream({ write: (bytes: Uint8Array) => agent.write(bytes) }),
          stdout: Readable.toWeb(agent.output) as ReadableStream<Uint8Array>,
          exited: Effect.promise(() =>
            agent.exit.then(
              (result) => ({
                code: result.exitCode ?? null,
                signal: result.outcome === AgentRunOutcome.STOPPED ? 'SIGTERM' : null,
              }),
              () => ({ code: null, signal: null }),
            ),
          ),
          stop: stop(agent),
        },
        path: agent.workspacePath,
        toolPort: agent.toolPort,
        checkpoint,
      }
    }),
})
