import { Context, Effect, Layer, Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'
import { AccountsApi } from './api/accounts'
import { AttentionApi } from './api/attention'
import { AutomationsApi } from './api/automations'
import { CanvasesApi } from './api/canvases'
import { ChangesApi } from './api/changes'
import { ConnectionsApi } from './api/connections'
import { CoordinatorApi } from './api/coordinator'
import { DevicesApi } from './api/devices'
import { FoldersApi } from './api/folders'
import { HomeApi } from './api/home'
import { LaunchesApi } from './api/launches'
import { AcpApi, ModelsApi } from './api/models'
import { PlansApi } from './api/plans'
import { ProjectsApi } from './api/projects'
import { ReviewsApi } from './api/reviews'
import { SocketAllowed } from './api/rpc'
import { SearchApi } from './api/search'
import { SessionsApi } from './api/sessions'
import { SettingsApi } from './api/settings'
import { AccountStrategy, AlwaysScope, ApiError, CommandId, Holder, Product, Queued, RuleKind } from './api/shared'
import { SkillsApi } from './api/skills'
import { TasksApi } from './api/tasks'
import { PictureApi, ThreadsApi } from './api/threads'
import { ToolsApi } from './api/tools'
import { WorkerPreviewApi, WorkersApi, WorkerSnapshotApi } from './api/workers'

/*
 * What a client can ask the runtime (docs/architecture/02): commands that
 * change state, queries that return what a screen shows, and one stream of
 * what changes. Everything is a schema, checked on both sides of the port.
 * Queries return projections shaped for screens, never tables.
 *
 * Every command carries an id the client makes, so a retry is answered from
 * the first one's receipt instead of running again. Every query says the
 * change-feed cursor it read at, so a client watches from there and misses
 * nothing between the two.
 */

/** Set by the host on a connection, never accepted from an RPC payload. */
export type MessageSender =
  | { readonly kind: 'window' }
  | { readonly kind: 'paired_device'; readonly deviceId: string }
  | { readonly kind: 'socket' }
  | { readonly kind: 'internal' }

/** Bumped when a change would break a client built against an older API. */
export const API_VERSION = 1

/** The header every client request carries, naming the API version the client speaks. Compatibility is an exact match. */
export const API_VERSION_HEADER = 'x-althar-api-version'

/**
 * The header a read carries when nobody waits on it: one the change feed
 * started, to keep what a screen holds current (`BACKGROUND`). The runtime
 * runs those a few at a time, behind everything else, so a burst of them
 * never holds up a press. Without it, a call is answered as it comes.
 */
export const LANE_HEADER = 'x-althar-lane'
export const BACKGROUND = 'background'

/**
 * The reads a runtime puts behind when their request says `BACKGROUND`: the
 * store's large ones, which the window's feed reads again on almost every
 * change and which hold the runtime's thread while they run. A read that waits
 * on a process or the network holds nothing meanwhile, so it would only keep a
 * place in the lane from the reads that need it: it is answered as it comes,
 * marked or not, and so is any other call.
 */
export const BEHIND_CALLS: ReadonlySet<string> = new Set([
  'ListProjects',
  'GetHome',
  'GetBoard',
  'GetCoordinator',
  'GetThread',
  'GetThreadItem',
  'GetThreadItems',
])

/** The reason of the error a runtime answers a client of another API version with. */
export const API_VERSION_MISMATCH = 'ApiVersionMismatch'

/**
 * What a runtime answers a request with when its client speaks another API
 * version than it serves (exact match), or didn't say; nothing when it matches.
 * `headers` are the request's, as the RPC middleware has them.
 */
export const apiVersionRefusal = (headers: Readonly<Record<string, string | undefined>>): ApiError | undefined => {
  const said = headers[API_VERSION_HEADER]
  const spoken = said !== undefined && /^\d+$/.test(said) ? Number(said) : undefined
  if (spoken === API_VERSION) return undefined
  return new ApiError({
    reason: API_VERSION_MISMATCH,
    message:
      spoken === undefined
        ? `This client didn’t say which API version it speaks; this runtime serves version ${API_VERSION}.`
        : `This client speaks API version ${spoken}; this runtime serves version ${API_VERSION}.`,
    runtimeVersion: API_VERSION,
    ...(spoken === undefined ? {} : { clientVersion: spoken }),
  })
}

/** The percent of a plan left at which a warning is told. */
export const USAGE_WARN_AT = [50, 25, 10, 5] as const

/** Shared by the runtime and the window's optimistic settings. */
export const rotatesAccounts = (strategy: AccountStrategy): boolean => strategy !== 'first'

/** Each kind of request in words, as an always answer keeps it: "Always allow ___", in the window and on the home's page. */
export const ruleKindWords = {
  'default-branch': 'pushes to the default branch',
  'force-push': 'force pushes',
  'many-branches': 'pushes of every branch, tags or a pattern of branches',
  'delete-branch': 'deleting branches that aren’t the task’s',
  deploy: 'deploying and publishing',
  outside: 'writing outside the task’s worktree',
  speak: 'posting for you',
} as const satisfies Record<RuleKind, string>

/** The decision presented in a security-key ceremony for a restricted HTTPS client. */
export const PermissionApproval = Schema.Struct({
  commandId: CommandId,
  attentionId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  decision: Schema.Literals(['allow', 'reject']),
  reason: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(1000))),
  always: Schema.optionalKey(AlwaysScope),
})
export type PermissionApproval = typeof PermissionApproval.Type

/** How far back a project's tally of asks and refusals goes. */
export const TALLY_DAYS = 14

/** How long a note may be: a decision, in a sentence or two. */
export const NOTE_LENGTH = 300

export const WorkPlaces = Schema.Struct({
  ...Queued.fields,
  holders: Schema.Array(Holder),
  configured: Schema.Int,
  offline: Schema.Boolean,
})
export type WorkPlaces = typeof WorkPlaces.Type

/** Items to a page, when a client doesn't say. */
export const PAGE = 100

/**
 * The code hosts a socket sets its home up with, by product and by service: connected, checked or removed there. A
 * tracker's connection, like a project's tracker, stays with the person's own window.
 */
export const SOCKET_CODE_HOSTS: ReadonlySet<string> = new Set<Product>(['github', 'gitlab', 'bitbucket_cloud', 'bitbucket_dc'])

export const Api = HomeApi.merge(
  DevicesApi,
  AttentionApi,
  ProjectsApi,
  TasksApi,
  ThreadsApi,
  PictureApi,
  SearchApi,
  CanvasesApi,
  PlansApi,
  ReviewsApi,
  ChangesApi,
  SessionsApi,
  ModelsApi,
  AcpApi,
  SettingsApi,
  ToolsApi,
  AutomationsApi,
  FoldersApi,
  ConnectionsApi,
  AccountsApi,
  WorkersApi,
  WorkerPreviewApi,
  WorkerSnapshotApi,
  LaunchesApi,
  SkillsApi,
  CoordinatorApi,
)
export type Api = typeof Api

/** The calls a socket connection may make, as `GetConnectionInfo` tells it: what its window offers follows from them. */
export const SOCKET_CALLS: ReadonlyArray<string> = [...Api.requests.values()]
  .filter((rpc) => Context.get(rpc.annotations, SocketAllowed))
  .map((rpc) => rpc._tag)
/** Closed handlers capture their services when built; callers cannot accidentally require another client's context. */
export type ApiHandlers = { readonly [R in RpcGroup.Rpcs<Api> as R['_tag']]: Rpc.ToHandlerFn<R, never> }

/** Build once per connection, then install bounded groups to keep handler service inference tractable as the API grows. */
export const apiLayer = <E = never, R = never>(build: ApiHandlers | Effect.Effect<ApiHandlers, E, R>) =>
  Layer.unwrap(
    Effect.map(Effect.isEffect(build) ? build : Effect.succeed(build), (handlers) =>
      Layer.mergeAll(
        HomeApi.toLayer<{ readonly [P in RpcGroup.Rpcs<typeof HomeApi> as P['_tag']]: Rpc.ToHandlerFn<P, never> }>(handlers),
        DevicesApi.toLayer<{ readonly [P in RpcGroup.Rpcs<typeof DevicesApi> as P['_tag']]: Rpc.ToHandlerFn<P, never> }>(handlers),
        AttentionApi.toLayer<{ readonly [P in RpcGroup.Rpcs<typeof AttentionApi> as P['_tag']]: Rpc.ToHandlerFn<P, never> }>(handlers),
        ProjectsApi.toLayer<{ readonly [P in RpcGroup.Rpcs<typeof ProjectsApi> as P['_tag']]: Rpc.ToHandlerFn<P, never> }>(handlers),
        TasksApi.toLayer<{ readonly [P in RpcGroup.Rpcs<typeof TasksApi> as P['_tag']]: Rpc.ToHandlerFn<P, never> }>(handlers),
        ThreadsApi.toLayer<{ readonly [P in RpcGroup.Rpcs<typeof ThreadsApi> as P['_tag']]: Rpc.ToHandlerFn<P, never> }>(handlers),
        PictureApi.toLayer<{ readonly [P in RpcGroup.Rpcs<typeof PictureApi> as P['_tag']]: Rpc.ToHandlerFn<P, never> }>(handlers),
        SearchApi.toLayer<{ readonly [P in RpcGroup.Rpcs<typeof SearchApi> as P['_tag']]: Rpc.ToHandlerFn<P, never> }>(handlers),
        CanvasesApi.toLayer<{ readonly [P in RpcGroup.Rpcs<typeof CanvasesApi> as P['_tag']]: Rpc.ToHandlerFn<P, never> }>(handlers),
        PlansApi.toLayer<{ readonly [P in RpcGroup.Rpcs<typeof PlansApi> as P['_tag']]: Rpc.ToHandlerFn<P, never> }>(handlers),
        ReviewsApi.toLayer<{ readonly [P in RpcGroup.Rpcs<typeof ReviewsApi> as P['_tag']]: Rpc.ToHandlerFn<P, never> }>(handlers),
        ChangesApi.toLayer<{ readonly [P in RpcGroup.Rpcs<typeof ChangesApi> as P['_tag']]: Rpc.ToHandlerFn<P, never> }>(handlers),
        SessionsApi.toLayer<{ readonly [P in RpcGroup.Rpcs<typeof SessionsApi> as P['_tag']]: Rpc.ToHandlerFn<P, never> }>(handlers),
        ModelsApi.toLayer<{ readonly [P in RpcGroup.Rpcs<typeof ModelsApi> as P['_tag']]: Rpc.ToHandlerFn<P, never> }>(handlers),
        AcpApi.toLayer<{ readonly [P in RpcGroup.Rpcs<typeof AcpApi> as P['_tag']]: Rpc.ToHandlerFn<P, never> }>(handlers),
        SettingsApi.toLayer<{ readonly [P in RpcGroup.Rpcs<typeof SettingsApi> as P['_tag']]: Rpc.ToHandlerFn<P, never> }>(handlers),
        ToolsApi.toLayer<{ readonly [P in RpcGroup.Rpcs<typeof ToolsApi> as P['_tag']]: Rpc.ToHandlerFn<P, never> }>(handlers),
        AutomationsApi.toLayer<{ readonly [P in RpcGroup.Rpcs<typeof AutomationsApi> as P['_tag']]: Rpc.ToHandlerFn<P, never> }>(handlers),
        FoldersApi.toLayer<{ readonly [P in RpcGroup.Rpcs<typeof FoldersApi> as P['_tag']]: Rpc.ToHandlerFn<P, never> }>(handlers),
        ConnectionsApi.toLayer<{ readonly [P in RpcGroup.Rpcs<typeof ConnectionsApi> as P['_tag']]: Rpc.ToHandlerFn<P, never> }>(handlers),
        AccountsApi.toLayer<{ readonly [P in RpcGroup.Rpcs<typeof AccountsApi> as P['_tag']]: Rpc.ToHandlerFn<P, never> }>(handlers),
        WorkersApi.toLayer<{ readonly [P in RpcGroup.Rpcs<typeof WorkersApi> as P['_tag']]: Rpc.ToHandlerFn<P, never> }>(handlers),
        WorkerPreviewApi.toLayer<{ readonly [P in RpcGroup.Rpcs<typeof WorkerPreviewApi> as P['_tag']]: Rpc.ToHandlerFn<P, never> }>(
          handlers,
        ),
        WorkerSnapshotApi.toLayer<{ readonly [P in RpcGroup.Rpcs<typeof WorkerSnapshotApi> as P['_tag']]: Rpc.ToHandlerFn<P, never> }>(
          handlers,
        ),
        LaunchesApi.toLayer<{ readonly [P in RpcGroup.Rpcs<typeof LaunchesApi> as P['_tag']]: Rpc.ToHandlerFn<P, never> }>(handlers),
        SkillsApi.toLayer<{ readonly [P in RpcGroup.Rpcs<typeof SkillsApi> as P['_tag']]: Rpc.ToHandlerFn<P, never> }>(handlers),
        CoordinatorApi.toLayer<{ readonly [P in RpcGroup.Rpcs<typeof CoordinatorApi> as P['_tag']]: Rpc.ToHandlerFn<P, never> }>(handlers),
      ),
    ),
  )
