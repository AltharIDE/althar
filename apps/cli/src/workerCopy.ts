import { join } from 'node:path'

import type { WorkerSnapshot, WorkerSnapshotChunk, WorkerSnapshotChunkRequest, WorkerSnapshotRequest } from '@althar/contracts'
import { spawnOwned } from '@althar/provider-adapters'
import { installWorkerSnapshot, workerCopyFolder } from '@althar/transport-node'
import { Deferred, Effect, Exit, Fiber, Scope } from 'effect'

import { terminalWrite } from './terminalWrite'

interface SnapshotClient<E> {
  readonly PrepareWorkerSnapshot: (input: WorkerSnapshotRequest) => Effect.Effect<WorkerSnapshot, E>
  readonly ReadWorkerSnapshotChunk: (input: WorkerSnapshotChunkRequest) => Effect.Effect<WorkerSnapshotChunk, E>
  readonly ReleaseWorkerSnapshot: (input: { readonly id: string }) => Effect.Effect<void, E>
}

export const testWorkerCopy = <E>(
  api: SnapshotClient<E>,
  input: WorkerSnapshotRequest,
  into: string,
  workspaceId: string | undefined,
  program: { readonly command: string; readonly args: ReadonlyArray<string> },
) =>
  Effect.gen(function* () {
    const location = yield* Effect.scoped(
      Effect.gen(function* () {
        const snapshot = yield* api.PrepareWorkerSnapshot(input)
        yield* Effect.addFinalizer(() =>
          api.ReleaseWorkerSnapshot({ id: snapshot.id }).pipe(Effect.interruptible, Effect.timeoutOption('3 seconds'), Effect.ignore),
        )
        if (snapshot.projectId !== input.projectId || snapshot.taskId !== input.taskId || snapshot.source !== input.source)
          return yield* Effect.fail(new Error('The home returned a snapshot for a different task.'))
        const repository =
          workspaceId === undefined ? snapshot.repositories[0] : snapshot.repositories.find((repo) => repo.workspaceId === workspaceId)
        if (repository === undefined) return yield* Effect.fail(new Error('That repository is not part of the worker copy.'))
        const path = yield* Effect.tryPromise({
          try: (signal) =>
            installWorkerSnapshot(
              snapshot,
              into,
              (chunk, signal) => Effect.runPromise(api.ReadWorkerSnapshotChunk(chunk), { signal }),
              signal,
            ),
          catch: (error) => (error instanceof Error ? error : new Error('Could not save the local copy.')),
        })
        return join(path, workerCopyFolder(repository.name))
      }),
    )
    yield* terminalWrite(process.stderr, 'Testing in ' + JSON.stringify(location) + '\n')
    yield* runInWorkerCopy(location, program)
    return JSON.stringify({ path: location })
  })

export const runInWorkerCopy = (location: string, program: { readonly command: string; readonly args: ReadonlyArray<string> }) =>
  Effect.scoped(
    Effect.gen(function* () {
      const scope = yield* Effect.acquireRelease(Scope.make(), (scope, exit) => Scope.close(scope, exit))
      const child = yield* spawnOwned(program, location, {
        stopWithOwner: true,
        stderr: (text) => void process.stderr.write(text),
      }).pipe(Scope.provide(scope))
      // Test commands run without terminal input. The project cannot supply a command or environment.
      yield* Effect.promise(() => child.stdin.close().catch(() => undefined))
      const stdout = yield* Effect.forkScoped(
        Effect.promise(async (signal) => {
          const reader = child.stdout.getReader()
          const cancel = () => void reader.cancel().catch(() => undefined)
          const decoder = new TextDecoder()
          signal.addEventListener('abort', cancel, { once: true })
          try {
            for (;;) {
              const next = await reader.read()
              if (next.done) break
              await Effect.runPromise(terminalWrite(process.stdout, decoder.decode(next.value, { stream: true })), { signal })
            }
            await Effect.runPromise(terminalWrite(process.stdout, decoder.decode()), { signal })
          } finally {
            signal.removeEventListener('abort', cancel)
            reader.releaseLock()
          }
        }),
      )
      const exited = yield* Deferred.await(child.exited)
      // End any descendants before draining the last output from the command.
      yield* Scope.close(scope, Exit.void)
      yield* Fiber.join(stdout).pipe(Effect.timeoutOption('2 seconds'))
      if (exited.code !== 0) {
        const outcome = exited.signal === null ? `exited with status ${exited.code ?? 'unknown'}` : `was stopped by ${exited.signal}`
        return yield* Effect.fail(new Error(`The local command ${outcome}.`))
      }
    }),
  )
