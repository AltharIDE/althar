import { type Actor, authorize, type Decision, type Index, type Permission, type Refusal, visibleProjects } from '@althar/access'
import type { Api } from '@althar/contracts'
import { Effect, Option } from 'effect'
import type { RpcGroup } from 'effect/rpc'
import { SqlClient, type SqlError } from 'effect/sql'

/**
 * What every call of the home's API needs from a member of an organization: the permission it checks and how its
 * project is found. The table names every call, so a new call can't be added without deciding; one missing is a type
 * error, and a test checks each locator against the call's payload.
 *
 * Today's connections (the window, a paired device, a socket) act for the profile's one person and don't consult it.
 * It is what a member's connection is checked against once members connect (ADR-113's member role).
 */

export type ApiTag = RpcGroup.Rpcs<typeof Api>['_tag']

/** Where a call's project comes from: the payload names the project, or something that belongs to one. */
export type Locator =
  | 'project'
  | 'task'
  | 'thread'
  | 'plan'
  | 'item'
  | 'attention'
  | 'issue_draft'
  | 'review_draft'
  | 'issue_changes'
  | 'automation'
  | 'canvas'
  /** Held in memory by the home, not in its store; a member is refused these until the home can say whose they are. */
  | 'terminal'
  | 'launch'
  | 'preview_socket'
  | 'worker_snapshot'

export type CallAccess =
  /** Anyone connected: the connection's own state, or the home's harmless descriptions. */
  | { readonly kind: 'open' }
  /** Allowed, but what it answers spans projects and must be cut to the ones the member can see. */
  | { readonly kind: 'visible' }
  /** The home itself, or the organization: its folders, workers, devices, agents, integrations. */
  | { readonly kind: 'organization'; readonly permission: Permission }
  /** On one project, found through the payload. */
  | { readonly kind: 'project'; readonly permission: Permission; readonly from: Locator }
  /** The person's own setup (their agent accounts, presets, defaults, MCP servers), kept per profile today. Not shared. */
  | { readonly kind: 'personal' }

/** The payload field each locator reads. */
export const locatorField: Record<Locator, string> = {
  project: 'projectId',
  task: 'taskId',
  thread: 'threadId',
  plan: 'planId',
  item: 'itemId',
  attention: 'attentionId',
  issue_draft: 'draftId',
  review_draft: 'draftId',
  issue_changes: 'changesId',
  automation: 'automationId',
  canvas: 'canvasId',
  terminal: 'id',
  launch: 'id',
  preview_socket: 'socket',
  worker_snapshot: 'id',
}

/** The table each stored locator's id is a row of. Every project-scoped row carries its project (architecture 07). */
export const locatorTable: Partial<Record<Locator, string>> = {
  task: 'tasks',
  thread: 'threads',
  plan: 'task_plans',
  item: 'thread_items',
  attention: 'attention_requests',
  issue_draft: 'issue_drafts',
  review_draft: 'review_drafts',
  issue_changes: 'issue_changes',
  automation: 'automations',
  canvas: 'canvases',
}

const open = { kind: 'open' } as const
const visible = { kind: 'visible' } as const
const personal = { kind: 'personal' } as const
const org = (permission: Permission) => ({ kind: 'organization', permission }) as const
const on =
  (from: Locator) =>
  (permission: Permission): CallAccess => ({ kind: 'project', permission, from })
const project = on('project')
const task = on('task')
const thread = on('thread')
const plan = on('plan')
const item = on('item')
const attention = on('attention')

export const callAccess = {
  // The connection and the home.
  Status: open,
  GetConnectionInfo: open,
  GetMachine: open,
  ListEditors: open,
  GetLoad: open,
  GetModels: open,
  GetSettings: open,
  GetAgentCatalog: open,
  ListSkills: open,
  ListConnections: open,
  GetConnectGuide: open,
  LeftHome: open,
  ListProjects: visible,
  GetHome: visible,
  Watch: visible,
  WatchFrom: visible,
  WatchAttention: visible,
  GetSearchDocuments: visible,

  // Pairing and devices: who may connect to this home.
  IssueDevicePairing: org('homes.manage'),
  CreatePairingCode: org('homes.manage'),
  GetPairingStatus: org('homes.manage'),
  GetPhoneAccess: org('homes.manage'),
  SetPhoneAccess: org('homes.manage'),
  RevokeConnectionDevice: org('homes.manage'),
  ListClientDevices: org('homes.manage'),
  RegisterClientDevice: org('homes.manage'),
  RevokeClientDevice: org('homes.manage'),

  // The home's folders, store, agents and limits.
  ReadFolder: org('homes.manage'),
  ListContainers: org('homes.manage'),
  SetAgentsAtOnce: org('homes.manage'),
  SetFolderWait: org('homes.manage'),
  SetPlansAndReviews: org('homes.manage'),
  SetNewProjectDefaults: org('homes.manage'),
  SetAutomationsPaused: org('homes.manage'),
  GetTaskFolders: org('homes.manage'),
  GetStorageSize: org('homes.manage'),
  CleanUpFolders: org('homes.manage'),
  GetMissedReports: org('homes.manage'),
  InstallAgent: org('homes.manage'),
  SaveAcpConnection: org('homes.manage'),
  CheckAcpConnection: org('homes.manage'),
  RemoveAcpConnection: org('homes.manage'),
  FindSkills: org('homes.manage'),
  StageSkill: org('homes.manage'),
  ApproveSkill: org('homes.manage'),
  CheckSkillUpdates: org('homes.manage'),
  RollBackSkill: org('homes.manage'),
  UninstallSkill: org('homes.manage'),

  // Workers and where work runs.
  GetPlaces: org('pools.manage'),
  GetWorkers: org('pools.manage'),
  AddWorker: org('pools.manage'),
  RemoveWorker: org('pools.manage'),
  CreateWorkerCode: org('pools.manage'),
  SetWorkerProjects: org('pools.manage'),

  // Code hosts and trackers the home is connected to.
  StartSignIn: org('integrations.manage'),
  GetSignIn: org('integrations.manage'),
  CancelSignIn: org('integrations.manage'),
  ConnectToken: org('integrations.manage'),
  FindServer: org('integrations.manage'),
  ConnectCli: org('integrations.manage'),
  CheckConnection: org('integrations.manage'),
  Disconnect: org('integrations.manage'),

  // Making projects on the home.
  OpenProject: org('projects.create'),
  FindHomeFolders: org('projects.create'),
  PlaceRepository: org('projects.create'),
  MakeRepository: org('projects.create'),
  PrepareFolder: org('projects.create'),
  CloneRepository: org('projects.create'),
  PublishRepository: org('projects.create'),
  ListHostRepositories: org('projects.create'),
  ListRepositoryOwners: org('projects.create'),

  // The person's own setup.
  AddAccount: personal,
  RenameAccount: personal,
  RemoveAccount: personal,
  SignOutAccount: personal,
  OrderAccounts: personal,
  FindAccounts: personal,
  SignInAccount: personal,
  StartAccountSignIn: personal,
  GetAccountSignIn: personal,
  PasteAccountSignInCode: personal,
  CancelAccountSignIn: personal,
  DismissSignInEnding: personal,
  GetPlanUsage: personal,
  SetDefaultEffort: personal,
  SetModelBlocked: personal,
  GetServerDetail: personal,
  CheckServers: personal,
  AddServer: personal,
  RemoveServer: personal,
  SetToolSync: personal,
  SetToolKeptOut: personal,
  PickToolWay: personal,
  UndoToolSync: personal,
  SignInToolServer: personal,
  SetCoAuthor: personal,
  SetPostTeamReviews: personal,
  SetRunOutside: personal,
  SetSendMidTurn: personal,
  SetShipRoute: personal,
  SetReviewSeal: personal,
  SetReviewSealStyle: personal,
  RemovePreset: personal,
  EditPreset: personal,
  TunePreset: personal,
  ResetPreset: personal,
  SavePreset: personal,
  DeclinePresetOffer: personal,

  // A project and its settings.
  RenameProject: project('project.manage'),
  SetProjectInk: project('project.manage'),
  GetProjectTracker: project('project.view'),
  SetProjectTracker: project('project.manage'),
  RemoveProject: project('project.delete'),
  SetArtifactsHome: project('project.manage'),
  SetProjectAccounts: project('project.manage'),
  SetUsageLimit: project('project.manage'),
  LineOldestFirst: project('project.manage'),
  KeepRunnable: project('project.manage'),
  DropRunnable: project('project.manage'),
  OrderRunnables: project('project.manage'),
  GetProjectRules: project('project.view'),
  SetProjectRules: project('rules.loosen'),
  GetSettingChanges: project('project.view'),
  GetVocabulary: project('project.view'),
  GetModelRooms: project('project.view'),
  ListPresets: project('project.view'),
  GetAgentTools: project('project.view'),
  SetToolRoles: project('tools.manage'),
  SetToolInProject: project('tools.manage'),
  GetProjectNotes: project('project.view'),
  EditProjectNote: project('notes.manage'),
  DropProjectNote: project('notes.manage'),
  ListIssues: project('project.view'),

  // Its repositories.
  GetRepositories: project('project.view'),
  AddRepositories: project('repositories.manage'),
  LeaveOutRepository: project('repositories.manage'),
  SetRepository: project('repositories.manage'),
  AddParentRemote: project('repositories.manage'),
  LookElsewhere: project('repositories.manage'),
  ListRepositoryFolders: project('project.view'),
  GetRepositoryScripts: project('project.view'),
  CreateBranch: project('changes.ship'),

  // The board, tasks and the coordinator.
  GetBoard: project('project.view'),
  GetOlderSettled: project('project.view'),
  ListTasks: project('project.view'),
  SearchTasks: project('project.view'),
  ListProjectWorkers: project('project.view'),
  ListCanvases: project('project.view'),
  ListArtifactsDrawing: project('project.view'),
  GetArtifactsPlace: project('project.view'),
  GetCoordinator: project('coordinator.talk'),
  CreateTask: project('tasks.run'),
  StartTask: project('tasks.run'),
  BringIn: project('tasks.run'),
  LookForConflicts: project('changes.ship'),
  ReadWorkerFile: project('project.view'),
  PrepareWorkerSnapshot: project('work.download'),
  ReadWorkerSnapshotChunk: on('worker_snapshot')('work.download'),
  ReleaseWorkerSnapshot: on('worker_snapshot')('work.download'),

  // Automations.
  GetAutomations: project('project.view'),
  MakeAutomation: project('automations.manage'),
  GetAutomation: on('automation')('project.view'),
  ChangeAutomation: on('automation')('automations.manage'),
  TurnOnAutomation: on('automation')('automations.manage'),
  PauseAutomation: on('automation')('automations.manage'),
  DeleteAutomation: on('automation')('automations.manage'),
  SetAutomationPostsReviews: on('automation')('automations.manage'),
  RunAutomationNow: on('automation')('automations.run'),
  UndoAutomationChange: item('automations.manage'),

  // Running the project, terminals and previews.
  RunProject: project('runs.use'),
  GetRunnableRefs: project('runs.use'),
  ListLaunches: project('runs.use'),
  ListTerminals: project('runs.use'),
  ReadLaunchPreview: project('runs.use'),
  OpenLaunchPreviewSocket: project('runs.use'),
  OpenTerminal: project('terminals.use'),
  AttachTerminal: on('terminal')('terminals.use'),
  WriteTerminal: on('terminal')('terminals.use'),
  ResizeTerminal: on('terminal')('terminals.use'),
  CloseTerminal: on('terminal')('terminals.use'),
  StopLaunch: on('launch')('runs.use'),
  ClearLaunch: on('launch')('runs.use'),
  ReadLaunchOutput: on('launch')('runs.use'),
  ReadLaunchPreviewSocket: on('preview_socket')('runs.use'),
  WriteLaunchPreviewSocket: on('preview_socket')('runs.use'),
  CloseLaunchPreviewSocket: on('preview_socket')('runs.use'),
  RunIt: task('runs.use'),
  StopRunning: task('runs.use'),

  // Plans.
  StartPlan: plan('tasks.run'),
  HoldPlan: plan('coordinator.talk'),
  ChangePlan: plan('coordinator.talk'),
  ApplyPreset: plan('coordinator.talk'),

  // Reading a task and its threads.
  SeeTask: task('project.view'),
  GetFileDiff: task('project.view'),
  GetTaskFindings: task('project.view'),
  GetLineComments: task('project.view'),
  RefreshTask: task('project.view'),
  OpenInEditor: task('project.view'),
  GetThread: thread('project.view'),
  GetThreadItem: thread('project.view'),
  GetThreadItems: thread('project.view'),
  GetSearchFiles: thread('project.view'),
  ReadOutput: thread('project.view'),
  ReadBackgroundOutput: thread('project.view'),
  ReadDocument: thread('project.view'),
  FindCode: thread('project.view'),
  ReadCode: thread('project.view'),
  OpenCode: thread('project.view'),
  ShowEarlier: thread('project.view'),
  GetCanvas: on('canvas')('project.view'),
  ReadCanvasText: on('canvas')('project.view'),

  // Talking to agents and steering tasks: one's own, or with Maintain anyone's.
  Send: thread('tasks.steer'),
  HoldDraft: thread('coordinator.talk'),
  PreferIssueCards: thread('coordinator.talk'),
  StartSession: thread('tasks.steer'),
  SwitchAgent: thread('tasks.steer'),
  SetModel: thread('tasks.steer'),
  SetEffort: thread('tasks.steer'),
  SetAgent: thread('tasks.steer'),
  SetThreadGoal: thread('tasks.steer'),
  Interrupt: thread('tasks.steer'),
  TryAgain: thread('tasks.steer'),
  CompactContext: thread('tasks.steer'),
  ClearView: thread('tasks.steer'),
  UndoClearView: thread('tasks.steer'),
  ForgetConversation: thread('tasks.steer'),
  StopSession: thread('tasks.steer'),
  StopBackground: thread('tasks.steer'),
  ClearBackground: thread('tasks.steer'),
  TakeBack: item('tasks.steer'),
  UndoTurn: item('tasks.steer'),
  KeepTheModel: item('tasks.steer'),
  UndoTheModelMove: item('tasks.steer'),
  StopWaiting: task('tasks.steer'),
  ChangeTeam: task('tasks.steer'),
  MakeItAFullTask: task('tasks.steer'),
  RemoveTaskFolder: task('tasks.steer'),
  MoveInLine: task('tasks.steer'),
  StartAnyway: task('tasks.steer'),
  StopTask: task('tasks.steer'),
  SetTaskResolveConflicts: task('tasks.steer'),
  ResolveConflictsNow: task('tasks.steer'),
  ResumeTask: task('tasks.steer'),
  LeaveOutCommits: task('tasks.steer'),
  AbandonTask: task('tasks.steer'),
  MarkTaskDone: task('tasks.steer'),
  KeepTaskForLater: task('tasks.steer'),
  RenameTask: task('tasks.steer'),
  ReopenTask: task('tasks.steer'),
  HandOverHeld: task('tasks.steer'),
  MoveTask: task('tasks.steer'),
  DropMove: task('tasks.steer'),
  JoinChanges: task('tasks.steer'),
  DropChange: task('tasks.steer'),
  StopHelper: task('tasks.steer'),
  ShelveTask: task('tasks.steer'),
  WorkToward: task('tasks.steer'),
  SkipReview: task('tasks.steer'),
  ShapeTask: task('tasks.steer'),
  DeclineReview: task('tasks.steer'),
  SetReviewAfterMerge: task('tasks.steer'),
  FixAfterMerge: task('tasks.steer'),
  LeaveAfterMerge: task('tasks.steer'),
  StopListening: task('tasks.steer'),
  AttachPullRequest: task('tasks.run'),
  SetTaskIssuePart: task('issues.manage'),

  // Answering: the person's word.
  AnswerTaskAsk: item('asks.answer'),
  Answer: attention('asks.answer'),
  AnswerStuck: attention('asks.answer'),
  AnswerQuestion: attention('asks.answer'),
  AnswerCheckout: attention('asks.answer'),
  SettledWithOnePress: task('asks.answer'),

  // Loosening what agents may do.
  SetTaskAllowEverything: task('rules.loosen'),
  TrustBot: task('rules.loosen'),
  AnswerSettingChange: item('rules.loosen'),
  UndoSettingChange: item('rules.loosen'),

  // Shipping and merging.
  Ship: task('changes.ship'),
  RouteShip: task('changes.ship'),
  OpenChange: task('changes.ship'),
  MarkReady: task('changes.ship'),
  PostScreenshots: task('changes.ship'),
  Push: task('changes.ship'),
  PushBranch: task('changes.ship'),
  PushHere: task('changes.ship'),
  ReplacePullRequest: task('changes.ship'),
  ClosePullRequest: task('changes.ship'),
  Merge: task('changes.merge'),
  MergeHere: task('changes.merge'),
  MergeNote: task('changes.merge'),
  SaveCanvas: on('canvas')('changes.ship'),
  StopSavingCanvas: on('canvas')('changes.ship'),

  // Issues and reviews on the code host and tracker.
  ChangeIssueDraft: on('issue_draft')('issues.manage'),
  FileIssueDraft: on('issue_draft')('issues.manage'),
  DiscardIssueDraft: on('issue_draft')('issues.manage'),
  ApplyIssueChanges: on('issue_changes')('issues.manage'),
  DiscardIssueChanges: on('issue_changes')('issues.manage'),
  ChangeReviewDraft: on('review_draft')('reviews.post'),
  PostReviewDraft: on('review_draft')('reviews.post'),
  DiscardReviewDraft: on('review_draft')('reviews.post'),
} as const satisfies Record<ApiTag, CallAccess>

/** What a call's payload points at, resolved to its project from the store. */
export const projectOf = (
  locator: Locator,
  payload: unknown,
): Effect.Effect<Option.Option<string>, SqlError.SqlError, SqlClient.SqlClient> =>
  Effect.gen(function* () {
    const value = typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>)[locatorField[locator]] : undefined
    if (typeof value !== 'string') return Option.none()
    if (locator === 'project') return Option.some(value)
    const table = locatorTable[locator]
    if (table === undefined) return Option.none()
    const sql = yield* SqlClient.SqlClient
    // The table is one of the fixed names above, never the payload's.
    const rows = yield* sql<{ project_id: string }>`SELECT project_id FROM ${sql(table)} WHERE id = ${value}`
    return Option.fromNullishOr(rows[0]?.project_id)
  })

export type CallDecision =
  | Decision
  /** Allowed, with the answer cut to these projects. */
  | { readonly allowed: true; readonly only: ReadonlySet<string> }

const refuse = (reason: Refusal | 'personal_not_shared'): { readonly allowed: false; readonly reason: Refusal } => ({
  allowed: false,
  reason: reason === 'personal_not_shared' ? 'not_permitted' : reason,
})

/**
 * May this member make this call? Personal calls are refused for now: a shared home keeps one profile's setup, and
 * a member's own setup lives with them until it is stored per person.
 */
export const decideCall = (
  index: Index,
  actor: Actor,
  tag: ApiTag,
  payload: unknown,
  now: number,
  extra: { readonly taskOwner?: string; readonly repositories?: ReadonlyArray<string> } = {},
): Effect.Effect<CallDecision, SqlError.SqlError, SqlClient.SqlClient> =>
  Effect.gen(function* () {
    const access: CallAccess = callAccess[tag]
    if (now >= index.expiresAt) return refuse('list_expired')
    switch (access.kind) {
      case 'open':
        return { allowed: true }
      case 'visible':
        return { allowed: true, only: visibleProjects(index, actor, now) }
      case 'personal':
        return refuse('personal_not_shared')
      case 'organization':
        return authorize(index, { actor, permission: access.permission, now })
      case 'project': {
        const found = yield* projectOf(access.from, payload)
        if (Option.isNone(found)) return refuse('not_found')
        return authorize(index, { actor, permission: access.permission, project: found.value, now, ...extra })
      }
    }
  })
