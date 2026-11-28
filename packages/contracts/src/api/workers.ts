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

/**
 * What a worker's own check found (its setup's last step, after each sign-in, and hourly): whether its agents' sandbox
 * starts there, and where not why (NoUserNamespaces, NoBubblewrap, NoSocat, Failed) with the one command an
 * administrator runs to let it; the tools on its PATH; and the models each of its signed-in agents offers there.
 */
export const WorkerReadiness = Schema.Struct({
  sandbox: Schema.Union([
    Schema.Struct({ starts: Schema.Literal(true) }),
    Schema.Struct({ starts: Schema.Literal(false), problem: Schema.String, fix: Schema.optionalKey(Schema.String) }),
  ]),
  tools: Schema.Array(Schema.Struct({ name: Schema.String, version: Schema.String })),
  models: Schema.Array(
    Schema.Struct({ providerId: Schema.String, models: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String })) }),
  ),
  /** Each signed-in agent, started once as a run starts it: whether it did, and where not, why in its own words. */
  agents: Schema.optionalKey(
    Schema.Array(Schema.Struct({ providerId: Schema.String, starts: Schema.Boolean, problem: Schema.optionalKey(Schema.String) })),
  ),
})
export type WorkerReadiness = typeof WorkerReadiness.Type

/**
 * A tool a project's files say it needs (`bun.lock` Bun, `.nvmrc` a Node, uv in `pyproject.toml` uv), at the version they
 * pin where they do, with the file that says so; for a worker, those it lacks. A worker installs Bun, Node, pnpm and uv
 * itself, into its own folder, before the task's setup (`installs`); the rest its task's lead sets up there and records.
 */
export const ToolNeed = Schema.Struct({
  name: Schema.String,
  version: Schema.optionalKey(Schema.String),
  why: Schema.String,
  installs: Schema.Boolean,
})
export type ToolNeed = typeof ToolNeed.Type

/** A connected worker the home has granted access to this project. */
export const ProjectWorker = Schema.Struct({
  workerId: Schema.String,
  /** As the person added it; none for one enrolled by command, or from an older home. */
  name: Schema.optionalKey(Schema.String),
  providers: Schema.Array(Schema.String),
  busy: Schema.Boolean,
  multiRepoProviders: Schema.optional(Schema.Array(Schema.String)),
  capacity: Schema.optionalKey(WorkerCapacity),
  /** Of `providers`, those signed in on it, where it says. */
  signedIn: Schema.optionalKey(Schema.Array(Schema.String)),
  /** What its own check found, where it has checked. */
  readiness: Schema.optionalKey(WorkerReadiness),
  /** What the project's files need that it lacks, where they need anything it lacks. */
  needs: Schema.optionalKey(Schema.Array(ToolNeed)),
})
export type ProjectWorker = typeof ProjectWorker.Type

/**
 * Where an update the person asked of a worker stands on its home: asked (until the worker is between runs and held for
 * no task, or connects), started (told to the worker, so no longer taken back), waiting (the worker said something of
 * its own runs: it's asked again before long), or how it ended: on a new release (`done`), with nothing newer it trusts
 * (`current`), or failed, and why. One that ended is said for a while, then not at all.
 */
export const WorkerUpdate = Schema.Union([
  Schema.Struct({ state: Schema.Literal('asked') }),
  Schema.Struct({ state: Schema.Literal('started') }),
  Schema.Struct({ state: Schema.Literal('waiting') }),
  Schema.Struct({ state: Schema.Literal('done'), version: Schema.String }),
  Schema.Struct({ state: Schema.Literal('current'), version: Schema.optionalKey(Schema.String) }),
  Schema.Struct({ state: Schema.Literal('failed'), message: Schema.String }),
])
export type WorkerUpdate = typeof WorkerUpdate.Type

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
  /** It updates when its home asks (`UpdateWorker`), where it says: an older worker, or one set up by hand, doesn't. */
  updatesOnRequest: Schema.optionalKey(Schema.Boolean),
  /** Where an update the person asked of it stands, where one was. */
  update: Schema.optionalKey(WorkerUpdate),
  /** What its own check found, while it is connected and has checked. */
  readiness: Schema.optionalKey(WorkerReadiness),
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
   * Asks a worker to update now, as its hourly timer would: at once where it is between runs, else once its run ends or
   * it connects. Its update unfolds on `HomeWorker.update`. Refused for a worker that can't be asked.
   */
  command('UpdateWorker', { workerId: WorkerId }, Schema.Void),
  /** Takes back an update asked of a worker that hasn't started yet. */
  command('CancelWorkerUpdate', { workerId: WorkerId }, Schema.Void),
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
