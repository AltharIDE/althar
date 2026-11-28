import { lstat } from 'node:fs/promises'
import { join } from 'node:path'

import { fileErrorCode } from '@althar/runtime/privateFiles'
import type { WorkerExecutionPlatform } from '@althar/runtime'
import type { listenWorkers, WorkerHomePaths, WorkerListener } from '@althar/runtime/workerHome'
import { AgentRequestFailed, AgentStartFailed } from '@althar/provider-adapters'
import { Effect, Scope } from 'effect'

/*
 * This Mac's home and its workers (ADR-103). A profile that keeps a worker configuration listens for them from the
 * start; one that doesn't yet opens its worker port the first time the person adds a worker, as its own authority,
 * without a restart. The worker transport is loaded only then: a profile with no workers never loads it.
 */

type Home = typeof import('@althar/runtime/workerHome')

export const workersForProfile = (
  paths: WorkerHomePaths,
  connectionChanged?: Parameters<typeof listenWorkers>[2],
  /** A port it opened after the runtime was ready, for main's list of the runtime's own ports. */
  opened?: (port: number) => void,
) =>
  Effect.gen(function* () {
    const exists = yield* Effect.tryPromise({
      try: async () => {
        try {
          await lstat(join(paths.profile, 'workers.json'))
          return true
        } catch (error) {
          if (fileErrorCode(error) === 'ENOENT') return false
          throw error
        }
      },
      catch: () => 'Could not read the worker configuration directory.',
    }).pipe(Effect.catch((message) => Effect.as(Effect.logWarning(message), false)))
    const scope = yield* Effect.scope
    let home: Home | undefined
    let execution: WorkerExecutionPlatform | undefined
    let listener: WorkerListener | undefined
    let homeId: string | undefined
    const load = Effect.tryPromise({
      try: async () => (home ??= await import('@althar/runtime/workerHome')),
      catch: () => 'Could not load the home’s worker transport.',
    })
    const platform = (loaded: Home) =>
      (execution ??= loaded.workerExecution(
        () => listener?.agentWorkers,
        () => listener,
        () =>
          Effect.gen(function* () {
            if (listener !== undefined) return listener
            if (homeId === undefined) return yield* Effect.fail('The home isn’t ready yet. Try again in a moment.')
            const opening = yield* loaded.openWorkers(paths, homeId, connectionChanged).pipe(
              Scope.provide(scope),
              Effect.mapError((error) => error.message),
            )
            listener = opening
            opened?.(opening.port)
            return opening
          }),
      ))
    const loaded = exists ? yield* load.pipe(Effect.catch((message) => Effect.as(Effect.logWarning(message), undefined))) : undefined
    // Each call goes to the worker transport once it is loaded; until then the home takes no workers, and adding one loads it.
    const notYet = (command: string) => new AgentStartFailed({ command, reason: 'This home has no workers yet.' })
    const unloaded = () => new AgentRequestFailed({ method: 'workspace', failure: 'transient', message: 'This home has no workers yet.' })
    const delegating: WorkerExecutionPlatform = {
      list: (projectId) => execution?.list(projectId) ?? [],
      enrolled: () => execution?.enrolled?.() ?? null,
      // Not loaded: the profile keeps no worker configuration, so the home adds them itself.
      adds: () => execution?.adds?.() ?? true,
      revoke: (workerId) => (execution?.revoke === undefined ? Effect.fail('This home takes no workers.') : execution.revoke(workerId)),
      update: (workerId) => (execution?.update === undefined ? Effect.fail('This home takes no workers.') : execution.update(workerId)),
      cancelUpdate: (workerId) =>
        execution?.cancelUpdate === undefined ? Effect.fail('This home takes no workers.') : execution.cancelUpdate(workerId),
      admin: {
        add: (input) => Effect.flatMap(load, (loading) => platform(loading).admin!.add(input)),
        code: (name) => Effect.flatMap(load, (loading) => platform(loading).admin!.code(name)),
        assign: (workerId, projectIds) => Effect.flatMap(load, (loading) => platform(loading).admin!.assign(workerId, projectIds)),
      },
      open: (input) => (execution === undefined ? Effect.fail(notYet(input.providerId)) : execution.open(input)),
      openHelper: (input) => (execution?.openHelper === undefined ? Effect.fail(notYet(input.providerId)) : execution.openHelper(input)),
      startCommand: (input) => (execution?.startCommand === undefined ? Effect.fail(notYet(input.command)) : execution.startCommand(input)),
      readFile: (input) => (execution?.readFile === undefined ? Effect.fail(unloaded()) : execution.readFile(input)),
      captureCheckouts: (input) =>
        execution?.captureCheckouts === undefined ? Effect.fail(unloaded()) : execution.captureCheckouts(input),
      checkpointWorktree: (input) =>
        execution?.checkpointWorktree === undefined ? Effect.fail(unloaded()) : execution.checkpointWorktree(input),
    }
    if (loaded !== undefined) platform(loaded)
    return {
      execution: delegating,
      listen: (id: string) =>
        Effect.gen(function* () {
          homeId = id
          if (loaded === undefined) return undefined
          const listening = yield* loaded.listenWorkers(paths, id, connectionChanged)
          if (listening === undefined) return undefined
          listener = listening
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              if (listener === listening) listener = undefined
            }),
          )
          return listening.port
        }),
    }
  })
