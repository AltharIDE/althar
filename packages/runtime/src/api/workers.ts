import { type ApiHandlers, ApiError } from '@althar/contracts'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { taskWorker } from '../workerExecution'
import { WorkerSnapshots } from '../WorkerSnapshots'
import { workerPreviewSockets } from '../workerPreviewSockets'
import { RuntimeConfig } from '../Config'
import { Instance } from '../Instance'
import { checkoutNeeds, withNeeds } from '../toolNeeds'
import { Launches } from '../Launches'
import { homeWorkers } from '../homeWorkers'
import type { ApiKit } from './kit'

/**
 * The workers a home enrolled: adding, removing, their projects, and those of a project.
 * What a worker serves back: a launch's preview and its sockets, its files and snapshots.
 */
export const workersHandlers = ({ identity, api, connectionAdmin }: ApiKit) =>
  Effect.gen(function* () {
    const launches = yield* Launches
    const workerSnapshots = yield* WorkerSnapshots
    const previews = workerPreviewSockets(yield* Effect.scope)
    yield* Effect.addFinalizer(() => previews.close)
    const instance = yield* Instance
    const sql = yield* SqlClient.SqlClient
    const config = yield* RuntimeConfig
    return {
      ListProjectWorkers: ({ projectId }) =>
        api(
          Effect.gen(function* () {
            const workers = config.workers?.list(projectId) ?? []
            // What the project's files need that each lacks, for a worker that has checked itself.
            if (workers.every((worker) => worker.readiness === undefined)) return workers
            return withNeeds(workers, yield* checkoutNeeds(projectId).pipe(Effect.orElseSucceed(() => [])))
          }).pipe(Effect.provideService(Instance, instance)),
        ),
      GetWorkers: () => api(homeWorkers(config.workers)),
      // Adding, changing and removing workers is the home's operator's or the person's own client's, as pairing a device
      // is: a device paired over the network can't, nor can an agent's socket on another device.
      RemoveWorker: ({ workerId }) =>
        connectionAdmin(
          config.workers?.revoke === undefined
            ? Effect.fail(new ApiError({ reason: 'WorkersOff', message: 'This home takes no workers.' }))
            : config.workers.revoke(workerId).pipe(Effect.mapError((message) => new ApiError({ reason: 'WorkerNotRemoved', message }))),
        ),
      AddWorker: ({ publicKey, name, ssh }) =>
        connectionAdmin(
          config.workers?.admin === undefined
            ? Effect.fail(new ApiError({ reason: 'WorkersOff', message: 'This home takes workers only by its operator’s certificates.' }))
            : config.workers.admin
                .add({ publicKey: Buffer.from(publicKey, 'base64url'), name: name.trim(), ssh: ssh?.trim() || null })
                .pipe(Effect.mapError((message) => new ApiError({ reason: 'WorkerNotAdded', message }))),
        ),
      CreateWorkerCode: ({ name }) =>
        connectionAdmin(
          config.workers?.admin === undefined
            ? Effect.fail(new ApiError({ reason: 'WorkersOff', message: 'This home takes workers only by its operator’s certificates.' }))
            : config.workers.admin.code(name).pipe(Effect.mapError((message) => new ApiError({ reason: 'WorkerNotAdded', message }))),
        ),
      SetWorkerProjects: ({ workerId, projectIds }) =>
        connectionAdmin(
          Effect.gen(function* () {
            const admin = config.workers?.admin
            if (admin === undefined)
              return yield* new ApiError({ reason: 'WorkersOff', message: 'This home’s workers get their projects from its operator.' })
            const wanted = [...new Set(projectIds)]
            const known =
              wanted.length === 0
                ? []
                : yield* sql<{ id: string }>`SELECT id FROM projects WHERE id IN ${sql.in(wanted)}`.pipe(Effect.orDie)
            if (known.length !== wanted.length)
              return yield* new ApiError({ reason: 'NotFound', message: 'That project isn’t on this home.' })
            return yield* admin
              .assign(workerId, wanted)
              .pipe(Effect.mapError((message) => new ApiError({ reason: 'WorkerNotChanged', message })))
          }),
        ),
      ReadLaunchPreview: (input) => api(launches.preview(input)),
      OpenLaunchPreviewSocket: (input) => api(previews.open(launches.previewSocket(input))),
      ReadLaunchPreviewSocket: ({ socket }) => previews.read(socket),
      WriteLaunchPreviewSocket: ({ socket, data }) => previews.write(socket, data),
      CloseLaunchPreviewSocket: ({ socket }) => previews.end(socket),
      ReadWorkerFile: ({ projectId, taskId, workspaceId, relativePath }) =>
        api(
          Effect.gen(function* () {
            const [site] = yield* sql<{ path: string }>`SELECT path FROM workspaces
            WHERE task_id = ${taskId} AND project_id = ${projectId} AND device_id = ${instance.deviceId}
              AND access = 'write' AND state = 'ready'
              AND (${workspaceId ?? null} IS NULL OR id = ${workspaceId ?? null})
            ORDER BY created_at, rowid LIMIT 1`
            const workerId = yield* taskWorker(taskId)
            const read = config.workers?.readFile
            if (site === undefined || workerId === null || read === undefined)
              return yield* new ApiError({ reason: 'NotFound', message: 'This worker file is unavailable.' })
            const file = yield* read({ workerId, projectId, worktree: site.path, path: relativePath }).pipe(
              Effect.mapError((error) => new ApiError({ reason: 'NotFound', message: error.message })),
            )
            return { sha256: file.sha256, size: file.bytes.byteLength, bodyBase64: Buffer.from(file.bytes).toString('base64') }
          }),
        ),
      PrepareWorkerSnapshot: (input) => api(workerSnapshots.prepare(identity, input)),
      ReadWorkerSnapshotChunk: (input) => workerSnapshots.read(identity, input),
      ReleaseWorkerSnapshot: ({ id }) => workerSnapshots.release(identity, id),
    } satisfies Partial<ApiHandlers>
  })
