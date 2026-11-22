import { lstat } from 'node:fs/promises'
import { join } from 'node:path'

import { fileErrorCode } from '@althar/runtime/privateFiles'
import type { listenWorkers, WorkerHomePaths } from '@althar/runtime/workerHome'
import { Effect } from 'effect'

/** A profile opts in by keeping a worker configuration. Loading the transport belongs to that profile only. */
export const workersForProfile = (paths: WorkerHomePaths, connectionChanged?: Parameters<typeof listenWorkers>[2]) =>
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
    if (!exists) return undefined
    const home = yield* Effect.tryPromise({
      try: () => import('@althar/runtime/workerHome'),
      catch: () => 'Could not load the home’s worker transport.',
    }).pipe(Effect.catch((message) => Effect.as(Effect.logWarning(message), undefined)))
    if (home === undefined) return undefined
    let listener: Effect.Success<ReturnType<typeof listenWorkers>>
    return {
      execution: home.workerExecution(() => listener?.agentWorkers),
      listen: (homeId: string) =>
        home.listenWorkers(paths, homeId, connectionChanged).pipe(
          Effect.tap((listening) => {
            listener = listening
            return Effect.addFinalizer(() =>
              Effect.sync(() => {
                if (listener === listening) listener = undefined
              }),
            )
          }),
          Effect.map((listening) => listening?.port),
        ),
    }
  })
