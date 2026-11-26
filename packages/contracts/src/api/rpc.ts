import { Context, Schema } from 'effect'
import { Rpc, RpcMiddleware } from 'effect/rpc'
import { ApiError, CommandId } from './shared'

/* What every area's group is made with: its calls, its commands, and who may make them. */

/** ADR-048: new calls are unavailable to a socket until explicitly marked. */
export const SocketAllowed = Context.Reference<boolean>('@althar/contracts/SocketAllowed', { defaultValue: () => false })

/** Enforced by the runtime for each connection, including streaming calls. */
export class ClientAuthority extends RpcMiddleware.Service<ClientAuthority>()('@althar/contracts/ClientAuthority', { error: ApiError }) {}

const socketCalls = new Set<string>([
  'IssueDevicePairing',
  'CreatePairingCode',
  'GetPairingStatus',
  'GetPhoneAccess',
  'SetPhoneAccess',
  'ListClientDevices',
  'RevokeConnectionDevice',
  'GetConnectionInfo',
  'Status',
  'ListProjects',
  'ListProjectWorkers',
  'GetThread',
  'GetThreadItem',
  'GetThreadItems',
  'ReadOutput',
  'ReadDocument',
  'ListCanvases',
  'ListArtifactsDrawing',
  'GetCanvas',
  'ReadCanvasText',
  'FindCode',
  'ReadCode',
  'GetFileDiff',
  'GetTaskFindings',
  'GetLineComments',
  'GetBoard',
  'GetOlderSettled',
  'GetHome',
  'GetCoordinator',
  'GetModels',
  'GetPlanUsage',
  'GetSettings',
  'GetLoad',
  'GetPlaces',
  'GetWorkers',
  'AddWorker',
  'CreateWorkerCode',
  'SetWorkerProjects',
  'RemoveWorker',
  'SearchTasks',
  'GetSearchDocuments',
  'GetSearchFiles',
  'Watch',
  'Send',
  'SetThreadGoal',
  'TakeBack',
  'StartTask',
  'StartPlan',
  'HoldPlan',
  'CreateTask',
  'StopTask',
  'ResumeTask',
  'StartSession',
  'StopSession',
  'Interrupt',
  'SwitchAgent',
  'SetModel',
  'SetEffort',
  'SetAgent',
  'GetRepositoryScripts',
  'ReadLaunchPreview',
  'OpenLaunchPreviewSocket',
  'ReadLaunchPreviewSocket',
  'WriteLaunchPreviewSocket',
  'CloseLaunchPreviewSocket',
  'PrepareWorkerSnapshot',
  'ReadWorkerSnapshotChunk',
  'ReleaseWorkerSnapshot',
  'ReadWorkerFile',
  // Making a project on the home the window is on: where its code comes from (a clone, a folder the home found, a new
  // repository there), by grants the home made, never a path the window names. An agent's task can do as much there.
  'FindHomeFolders',
  'GetMachine',
  'ListConnections',
  'ListHostRepositories',
  'GetRepositories',
  'ReadFolder',
  'PlaceRepository',
  'MakeRepository',
  'PrepareFolder',
  'CloneRepository',
  'OpenProject',
])

/** The same deny-by-default policy used at authenticated ingress, for clients that show their connection's capabilities. */
export const socketCanCall = (tag: string): boolean => tag === 'WatchFrom' || tag === 'WatchAttention' || socketCalls.has(tag)

export const call = <const Tag extends string, P extends Schema.Struct.Fields, S extends Schema.Top>(tag: Tag, payload: P, success: S) =>
  Rpc.make(tag, { payload, success, error: ApiError }).annotate(SocketAllowed, socketCanCall(tag))

/** A command: what it says, and the client's id for it. */
export const command = <const Tag extends string, P extends Schema.Struct.Fields, S extends Schema.Top>(tag: Tag, payload: P, success: S) =>
  call(tag, { commandId: CommandId, ...payload }, success)

export const limit = Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 500 })))
