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
  'PlacePlan',
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
  // A picture a thread shows, by its digest: what a window on another computer, or a phone, draws it from (PictureApi).
  'ReadPicture',
  // Making a project on the home the window is on: where its code comes from (a clone, a folder the home found, a new
  // repository there), by grants the home made, never a path the window names. An agent's task can do as much there.
  'FindHomeFolders',
  'GetMachine',
  'ListConnections',
  'ListHostRepositories',
  'ReadHostReach',
  'GetRepositories',
  'ReadFolder',
  'PlaceRepository',
  'MakeRepository',
  'PrepareFolder',
  'CloneRepository',
  'OpenProject',
  // Setting the home up from the window: the code hosts it works with, connected there (a token made on the host's page and
  // pasted, the home's own gh or glab sign-in, or the host's device sign-in where the home has Althar's app for it), and its
  // agents' accounts signed in there (the agent's page opened in the window's browser and its code pasted back, or a device
  // code). Each keeps its credential on the home, sealed out of its agents' reach, as one made on the home itself would.
  'GetConnectGuide',
  'FindServer',
  'StartSignIn',
  'GetSignIn',
  'CancelSignIn',
  'ConnectToken',
  'ConnectCli',
  'CheckConnection',
  'Disconnect',
  'AddAccount',
  'RenameAccount',
  'RemoveAccount',
  'SignOutAccount',
  'OrderAccounts',
  'FindAccounts',
  'SignInAccount',
  'StartAccountSignIn',
  'GetAccountSignIn',
  'PasteAccountSignInCode',
  'CancelAccountSignIn',
  // The home's own settings, changed from its window as Settings shows them under the home's name: how its tasks go, its
  // pull requests, its presets, how many agents work there at once, its automations and its finished tasks' folders.
  // What a project's rules give stays with the project's own settings, and what only the person decides with the person:
  // trusting outside code fully (SetRunOutside), removing finished tasks' folders and what they hold (CleanUpFolders,
  // RemoveTaskFolder), and removing a preset of their own (RemovePreset).
  'SetPlansAndReviews',
  'SetSendMidTurn',
  'SetNewProjectDefaults',
  'SetAutomationsPaused',
  'ListPresets',
  'EditPreset',
  'TunePreset',
  'ResetPreset',
  'SetPostTeamReviews',
  'SetCoAuthor',
  'SetReviewSeal',
  'SetReviewSealStyle',
  'SetShipRoute',
  'SetAgentsAtOnce',
  'GetTaskFolders',
  'SetFolderWait',
  // The home's MCP servers and skills, its agents' own (ADR-097): read, given to roles and projects, synced, added and
  // removed from its window. A server's sign-in runs the agent's own command where it is, opening a browser on the home,
  // so it stays with a window on that computer.
  'GetAgentTools',
  'GetServerDetail',
  'CheckServers',
  'SetToolRoles',
  'SetToolInProject',
  'SetToolSync',
  'SetToolKeptOut',
  'PickToolWay',
  'UndoToolSync',
  'AddServer',
  'RemoveServer',
  'ListSkills',
  'FindSkills',
  'StageSkill',
  'ApproveSkill',
  'CheckSkillUpdates',
  'RollBackSkill',
  'UninstallSkill',
])

/** The same deny-by-default policy used at authenticated ingress, for clients that show their connection's capabilities. */
export const socketCanCall = (tag: string): boolean => tag === 'WatchFrom' || tag === 'WatchAttention' || socketCalls.has(tag)

export const call = <const Tag extends string, P extends Schema.Struct.Fields, S extends Schema.Top>(tag: Tag, payload: P, success: S) =>
  Rpc.make(tag, { payload, success, error: ApiError }).annotate(SocketAllowed, socketCanCall(tag))

/** A command: what it says, and the client's id for it. */
export const command = <const Tag extends string, P extends Schema.Struct.Fields, S extends Schema.Top>(tag: Tag, payload: P, success: S) =>
  call(tag, { commandId: CommandId, ...payload }, success)

export const limit = Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 500 })))
