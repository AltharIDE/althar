import { randomBytes } from 'node:crypto'
import {
  ApiError,
  MAX_SNAPSHOT_CHUNK,
  type ClientIdentity,
  type WorkerSnapshot,
  type WorkerSnapshotChunk,
  type WorkerSnapshotChunkRequest,
  type WorkerSnapshotRequest,
} from '@althar/contracts'
import {
  MAX_WORKER_BUNDLE_BYTES,
  MAX_WORKER_REPOSITORIES,
  MAX_WORKER_SET_BYTES,
  WORKER_REPOSITORY_FOLDER,
} from '@althar/worker-protocol/agent-runs'
import { Context, Effect, Exit, Layer, Scope } from 'effect'
import { SqlClient } from 'effect/sql'
import { RuntimeConfig } from './Config'
import { git, treeOf } from './git'
import { Instance } from './Instance'
import { type CapturedWorkerCheckout, taskWorker } from './workerExecution'
import { prepareWorkerWorkspace } from './workerWorkspace'

type Bundle = Effect.Success<ReturnType<typeof prepareWorkerWorkspace>>
interface Exported {
  readonly owner: string
  readonly scope: Scope.Closeable
  readonly bundles: ReadonlyMap<string, Bundle>
}

const MAX_EXPORTS = 4
const MAX_DEVICE_EXPORTS = 2
const ownerOf = (identity: ClientIdentity) => `${identity.homeId}/${identity.actorId}/${identity.deviceId}`
const noSnapshot = () => new ApiError({ reason: 'NotFound', message: 'This workspace snapshot is unavailable.' })
const blocked = (message: string) => new ApiError({ reason: 'WorkerUnavailable', message })

/** A short-lived copy of a verified checkpoint can be downloaded again by the same device after reconnecting. */
export class WorkerSnapshots extends Context.Service<
  WorkerSnapshots,
  {
    prepare(identity: ClientIdentity, input: WorkerSnapshotRequest): Effect.Effect<WorkerSnapshot, ApiError>
    read(identity: ClientIdentity, input: WorkerSnapshotChunkRequest): Effect.Effect<WorkerSnapshotChunk, ApiError>
    release(identity: ClientIdentity, id: string): Effect.Effect<void>
  }
>()('@althar/runtime/WorkerSnapshots') {
  static readonly layer = Layer.effect(
    WorkerSnapshots,
    Effect.gen(function* () {
      const root = yield* Effect.scope
      const instance = yield* Instance
      const sql = yield* SqlClient.SqlClient
      const workers = (yield* RuntimeConfig).workers
      const exports = new Map<string, Exported>()
      const reservations = new Map<string, number>()
      let active = 0
      const drop = (id: string) =>
        Effect.suspend(() => {
          const found = exports.get(id)
          if (found === undefined) return Effect.void
          exports.delete(id)
          return Scope.close(found.scope, Exit.void)
        })
      const prepare = (identity: ClientIdentity, input: WorkerSnapshotRequest) =>
        Effect.uninterruptibleMask((restore) =>
          Effect.gen(function* () {
            const owner = ownerOf(identity)
            const pending = reservations.get(owner) ?? 0
            if (identity.homeId !== instance.homeId) return yield* noSnapshot()
            if (
              active + exports.size >= MAX_EXPORTS ||
              pending + [...exports.values()].filter((record) => record.owner === owner).length >= MAX_DEVICE_EXPORTS
            )
              return yield* blocked('Finish downloading an earlier workspace snapshot first.')
            reservations.set(owner, pending + 1)
            active++
            const scope = yield* Scope.fork(root, 'sequential')
            const made = yield* Effect.exit(
              restore(
                Effect.gen(function* () {
                  const workspaces = yield* sql<{ id: string; name: string; path: string; state: string }>`
              SELECT w.id, b.slug AS name, w.path, w.state FROM workspaces w
              JOIN repository_bindings b ON b.id = w.binding_id
              WHERE w.task_id = ${input.taskId} AND w.project_id = ${input.projectId}
                AND w.device_id = ${instance.deviceId} AND w.access = 'write'
              ORDER BY b.created_at, b.rowid`
                  const [first] = workspaces
                  if (
                    first === undefined ||
                    workspaces.length > MAX_WORKER_REPOSITORIES ||
                    workspaces.some((entry) => entry.state !== 'ready' || !WORKER_REPOSITORY_FOLDER.test(entry.name)) ||
                    new Set(workspaces.map(({ name }) => name)).size !== workspaces.length
                  )
                    return yield* noSnapshot()
                  const workerId = yield* taskWorker(input.taskId)
                  if (workerId === null) return yield* noSnapshot()
                  let captures: ReadonlyMap<string, CapturedWorkerCheckout> | undefined
                  if (input.source === 'worker') {
                    const capture = workers?.captureCheckouts
                    if (capture === undefined)
                      return yield* blocked('The worker is unavailable. You can still make a snapshot of the home’s copy.')
                    captures = yield* capture({ projectId: input.projectId, workerId, worktree: first.path }).pipe(
                      Effect.mapError((error) => blocked(error.message)),
                    )
                  }
                  const bundles = new Map<string, Bundle>()
                  let remaining = MAX_WORKER_SET_BYTES
                  for (const workspace of workspaces) {
                    const captured = captures?.get(workspace.path)
                    if (captures !== undefined && captured === undefined)
                      return yield* blocked('The worker did not return staged files for every repository.')
                    const bundle = yield* prepareWorkerWorkspace(
                      workspace.path,
                      { maxBytes: Math.min(MAX_WORKER_BUNDLE_BYTES, remaining) },
                      true,
                      captured?.index,
                    )
                    bundles.set(workspace.id, bundle)
                    remaining -= bundle.size
                  }
                  for (const workspace of workspaces) {
                    const bundle = bundles.get(workspace.id)!
                    const head = yield* git(workspace.path, 'rev-parse', '--verify', 'HEAD')
                    const captured = captures?.get(workspace.path)
                    if (
                      bundle.head !== head ||
                      bundle.tree !== (yield* treeOf(workspace.path)) ||
                      (captured !== undefined && (bundle.head !== captured.head || bundle.tree !== captured.tree)) ||
                      bundle.index !== (captured?.index ?? (yield* git(workspace.path, 'write-tree')))
                    )
                      return yield* blocked('The task checkout changed while the snapshot was being made. Try again when work settles.')
                  }
                  return {
                    bundles,
                    repositories: workspaces.map(({ id, name }) => {
                      const bundle = bundles.get(id)!
                      return {
                        workspaceId: id,
                        name,
                        bytes: bundle.size,
                        sha256: bundle.sha256.toString('hex'),
                        head: bundle.head,
                        tree: bundle.tree,
                        index: bundle.index!,
                      }
                    }),
                  }
                }).pipe(Scope.provide(scope)),
              ),
            )
            active--
            const count = (reservations.get(owner) ?? 1) - 1
            if (count === 0) reservations.delete(owner)
            else reservations.set(owner, count)
            if (Exit.isFailure(made)) {
              yield* Scope.close(scope, Exit.void)
              return yield* Effect.failCause(made.cause)
            }
            const id = 'snap_' + randomBytes(16).toString('hex')
            exports.set(id, { owner, scope, bundles: made.value.bundles })
            yield* Effect.forkIn(Effect.sleep('15 minutes').pipe(Effect.andThen(drop(id))), root)
            return { ...input, id, repositories: made.value.repositories }
          }),
        ).pipe(
          Effect.provideService(SqlClient.SqlClient, sql),
          Effect.mapError((error) => (error instanceof ApiError ? error : blocked('Althar could not make a verified workspace snapshot.'))),
        )
      return WorkerSnapshots.of({
        prepare,
        read: (identity, input) =>
          Effect.gen(function* () {
            const found = exports.get(input.id)
            const bundle = found?.owner === ownerOf(identity) ? found.bundles.get(input.workspaceId) : undefined
            if (bundle === undefined || !Number.isInteger(input.offset) || input.offset < 0 || input.offset >= bundle.size)
              return yield* noSnapshot()
            const length = Math.min(MAX_SNAPSHOT_CHUNK, bundle.size - input.offset)
            const data = yield* bundle.range(input.offset, length).pipe(Effect.mapError(noSnapshot))
            const nextOffset = input.offset + length
            return { bodyBase64: data.toString('base64'), nextOffset, done: nextOffset === bundle.size }
          }),
        release: (identity, id) => Effect.suspend(() => (exports.get(id)?.owner === ownerOf(identity) ? drop(id) : Effect.void)),
      })
    }),
  )
}
