import { Readable } from 'node:stream'
import { AgentRequestFailed, AgentStartFailed } from '@althar/provider-adapters'
import { acceptWorkerPatch, prepareWorkerWorkspace } from '../workerWorkspace'
import type { WorkerExecutionPlatform } from '../workerExecution'
import { AgentRunOutcome } from '@althar/worker-protocol'
import { MAX_WORKER_BUNDLE_BYTES, type AgentWorkerPool, type WorkerAgentProcess } from '@althar/worker-protocol/agent-runs'
import { Effect, Scope, Semaphore } from 'effect'

const unavailable = (error: unknown): string => {
  if (error instanceof Error) return error.message
  return typeof error === 'string' ? error : 'The worker connection was lost.'
}

export const workerExecution = (active: () => AgentWorkerPool | undefined): WorkerExecutionPlatform => {
  const workspaces = new Map<string, { readonly projectId: string; readonly workerId: string; readonly agent: WorkerAgentProcess }>()
  return {
    list: (projectId) =>
      (active()?.list(projectId) ?? []).map(({ workerId, busy, capabilities }) => ({
        workerId,
        providers: capabilities.map(({ providerId }) => providerId),
        busy,
      })),
    startCommand: (input) =>
      Effect.gen(function* () {
        const workspace = workspaces.get(input.worktree)
        const failed = (reason: string) => new AgentStartFailed({ command: input.command, reason })
        if (workspace === undefined || workspace.projectId !== input.projectId || workspace.workerId !== input.workerId)
          return yield* failed('Start this task on its assigned worker before running a project command.')
        return yield* Effect.acquireRelease(
          Effect.tryPromise({ try: () => workspace.agent.startCommand(input), catch: (error) => failed(unavailable(error)) }),
          (process) => Effect.tryPromise(() => process.stop()).pipe(Effect.catch(() => Effect.void)),
        )
      }),
    open: (input) =>
      Effect.gen(function* () {
        const { workerId, projectId, workspaceId, providerId, worktree, toolPort, setup } = input
        const failed = (error: unknown) => new AgentStartFailed({ command: providerId, reason: unavailable(error) })
        const pool = active()
        if (pool === undefined) return yield* failed(new Error('The home’s worker listener is unavailable.'))
        const made = Effect.scoped(
          Effect.gen(function* () {
            const checkout = yield* prepareWorkerWorkspace(worktree, MAX_WORKER_BUNDLE_BYTES)
            const agent = yield* Effect.tryPromise({
              try: (signal) =>
                pool.start(
                  workerId,
                  { projectId, workspaceId, providerId },
                  { signal, checkout, toolPort, ...(setup === undefined ? {} : { setup }) },
                ),
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
        const workspace = { workerId, projectId, agent }
        workspaces.set(worktree, workspace)
        const scope = yield* Effect.scope
        yield* Scope.addFinalizer(
          scope,
          Effect.sync(() => {
            if (workspaces.get(worktree) === workspace) workspaces.delete(worktree)
          }),
        )
        const writes = yield* Semaphore.make(1)
        let base = prepared
        const checkpoint = writes.withPermits(1)(
          Effect.gen(function* () {
            const incoming = yield* Effect.tryPromise({ try: () => agent.readPatch(base.tree, base.head), catch: unavailable })
            yield* acceptWorkerPatch(worktree, base, incoming, agent.ownsRun)
            base = { head: incoming.head, tree: incoming.tree }
            if (!agent.ownsRun()) return yield* Effect.fail('The worker no longer owns this run.')
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
          ...(agent.setup === undefined
            ? {}
            : {
                setup: {
                  code: agent.setup.exitCode,
                  timedOut: agent.setup.timedOut,
                  output: Buffer.from(agent.setup.outputTail).toString('utf8'),
                },
              }),
          checkpoint,
        }
      }),
  }
}
