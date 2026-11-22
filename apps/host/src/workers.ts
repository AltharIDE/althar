import { join } from 'node:path'
import {
  configureWorkers as configure,
  listenWorkers as listen,
  workerCertificate as certificate,
  WorkerHomeError,
  type WorkerConfiguration,
  type WorkerHomePaths,
} from '@althar/runtime/workerHome'
import { PrivateFileError } from '@althar/runtime/privateFiles'
import { Effect } from 'effect'

import { HostError, storageFailure } from './errors'
import { hostStatus } from './status'
import { readHomeId } from './updates/store'
import { openWorkerStore } from './workerStore'

export type { WorkerConfiguration } from '@althar/runtime/workerHome'

export const workerFailure = (error: unknown) =>
  error instanceof WorkerHomeError || error instanceof PrivateFileError
    ? new HostError({ code: error.code, message: error.message })
    : storageFailure(error)

export const configureWorkers = (options: WorkerHomePaths, config: WorkerConfiguration | undefined) =>
  configure(options, config).pipe(Effect.mapError(workerFailure))

export const listenWorkers = (options: WorkerHomePaths, homeId: string) => listen(options, homeId).pipe(Effect.mapError(workerFailure))

export const workerCertificate = async (path: string) => {
  try {
    return await certificate(path)
  } catch (error) {
    throw workerFailure(error)
  }
}

export const workerOperation = <A>(
  profile: string,
  operation: (store: Awaited<ReturnType<typeof openWorkerStore>>) => A | Promise<A>,
  projectId?: string,
) =>
  Effect.gen(function* () {
    // The live runtime holds its database exclusively. Use its authenticated
    // local endpoint, and read the offline identity only while it is stopped.
    const homeId = yield* hostStatus(profile, false, projectId).pipe(
      Effect.map((ready) => ready.homeId),
      Effect.catchIf(
        (error) => projectId === undefined && error.code === 'HostUnavailable',
        () => Effect.try({ try: () => readHomeId(join(profile, 'althar.sqlite')), catch: storageFailure }),
      ),
    )
    return yield* Effect.tryPromise({
      try: async () => {
        const store = await openWorkerStore(profile, homeId)
        try {
          return await operation(store)
        } finally {
          store.close()
        }
      },
      catch: workerFailure,
    })
  })
