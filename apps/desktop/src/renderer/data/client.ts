import {
  type AccountSignInState,
  type AccountStatus,
  type AgentModels,
  type AlwaysScope,
  type AppSettings,
  type Attachment,
  type BoardTask,
  type FieldAnswer,
  type FoundAccount,
  type ProjectNote,
  type ProjectRulesView,
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
  type FolderReading,
  type IssueList,
  type Load,
  type OutputText,
  type Product,
  type ChangeTarget,
  type ProjectInk,
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
  type SentImage,
  type TaskEnd,
  type TaskList,
  type TaskSummary,
  type ThreadItem,
  type ThreadSnapshot,
  type WatchEvent,
  type Launch,
  type RepositoryScript,
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
export type ProjectRulesChange = { readonly projectId: string } & Partial<Omit<ProjectRulesView, 'projectId' | 'revision'>> & {
    /** The revision a change that replaces a list was made against: refused where the rules have moved on since. */
    readonly expectedRevision?: number
  }

export interface Client {
  /** The runtime's version and the agents on this Mac; `recheck` asks each agent again rather than trust the last minute's answer. */
  readonly status: (options?: { readonly recheck?: boolean }) => Promise<Status>
  readonly listProjects: () => Promise<ProjectList>
  /** What opening the folder a grant names would make, read without changing anything. */
  readonly readFolder: (grant: string) => Promise<FolderReading>
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
  /** A markdown document an agent in a thread wrote, as it is now in the task's worktree. */
  readonly readDocument: (threadId: string, path: string) => Promise<DocumentText>
  /** One file a task changed, as a diff from its base to its worktree. */
  readonly getFileDiff: (taskId: string, path: string) => Promise<FileDiff>
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
  readonly startSession: (input: Start) => Promise<string>
  /** Hands the thread to another agent; with `body`, what the person said, and any images, its first turn after the brief. */
  readonly switchAgent: (
    input: Start & { readonly body?: string; readonly images?: ReadonlyArray<SentImage>; readonly dictated?: boolean },
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
  /** Althar as co-author of the commits and pull requests it sends, or not. */
  readonly setCoAuthor: (on: boolean) => Promise<void>
  /** How many agents work at once on this machine: the person's number, or null for the default again. */
  readonly setAgentsAtOnce: (count: number | null) => Promise<void>
  /** Puts a task waiting for a free agent at a place in its project's line, from 0 the front; the line starts in that order. */
  readonly moveInLine: (taskId: string, to: number) => Promise<void>
  /** Puts a project's line back in the order its tasks began waiting. */
  readonly lineOldestFirst: (projectId: string) => Promise<void>
  /** Whether a review of the person's team's pull request posts itself once drafted; an outside one always waits. */
  readonly setPostTeamReviews: (on: boolean) => Promise<void>
  readonly interrupt: (threadId: string) => Promise<void>
  /** Asks the thread's agent to compact its context, after what it was told before. */
  readonly compact: (threadId: string) => Promise<void>
  /** Stops a task: every agent on it, and the step it was on waits until it is resumed. */
  readonly stopTask: (taskId: string) => Promise<void>
  /** Whether a task's lead resolves conflicts on its own otherwise than its project says; null goes back to the project. */
  readonly setTaskResolveConflicts: (input: { readonly taskId: string; readonly resolveConflicts: boolean | null }) => Promise<void>
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
    /** Any of its words came from dictation, even if edited after. */
    readonly dictated?: boolean
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
  }) => Promise<TaskSummary>
  readonly startPlan: (planId: string) => Promise<void>
  readonly holdPlan: (planId: string) => Promise<void>
  readonly changePlan: (planId: string, steps: ReadonlyArray<PlanStep>, end?: TaskEnd | null) => Promise<void>
  /** Changes what an issue the coordinator drafted says, before it is filed. */
  readonly changeIssueDraft: (
    draftId: string,
    edit: { readonly title: string; readonly body: string; readonly labels: ReadonlyArray<string> },
  ) => Promise<void>
  /** Files an issue the coordinator drafted, or one that wasn't filed, again: its card says how it went. */
  readonly fileIssueDraft: (draftId: string) => Promise<void>
  readonly discardIssueDraft: (draftId: string) => Promise<void>
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
  }) => Promise<void>
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
  /** Opens the pull request of a task whose work ended on its branch: a draft, as the person said. */
  readonly openChange: (taskId: string) => Promise<void>
  /** Skips the review of the task's work under way. */
  readonly skipReview: (taskId: string) => Promise<void>
  /** Merges the task's pull request at the head the person saw, as they said to; a draft is marked ready first. */
  readonly merge: (taskId: string, head: string, url?: string) => Promise<void>
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
  /** Runs one of the project's runnables with no agent, its default without one: what the task built, or with none, a copy of the default branch. */
  readonly runProject: (projectId: string, taskId: string | null, threadId: string | null, runnableId?: string) => Promise<Launch>
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
  /** The person's answer to a step that needs them. */
  readonly answerStuck: (input: { readonly attentionId: string; readonly answer: StuckAnswer }) => Promise<void>
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
 * Tell a step's agent what to do, hand the step to an agent (on an account
 * and model, where one was picked), wait for a usage limit's reset, or
 * abandon it.
 */
export type StuckAnswer =
  | { readonly kind: 'tell'; readonly note: string }
  | { readonly kind: 'retry'; readonly agentId: string; readonly accountId?: string; readonly model?: string }
  | { readonly kind: 'wait' }
  | { readonly kind: 'abandon' }

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
    readDocument: (threadId, path) => settle(api.ReadDocument({ threadId, path })),
    getFileDiff: (taskId, path) => settle(api.GetFileDiff({ taskId, path })),
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
    startSession: (input) => command((commandId) => api.StartSession({ commandId, ...input })),
    switchAgent: (input) => command((commandId) => api.SwitchAgent({ commandId, ...input })),
    setModel: (input) => command((commandId) => api.SetModel({ commandId, ...input })),
    setEffort: (input) => command((commandId) => api.SetEffort({ commandId, ...input })),
    getModels: () => settle(api.GetModels({})),
    setDefaultEffort: (input) => command((commandId) => api.SetDefaultEffort({ commandId, ...input })),
    setModelBlocked: (input) => command((commandId) => api.SetModelBlocked({ commandId, ...input })),
    getSettings: () => settle(api.GetSettings({})),
    setCoAuthor: (on) => command((commandId) => api.SetCoAuthor({ commandId, on })),
    setPostTeamReviews: (on) => command((commandId) => api.SetPostTeamReviews({ commandId, on })),
    setAgentsAtOnce: (count) => command((commandId) => api.SetAgentsAtOnce({ commandId, count })),
    moveInLine: (taskId, to) => command((commandId) => api.MoveInLine({ commandId, taskId, to })),
    lineOldestFirst: (projectId) => command((commandId) => api.LineOldestFirst({ commandId, projectId })),
    interrupt: (threadId) => command((commandId) => api.Interrupt({ commandId, threadId })),
    compact: (threadId) => command((commandId) => api.CompactContext({ commandId, threadId })),
    stopTask: (taskId) => command((commandId) => api.StopTask({ commandId, taskId })),
    setTaskResolveConflicts: (input) => command((commandId) => api.SetTaskResolveConflicts({ commandId, ...input })),
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
    changePlan: (planId, steps, end) =>
      command((commandId) => api.ChangePlan({ commandId, planId, steps, ...(end === undefined ? {} : { end }) })),
    changeIssueDraft: (draftId, edit) => command((commandId) => api.ChangeIssueDraft({ commandId, draftId, ...edit })),
    fileIssueDraft: (draftId) => command((commandId) => api.FileIssueDraft({ commandId, draftId })),
    discardIssueDraft: (draftId) => command((commandId) => api.DiscardIssueDraft({ commandId, draftId })),
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
    removeProject: (projectId) => command((commandId) => api.RemoveProject({ commandId, projectId })),
    getRepositories: (projectId) => settle(api.GetRepositories({ projectId })),
    addRepositories: (projectId, grant) => command((commandId) => api.AddRepositories({ commandId, projectId, grant })),
    leaveOutRepository: (projectId, repositoryId) => command((commandId) => api.LeaveOutRepository({ commandId, projectId, repositoryId })),
    setRepository: (input) => command((commandId) => api.SetRepository({ commandId, ...input })),
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
    openChange: (taskId) => command((commandId) => api.OpenChange({ commandId, taskId })),
    skipReview: (taskId) => command((commandId) => api.SkipReview({ commandId, taskId })),
    merge: (taskId, head, url) => command((commandId) => api.Merge({ commandId, taskId, head, ...(url === undefined ? {} : { url }) })),
    mergeHere: (taskId, heads) => command((commandId) => api.MergeHere({ commandId, taskId, heads })),
    pushHere: (taskId) => command((commandId) => api.PushHere({ commandId, taskId })),
    pushBranch: (taskId, heads) => command((commandId) => api.PushBranch({ commandId, taskId, heads })),
    listEditors: () => settle(api.ListEditors({})),
    getLoad: () => settle(api.GetLoad({})),
    openInEditor: (input) => command((commandId) => api.OpenInEditor({ commandId, ...input })),
    openCode: (input) => command((commandId) => api.OpenCode({ commandId, ...input })),
    installAgent: (agentId) => command((commandId) => api.InstallAgent({ commandId, agentId })),
    push: (taskId, head, url) => command((commandId) => api.Push({ commandId, taskId, head, ...(url === undefined ? {} : { url }) })),
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
    runProject: (projectId, taskId, threadId, runnableId) =>
      command((commandId) =>
        api.RunProject({ commandId, projectId, taskId, threadId, ...(runnableId === undefined ? {} : { runnableId }) }),
      ),
    keepRunnable: (input) => command((commandId) => api.KeepRunnable({ commandId, ...input })),
    dropRunnable: (projectId, id) => command((commandId) => api.DropRunnable({ commandId, projectId, id })),
    orderRunnables: (projectId, ids) => command((commandId) => api.OrderRunnables({ commandId, projectId, ids })),
    getRepositoryScripts: (projectId) => settle(api.GetRepositoryScripts({ projectId })),
    stopLaunch: (id) => command((commandId) => api.StopLaunch({ commandId, id })),
    clearLaunch: (id) => command((commandId) => api.ClearLaunch({ commandId, id })),
    answerStuck: (input) => command((commandId) => api.AnswerStuck({ commandId, ...input })),
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
