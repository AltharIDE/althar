import {
  type CanvasDetail,
  type CanvasSummary,
  type CanvasText,
  type SentCanvasComment,
  type CheckoutAnswer,
  type MoveOutcome,
  type Preset,
  type PresetParts,
  type WorksIn,
  type AccountSignInState,
  type SignInEnding,
  type InstalledSkill,
  type SkillList,
  type SkillReviewCard,
  type SkillsFound,
  type SkillUpdate,
  type AccountStatus,
  type AgentModels,
  type AlwaysScope,
  type AgentTools,
  type SyncedAgent,
  type ToolRole,
  type ServerDetail,
  type NewServer,
  type AppSettings,
  type Attachment,
  type AutomationDefinition,
  type AutomationSnapshot,
  type AutomationsSnapshot,
  type BoardTask,
  type FieldAnswer,
  type OnePressAction,
  type FoundAccount,
  type ProjectNote,
  type ProjectRulesView,
  type SandboxEdits,
  type SealStyle,
  Api,
  ApiError,
  type BoardSnapshot,
  type HomeSnapshot,
  clientProtocol,
  type ConnectGuide,
  type ConnectionCheck,
  type ConnectionList,
  type ConnectionSummary,
  type FoundServer,
  type FoundTasks,
  type CoordinatorSnapshot,
  type CodeFound,
  type CodePlace,
  type CodeText,
  type DocumentText,
  type DomMessagePort,
  domPort,
  type FileDiff,
  type TaskFindings,
  type FolderHeld,
  type FolderReading,
  type MadeRepository,
  type PlacedRepository,
  type FoldersFreed,
  type FolderWait,
  type PlansAndReviewsChange,
  type NewProjectDefaultsChange,
  type IssueList,
  type Load,
  type MissedReports,
  type ModelRoom,
  type PlanUsage,
  type OutputText,
  type Product,
  type ChangeTarget,
  type RepositorySetup,
  type ProjectInk,
  type ProjectTracker,
  type ProjectList,
  type ProjectRepository,
  type ProjectSummary,
  type RepositoryRole,
  type ReviewVerdict,
  type PlanStep,
  type Service,
  type SignInStart,
  type SignInState,
  type Status,
  type SentFile,
  type SentImage,
  type TaskEnd,
  type TaskFolders,
  type TaskList,
  type TaskSummary,
  type ThreadItem,
  type ThreadSnapshot,
  type TrackerContainer,
  type WatchEvent,
  type Launch,
  type OfferedRefs,
  type RepositoryScript,
  type SettingChanged,
} from '@althar/contracts'
import { Cause, Duration, Effect, Exit, Fiber, Layer, Option, Scope, Stream } from 'effect'
import { RpcClient } from 'effect/rpc'

/*
 * The data layer (ADR-010): the only code that talks to the runtime. It is
 * Effect inside; what it hands the view models is plain promises and a
 * subscription, so they stay ordinary React hooks.
 *
 * Every command gets an id here. When a command's answer doesn't come back
 * (the runtime didn't answer, rather than said no), it is tried once more
 * with the same id, and the runtime answers the retry from the first one's
 * receipt instead of doing it twice. `watch` picks up from the last change it
 * heard when its stream breaks.
 */

/** What may change of a project's rules at once: any of it. */
export type ProjectRulesChange = { readonly projectId: string } & Partial<Omit<ProjectRulesView, 'projectId' | 'revision' | 'sandbox'>> & {
    /** What the person changed of what leads' sandboxes let through: each list's edits, whole. */
    readonly sandbox?: { readonly commands?: SandboxEdits; readonly hosts?: SandboxEdits }
    /** The revision a change that replaces a list was made against: refused where the rules have moved on since. */
    readonly expectedRevision?: number
  }

/** A card in Needs you settled with one press (DEV-173): a call's by the call, else its task's. */
export type OnePress =
  | { readonly taskId: string; readonly action: OnePressAction }
  | { readonly attentionId: string; readonly action: OnePressAction }

export interface Client {
  /** The runtime's version and the agents on this Mac; `recheck` asks each agent again rather than trust the last minute's answer. */
  readonly status: (options?: { readonly recheck?: boolean }) => Promise<Status>
  readonly listProjects: () => Promise<ProjectList>
  /** What opening the folder a grant names would make, read without changing anything. */
  readonly readFolder: (grant: string) => Promise<FolderReading>
  /** Where a new repository named after `name` would go in the folder a grant names, read without making it; refused where it can't. */
  readonly placeRepository: (grant: string, name: string) => Promise<PlacedRepository>
  /** Makes it there, a git repository with a first commit; the grant a project opens it by. */
  readonly makeRepository: (grant: string, name: string) => Promise<MadeRepository>
  /**
   * Opens the folder a grant names: one the person chose in the picker or
   * dropped on the window. A folder of several repositories opens with the
   * ones the person kept, each by the grant of the folder it was found in.
   * A project made on purpose comes with the id the window made for it
   * (`newProjectId`), and the ink the person saw.
   */
  readonly openProject: (
    grant: string,
    options?: {
      readonly name?: string
      readonly repositories?: ReadonlyArray<{ readonly grant: string; readonly path: string }>
      readonly projectId?: string
      readonly ink?: ProjectInk
    },
  ) => Promise<ProjectSummary>
  readonly listTasks: (projectId: string) => Promise<TaskList>
  /** Tasks found by what they were about, best first: in one project, or every one; with no words, the ones changed last. */
  readonly searchTasks: (input: { readonly projectId?: string; readonly text: string; readonly limit?: number }) => Promise<FoundTasks>
  readonly createTask: (input: {
    readonly projectId: string
    readonly title: string
    readonly description?: string
    readonly issue?: string
  }) => Promise<TaskSummary>
  /** The thread, with the newest `limit` items before `before`. */
  /** A task's thread; `fresh` reads the files it changed from git, for the person looking at them. */
  readonly getThread: (
    threadId: string,
    page?: { readonly before?: number; readonly limit?: number; readonly fresh?: boolean },
  ) => Promise<ThreadSnapshot>
  readonly getThreadItem: (threadId: string, itemId: string) => Promise<ThreadItem>
  /** What a command in a thread printed, as kept once it ended. */
  readonly readOutput: (threadId: string, itemId: string) => Promise<OutputText>
  /** What a command a thread's session left running has printed so far. */
  readonly readBackgroundOutput: (threadId: string, id: string) => Promise<OutputText>
  /** A markdown document an agent in a thread wrote, as it is now in the task's worktree. */
  readonly readDocument: (threadId: string, path: string) => Promise<DocumentText>
  /** A project's canvases (ADR-104), newest first; archived ones too where asked. */
  readonly listCanvases: (projectId: string, archived?: boolean) => Promise<ReadonlyArray<CanvasSummary>>
  /** One of a project's canvases whole: its versions and the comments sent on it. */
  readonly getCanvas: (canvasId: string) => Promise<CanvasDetail>
  /** A version's entry, as the window draws a document, a diagram or an SVG. */
  readonly readCanvasText: (canvasId: string, version: number) => Promise<CanvasText>
  /** One file a task changed, as a diff from its base to its worktree; with `untouched`, one it left as it was, every line unchanged. */
  readonly getFileDiff: (taskId: string, path: string, untouched?: boolean) => Promise<FileDiff>
  /** What the reviews of a task's run found, each where it is in the change now: the run of the review reported in `review`, else the latest. */
  readonly getTaskFindings: (taskId: string, review?: string) => Promise<TaskFindings>
  /** What the names in a thread's messages name where its agent works, each message by its item where it has one. */
  readonly findCode: (
    threadId: string,
    messages: ReadonlyArray<{ readonly itemId?: string; readonly names: ReadonlyArray<string> }>,
  ) => Promise<{ readonly place: CodePlace; readonly messages: ReadonlyArray<{ readonly found: ReadonlyArray<CodeFound> }> }>
  /** A file a thread's agent named, by its path as findCode named it: as it is now, or at the commit it was when a message was said. */
  readonly readCode: (threadId: string, path: string, at?: { readonly commit?: string; readonly line?: number }) => Promise<CodeText>
  /** A project's board: its tasks, by card, and the calls that wait on the person. */
  readonly getBoard: (projectId: string) => Promise<BoardSnapshot>
  /** The next page of a project's settled tasks, older than the one settled at `before` (`taskId` breaking a tie). */
  readonly getOlderSettled: (projectId: string, before: string, taskId: string) => Promise<ReadonlyArray<BoardTask>>
  /** The home, across every project; what the loop did from `since`, else from when the person last left the home. */
  readonly getHome: (since?: string) => Promise<HomeSnapshot>
  /** The person left the home: what the loop does from now on is new to them. */
  readonly leftHome: () => Promise<void>
  /** The person opened a task's screen: a plain task that finished is done once seen. */
  readonly seeTask: (taskId: string) => Promise<void>
  /** Keeps on this computer that a card in Needs you was settled with one press where it shows (DEV-173): a call's by the call. */
  readonly settledWithOnePress: (press: OnePress) => Promise<void>
  readonly startSession: (input: Start) => Promise<string>
  /** Hands the thread to another agent; with `body`, what the person said, and any images, its first turn after the brief. */
  readonly switchAgent: (
    input: Start & {
      readonly body?: string
      readonly images?: ReadonlyArray<SentImage>
      readonly files?: ReadonlyArray<SentFile>
      readonly dictated?: boolean
    },
  ) => Promise<string>
  readonly setModel: (input: { readonly threadId: string; readonly model: string }) => Promise<void>
  /** How hard the thread's agent thinks, as the agent names it. */
  readonly setEffort: (input: { readonly threadId: string; readonly effort: string }) => Promise<void>
  /** The models each agent offers, and its efforts, as far as they are known. */
  readonly getModels: () => Promise<ReadonlyArray<AgentModels>>
  /** The person's default effort for one of an agent's models: every session on it starts there. */
  readonly setDefaultEffort: (input: { readonly agentId: string; readonly model: string; readonly effort: string }) => Promise<void>
  /** Switches one of an agent's models off, or on again (ADR-015). */
  readonly setModelBlocked: (input: { readonly agentId: string; readonly model: string; readonly blocked: boolean }) => Promise<void>
  /** The person's settings for the app as a whole. */
  readonly getSettings: () => Promise<AppSettings>
  /** The person's MCP servers and skills, the roles each gets, for every project or one, and how sync stands (ADR-097). */
  readonly getAgentTools: (projectId: string | null) => Promise<AgentTools>
  /** Which roles get a server or skill in every project; `repository` names the project whose repository's own it is. */
  readonly setToolRoles: (
    kind: 'server' | 'skill',
    name: string,
    roles: ReadonlyArray<ToolRole>,
    projectId: string | null,
    repository?: string | null,
  ) => Promise<void>
  /** One project's mark pressed out or in on a server or skill. */
  readonly setToolInProject: (kind: 'server' | 'skill', name: string, projectId: string, on: boolean) => Promise<void>
  /** A server opened out: each agent's file as it keeps it, and its tools counted. */
  readonly getServerDetail: (name: string, repository: string | null) => Promise<ServerDetail>
  /** Asks each of the person's agents how its servers stand: signed in, or why one failed to start. */
  readonly checkServers: () => Promise<void>
  /** Adds a server to each agent listed, in its own file. */
  readonly addServer: (server: NewServer, agents: ReadonlyArray<SyncedAgent>) => Promise<void>
  /** Takes a server out of every agent's file that has it. */
  readonly removeServer: (name: string) => Promise<void>
  readonly setToolSync: (kind: 'server' | 'skill', on: boolean, takeBack: boolean) => Promise<void>
  readonly setToolKeptOut: (kind: 'server' | 'skill', agent: SyncedAgent, name: string, out: boolean) => Promise<void>
  readonly pickToolWay: (kind: 'server' | 'skill', name: string, way: SyncedAgent | 'apart') => Promise<void>
  readonly undoToolSync: (id: string) => Promise<void>
  readonly signInToolServer: (agent: SyncedAgent, name: string) => Promise<void>
  /** Althar as co-author of the commits and pull requests it sends, or not. */
  readonly setCoAuthor: (on: boolean) => Promise<void>
  /** How many agents work at once on this machine: the person's number, or null for the default again. */
  readonly setAgentsAtOnce: (count: number | null) => Promise<void>
  /** When finished tasks' folders go from now on (ADR-056). */
  readonly setFolderWait: (wait: FolderWait) => Promise<void>
  /** How long work goes on alone, from the next plan, round or look at a running turn; what isn't given stays. */
  readonly setPlansAndReviews: (change: PlansAndReviewsChange) => Promise<void>
  /** What the rules of projects made from now on start with; what isn't given stays. */
  readonly setNewProjectDefaults: (change: NewProjectDefaultsChange) => Promise<void>
  /** Finished tasks' folders on this computer, with the disk they are on. */
  readonly getTaskFolders: () => Promise<TaskFolders>
  /** Removes every finished task's folder nothing holds; what it freed, measured after. */
  readonly cleanUpFolders: () => Promise<FoldersFreed>
  /** Removes one finished task's folder by hand, though something holds it: refused where more would be lost than `seen`, what the person was told holds it. */
  readonly removeTaskFolder: (taskId: string, seen: FolderHeld | null) => Promise<FoldersFreed>
  /** Puts a task waiting for a free agent at a place in its project's line, from 0 the front; the line starts in that order. */
  readonly moveInLine: (taskId: string, to: number) => Promise<void>
  /** Puts a project's line back in the order its tasks began waiting. */
  readonly lineOldestFirst: (projectId: string) => Promise<void>
  /** Whether a review of the person's team's pull request posts itself once drafted; an outside one always waits. */
  readonly setPostTeamReviews: (on: boolean) => Promise<void>
  /** What "Run it" on code from outside the team does without asking. */
  readonly setRunOutside: (to: 'ask' | 'safe' | 'full') => Promise<void>
  /** Puts a task on Scratch, or on the board with null. */
  readonly shelveTask: (taskId: string, shelf: 'scratch' | null) => Promise<void>
  /** Stops a helper the task's lead started. */
  readonly stopHelper: (taskId: string, helper: string) => Promise<void>
  /** Keep them together: one change's commits onto another of the task's, before either ships. */
  readonly joinChanges: (taskId: string, change: string, into?: string) => Promise<void>
  /** Drop it: a change's folder goes, its branch stays. */
  readonly dropChange: (taskId: string, change: string) => Promise<void>
  /** The presets the person has, in a project where one is named. */
  readonly listPresets: (projectId?: string) => Promise<ReadonlyArray<Preset>>
  /** Edits one of the person's presets: its name, its parts, and whether it is kept to its task's project. */
  readonly editPreset: (input: {
    readonly id: string
    readonly name: string
    readonly parts: Preset['parts']
    readonly projectOnly?: boolean
  }) => Promise<void>
  /** Picks another preset for a plan before it starts: its parts change to match. The preset's name. */
  readonly applyPreset: (planId: string, preset: string) => Promise<string>
  /** Saves a preset from a task, or the parts the coordinator offered. */
  readonly savePreset: (input: {
    readonly name: string
    readonly taskId?: string
    readonly parts?: PresetParts
    readonly projectOnly?: boolean
  }) => Promise<{ readonly name: string }>
  /** Removes one of the person's presets. */
  readonly removePreset: (id: string) => Promise<void>
  /** "Run it" on the pull request a review task reviews, as far as `how` trusts it; `asks` where nothing says how far. */
  readonly runIt: (
    taskId: string,
    how?: 'safe' | 'full',
  ) => Promise<{ readonly kind: 'ran'; readonly trust: 'safe' | 'full'; readonly said: string } | { readonly kind: 'asks' }>
  /** Stop running it: its copy read only again, and its lead a reader. What it did, in words. */
  readonly stopRunning: (taskId: string) => Promise<string>
  /** Whether a pull request Althar opens says how its change was reviewed: the seal and the folded review. */
  readonly setReviewSeal: (on: boolean) => Promise<void>
  /** How the review seal looks. */
  readonly setReviewSealStyle: (style: SealStyle) => Promise<void>
  /** A project's automations, for its Automations tab. */
  readonly getAutomations: (projectId: string) => Promise<AutomationsSnapshot>
  /** One automation, for its own page: its definition, its limits and its runs. */
  readonly getAutomation: (automationId: string) => Promise<AutomationSnapshot>
  /** Makes an automation in a project, on this Mac: proposed, waiting for the person to turn it on, unless `on`. Its id. */
  readonly makeAutomation: (input: {
    readonly projectId: string
    readonly definition: AutomationDefinition
    readonly on?: boolean
  }) => Promise<string>
  /** The person changes an automation, the whole of it: it holds from its next run, and stays on where it is. */
  readonly changeAutomation: (automationId: string, definition: AutomationDefinition) => Promise<void>
  /** Turns an automation on, or back on; `itemId`, where the person did it from the coordinator's card asking it. */
  readonly turnOnAutomation: (automationId: string, itemId?: string) => Promise<void>
  /** Pauses an automation: nothing of it starts until it is turned on again. A run under way finishes. */
  readonly pauseAutomation: (automationId: string) => Promise<void>
  /** Runs an automation once now, with every limit a run has, whether it is on or not yet; `itemId`, from the coordinator's card asking it. */
  readonly runAutomationNow: (automationId: string, itemId?: string) => Promise<void>
  /** Answers the coordinator's card asking to stop, hold, restart or settle a task: yes does it. */
  readonly answerTaskAsk: (itemId: string, yes: boolean) => Promise<void>
  /** Makes a small change a full task: its change is reviewed before it merges, by the reviewer its plan named. */
  readonly makeItAFullTask: (taskId: string) => Promise<void>
  /** Keeps the heavier model for this task, as the line Auto moved the lead with offers. */
  readonly keepTheModel: (itemId: string) => Promise<void>
  /** Puts the move Auto made again, after Keep. */
  readonly undoTheModelMove: (itemId: string) => Promise<void>
  /** Deletes an automation: nothing of it starts again. The tasks its runs made stay. */
  readonly deleteAutomation: (automationId: string) => Promise<void>
  /** Puts back what the coordinator changed an automation from, as its card in the thread shows it. */
  readonly undoAutomationChange: (itemId: string) => Promise<void>
  /** Answers an agent's card asking to change a setting that loosens what asks: yes makes it. */
  readonly answerSettingChange: (itemId: string, yes: boolean) => Promise<void>
  /** Puts back what an agent changed a setting from, as its line shows it. */
  readonly undoSettingChange: (itemId: string) => Promise<void>
  /** The settings an agent changed that stay as it left them, with who and when: a project's, or (null) Althar's own. */
  readonly getSettingChanges: (projectId: string | null) => Promise<ReadonlyArray<SettingChanged>>
  /** Whether an automation's reviews post themselves once drafted; an outside pull request's still waits. */
  readonly setAutomationPostsReviews: (automationId: string, on: boolean) => Promise<void>
  /** Pauses every automation, or lets them run again. Runs under way finish. */
  readonly setAutomationsPaused: (paused: boolean) => Promise<void>
  /** The skills a task's lead is given: the catalog Althar ships and what the person installed. */
  readonly listSkills: () => Promise<SkillList>
  /** The skill folders in a GitHub repository, at the commit its ref names now. */
  readonly findSkills: (input: { readonly source: string; readonly ref?: string }) => Promise<SkillsFound>
  /** One skill from GitHub, fetched and kept for review; nothing is installed. */
  readonly stageSkill: (input: { readonly repo: string; readonly ref: string; readonly subpath: string }) => Promise<SkillReviewCard>
  /** Installs the version on a card the person read. */
  readonly approveSkill: (card: SkillReviewCard, replace: boolean) => Promise<InstalledSkill>
  readonly checkSkillUpdates: () => Promise<ReadonlyArray<SkillUpdate>>
  readonly rollBackSkill: (id: string) => Promise<InstalledSkill>
  readonly uninstallSkill: (id: string) => Promise<void>
  readonly interrupt: (threadId: string) => Promise<void>
  /** Tries the thread's last turn again, where it failed: what the person said in it goes again. */
  readonly tryAgain: (threadId: string) => Promise<void>
  /** Asks the thread's agent to compact its context, after what it was told before. */
  readonly compact: (threadId: string) => Promise<void>
  /** Clears the view of the coordinator's thread: it starts here, and the coordinator keeps the conversation. */
  readonly clearView: (threadId: string) => Promise<void>
  /** Reads the conversation before a cleared view in the thread's place, or puts it away. */
  readonly showEarlier: (threadId: string, open: boolean) => Promise<void>
  /** Takes back a cleared view: the whole thread shows again. */
  readonly undoClearView: (threadId: string) => Promise<void>
  /** Ends the coordinator's session and deletes its conversation. It can't be undone. */
  readonly forgetConversation: (threadId: string) => Promise<void>
  /** Stops a task: every agent on it, and the step it was on waits until it is resumed. */
  readonly stopTask: (taskId: string) => Promise<void>
  /** Whether a task's lead resolves conflicts on its own otherwise than its project says; null goes back to the project. */
  readonly setTaskResolveConflicts: (input: { readonly taskId: string; readonly resolveConflicts: boolean | null }) => Promise<void>
  /** Resolve now: a task's conflict with its default branch asked of its lead, whatever kept it from being asked. */
  readonly resolveConflictsNow: (taskId: string) => Promise<void>
  /** Each open task of a project looked at now for a conflict with its default branch, under the project's rules. */
  readonly lookForConflicts: (projectId: string) => Promise<void>
  /** Allows everything its agents ask on one task, short of what its project never allows, or takes it back. */
  readonly setTaskAllowEverything: (input: { readonly taskId: string; readonly allowEverything: boolean }) => Promise<void>
  /** Carries a stopped task on from the step it was on: with its last lead, or the agent picked. */
  readonly resumeTask: (input: {
    readonly taskId: string
    readonly agentId?: string
    readonly model?: string | null
    readonly effort?: string | null
  }) => Promise<void>
  /** Leaves out the commits after a task's last pull request that are in none yet: it settles without them, and they stay on its branch. */
  readonly leaveOutCommits: (taskId: string) => Promise<void>
  /** Settles a task without its change; its worktree and branch stay. */
  readonly abandonTask: (taskId: string) => Promise<void>
  /** Opens an abandoned task again, on its worktree and branch. */
  readonly reopenTask: (taskId: string) => Promise<void>
  /** Settles a finished task that isn't a change as Done, stopping what it left running, such as a page. */
  readonly markTaskDone: (taskId: string) => Promise<void>
  /** Takes a finished task that isn't a change out of Needs you as it is, kept for later. */
  readonly keepTaskForLater: (taskId: string) => Promise<void>
  /** Gives the task another title, in any state; its slug, branch and folder stay. */
  readonly renameTask: (taskId: string, title: string) => Promise<void>
  readonly send: (input: {
    readonly threadId: string
    readonly body: string
    readonly disposition: 'after_current' | 'interrupt_and_continue'
    /** Images sent with it, in order. */
    readonly images?: ReadonlyArray<SentImage>
    /** Files and folders sent with it, in order, by their grants or kept copies. */
    readonly files?: ReadonlyArray<SentFile>
    /** Any of its words came from dictation, even if edited after. */
    readonly dictated?: boolean
    /** The person's comments on canvases, kept with it (ADR-104). */
    readonly canvasComments?: ReadonlyArray<SentCanvasComment>
  }) => Promise<void>
  /** Takes back a message still waiting its turn, by its item. */
  readonly takeBack: (itemId: string) => Promise<void>
  /** The person's answer to a permission; with `always`, kept in the project's rules by that scope, one of those offered. */
  readonly answer: (input: {
    readonly attentionId: string
    readonly decision: 'allow' | 'reject'
    readonly reason?: string
    readonly always?: AlwaysScope
  }) => Promise<void>
  /** The person's answer to an agent's question, field by field: the options picked, and any words of their own. */
  readonly answerQuestion: (input: {
    readonly attentionId: string
    readonly answers: Readonly<Record<string, FieldAnswer>>
  }) => Promise<void>
  /** The project's coordinator thread, with the newest `limit` items before `before`. */
  readonly getCoordinator: (projectId: string, page?: { readonly before?: number; readonly limit?: number }) => Promise<CoordinatorSnapshot>
  /** Starts a task the person planned: its card shows in the coordinator's thread. */
  readonly startTask: (input: {
    readonly projectId: string
    readonly title: string
    readonly description?: string
    readonly steps: ReadonlyArray<PlanStep>
    /** The issue it comes from: its link or key. */
    readonly issue?: string
    readonly end?: TaskEnd | null
    /** The project's repositories it changes, by name: needed only in a project of several. */
    readonly repositories?: ReadonlyArray<string>
    /** An aside: a chat of the person's own, on Scratch, with no card in the coordinator's thread; its words are `description`. */
    readonly chat?: boolean
  }) => Promise<TaskSummary>
  readonly startPlan: (planId: string) => Promise<void>
  readonly holdPlan: (planId: string) => Promise<void>
  /** Changes a plan before its first step starts: who does its steps, how it ends, and where it works (ADR-091). */
  readonly changePlan: (
    planId: string,
    steps: ReadonlyArray<PlanStep>,
    end?: TaskEnd | null,
    worksIn?: WorksIn,
    /** The branch it works toward (ADR-093), until it starts; null for the default branch. */
    toward?: string | null,
  ) => Promise<void>
  /** Changes who leads and who reviews a task that has begun: its lead from its next turn, its reviewer until a review of it ran to its end. */
  readonly changeTeam: (taskId: string, steps: ReadonlyArray<PlanStep>) => Promise<void>
  /** Turns down the review a change was offered as its work turned real: it isn't offered again. */
  readonly declineReview: (taskId: string) => Promise<void>
  /** Changes what an issue the coordinator drafted says, before it is filed. */
  readonly changeIssueDraft: (
    draftId: string,
    edit: { readonly title: string; readonly body: string; readonly labels: ReadonlyArray<string> },
  ) => Promise<void>
  /** Files an issue the coordinator drafted, or one that wasn't filed, again: its card says how it went. */
  readonly fileIssueDraft: (draftId: string) => Promise<void>
  readonly discardIssueDraft: (draftId: string) => Promise<void>
  /** Applies changes to issues, or what of them didn't apply, again: their card says how it went. */
  readonly applyIssueChanges: (changesId: string) => Promise<void>
  readonly discardIssueChanges: (changesId: string) => Promise<void>
  /** Says to the coordinator, as the person, that issues are filed and changed at once from now on, or wait on a card first: from an issue card in a thread. */
  readonly preferIssueCards: (threadId: string, atOnce: boolean) => Promise<void>
  /** Whether a task does only part of its issue, so its merge comments on it and leaves it open. */
  readonly setTaskIssuePart: (taskId: string, partOf: boolean) => Promise<void>
  /** Changes a review the lead drafted, before it is posted: its verdict, its summary, which comments are kept and what they say. */
  readonly changeReviewDraft: (
    draftId: string,
    edit: {
      readonly verdict?: ReviewVerdict
      readonly summary?: string
      readonly comments?: ReadonlyArray<{ readonly id: string; readonly kept?: boolean; readonly body?: string }>
    },
  ) => Promise<void>
  /** Posts a review the lead drafted, or one that wasn't posted, again: its card says how it went. */
  readonly postReviewDraft: (draftId: string) => Promise<void>
  readonly discardReviewDraft: (draftId: string) => Promise<void>
  /** The connections on this Mac, and the code hosts and trackers a person can connect. */
  readonly listConnections: () => Promise<ConnectionList>
  /** Starts a service's own sign-in. */
  readonly startSignIn: (product: Product, webUrl?: string, connectionId?: string) => Promise<SignInStart>
  readonly getSignIn: (flowId: string) => Promise<SignInState>
  readonly cancelSignIn: (flowId: string) => Promise<void>
  /** Connects with a pasted token; with a connection, signs it in again with a new one. */
  readonly connectToken: (input: {
    readonly product: Product
    readonly webUrl?: string
    readonly user?: string
    readonly key?: string
    readonly token: string
    readonly connectionId?: string
  }) => Promise<ConnectionSummary>
  /** What connecting a service starts from. */
  readonly getConnectGuide: (service: Service) => Promise<ConnectGuide>
  /** Which of a service's products answers at an address. */
  readonly findServer: (service: Service, webUrl: string) => Promise<FoundServer>
  /** Connects with gh's or glab's sign-in on this device. */
  readonly connectCli: (product: Product, webUrl: string, connectionId?: string) => Promise<ConnectionSummary>
  /** What a connection can do, as its service says. */
  readonly checkConnection: (connectionId: string) => Promise<ConnectionCheck>
  readonly disconnect: (connectionId: string) => Promise<void>
  /** A project's rules. */
  /** Renames a project; its mark and its worktrees' folders stay. */
  readonly renameProject: (projectId: string, name: string) => Promise<void>
  /** Draws a project's mark in another ink, wherever it shows. */
  readonly setProjectInk: (projectId: string, ink: ProjectInk) => Promise<void>
  /** The tracker a project is bound to (ADR-059), or null where where its issues go is learned. */
  readonly getProjectTracker: (projectId: string) => Promise<ProjectTracker | null>
  /** Binds a project to a tracker and where its issues are filed there, or, with null, unbinds it. */
  readonly setProjectTracker: (projectId: string, tracker: ProjectTracker | null) => Promise<void>
  /** Where issues can be filed on a connected tracker: its teams, projects or lists. */
  readonly listContainers: (connectionId: string) => Promise<ReadonlyArray<TrackerContainer>>
  /** Removes a project from Althar: its agents stop; its folders, worktrees and branches stay. */
  readonly removeProject: (projectId: string) => Promise<void>
  readonly getRepositories: (projectId: string) => Promise<ReadonlyArray<ProjectRepository>>
  /** Adds the repositories at the folder a grant names. */
  readonly addRepositories: (projectId: string, grant: string) => Promise<void>
  readonly leaveOutRepository: (projectId: string, repositoryId: string) => Promise<void>
  readonly setRepository: (input: {
    readonly projectId: string
    readonly repositoryId: string
    readonly role?: RepositoryRole
    readonly changeTarget?: ChangeTarget
    /** Answers the offer to push a fork's branches upstream with no. */
    readonly notNow?: boolean
    readonly setup?: RepositorySetup
    /** The branch new tasks work toward there (ADR-093); null for its default branch. */
    readonly workToward?: string | null
  }) => Promise<void>
  /** Makes a branch on the code host from the default branch, where a repository's tasks start (ADR-093); answers its name as made. */
  readonly createBranch: (input: { readonly projectId: string; readonly repositoryId: string; readonly branch: string }) => Promise<string>
  readonly getProjectRules: (projectId: string) => Promise<ProjectRulesView>
  /** A project's notes, oldest first: the decisions its coordinator keeps. */
  readonly getProjectNotes: (projectId: string) => Promise<ReadonlyArray<ProjectNote>>
  /** Drops one of a project's notes: no coordinator session starts with it again. */
  readonly dropProjectNote: (projectId: string, noteId: string) => Promise<void>
  /** Says one of its notes in the person's words. */
  readonly editProjectNote: (projectId: string, noteId: string, body: string) => Promise<void>
  /** The names a project's code uses that have parts, most used first, for dictation to write as it does. */
  readonly getVocabulary: (projectId: string) => Promise<ReadonlyArray<string>>
  /** Changes what is given of a project's rules; the rules as they are after it. */
  readonly setProjectRules: (input: ProjectRulesChange) => Promise<ProjectRulesView>
  /** Adds an account to an agent: in the folder a grant names, or one Althar makes. */
  readonly addAccount: (input: { readonly agentId: string; readonly name: string; readonly grant?: string }) => Promise<AccountStatus>
  readonly renameAccount: (accountId: string, name: string) => Promise<void>
  /** Stops using an account; `anyway`, its folder goes even where its sign-out didn't happen. */
  readonly removeAccount: (accountId: string, anyway?: boolean) => Promise<void>
  readonly orderAccounts: (agentId: string, accountIds: ReadonlyArray<string>) => Promise<void>
  /** Folders account switchers keep the agent's accounts in, not added yet. */
  readonly findAccounts: (agentId: string) => Promise<ReadonlyArray<FoundAccount>>
  /** Opens the agent's own sign-in for the account in Terminal: the line it runs, and whether it could. */
  readonly signInAccount: (accountId: string) => Promise<{ readonly line: string; readonly opened: boolean }>
  /** Signs an account in inside Althar, this way; its id, to ask how it stands. */
  readonly startAccountSignIn: (
    accountId: string,
    way: 'browser' | 'device',
  ) => Promise<{ readonly flowId: string; readonly state: AccountSignInState }>
  readonly getAccountSignIn: (flowId: string) => Promise<AccountSignInState>
  readonly pasteAccountSignInCode: (flowId: string, code: string) => Promise<void>
  readonly cancelAccountSignIn: (flowId: string) => Promise<void>
  /** The person's open issues, for a project. */
  readonly listIssues: (projectId: string) => Promise<IssueList>
  /** Marks a task's draft pull request ready for review: in a task of several repositories, the one at `url`. */
  readonly markReady: (taskId: string, url?: string) => Promise<void>
  /** Puts the task's screenshots, as its Outputs show them, in the comment on its pull request at `url`, without the views left out (ADR-077). */
  readonly postScreenshots: (input: {
    readonly taskId: string
    readonly url: string
    readonly leftOut: ReadonlyArray<string>
  }) => Promise<void>
  /** Opens the pull request of a task whose work ended on its branch: a draft, as the person said. */
  readonly openChange: (taskId: string) => Promise<void>
  /** Skips the review of the task's work under way. */
  readonly skipReview: (taskId: string) => Promise<void>
  /** Gives a task another preset's parts at once, as Make it a change does with Change: its review, ending and worktree. */
  readonly shapeTask: (taskId: string, preset: string) => Promise<void>
  /**
   * One small change's own word on its review after the merge, over its project's rule, until it merges: `review`, `none`,
   * or null for the rule. Its card reads what holds (`afterMerge` on the small change's card).
   */
  readonly setReviewAfterMerge: (taskId: string, review: 'review' | 'none' | null) => Promise<void>
  /** Merges the task's pull request at the head the person saw, as they said to; a draft is marked ready first. */
  readonly merge: (taskId: string, head: string, url?: string, how?: 'review' | 'now') => Promise<void>
  /** Merges a task without a pull request into its repositories' default branches on this Mac, up to the commit the person saw in each. */
  readonly mergeHere: (taskId: string, heads: ReadonlyArray<{ readonly repository: string; readonly head: string }>) => Promise<void>
  /** Pushes the default branches the task merged into here to their remotes, with the person's own git sign-in. */
  readonly pushHere: (taskId: string) => Promise<void>
  /** Pushes the task's branch to its repositories' remotes, up to the commit the person saw in each, with their own git sign-in. */
  readonly pushBranch: (taskId: string, heads: ReadonlyArray<{ readonly repository: string; readonly head: string }>) => Promise<void>
  /** The editors on this Mac a task's files open in. */
  readonly listEditors: () => Promise<ReadonlyArray<{ readonly id: string; readonly name: string }>>
  /** How hard this computer works now, and Althar's work's part, for the bar while it shows it. */
  readonly getLoad: () => Promise<Load>
  /** Every account's plan usage; with `refresh`, each account is read again first rather than as kept. */
  readonly getPlanUsage: (options?: { readonly refresh?: boolean }) => Promise<PlanUsage>
  /** Puts aside the warning that an account's sign-in ends at `endsAt`, for that sign-in. */
  readonly dismissSignInEnding: (accountId: string, endsAt: string, stage: SignInEnding['stage']) => Promise<void>
  /** Each model's room where work on it would start, in a project (its rule for moving work through accounts) or anywhere. */
  readonly getModelRooms: (projectId: string | null) => Promise<ReadonlyArray<ModelRoom>>
  /** Each model that ended steps without its report in the last week, once reminded, with how often. */
  readonly getMissedReports: () => Promise<ReadonlyArray<MissedReports>>
  /** Downloads an agent for the person, checks it, and keeps it for Althar to run; done once it is ready. */
  readonly installAgent: (agentId: string) => Promise<void>
  /** Opens a task's folder in an editor, at one of its files and a line; whether it could. */
  readonly openInEditor: (input: {
    readonly taskId: string
    readonly editor: string
    readonly path?: string
    readonly line?: number
  }) => Promise<boolean>
  /** Opens a file a thread's agent named in an editor, at a line where given: a task's in its folder, the coordinator's in the person's checkout. */
  readonly openCode: (input: {
    readonly threadId: string
    readonly editor: string
    readonly path: string
    readonly line?: number
  }) => Promise<boolean>
  /** Pushes the task's branch to its pull request, up to the commit the person saw; in a task of several repositories, the one at `url`. */
  readonly push: (taskId: string, head: string, url?: string) => Promise<void>
  /** Ships what waits on the task's branch for Ship: its review first, where its plan has one before the work ships, then the commits go up. */
  /** Ships what waits; with a change named, only it, and what waits beneath it in its stack. */
  readonly ship: (taskId: string, change?: string) => Promise<void>
  /** Fix it, on what the task's review after a merge found: the lead takes the findings, and its fix ships after the merged pull request. */
  readonly fixAfterMerge: (taskId: string, url?: string) => Promise<void>
  /** Leave it, on what the task's review after a merge found: the findings close, and stay in the thread. */
  readonly leaveAfterMerge: (taskId: string, url?: string) => Promise<void>
  /** Replaces the commits on the task's pull request with its branch, up to the commit the person saw, only while it is still at `replaces`: a force push they confirmed. */
  readonly replacePullRequest: (taskId: string, head: string, replaces: string, url?: string) => Promise<void>
  /** What to tell the lead so its branch takes the pull request's commits in by merging; they are fetched to its worktree first. */
  readonly mergeNote: (taskId: string, url?: string) => Promise<string>
  /** Asks a task's pull request for news now. */
  readonly refreshTask: (taskId: string) => Promise<void>
  /** Stops listening to the task's pull request at this address. */
  readonly stopListening: (taskId: string, url: string) => Promise<void>
  /** Attaches the task to an open pull request it didn't open, by its link or number; `start` starts its branch from that one's head. */
  readonly attachPullRequest: (taskId: string, pullRequest: string, start: boolean) => Promise<Attachment>
  /**
   * Closes the task's pull request at this address on its host, unmerged; its branch there too, with `deleteBranch`. What the
   * host said to deleting the branch, where it didn't.
   */
  readonly closePullRequest: (input: { readonly taskId: string; readonly url: string; readonly deleteBranch: boolean }) => Promise<{
    readonly branch: string | null
  }>
  /** Stops a command the session on a thread left running. */
  readonly stopBackground: (threadId: string, id: string) => Promise<void>
  /** Clears one that ended by itself from the list. */
  readonly clearBackground: (threadId: string, id: string) => Promise<void>
  /** Runs one of the project's runnables with no agent, its default without one: what the task built, or with none, a copy of the default branch, or of the branch or pull request named, which Althar fetches first. */
  readonly runProject: (
    projectId: string,
    taskId: string | null,
    threadId: string | null,
    runnableId?: string,
    ref?: RunRef,
  ) => Promise<Launch>
  readonly stopLaunch: (id: string) => Promise<void>
  readonly clearLaunch: (id: string) => Promise<void>
  /** Keeps something for the project to run: a new one, or, by id, a change to one; a null command is its repository's own way. */
  readonly keepRunnable: (input: {
    readonly projectId: string
    readonly id?: string
    readonly name: string | null
    readonly command: string | null
    readonly repository?: string
  }) => Promise<{ readonly id: string }>
  /** Drops one of the project's runnables. */
  readonly dropRunnable: (projectId: string, id: string) => Promise<void>
  /** Puts the project's runnables in this order: the first is its default. */
  readonly orderRunnables: (projectId: string, ids: ReadonlyArray<string>) => Promise<void>
  /** The scripts in the project's package.json files, to pick something to run from. */
  readonly getRepositoryScripts: (projectId: string) => Promise<ReadonlyArray<RepositoryScript>>
  /** What the project's repositories offer to run besides their default branch, asked of their remotes now; with words, the open pull requests their hosts find by them. */
  readonly getRunnableRefs: (projectId: string, text?: string) => Promise<ReadonlyArray<OfferedRefs>>
  /** The person's answer to a step that needs them. */
  readonly answerStuck: (input: { readonly attentionId: string; readonly answer: StuckAnswer }) => Promise<void>
  /** The person's answer to what Althar asked before a Local task takes their checkout (ADR-091). */
  readonly answerCheckout: (input: { readonly attentionId: string; readonly answer: CheckoutAnswer }) => Promise<void>
  /** Moves a running task between a worktree and Local; `consent` answers what it asked about a checkout on a branch of the person's own. */
  readonly moveTask: (input: {
    readonly taskId: string
    readonly to: 'worktree' | 'checkout'
    readonly consent?: { readonly branch: string | null; readonly head: string }
  }) => Promise<MoveOutcome>
  /** Calls off a move that waits. */
  readonly dropMove: (taskId: string) => Promise<void>
  /** Points a running task at another branch to work toward, or its default with null: what it did, in words. */
  readonly workToward: (taskId: string, toward: string | null) => Promise<ReadonlyArray<string>>
  /** Hands the task's step held for a usage limit to an agent, on the account and model picked, rather than waiting for the reset. */
  readonly handOverHeld: (input: {
    readonly taskId: string
    readonly agentId: string
    readonly accountId?: string
    readonly model?: string
  }) => Promise<void>
  /**
   * Calls `listener` with each change after `since` (or from now) until the
   * returned function is called; and `onWatching` each time it starts
   * listening, at first and again after it broke, when what streams only to
   * those listening (an agent's words, a command's output) may have been missed.
   */
  readonly watch: (listener: (event: WatchEvent) => void, since?: number, onWatching?: () => void) => () => void
  readonly close: () => Promise<void>
}

/** An agent to start on a thread; without a model or effort, the agent's own. */
export interface Start {
  readonly threadId: string
  readonly agentId: string
  readonly model?: string
  readonly effort?: string
}

/**
 * Tell a step's agent what to do, hand the step to an agent (on an account,
 * model and effort, where one was picked), wait for a usage limit's reset, or
 * abandon it.
 */
export type StuckAnswer =
  | { readonly kind: 'tell'; readonly note: string }
  | { readonly kind: 'retry'; readonly agentId: string; readonly accountId?: string; readonly model?: string; readonly effort?: string }
  | { readonly kind: 'wait' }
  | { readonly kind: 'abandon' }

/** A branch or a pull request to run, in a copy of its own (ADR-066); in a project of several repositories, which one's. */
export type RunRef =
  | { readonly branch: string; readonly repository?: string }
  | { readonly pullRequest: string; readonly repository?: string }

/** What went wrong with a call, in words a view can show. */
export const messageOf = (error: unknown): string =>
  error instanceof ApiError ? error.message : "Althar's runtime didn't answer. If it keeps happening, restart Althar."

/** A new command id, as the contract has them. */
export const newCommandId = (): string => `cmd_${globalThis.crypto.randomUUID().replaceAll('-', '')}`

/**
 * A new project's id, as the runtime makes them: `proj_` and a UUIDv7, so
 * ids sort by when they were made. The window makes one for a project before
 * it is made, to draw its mark from as it is named.
 */
export const newProjectId = (now: number = Date.now()): string => {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16))
  // 48 bits of milliseconds, then the version and the variant over the random rest.
  for (let i = 0; i < 6; i++) bytes[i] = Math.floor(now / 2 ** (8 * (5 - i))) % 256
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  return `proj_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

/** Runs a call and settles its promise with the call's own failure, not Effect's wrapper around it. */
const settle = <A>(effect: Effect.Effect<A, unknown>): Promise<A> =>
  Effect.runPromiseExit(effect).then((exit) => {
    if (Exit.isSuccess(exit)) return exit.value
    throw Cause.squash(exit.cause)
  })

/** How long before a command with no answer is tried again, once. */
const RETRY_AFTER = Duration.millis(300)

/** How long before a broken watch picks up again. */
const REWATCH_AFTER = Duration.seconds(1)

/** A command, under one id however often it is tried: once more when the runtime didn't answer, never when it said no. */
const command = <A>(run: (commandId: string) => Effect.Effect<A, unknown>): Promise<A> => {
  const commandId = newCommandId()
  return settle(
    Effect.catchCause(run(commandId), (cause) => {
      const refused = Option.exists(Cause.findErrorOption(cause), (error) => error instanceof ApiError)
      return refused || Cause.hasInterruptsOnly(cause) ? Effect.failCause(cause) : Effect.andThen(Effect.sleep(RETRY_AFTER), run(commandId))
    }),
  )
}

/** Connects to the runtime over a port, and keeps the connection until `close`. */
export const connect = async (port: DomMessagePort): Promise<Client> => {
  const scope = await Effect.runPromise(Scope.make())
  const api = await Effect.runPromise(
    Effect.gen(function* () {
      const protocol = yield* Layer.build(clientProtocol(domPort(port)))
      return yield* RpcClient.make(Api).pipe(Effect.provideContext(protocol))
    }).pipe(Scope.provide(scope)),
  )
  return {
    status: (options = {}) => settle(api.Status(options.recheck === undefined ? {} : { recheck: options.recheck })),
    listProjects: () => settle(api.ListProjects()),
    readFolder: (grant) => settle(api.ReadFolder({ grant })),
    placeRepository: (grant, name) => settle(api.PlaceRepository({ grant, name })),
    makeRepository: (grant, name) => settle(api.MakeRepository({ grant, name })),
    openProject: (grant, options = {}) =>
      command((commandId) =>
        api.OpenProject({
          commandId,
          grant,
          ...(options.name === undefined ? {} : { name: options.name }),
          ...(options.repositories === undefined ? {} : { repositories: options.repositories }),
          ...(options.projectId === undefined ? {} : { projectId: options.projectId }),
          ...(options.ink === undefined ? {} : { ink: options.ink }),
        }),
      ),
    listTasks: (projectId) => settle(api.ListTasks({ projectId })),
    searchTasks: (input) => settle(api.SearchTasks(input)),
    createTask: (input) => command((commandId) => api.CreateTask({ commandId, ...input })),
    getThread: (threadId, page = {}) => settle(api.GetThread({ threadId, ...page })),
    getThreadItem: (threadId, itemId) => settle(api.GetThreadItem({ threadId, itemId })),
    readOutput: (threadId, itemId) => settle(api.ReadOutput({ threadId, itemId })),
    readBackgroundOutput: (threadId, id) => settle(api.ReadBackgroundOutput({ threadId, id })),
    readDocument: (threadId, path) => settle(api.ReadDocument({ threadId, path })),
    listCanvases: (projectId, archived) => settle(api.ListCanvases({ projectId, ...(archived === true ? { archived } : {}) })),
    getCanvas: (canvasId) => settle(api.GetCanvas({ canvasId })),
    readCanvasText: (canvasId, version) => settle(api.ReadCanvasText({ canvasId, version })),
    getFileDiff: (taskId, path, untouched) => settle(api.GetFileDiff({ taskId, path, ...(untouched === true ? { untouched } : {}) })),
    getTaskFindings: (taskId, review) => settle(api.GetTaskFindings({ taskId, ...(review === undefined ? {} : { review }) })),
    findCode: (threadId, messages) => settle(api.FindCode({ threadId, messages })),
    readCode: (threadId, path, at = {}) =>
      settle(
        api.ReadCode({
          threadId,
          path,
          ...(at.commit === undefined ? {} : { commit: at.commit }),
          ...(at.line === undefined ? {} : { line: at.line }),
        }),
      ),
    getBoard: (projectId) => settle(api.GetBoard({ projectId })),
    getOlderSettled: (projectId, before, taskId) => settle(api.GetOlderSettled({ projectId, before, taskId })).then((older) => older.tasks),
    getHome: (since) => settle(api.GetHome(since === undefined ? {} : { since })),
    leftHome: () => command((commandId) => api.LeftHome({ commandId })),
    seeTask: (taskId) => command((commandId) => api.SeeTask({ commandId, taskId })),
    settledWithOnePress: (press) => command((commandId) => api.SettledWithOnePress({ commandId, ...press })),
    startSession: (input) => command((commandId) => api.StartSession({ commandId, ...input })),
    switchAgent: (input) => command((commandId) => api.SwitchAgent({ commandId, ...input })),
    setModel: (input) => command((commandId) => api.SetModel({ commandId, ...input })),
    setEffort: (input) => command((commandId) => api.SetEffort({ commandId, ...input })),
    getModels: () => settle(api.GetModels({})),
    setDefaultEffort: (input) => command((commandId) => api.SetDefaultEffort({ commandId, ...input })),
    setModelBlocked: (input) => command((commandId) => api.SetModelBlocked({ commandId, ...input })),
    getSettings: () => settle(api.GetSettings({})),
    getAgentTools: (projectId) => settle(api.GetAgentTools({ projectId })),
    setToolRoles: (kind, name, roles, projectId, repository) =>
      command((commandId) =>
        api.SetToolRoles({ commandId, kind, name, roles: [...roles], projectId, ...(repository === undefined ? {} : { repository }) }),
      ),
    setToolInProject: (kind, name, projectId, on) => command((commandId) => api.SetToolInProject({ commandId, kind, name, projectId, on })),
    getServerDetail: (name, repository) => settle(api.GetServerDetail({ name, repository })),
    checkServers: () => command((commandId) => api.CheckServers({ commandId })),
    addServer: (server, agents) => command((commandId) => api.AddServer({ commandId, server, agents: [...agents] })),
    removeServer: (name) => command((commandId) => api.RemoveServer({ commandId, name })),
    setToolSync: (kind, on, takeBack) => command((commandId) => api.SetToolSync({ commandId, kind, on, takeBack })),
    setToolKeptOut: (kind, agent, name, out) => command((commandId) => api.SetToolKeptOut({ commandId, kind, agent, name, out })),
    pickToolWay: (kind, name, way) => command((commandId) => api.PickToolWay({ commandId, kind, name, way })),
    undoToolSync: (id) => command((commandId) => api.UndoToolSync({ commandId, id })),
    signInToolServer: (agent, name) => command((commandId) => api.SignInToolServer({ commandId, agent, name })),
    setCoAuthor: (on) => command((commandId) => api.SetCoAuthor({ commandId, on })),
    setPostTeamReviews: (on) => command((commandId) => api.SetPostTeamReviews({ commandId, on })),
    setRunOutside: (to) => command((commandId) => api.SetRunOutside({ commandId, to })),
    shelveTask: (taskId, shelf) => command((commandId) => api.ShelveTask({ commandId, taskId, shelf })),
    stopHelper: (taskId, helper) => command((commandId) => api.StopHelper({ commandId, taskId, helper })),
    joinChanges: (taskId, change, into) =>
      command((commandId) => api.JoinChanges({ commandId, taskId, change, ...(into === undefined ? {} : { into }) })),
    dropChange: (taskId, change) => command((commandId) => api.DropChange({ commandId, taskId, change })),
    listPresets: (projectId) => settle(api.ListPresets(projectId === undefined ? {} : { projectId })),
    applyPreset: (planId, preset) => command((commandId) => api.ApplyPreset({ commandId, planId, preset })),
    editPreset: (input) => command((commandId) => api.EditPreset({ commandId, ...input })),
    savePreset: (input) => command((commandId) => api.SavePreset({ commandId, ...input })),
    removePreset: (id) => command((commandId) => api.RemovePreset({ commandId, id })),
    runIt: (taskId, how) => command((commandId) => api.RunIt({ commandId, taskId, ...(how === undefined ? {} : { how }) })),
    stopRunning: (taskId) => command((commandId) => api.StopRunning({ commandId, taskId })),
    setReviewSeal: (on) => command((commandId) => api.SetReviewSeal({ commandId, on })),
    setReviewSealStyle: (style) => command((commandId) => api.SetReviewSealStyle({ commandId, style })),
    getAutomations: (projectId) => settle(api.GetAutomations({ projectId })),
    getAutomation: (automationId) => settle(api.GetAutomation({ automationId })),
    makeAutomation: ({ projectId, definition, on }) =>
      command((commandId) => api.MakeAutomation({ commandId, projectId, definition, ...(on === undefined ? {} : { on }) })).then(
        (made) => made.automationId,
      ),
    changeAutomation: (automationId, definition) => command((commandId) => api.ChangeAutomation({ commandId, automationId, definition })),
    turnOnAutomation: (automationId, itemId) =>
      command((commandId) => api.TurnOnAutomation({ commandId, automationId, ...(itemId === undefined ? {} : { itemId }) })),
    pauseAutomation: (automationId) => command((commandId) => api.PauseAutomation({ commandId, automationId })),
    runAutomationNow: (automationId, itemId) =>
      command((commandId) => api.RunAutomationNow({ commandId, automationId, ...(itemId === undefined ? {} : { itemId }) })),
    deleteAutomation: (automationId) => command((commandId) => api.DeleteAutomation({ commandId, automationId })),
    answerTaskAsk: (itemId, yes) => command((commandId) => api.AnswerTaskAsk({ commandId, itemId, yes })),
    makeItAFullTask: (taskId) => command((commandId) => api.MakeItAFullTask({ commandId, taskId })),
    keepTheModel: (itemId) => command((commandId) => api.KeepTheModel({ commandId, itemId })),
    undoTheModelMove: (itemId) => command((commandId) => api.UndoTheModelMove({ commandId, itemId })),
    undoAutomationChange: (itemId) => command((commandId) => api.UndoAutomationChange({ commandId, itemId })),
    answerSettingChange: (itemId, yes) => command((commandId) => api.AnswerSettingChange({ commandId, itemId, yes })),
    undoSettingChange: (itemId) => command((commandId) => api.UndoSettingChange({ commandId, itemId })),
    getSettingChanges: (projectId) => settle(api.GetSettingChanges({ projectId })),
    setAutomationPostsReviews: (automationId, on) => command((commandId) => api.SetAutomationPostsReviews({ commandId, automationId, on })),
    setAutomationsPaused: (paused) => command((commandId) => api.SetAutomationsPaused({ commandId, paused })),
    listSkills: () => settle(api.ListSkills({})),
    findSkills: (input) => settle(api.FindSkills(input)),
    stageSkill: (input) => settle(api.StageSkill(input)),
    approveSkill: (card, replace) =>
      command((commandId) => {
        const { repo, ref, sha, subpath } = card.source
        return api.ApproveSkill({ commandId, id: card.id, repo, ref, sha, subpath, treeHash: card.treeHash, replace })
      }),
    checkSkillUpdates: () => settle(api.CheckSkillUpdates({})),
    rollBackSkill: (id) => command((commandId) => api.RollBackSkill({ commandId, id })),
    uninstallSkill: (id) => command((commandId) => api.UninstallSkill({ commandId, id })),
    setAgentsAtOnce: (count) => command((commandId) => api.SetAgentsAtOnce({ commandId, count })),
    setFolderWait: (wait) => command((commandId) => api.SetFolderWait({ commandId, wait })),
    setPlansAndReviews: (change) => command((commandId) => api.SetPlansAndReviews({ commandId, ...change })),
    setNewProjectDefaults: (change) => command((commandId) => api.SetNewProjectDefaults({ commandId, ...change })),
    getTaskFolders: () => settle(api.GetTaskFolders({})),
    cleanUpFolders: () => command((commandId) => api.CleanUpFolders({ commandId })),
    removeTaskFolder: (taskId, seen) => command((commandId) => api.RemoveTaskFolder({ commandId, taskId, seen })),
    moveInLine: (taskId, to) => command((commandId) => api.MoveInLine({ commandId, taskId, to })),
    lineOldestFirst: (projectId) => command((commandId) => api.LineOldestFirst({ commandId, projectId })),
    interrupt: (threadId) => command((commandId) => api.Interrupt({ commandId, threadId })),
    tryAgain: (threadId) => command((commandId) => api.TryAgain({ commandId, threadId })),
    compact: (threadId) => command((commandId) => api.CompactContext({ commandId, threadId })),
    clearView: (threadId) => command((commandId) => api.ClearView({ commandId, threadId })),
    showEarlier: (threadId, open) => command((commandId) => api.ShowEarlier({ commandId, threadId, open })),
    undoClearView: (threadId) => command((commandId) => api.UndoClearView({ commandId, threadId })),
    forgetConversation: (threadId) => command((commandId) => api.ForgetConversation({ commandId, threadId })),
    stopTask: (taskId) => command((commandId) => api.StopTask({ commandId, taskId })),
    setTaskResolveConflicts: (input) => command((commandId) => api.SetTaskResolveConflicts({ commandId, ...input })),
    resolveConflictsNow: (taskId) => command((commandId) => api.ResolveConflictsNow({ commandId, taskId })),
    lookForConflicts: (projectId) => command((commandId) => api.LookForConflicts({ commandId, projectId })),
    setTaskAllowEverything: (input) => command((commandId) => api.SetTaskAllowEverything({ commandId, ...input })),
    resumeTask: (input) => command((commandId) => api.ResumeTask({ commandId, ...input })),
    leaveOutCommits: (taskId) => command((commandId) => api.LeaveOutCommits({ commandId, taskId })),
    abandonTask: (taskId) => command((commandId) => api.AbandonTask({ commandId, taskId })),
    reopenTask: (taskId) => command((commandId) => api.ReopenTask({ commandId, taskId })),
    markTaskDone: (taskId) => command((commandId) => api.MarkTaskDone({ commandId, taskId })),
    keepTaskForLater: (taskId) => command((commandId) => api.KeepTaskForLater({ commandId, taskId })),
    renameTask: (taskId, title) => command((commandId) => api.RenameTask({ commandId, taskId, title })),
    send: (input) => command((commandId) => api.Send({ commandId, ...input })),
    takeBack: (itemId) => command((commandId) => api.TakeBack({ commandId, itemId })),
    answer: (input) => command((commandId) => api.Answer({ commandId, ...input })),
    answerQuestion: (input) => command((commandId) => api.AnswerQuestion({ commandId, ...input })),
    getCoordinator: (projectId, page = {}) => settle(api.GetCoordinator({ projectId, ...page })),
    startTask: (input) => command((commandId) => api.StartTask({ commandId, ...input })),
    startPlan: (planId) => command((commandId) => api.StartPlan({ commandId, planId })),
    holdPlan: (planId) => command((commandId) => api.HoldPlan({ commandId, planId })),
    changePlan: (planId, steps, end, worksIn, toward) =>
      command((commandId) =>
        api.ChangePlan({
          commandId,
          planId,
          steps,
          ...(end === undefined ? {} : { end }),
          ...(worksIn === undefined ? {} : { worksIn }),
          ...(toward === undefined ? {} : { toward }),
        }),
      ),
    changeTeam: (taskId, steps) => command((commandId) => api.ChangeTeam({ commandId, taskId, steps })),
    declineReview: (taskId) => command((commandId) => api.DeclineReview({ commandId, taskId })),
    changeIssueDraft: (draftId, edit) => command((commandId) => api.ChangeIssueDraft({ commandId, draftId, ...edit })),
    fileIssueDraft: (draftId) => command((commandId) => api.FileIssueDraft({ commandId, draftId })),
    discardIssueDraft: (draftId) => command((commandId) => api.DiscardIssueDraft({ commandId, draftId })),
    applyIssueChanges: (changesId) => command((commandId) => api.ApplyIssueChanges({ commandId, changesId })),
    discardIssueChanges: (changesId) => command((commandId) => api.DiscardIssueChanges({ commandId, changesId })),
    preferIssueCards: (threadId, atOnce) => command((commandId) => api.PreferIssueCards({ commandId, threadId, atOnce })),
    setTaskIssuePart: (taskId, partOf) => command((commandId) => api.SetTaskIssuePart({ commandId, taskId, partOf })),
    changeReviewDraft: (draftId, edit) => command((commandId) => api.ChangeReviewDraft({ commandId, draftId, ...edit })),
    postReviewDraft: (draftId) => command((commandId) => api.PostReviewDraft({ commandId, draftId })),
    discardReviewDraft: (draftId) => command((commandId) => api.DiscardReviewDraft({ commandId, draftId })),
    listConnections: () => settle(api.ListConnections()),
    startSignIn: (product, webUrl, connectionId) =>
      command((commandId) =>
        api.StartSignIn({
          commandId,
          product,
          ...(webUrl === undefined ? {} : { webUrl }),
          ...(connectionId === undefined ? {} : { connectionId }),
        }),
      ),
    getSignIn: (flowId) => settle(api.GetSignIn({ flowId })),
    cancelSignIn: (flowId) => command((commandId) => api.CancelSignIn({ commandId, flowId })),
    connectToken: (input) => command((commandId) => api.ConnectToken({ commandId, ...input })),
    getConnectGuide: (service) => settle(api.GetConnectGuide({ service })),
    findServer: (service, webUrl) => settle(api.FindServer({ service, webUrl })),
    connectCli: (product, webUrl, connectionId) =>
      command((commandId) => api.ConnectCli({ commandId, product, webUrl, ...(connectionId === undefined ? {} : { connectionId }) })),
    checkConnection: (connectionId) => settle(api.CheckConnection({ connectionId })),
    disconnect: (connectionId) => command((commandId) => api.Disconnect({ commandId, connectionId })),
    renameProject: (projectId, name) => command((commandId) => api.RenameProject({ commandId, projectId, name })),
    setProjectInk: (projectId, ink) => command((commandId) => api.SetProjectInk({ commandId, projectId, ink })),
    getProjectTracker: (projectId) => settle(api.GetProjectTracker({ projectId })),
    setProjectTracker: (projectId, tracker) => command((commandId) => api.SetProjectTracker({ commandId, projectId, tracker })),
    listContainers: (connectionId) => settle(api.ListContainers({ connectionId })),
    removeProject: (projectId) => command((commandId) => api.RemoveProject({ commandId, projectId })),
    getRepositories: (projectId) => settle(api.GetRepositories({ projectId })),
    addRepositories: (projectId, grant) => command((commandId) => api.AddRepositories({ commandId, projectId, grant })),
    leaveOutRepository: (projectId, repositoryId) => command((commandId) => api.LeaveOutRepository({ commandId, projectId, repositoryId })),
    setRepository: (input) => command((commandId) => api.SetRepository({ commandId, ...input })),
    createBranch: (input) => command((commandId) => api.CreateBranch({ commandId, ...input })),
    getProjectRules: (projectId) => settle(api.GetProjectRules({ projectId })),
    getProjectNotes: (projectId) => settle(api.GetProjectNotes({ projectId })),
    dropProjectNote: (projectId, noteId) => command((commandId) => api.DropProjectNote({ commandId, projectId, noteId })),
    editProjectNote: (projectId, noteId, body) => command((commandId) => api.EditProjectNote({ commandId, projectId, noteId, body })),
    getVocabulary: (projectId) => settle(api.GetVocabulary({ projectId })),
    setProjectRules: (input) => command((commandId) => api.SetProjectRules({ commandId, ...input })),
    addAccount: (input) => command((commandId) => api.AddAccount({ commandId, ...input })),
    renameAccount: (accountId, name) => command((commandId) => api.RenameAccount({ commandId, accountId, name })),
    removeAccount: (accountId, anyway) =>
      command((commandId) => api.RemoveAccount({ commandId, accountId, ...(anyway === undefined ? {} : { anyway }) })),
    orderAccounts: (agentId, accountIds) => command((commandId) => api.OrderAccounts({ commandId, agentId, accountIds })),
    findAccounts: (agentId) => settle(api.FindAccounts({ agentId })).then((list) => list.found),
    signInAccount: (accountId) => command((commandId) => api.SignInAccount({ commandId, accountId })),
    startAccountSignIn: (accountId, way) => command((commandId) => api.StartAccountSignIn({ commandId, accountId, way })),
    getAccountSignIn: (flowId) => settle(api.GetAccountSignIn({ flowId })),
    pasteAccountSignInCode: (flowId, code) => command((commandId) => api.PasteAccountSignInCode({ commandId, flowId, code })),
    cancelAccountSignIn: (flowId) => command((commandId) => api.CancelAccountSignIn({ commandId, flowId })),
    listIssues: (projectId) => settle(api.ListIssues({ projectId })),
    markReady: (taskId, url) => command((commandId) => api.MarkReady({ commandId, taskId, ...(url === undefined ? {} : { url }) })),
    postScreenshots: (input) => command((commandId) => api.PostScreenshots({ commandId, ...input })),
    openChange: (taskId) => command((commandId) => api.OpenChange({ commandId, taskId })),
    skipReview: (taskId) => command((commandId) => api.SkipReview({ commandId, taskId })),
    shapeTask: (taskId, preset) => command((commandId) => api.ShapeTask({ commandId, taskId, preset })),
    setReviewAfterMerge: (taskId, review) => command((commandId) => api.SetReviewAfterMerge({ commandId, taskId, review })),
    merge: (taskId, head, url, how) =>
      command((commandId) =>
        api.Merge({ commandId, taskId, head, ...(url === undefined ? {} : { url }), ...(how === undefined ? {} : { how }) }),
      ),
    mergeHere: (taskId, heads) => command((commandId) => api.MergeHere({ commandId, taskId, heads })),
    pushHere: (taskId) => command((commandId) => api.PushHere({ commandId, taskId })),
    pushBranch: (taskId, heads) => command((commandId) => api.PushBranch({ commandId, taskId, heads })),
    listEditors: () => settle(api.ListEditors({})),
    getLoad: () => settle(api.GetLoad({})),
    getPlanUsage: (options = {}) => settle(api.GetPlanUsage(options.refresh === undefined ? {} : { refresh: options.refresh })),
    dismissSignInEnding: (accountId, endsAt, stage) =>
      command((commandId) => api.DismissSignInEnding({ commandId, accountId, endsAt, stage })),
    getModelRooms: (projectId) => settle(api.GetModelRooms(projectId === null ? {} : { projectId })),
    getMissedReports: () => settle(api.GetMissedReports({})),
    openInEditor: (input) => command((commandId) => api.OpenInEditor({ commandId, ...input })),
    openCode: (input) => command((commandId) => api.OpenCode({ commandId, ...input })),
    installAgent: (agentId) => command((commandId) => api.InstallAgent({ commandId, agentId })),
    push: (taskId, head, url) => command((commandId) => api.Push({ commandId, taskId, head, ...(url === undefined ? {} : { url }) })),
    ship: (taskId, change) => command((commandId) => api.Ship({ commandId, taskId, ...(change === undefined ? {} : { change }) })),
    fixAfterMerge: (taskId, url) => command((commandId) => api.FixAfterMerge({ commandId, taskId, ...(url === undefined ? {} : { url }) })),
    leaveAfterMerge: (taskId, url) =>
      command((commandId) => api.LeaveAfterMerge({ commandId, taskId, ...(url === undefined ? {} : { url }) })),
    replacePullRequest: (taskId, head, replaces, url) =>
      command((commandId) => api.ReplacePullRequest({ commandId, taskId, head, replaces, ...(url === undefined ? {} : { url }) })),
    mergeNote: (taskId, url) =>
      command((commandId) => api.MergeNote({ commandId, taskId, ...(url === undefined ? {} : { url }) })).then(({ note }) => note),
    refreshTask: (taskId) => command((commandId) => api.RefreshTask({ commandId, taskId })),
    stopListening: (taskId, url) => command((commandId) => api.StopListening({ commandId, taskId, url })),
    attachPullRequest: (taskId, pullRequest, start) =>
      command((commandId) => api.AttachPullRequest({ commandId, taskId, pullRequest, start })),
    closePullRequest: (input) => command((commandId) => api.ClosePullRequest({ commandId, ...input })),
    stopBackground: (threadId, id) => command((commandId) => api.StopBackground({ commandId, threadId, id })),
    clearBackground: (threadId, id) => command((commandId) => api.ClearBackground({ commandId, threadId, id })),
    runProject: (projectId, taskId, threadId, runnableId, ref) =>
      command((commandId) =>
        api.RunProject({ commandId, projectId, taskId, threadId, ...(runnableId === undefined ? {} : { runnableId }), ...ref }),
      ),
    keepRunnable: (input) => command((commandId) => api.KeepRunnable({ commandId, ...input })),
    dropRunnable: (projectId, id) => command((commandId) => api.DropRunnable({ commandId, projectId, id })),
    orderRunnables: (projectId, ids) => command((commandId) => api.OrderRunnables({ commandId, projectId, ids })),
    getRepositoryScripts: (projectId) => settle(api.GetRepositoryScripts({ projectId })),
    getRunnableRefs: (projectId, text) => settle(api.GetRunnableRefs({ projectId, ...(text === undefined ? {} : { text }) })),
    stopLaunch: (id) => command((commandId) => api.StopLaunch({ commandId, id })),
    clearLaunch: (id) => command((commandId) => api.ClearLaunch({ commandId, id })),
    answerStuck: (input) => command((commandId) => api.AnswerStuck({ commandId, ...input })),
    answerCheckout: (input) => command((commandId) => api.AnswerCheckout({ commandId, ...input })),
    moveTask: (input) => command((commandId) => api.MoveTask({ commandId, ...input })),
    dropMove: (taskId) => command((commandId) => api.DropMove({ commandId, taskId })),
    workToward: (taskId, toward) => command((commandId) => api.WorkToward({ commandId, taskId, toward })),
    handOverHeld: (input) => command((commandId) => api.HandOverHeld({ commandId, ...input })),
    watch: (listener, since, onWatching) => {
      let cursor = since
      // A stream that ends or breaks starts again from the last change heard, so nothing in between is missed.
      // Said once the watch's request has gone, a moment after it starts, so a read made then comes after it on the port.
      const started = Effect.sync(() => void setTimeout(() => onWatching?.(), 0))
      const heard = Effect.suspend(() =>
        Stream.runForEach(Stream.onStart(api.Watch(cursor === undefined ? {} : { since: cursor }), started), (event) =>
          Effect.sync(() => {
            if (event._tag === 'Changed') cursor = event.cursor
            listener(event)
          }),
        ),
      )
      const fiber = Effect.runFork(Effect.forever(Effect.andThen(Effect.ignore(heard), Effect.sleep(REWATCH_AFTER))))
      return () => void Effect.runFork(Fiber.interrupt(fiber))
    },
    close: () => Effect.runPromise(Scope.close(scope, Exit.void)),
  }
}

/** The port the preload hands the page, once the main process has made it. */
export const receivePort = (target: Pick<Window, 'addEventListener' | 'removeEventListener'> = window): Promise<DomMessagePort> =>
  new Promise((resolve) => {
    const onMessage = (event: MessageEvent) => {
      const port = event.ports[0]
      if (event.data !== 'althar:port' || port === undefined) return
      target.removeEventListener('message', onMessage)
      resolve(port)
    }
    target.addEventListener('message', onMessage)
  })
