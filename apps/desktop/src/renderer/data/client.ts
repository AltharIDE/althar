import {
  type AccountSignInState,
  type AccountStatus,
  type AgentModels,
  type AppSettings,
  type FoundAccount,
  type ProjectRulesView,
  Api,
  ApiError,
  type BoardSnapshot,
  type HomeSnapshot,
  clientProtocol,
  type ConnectionList,
  type ConnectionSummary,
  type CoordinatorSnapshot,
  type DomMessagePort,
  domPort,
  type FileDiff,
  type FolderReading,
  type IssueList,
  type Product,
  type ChangeTarget,
  type ProjectList,
  type ProjectRepository,
  type ProjectSummary,
  type RepositoryRole,
  type PlanStep,
  type SignInStart,
  type SignInState,
  type Status,
  type TaskEnd,
  type TaskList,
  type TaskSummary,
  type ThreadItem,
  type ThreadSnapshot,
  type WatchEvent,
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
export type ProjectRulesChange = { readonly projectId: string } & Partial<Omit<ProjectRulesView, 'projectId'>>

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
   */
  readonly openProject: (
    grant: string,
    options?: { readonly name?: string; readonly repositories?: ReadonlyArray<{ readonly grant: string; readonly path: string }> },
  ) => Promise<ProjectSummary>
  readonly listTasks: (projectId: string) => Promise<TaskList>
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
  /** One file a task changed, as a diff from its base to its worktree. */
  readonly getFileDiff: (taskId: string, path: string) => Promise<FileDiff>
  /** A project's board: its tasks, by card, and the calls that wait on the person. */
  readonly getBoard: (projectId: string) => Promise<BoardSnapshot>
  /** The home, across every project; what the loop did from `since`, else from when the person last left the home. */
  readonly getHome: (since?: string) => Promise<HomeSnapshot>
  /** The person left the home: what the loop does from now on is new to them. */
  readonly leftHome: () => Promise<void>
  readonly startSession: (input: Start) => Promise<string>
  /** Hands the thread to another agent; with `body`, what the person said, its first turn after the brief. */
  readonly switchAgent: (input: Start & { readonly body?: string }) => Promise<string>
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
  readonly interrupt: (threadId: string) => Promise<void>
  readonly stopSession: (threadId: string) => Promise<void>
  readonly send: (input: {
    readonly threadId: string
    readonly body: string
    readonly disposition: 'after_current' | 'interrupt_and_continue'
  }) => Promise<void>
  /** Takes back a message still waiting its turn, by its item. */
  readonly takeBack: (itemId: string) => Promise<void>
  readonly answer: (input: {
    readonly attentionId: string
    readonly decision: 'allow' | 'reject'
    readonly reason?: string
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
  /** The connections on this Mac, and the code hosts and trackers a person can connect. */
  readonly listConnections: () => Promise<ConnectionList>
  /** Starts a service's own sign-in. */
  readonly startSignIn: (product: Product, webUrl?: string) => Promise<SignInStart>
  readonly getSignIn: (flowId: string) => Promise<SignInState>
  readonly cancelSignIn: (flowId: string) => Promise<void>
  /** Connects with a pasted token. */
  readonly connectToken: (input: {
    readonly product: Product
    readonly webUrl?: string
    readonly user?: string
    readonly key?: string
    readonly token: string
  }) => Promise<ConnectionSummary>
  readonly disconnect: (connectionId: string) => Promise<void>
  /** A project's rules. */
  /** Renames a project; its mark and its worktrees' folders stay. */
  readonly renameProject: (projectId: string, name: string) => Promise<void>
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
  /** Downloads an agent for the person, checks it, and keeps it for Althar to run; done once it is ready. */
  readonly installAgent: (agentId: string) => Promise<void>
  /** Opens a task's folder in an editor, at one of its files and a line; whether it could. */
  readonly openInEditor: (input: {
    readonly taskId: string
    readonly editor: string
    readonly path?: string
    readonly line?: number
  }) => Promise<boolean>
  /** Pushes the task's branch to its pull request, up to the commit the person saw; in a task of several repositories, the one at `url`. */
  readonly push: (taskId: string, head: string, url?: string) => Promise<void>
  /** Asks a task's pull request for news now. */
  readonly refreshTask: (taskId: string) => Promise<void>
  /** The person's answer to a step that needs them. */
  readonly answerStuck: (input: { readonly attentionId: string; readonly answer: StuckAnswer }) => Promise<void>
  /** Calls `listener` with each change after `since` (or from now) until the returned function is called. */
  readonly watch: (listener: (event: WatchEvent) => void, since?: number) => () => void
  readonly close: () => Promise<void>
}

/** An agent to start on a thread; without a model or effort, the agent's own. */
export interface Start {
  readonly threadId: string
  readonly agentId: string
  readonly model?: string
  readonly effort?: string
}

/** Tell a step's agent what to do, hand the step to an agent, or abandon it. */
export type StuckAnswer =
  | { readonly kind: 'tell'; readonly note: string }
  | { readonly kind: 'retry'; readonly agentId: string }
  | { readonly kind: 'abandon' }

/** What went wrong with a call, in words a view can show. */
export const messageOf = (error: unknown): string =>
  error instanceof ApiError ? error.message : "Althar's runtime didn't answer. If it keeps happening, restart Althar."

/** A new command id, as the contract has them. */
export const newCommandId = (): string => `cmd_${globalThis.crypto.randomUUID().replaceAll('-', '')}`

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
        }),
      ),
    listTasks: (projectId) => settle(api.ListTasks({ projectId })),
    createTask: (input) => command((commandId) => api.CreateTask({ commandId, ...input })),
    getThread: (threadId, page = {}) => settle(api.GetThread({ threadId, ...page })),
    getThreadItem: (threadId, itemId) => settle(api.GetThreadItem({ threadId, itemId })),
    getFileDiff: (taskId, path) => settle(api.GetFileDiff({ taskId, path })),
    getBoard: (projectId) => settle(api.GetBoard({ projectId })),
    getHome: (since) => settle(api.GetHome(since === undefined ? {} : { since })),
    leftHome: () => command((commandId) => api.LeftHome({ commandId })),
    startSession: (input) => command((commandId) => api.StartSession({ commandId, ...input })),
    switchAgent: (input) => command((commandId) => api.SwitchAgent({ commandId, ...input })),
    setModel: (input) => command((commandId) => api.SetModel({ commandId, ...input })),
    setEffort: (input) => command((commandId) => api.SetEffort({ commandId, ...input })),
    getModels: () => settle(api.GetModels({})),
    setDefaultEffort: (input) => command((commandId) => api.SetDefaultEffort({ commandId, ...input })),
    setModelBlocked: (input) => command((commandId) => api.SetModelBlocked({ commandId, ...input })),
    getSettings: () => settle(api.GetSettings({})),
    setCoAuthor: (on) => command((commandId) => api.SetCoAuthor({ commandId, on })),
    interrupt: (threadId) => command((commandId) => api.Interrupt({ commandId, threadId })),
    stopSession: (threadId) => command((commandId) => api.StopSession({ commandId, threadId })),
    send: (input) => command((commandId) => api.Send({ commandId, ...input })),
    takeBack: (itemId) => command((commandId) => api.TakeBack({ commandId, itemId })),
    answer: (input) => command((commandId) => api.Answer({ commandId, ...input })),
    getCoordinator: (projectId, page = {}) => settle(api.GetCoordinator({ projectId, ...page })),
    startTask: (input) => command((commandId) => api.StartTask({ commandId, ...input })),
    startPlan: (planId) => command((commandId) => api.StartPlan({ commandId, planId })),
    holdPlan: (planId) => command((commandId) => api.HoldPlan({ commandId, planId })),
    changePlan: (planId, steps, end) =>
      command((commandId) => api.ChangePlan({ commandId, planId, steps, ...(end === undefined ? {} : { end }) })),
    listConnections: () => settle(api.ListConnections()),
    startSignIn: (product, webUrl) =>
      command((commandId) => api.StartSignIn({ commandId, product, ...(webUrl === undefined ? {} : { webUrl }) })),
    getSignIn: (flowId) => settle(api.GetSignIn({ flowId })),
    cancelSignIn: (flowId) => command((commandId) => api.CancelSignIn({ commandId, flowId })),
    connectToken: (input) => command((commandId) => api.ConnectToken({ commandId, ...input })),
    disconnect: (connectionId) => command((commandId) => api.Disconnect({ commandId, connectionId })),
    renameProject: (projectId, name) => command((commandId) => api.RenameProject({ commandId, projectId, name })),
    removeProject: (projectId) => command((commandId) => api.RemoveProject({ commandId, projectId })),
    getRepositories: (projectId) => settle(api.GetRepositories({ projectId })),
    addRepositories: (projectId, grant) => command((commandId) => api.AddRepositories({ commandId, projectId, grant })),
    leaveOutRepository: (projectId, repositoryId) => command((commandId) => api.LeaveOutRepository({ commandId, projectId, repositoryId })),
    setRepository: (input) => command((commandId) => api.SetRepository({ commandId, ...input })),
    getProjectRules: (projectId) => settle(api.GetProjectRules({ projectId })),
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
    merge: (taskId, head, url) => command((commandId) => api.Merge({ commandId, taskId, head, ...(url === undefined ? {} : { url }) })),
    mergeHere: (taskId, heads) => command((commandId) => api.MergeHere({ commandId, taskId, heads })),
    pushHere: (taskId) => command((commandId) => api.PushHere({ commandId, taskId })),
    pushBranch: (taskId, heads) => command((commandId) => api.PushBranch({ commandId, taskId, heads })),
    listEditors: () => settle(api.ListEditors({})),
    openInEditor: (input) => command((commandId) => api.OpenInEditor({ commandId, ...input })),
    installAgent: (agentId) => command((commandId) => api.InstallAgent({ commandId, agentId })),
    push: (taskId, head, url) => command((commandId) => api.Push({ commandId, taskId, head, ...(url === undefined ? {} : { url }) })),
    refreshTask: (taskId) => command((commandId) => api.RefreshTask({ commandId, taskId })),
    answerStuck: (input) => command((commandId) => api.AnswerStuck({ commandId, ...input })),
    watch: (listener, since) => {
      let cursor = since
      // A stream that ends or breaks starts again from the last change heard, so nothing in between is missed.
      const heard = Effect.suspend(() =>
        Stream.runForEach(api.Watch(cursor === undefined ? {} : { since: cursor }), (event) =>
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
