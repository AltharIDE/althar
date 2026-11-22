import { Schema } from 'effect'

export const WorkerSnapshotId = Schema.String.check(Schema.isPattern(/^snap_[a-f0-9]{32}$/u))
export const SnapshotWorkspaceId = Schema.String.check(Schema.isPattern(/^ws_[a-f0-9]{32}$/u))
export const MAX_SNAPSHOT_CHUNK = 128 * 1024
const gitObject = Schema.String.check(Schema.isPattern(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u))

export const MAX_WORKER_FILE_BYTES = 16 * 1024 * 1024

export const WorkerFileRequest = Schema.Struct({
  projectId: Schema.String.check(Schema.isPattern(/^proj_[a-f0-9]{32}$/u)),
  taskId: Schema.String.check(Schema.isPattern(/^task_[a-f0-9]{32}$/u)),
  workspaceId: Schema.optional(SnapshotWorkspaceId),
  relativePath: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512)),
})
export type WorkerFileRequest = typeof WorkerFileRequest.Type
export const WorkerFile = Schema.Struct({
  sha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/u)),
  size: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: MAX_WORKER_FILE_BYTES })),
  bodyBase64: Schema.String.check(Schema.isMaxLength(Math.ceil(MAX_WORKER_FILE_BYTES / 3) * 4)),
})

export const WorkerSnapshotRequest = Schema.Struct({
  projectId: Schema.String.check(Schema.isPattern(/^proj_[a-f0-9]{32}$/u)),
  taskId: Schema.String.check(Schema.isPattern(/^task_[a-f0-9]{32}$/u)),
  source: Schema.Literals(['worker', 'home_copy']),
})
export type WorkerSnapshotRequest = typeof WorkerSnapshotRequest.Type

export const WorkerSnapshotRepository = Schema.Struct({
  workspaceId: SnapshotWorkspaceId,
  name: Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9._-]{0,63}$/u)),
  bytes: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 128 * 1024 * 1024 })),
  sha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/u)),
  head: gitObject,
  tree: gitObject,
  index: gitObject,
})
export type WorkerSnapshotRepository = typeof WorkerSnapshotRepository.Type

export const WorkerSnapshot = Schema.Struct({
  id: WorkerSnapshotId,
  ...WorkerSnapshotRequest.fields,
  repositories: Schema.Array(WorkerSnapshotRepository).check(Schema.isMinLength(1), Schema.isMaxLength(8)),
})
export type WorkerSnapshot = typeof WorkerSnapshot.Type

export const WorkerSnapshotChunkRequest = Schema.Struct({
  id: WorkerSnapshotId,
  workspaceId: SnapshotWorkspaceId,
  offset: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 128 * 1024 * 1024 })),
})
export type WorkerSnapshotChunkRequest = typeof WorkerSnapshotChunkRequest.Type

export const WorkerSnapshotChunk = Schema.Struct({
  bodyBase64: Schema.String.check(Schema.isMaxLength(Math.ceil(MAX_SNAPSHOT_CHUNK / 3) * 4)),
  nextOffset: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 128 * 1024 * 1024 })),
  done: Schema.Boolean,
})
export type WorkerSnapshotChunk = typeof WorkerSnapshotChunk.Type
