import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'
import {
  WorkerPreviewRequest,
  WorkerPreviewResponse,
  WorkerPreviewRun,
  WorkerPreviewSocketData,
  WorkerPreviewSocketId,
} from '../workerPreview'
import {
  WorkerFile,
  WorkerFileRequest,
  WorkerSnapshot,
  WorkerSnapshotChunk,
  WorkerSnapshotChunkRequest,
  WorkerSnapshotId,
  WorkerSnapshotRequest,
} from '../workerSnapshot'
import { call, ClientAuthority, command, SocketAllowed } from './rpc'
import { ApiError } from './shared'

export const WorkerCapacity = Schema.Struct({
  platform: Schema.Literals(['linux', 'macos', 'windows']),
  architecture: Schema.Literals(['x64', 'arm64']),
  cpuCores: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65_535 })),
  freeMemoryMib: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 0xffffffff })),
  freeDiskMib: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 0xffffffff })),
})

export type WorkerCapacity = typeof WorkerCapacity.Type

/** A connected worker the home has granted access to this project. */
export const ProjectWorker = Schema.Struct({
  workerId: Schema.String,
  /** As the person added it; none for one enrolled by command, or from an older home. */
  name: Schema.optionalKey(Schema.String),
  providers: Schema.Array(Schema.String),
  busy: Schema.Boolean,
  multiRepoProviders: Schema.optional(Schema.Array(Schema.String)),
  capacity: Schema.optionalKey(WorkerCapacity),
})
export type ProjectWorker = typeof ProjectWorker.Type

/**
 * A worker the home enrolled, as Settings › Computers and the load popover
 * list it (ADR-103): whether it is connected now, whether it runs a task (one
 * at a time) and which, what it reported last, the agents it can run and the
 * projects it may work on.
 */
export const HomeWorker = Schema.Struct({
  workerId: Schema.String,
  /** As the person added it: the computer's name or its SSH address; none for one enrolled by command, or from an older home. */
  name: Schema.optionalKey(Schema.String),
  /** The SSH address it was set up at, where it was: a window signs its agents in there. */
  ssh: Schema.optionalKey(Schema.String),
  connected: Schema.Boolean,
  /** Running a task; or, offline, still holding the workspace of the task it went offline during, until it says it stopped. */
  busy: Schema.Boolean,
  /** What it reported last, while that is current; none while it is offline or hasn't said. */
  capacity: Schema.optionalKey(WorkerCapacity),
  /** The agents it can run, by id; empty while it is offline. */
  providers: Schema.Array(Schema.String),
  /**
   * Of `providers`, those signed in on it, as it said when it connected; none where it doesn't say, as one set up by hand
   * or an older worker doesn't.
   */
  signedIn: Schema.optionalKey(Schema.Array(Schema.String)),
  /** The Althar release it runs, where it says. */
  release: Schema.optionalKey(Schema.String),
  /** It works on whatever project it is given, as one the home set up does: its projects are picked in the window. */
  anyProject: Schema.optionalKey(Schema.Boolean),
  projects: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String })),
  /** The home's task it runs now, or went offline during, where it holds one. */
  task: Schema.NullOr(Schema.Struct({ taskId: Schema.String, threadId: Schema.String, title: Schema.String, project: Schema.String })),
})
export type HomeWorker = typeof HomeWorker.Type

/**
 * The home's workers: whether it takes workers at all (it is set up to listen for them), each it enrolled, and whether
 * it adds them itself (`adds`): it is its own authority, and signs a worker's key as the window asks. A home that only
 * takes workers by its operator's certificates, or an older one, doesn't.
 */
export const HomeWorkers = Schema.Struct({
  enabled: Schema.Boolean,
  workers: Schema.Array(HomeWorker),
  adds: Schema.optionalKey(Schema.Boolean),
})

export type HomeWorkers = typeof HomeWorkers.Type

/** A worker the home signed, as the window hands it to the worker it sets up: all it needs to reach the home and prove who it is. */
export const WorkerGrant = Schema.Struct({
  homeId: Schema.String,
  workerId: Schema.String,
  /** The home's own authority's certificate, PEM: all the worker trusts. */
  authority: Schema.String,
  /** The worker's certificate, PEM, signed for its own key. */
  certificate: Schema.String,
  /** The name the home's certificate carries, wherever the worker reaches it. */
  serverName: Schema.String,
  port: Schema.Int,
  /** Where the worker may reach the home, `host:port`, best first. */
  addresses: Schema.Array(Schema.String),
})
export type WorkerGrant = typeof WorkerGrant.Type
const WorkerId = Schema.String.check(Schema.isPattern(/^wrk_[a-f0-9]{32}$/u))

/**
 * The workers a home enrolled: adding, removing, their projects, and those of a project.
 * What a worker serves back: a launch's preview and its sockets, its files and snapshots.
 */
export const WorkersApi = RpcGroup.make(
  call('ListProjectWorkers', { projectId: Schema.String }, Schema.Array(ProjectWorker)),
  /** The workers this home enrolled, connected or not, and what each runs and reported. */
  call('GetWorkers', {}, HomeWorkers),
  /** Takes a worker out of this home: its certificate is no longer accepted, and it gets no more work. */
  command('RemoveWorker', { workerId: WorkerId }, Schema.Void),
  /**
   * Adds a worker: the home signs the worker's own P-256 public key (SPKI DER, base64url) as its certificate, enrolls it
   * by that key under the name the person knows it by, and opens its worker port where it hasn't yet. Again for the same
   * key, the same worker. The home's operator or the person's own client only, as pairing a device is.
   */
  command(
    'AddWorker',
    {
      publicKey: Schema.String.check(Schema.isMaxLength(512)),
      name: Schema.String.check(Schema.isMaxLength(80)),
      ssh: Schema.optional(Schema.String.check(Schema.isMaxLength(255))),
    },
    WorkerGrant,
  ),
  /** A one-time code a machine without SSH adds itself with, good for ten minutes and one worker. Not a command: no receipt keeps the code. */
  call(
    'CreateWorkerCode',
    { name: Schema.String.check(Schema.isMaxLength(80)) },
    Schema.Struct({ code: Schema.String, expiresAt: Schema.Number }),
  ),
  /** The projects a worker may work on, as the person picks them: one taken off stops its run there. */
  command('SetWorkerProjects', { workerId: WorkerId, projectIds: Schema.Array(Schema.String).check(Schema.isMaxLength(256)) }, Schema.Void),
).middleware(ClientAuthority)

export const WorkerPreviewApi = RpcGroup.make(
  call('ReadLaunchPreview', WorkerPreviewRequest.fields, WorkerPreviewResponse),
  call('OpenLaunchPreviewSocket', WorkerPreviewRun.fields, WorkerPreviewSocketId),
  Rpc.make('ReadLaunchPreviewSocket', {
    payload: { socket: WorkerPreviewSocketId },
    success: WorkerPreviewSocketData,
    error: ApiError,
    stream: true,
  }).annotate(SocketAllowed, true),
  call('WriteLaunchPreviewSocket', { socket: WorkerPreviewSocketId, data: WorkerPreviewSocketData }, Schema.Void),
  call('CloseLaunchPreviewSocket', { socket: WorkerPreviewSocketId }, Schema.Void),
).middleware(ClientAuthority)

export const WorkerSnapshotApi = RpcGroup.make(
  call('ReadWorkerFile', WorkerFileRequest.fields, WorkerFile),
  call('PrepareWorkerSnapshot', WorkerSnapshotRequest.fields, WorkerSnapshot),
  call('ReadWorkerSnapshotChunk', WorkerSnapshotChunkRequest.fields, WorkerSnapshotChunk),
  call('ReleaseWorkerSnapshot', { id: WorkerSnapshotId }, Schema.Void),
).middleware(ClientAuthority)
