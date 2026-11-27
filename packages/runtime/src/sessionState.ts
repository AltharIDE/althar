import { dirname, join } from 'node:path'
import { isAgentDefault, knownModelName, standsFor } from '@althar/contracts'
import type { ProjectId } from '@althar/domain'
import { type CommandIdReused, Commands, Ledger, type RevisionConflict, type RowNotFound } from '@althar/persistence-sqlite'
import type { AgentConnection, AgentDefinition, AgentSession, ConfigOption, SessionEvent } from '@althar/provider-adapters'
import { Crypto, Deferred, Duration, Effect, Option, Queue, Schema, Scope, Semaphore } from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'
import { type Account, Accounts } from './Accounts'
import { Artifacts } from './Artifacts'
import { canCompact, COMPACT, contextFull } from './compact'
import { type AgentEntry, Agents, RuntimeConfig } from './Config'
import type { CoordinatorFolder } from './coordinatorFolder'
import { Instance } from './Instance'
import type { LeftRunning } from './leftRunning'
import { Limits } from './Limits'
import { Live } from './Live'
import type { TimeTold } from './localTime'
import { type Models, modelsOf } from './Models'
import { Permissions, type RequestContext } from './Permissions'
import { PlanUsage } from './PlanUsage'
import { Policies } from './Policies'
import { blockedModelsOf, defaultEffortOf } from './preferences'
import { Questions } from './Questions'
import type { Reviewed } from './reviewing'
import type { Reach } from './sandboxReach'
import { Setups } from './Setups'
import { alsoPlanned, siblingsOf } from './siblings'
import type { OutputSoFar } from './threads'
import { ToolServer } from './ToolServer'
import type { Starting } from './turnTimes'

/*
 * Agent sessions on a task's thread (docs/architecture/03). The runtime
 * starts the agent as a process it records, starts a session in the mode
 * that asks, and delivers the thread's input to it one turn at a time.
 * Everything the agent says becomes thread items; every turn, session and
 * process is recorded with how it ended.
 *
 * Input is accepted into the thread's queue first, durably, and delivered
 * after (docs/architecture/01): `after_current` waits for the turn running,
 * `interrupt_and_continue` stops it; the whole queued burst keeps its order.
 */

export type Disposition = 'after_current' | 'interrupt_and_continue'

/**
 * An agent that doesn't answer ACP startup must not leave a handover pending forever. The bound covers the whole startup, so it
 * also cuts off an agent that works but is slow: connecting, `session/new`, and setting the model and effort.
 */
export const INTEGRATION_BRIEF =
  "For a complete issue discussion, read_issue_comments returns full bodies and IDs: follow every next cursor. Linear documents, projects, milestones, initiatives and updates have list_linear_resource, read_linear_resource and save_linear_resource; relationships have read_issue_relations and change_issue_relation. read_issue_attachments and upload_issue_attachment cover supported trackers, with file links in comments on GitHub/GitLab. edit_issue_comment edits existing comments; reply_to_issue_comment uses Linear roots or GitLab discussion IDs. search_pull_requests reaches beyond this project's repositories and pages searches; request_pull_request_reviewers, resolve_review_thread, mark_pull_request_draft and post_review cover code-host review controls. For anything without a typed tool, list_integrations identifies its connection and code_host_api or tracker_api calls its API. On Jira use namespace agile for boards/sprints, or service_desk for service requests. These additional writes take the person's message ID from read_turn or an errand: their request already gives their word, so don't ask for it again."

export const SESSION_START_TIMEOUT = Duration.minutes(2)

/** No model named, the agent would start on one the person switched off, and offers no other they left on. */
export class ModelSwitchedOff extends Schema.TaggedError<ModelSwitchedOff>()('ModelSwitchedOff', {
  agentName: Schema.String,
  model: Schema.String,
}) {
  override get message(): string {
    return `${this.model} is switched off for ${this.agentName}, and it has no other model on. Switch one on in Settings, or pick another agent.`
  }
}

/** Starting the agent took longer than its bound: it hung, or was too slow, as opposed to refusing or crashing. */
export class StartTimedOut extends Schema.TaggedError<StartTimedOut>()('StartTimedOut', {
  agentId: Schema.String,
  agentName: Schema.String,
  after: Schema.Duration,
}) {
  override get message(): string {
    return `Timed out after ${Duration.format(this.after)} waiting for ${this.agentName} to set up a session.`
  }
}

export const AcceptedInput = Schema.Struct({ inputId: Schema.String, sequence: Schema.Int })

export type AcceptedInput = typeof AcceptedInput.Type

/** One of a task's repositories, in its worktree here. */
export interface TaskRepository {
  /** Its repository in the project, whose agent settings the person trusts or not (DEV-280); absent in a test's thread. */
  readonly bindingId?: string
  readonly name: string
  /** What it is to the project, as the person set it. */
  readonly role: string
  readonly worktree: string
  /** Its branch; for a plain task's that has none yet, the one it gets once its lead changes the repository. */
  readonly branch: string
  /** 1 once it is on its branch; 0 for a plain task's that has none yet. */
  readonly branched: number
  readonly baseRef: string
  readonly baseCommit: string | null
  readonly defaultBranch: string
  /** The branch its work goes into, where it isn't the default (ADR-093): kept current with, and never pushed onto, as the default is. */
  readonly toward: string | null
  /** The folder inside it the project is about, such as one package of a monorepo; null for all of it. */
  readonly within: string | null
  /** 1 where it is the repository's own checkout, where the person works, as a Local task's is (ADR-091); 0 for a worktree. */
  readonly local: number
  /** The change it is the worktree of, by its name, where the task has several (a task is a conversation plus parts); null for its first. */
  readonly change?: string | null
}

/** What a project works toward in one of its repositories (ADR-093): null for its default branch. */
export interface Toward {
  readonly name: string
  readonly toward: string | null
  readonly defaultBranch: string
}

/**
 * A task's thread: its lead works in the task's worktrees, one per repository
 * it changes, under the project rules. `worktree`, `branch` and the rest are
 * its first repository's; `cwd` is where the lead starts: that worktree (or
 * the folder in it the project is about), or, with several, the task's
 * folder that holds them side by side.
 */
export interface TaskThread {
  readonly role: 'task'
  readonly threadId: string
  readonly projectId: ProjectId
  readonly taskId: string
  readonly title: string
  readonly description: string
  /** What the person asked for, in their words, where Althar kept it. */
  readonly request: string | null
  readonly worktree: string
  readonly branch: string
  readonly baseRef: string
  readonly baseCommit: string | null
  readonly defaultBranch: string
  readonly repositories: ReadonlyArray<TaskRepository>
  readonly cwd: string
  /**
   * Someone else's pull request the task reviews, where it is a review: its
   * lead then reads a read-only copy of it, under the rules of a role that
   * only reads, and, for one from outside the project, offline. Null for a
   * task with work of its own, which reads any pull request it reviews
   * beside it (a task is a conversation plus parts, "Reviewing").
   */
  readonly review: Reviewed | null
  /**
   * How far the person trusts that pull request's code ("Run it"): null, its
   * lead only reads; `safe`, it runs its commands in the sandbox, offline;
   * `full`, as the team's code, set up and with the network.
   */
  readonly trust: 'safe' | 'full' | null
  /**
   * A helper its lead started (ADR-087, as "a task is a conversation plus parts" amends it): a session of its own, in a step
   * thread of the task's, working in the worktree of the change it was handed; absent for the task's lead.
   */
  readonly helper?: {
    readonly name: string
    readonly brief: string
    readonly change: string | null
    /** In a copy of its own, not the change's worktree; `writes`, what it changes there kept as a commit for its lead. */
    readonly copy?: boolean
    readonly copyOf?: string
    readonly writes?: boolean
  }
}

/**
 * The project's coordinator thread (docs/architecture/04): it reads the
 * project's repositories, fresh from their default branch, under the rules of
 * a role that only reads, and changes things only through Althar's tools.
 */
export interface CoordinatorThread {
  readonly role: 'coordinator'
  readonly threadId: string
  readonly projectId: ProjectId
  readonly projectName: string
  readonly folder: CoordinatorFolder
}

/**
 * A task's review step (docs/architecture/05): another agent reads the task's
 * worktree under the rules of a role that only reads, and reports what it
 * found through Althar's tool. Its thread spans the review's rounds.
 */
export interface ReviewThread {
  readonly role: 'reviewer'
  /**
   * A review after a merge (MergeReviews.ts): the pull request that merged, as its host names it, and what of its findings
   * come back to the person: only blocking and major ones (`major`), or any (`all`).
   */
  readonly merged?: { readonly words: string; readonly bringsBack: 'major' | 'all' } | undefined
  readonly threadId: string
  readonly projectId: ProjectId
  readonly taskId: string
  readonly title: string
  readonly description: string
  readonly request: string | null
  /** The copy of each repository's worktree it reads, and where it starts, as for the lead. */
  readonly repositories: ReadonlyArray<TaskRepository>
  readonly cwd: string
}

export type ThreadContext = TaskThread | CoordinatorThread | ReviewThread

/** Where a thread's agent works. */
/**
 * An agent that went on its own, as a report says it: its id and how its
 * process ended, never what it wrote. No stack: where Althar noticed says
 * nothing, and each agent and way of ending is its own report.
 */
export const agentLost = (
  agentId: string,
  exit: Option.Option<{ readonly code: number | null; readonly signal: string | null }>,
): Error => {
  const how = Option.isSome(exit) ? `exit code ${exit.value.code ?? 'none'}, signal ${exit.value.signal ?? 'none'}` : 'no exit seen'
  const error = new Error(`The ${agentId} agent stopped on its own: ${how}.`)
  error.name = 'AgentLost'
  error.stack = ''
  return error
}

export const cwdOf = (thread: ThreadContext) => (thread.role === 'coordinator' ? thread.folder.folder : thread.cwd)

/** Every folder a thread's agent works in: a picture an agent points at is read only from inside them. */
export const foldersOf = (thread: ThreadContext): ReadonlyArray<string> =>
  thread.role === 'coordinator'
    ? [thread.folder.folder]
    : [...new Set([thread.cwd, ...thread.repositories.map((repository) => repository.worktree)])]

/** Where an agent starts among a task's repositories: in the one, or the folder in it the project is about; among several, the folder that holds them. */
export const startIn = (repositories: ReadonlyArray<{ readonly worktree: string; readonly within: string | null }>) => {
  const [first] = repositories
  if (first === undefined) return ''
  return repositories.length === 1 ? join(first.worktree, first.within ?? '') : dirname(first.worktree)
}

/**
 * What a Local task's lead is told of its folder (ADR-091): the person's
 * own checkout, which they may edit while it works, so it commits only its
 * own files and never moves the checkout or throws anything there away.
 */
export const localBrief = (several: boolean) =>
  [
    `This task works Local: ${several ? 'each folder is' : 'the folder is'} the person's own checkout, where they work, with their builds, simulators and services, and they may edit there while you do.`,
    'Commit only the files you changed for this task, by name, never with `git add -A`, `git add .` or `git commit -a`; leave anything else changed there as it is, uncommitted.',
    "Never switch branch, stash, reset, restore or clean there: Althar checked out this task's branch for it, and puts the checkout back on the branch it was on once the task is settled.",
  ].join(' ')

/** What the person asked for, in their words, for a brief: where it says more than the task's title and description. */
export const askedFor = (thread: { readonly title: string; readonly description: string; readonly request: string | null }) =>
  thread.request === null || thread.request === thread.title || thread.request === `${thread.title}\n\n${thread.description}`
    ? []
    : [`What the person asked for, in their words:\n\n${thread.request}`]

/**
 * Whether a thread's agent only reads: the coordinator, a reviewer, and a review's lead. It loads nothing of the
 * repository's own settings. Selected skills are independent of this role; only offline outside reviews omit them.
 */
export const onlyReads = (
  thread:
    | { readonly role: 'task'; readonly review: object | null; readonly trust?: 'safe' | 'full' | null }
    | { readonly role: Exclude<ThreadContext['role'], 'task'> },
) => thread.role !== 'task' || (thread.review !== null && (thread.trust ?? null) === null)

/** The other tasks planned from the message a task came from, for its lead's brief (siblings.ts). */
export const alongside = (taskId: string) =>
  siblingsOf(taskId).pipe(Effect.map((others) => (others.length === 0 ? [] : [alsoPlanned(others)])))

/** What a lead is told of the project's other tasks (otherTasks.ts, Overlaps.ts), and of starting and moving them (ADR-097). */
export const OTHER_TASKS =
  "Other tasks of this project may change the same code as yours. list_tasks and find_tasks show each with where it stands, its branch, where it works and the files it changes now; read_task (its brief, plan, report and review findings), read_task_diff (its change as it stands, what isn't committed included) and read_thread (what the person and its lead said) read one. Read them before you change code another open task changes, and where your brief names another task. Where Althar tells you another running task changes files you change, read its work before you go on there. You share the coordinator's tools: where the person asks for work your task shouldn't do itself, such as a review's findings into a fix, draft it with draft_task and plan it with propose_plan (or start something small with start_task); it records your task as where it came from, waits the plan's countdown so the person can hold it, and you may start a few in a turn and ten in all. message_lead passes something to another task's lead, signed with your task. The task moves (stop_task, hold_task, restart_task, settle_task, skip_review, push_task and the rest of what the window's buttons do) act at once, with a line in both threads: use them on another task only when the person asks, or where its work plainly conflicts with yours, and say why. Accepting and merging stay on the person's own message. close_pull_request, reopen_pull_request, mark_ready, reply_on_pull_request and edit_pull_request act on any of the project's pull requests, whoever opened it: Althar's own and the person's own at once, anyone else's on the person's own message in your turn (message, from read_turn). read_settings and change_settings read and change the project's settings and Althar's, as the Settings screens do: a change that loosens what asks goes only on the person's own message in your turn, and is a card for them otherwise. Never change another task's files yourself."

/**
 * How the code-host tools' sign-in reaches a session's commands: gh and glab
 * read their own folders inside its sandbox (`CLI_SIGN_INS`); a token kept in
 * the macOS keychain, which the sandbox never reads, they reach only outside it.
 */
export const CLI_SIGN_IN_WORDS =
  "gh and glab read their own settings and sign-in inside your sandbox. Where one says it isn't signed in there, its token is most likely in the macOS keychain, which your sandbox doesn't read: run that command outside your sandbox, where it meets the same irreversible rules."

/** A role's Althar tools. */
export const toolRoleOf = (thread: ThreadContext) => (thread.role === 'task' ? 'lead' : thread.role)

/**
 * What a lead is told of what its sandbox lets through from the start: as
 * Claude Code 2.1 runs it, a line runs outside the sandbox only where every
 * command in it is one of these, never one that changes folder, and never
 * one that starts with `bun`, so a Bun script is listed by what it runs.
 */
export const upFrontSaid = (upFront: Reach): string =>
  [
    upFront.commands.length === 0
      ? ''
      : `Run these commands directly. They start outside your sandbox and still meet the project's rules: ${upFront.commands.map((command) => `\`${command}\``).join(', ')}. Give each command its own call, including a separate call for \`cd\`, and leave off pipes. For a \`bun\` script, run its listed command directly from the script's folder.`,
    'Your sandbox reaches any host without asking: the network is open.',
    upFront.writes.length === 0
      ? ''
      : `Your sandbox writes to the caches of the tools the project installs with: ${upFront.writes.join(', ')}, so an install that downloads into one, such as Electron's build or Playwright's browsers, works inside it.`,
  ]
    .filter((said) => said !== '')
    .join(' ')

export interface Running {
  readonly sessionId: string
  readonly entry: AgentEntry
  readonly thread: ThreadContext
  /** The account it runs on (ADR-012). */
  readonly account: Account
  readonly agent: AgentSession
  readonly connection: AgentConnection
  readonly scope: Scope.Closeable
  readonly wake: Queue.Queue<void>
  /** Held while a turn is delivered, so stopping waits for the turn to be recorded. */
  readonly delivering: Semaphore.Semaphore
  /** Told once the next turn is under way: the place it was given among the agents at work here is then its session's. */
  begun?: Effect.Effect<void> | undefined
  readonly stopRequest: Deferred.Deferred<StopRequest>
  readonly ended: Deferred.Deferred<void>
  /** The brief the session's first turn starts with, and what it asks for when no input is waiting. */
  brief: Brief | undefined
  /** A failed first turn with no input still has its brief to try again. */
  retryBrief?: Brief | undefined
  /** Takes back the session's Althar tools. */
  readonly revokeTools: Effect.Effect<void>
  /** What its permission requests are decided by: its thread, task and rules. */
  readonly requestContext: RequestContext
  turnRunning: boolean
  /** A failed delivery waits for an explicit retry, new words, or its account's reset; queued input alone is not work. */
  deliveryHeld: 'transient' | 'usage_limit' | 'recovery' | null
  /**
   * Held for `usage_limit`: its account out until when, as last read. Kept here only, never as the thread's wait for a place
   * (`waits_for_place`): its task's card says it waits for the reset, not for an agent.
   */
  usageOut?: { readonly agentId: string; readonly accountId: string; readonly until: string } | undefined
  /** Queued recovery may deliver fresh input, but cannot retry input that an earlier session already dispatched. */
  blockedInputs: ReadonlySet<string> | undefined
  /** The failed turn whose input waits, so a later person message can resume even when it arrived as that turn ended. */
  heldTurn?: string | undefined
  /**
   * Told once the prompt of the turn running has reached the agent, which may stop it: between `turnRunning` and that
   * moment there is nothing for an interrupt to stop.
   */
  promptSent: Deferred.Deferred<void> | null
  goalRoundTurn?: string | undefined
  stopping: boolean
  /** The first stop intent survives a crash during cancellation and cannot be replaced by shutdown. */
  stopIntent?: StopRequest
  /** Concurrent shutdown waits until the first stop intent's durable write has finished before it interrupts anything. */
  readonly stopRecorded: Deferred.Deferred<void>
  /** How full the agent's context is, in tokens, as it last said; null until it says (ACP's usage updates). */
  context: { readonly used: number; readonly size: number } | null
  /** Closes the message being said between turns. */
  settleBetween: Effect.Effect<void, never, Store>
  /** What records its events now: its turn's, or the one between turns. */
  recording: { readonly outputOf: (itemId: string) => OutputSoFar | undefined } | undefined
  /** The person stopped the turn running (`interrupt`): its end says so. */
  stoppedByPerson: boolean
  /**
   * The ports its process tree listened on as its latest turn began, once
   * read: what a command it leaves running in that turn is told apart from
   * where only the agent's whole tree is known (`portFor`).
   */
  listeningBefore: Deferred.Deferred<ReadonlySet<number>>
  /** What it left running in the background, in the order it started them (leftRunning.ts). */
  readonly background: Map<string, LeftRunning>
  /** Tool calls it began outside a turn Althar sent, as Claude Code does when something it left running ends, and hasn't finished. */
  readonly callsOpen: Set<string>
  /** When it last spoke outside a turn, or something it left running ended, in milliseconds; null if not since its last turn began. */
  workedAt: number | null
  /** When something it left running ended in between turns, if it hasn't spoken since, in milliseconds. */
  wakeAt: number | null
  /** A session being replaced takes no turns until the new one is ready. */
  handover: 'none' | 'under_way'
  /** Avoid repeating an automatic request while the agent still reports the same full context. */
  compactAttempted?: boolean
  /** Identity of the latest compaction whose Althar records are still owed on a normal turn. */
  compacted?: symbol
  /** The agent is compacting on its own between turns. */
  nativeCompacting?: boolean
  /** When its turn running started, in milliseconds: what the person's wait for its first word is counted from. */
  turnStartedAt: number | null
  /**
   * Briefed as an aside (`asideBrief`): told a lead's whole brief with its next turn, once, when it becomes work, with what its
   * sandbox lets through, which it wasn't told.
   */
  aside?: { readonly sandbox: string | null } | undefined
  /** An aside opened with + with nothing said in it yet: its brief waits for the person's first words, as the coordinator's does. */
  waitsForWords?: boolean | undefined
  /** In a task of several changes, where each change's branch stood as its turn started: what it committed to each is counted from. */
  turnHeads?: ReadonlyArray<{ readonly name: string; readonly path: string; readonly head: string }> | undefined
  /** When its last turn ended, in milliseconds; null before its first. */
  turnEndedAt: number | null
  /** When this live session became active, including one whose first words were withdrawn. */
  readonly openedAt: number
  /** Latest accepted input, including one withdrawn before a turn could take it. */
  idleTouchedAt: number
  /**
   * A lead's or the coordinator's: when it was last told the person's local date and time, and in which zone (localTime.ts);
   * undefined before its brief, or since a compaction, which may have left it out.
   */
  timeTold?: TimeTold | undefined
  /**
   * Who leads it from its next turn, where the person or a tool changed that while it worked or waited (`changeLead`): taken up
   * between turns, as what is said to it next is delivered, never in one.
   */
  nextLead: { readonly agentId: string; readonly model?: string; readonly effort?: string } | undefined
  /** Its `nextLead` was picked while it took the thread over: its first turn, the brief alone though it be, takes it up first. */
  adoptedLead?: boolean | undefined
  /** Held while its agent is set to a model or effort, so two settings never cross: the chosen one and the one before (`chooseLead`). */
  leadLock: Semaphore.Semaphore
  /** Its agent is being set to a model or effort now. */
  settingLead: boolean
  /** A turn is being delivered, from the lead being taken up to the prompt going out: nothing sets the lead then, but that delivery. */
  leadHeld: boolean
  /**
   * Its folder moved under it (a task moving between a worktree and Local): what is said to it next goes to a fresh session
   * there, handed the work so far, as a handover's would, since an agent's session can't follow its folder.
   */
  moved: boolean
  /** The model and effort its lead starts on where it moved, as the person picked them for where it went. */
  movedLead?: { readonly model?: string; readonly effort?: string }
  /**
   * Where the next turn's time went before it was delivered (turnTimes.ts):
   * how long its session took to start or be handed over, and its folder's
   * setup it waited for, which only a session's first turn counts; and how
   * long it waited for a place among the agents at work here. Taken by the
   * turn it was for.
   */
  before: { session: number; starting: Starting | null; place: number }
}

/** How often, at most, a thread's agent is looked at while a round waits for it to be done. */
export const IDLE_EVERY = Duration.millis(250)

/**
 * How often, and for how long, what one left running is read for where it
 * answers: as long as Althar's own runs are (Launches.ts). Its output is read
 * each time; the ports its processes listen on, every few.
 */
export const SERVING_EVERY = Duration.millis(500)

export const SERVING_TRIES = 1_200

export const PORTS_EVERY = 4

/** The longest a turn waits to read what the agent's tree listens on before it begins. */
export const BASELINE_WITHIN = Duration.seconds(5)

/** The longest a session that closes spends stopping what it left running, finding it included, before its agent stops. */
export const LEFT_STOPS_WITHIN = Duration.seconds(15)

export const idleSince = (running: Running) =>
  Math.max(running.turnEndedAt ?? running.openedAt, running.workedAt ?? 0, running.idleTouchedAt)

export const canCompactWhileIdle = (running: Running) => {
  const { thread } = running
  return (
    !running.stopping &&
    running.brief === undefined &&
    running.nextLead === undefined &&
    !running.settingLead &&
    !running.moved &&
    running.handover === 'none' &&
    running.deliveryHeld === null &&
    !running.compactAttempted &&
    !running.nativeCompacting &&
    running.callsOpen.size === 0 &&
    (thread.role === 'coordinator' || (thread.role === 'task' && thread.review === null && thread.helper === undefined)) &&
    contextFull(running.context, thread.role === 'task') &&
    canCompact(running.entry.definition.id)
  )
}

export const idleCompactionDue = (running: Running, now: number, idleFor: number) =>
  canCompactWhileIdle(running) && now - idleSince(running) >= idleFor

export const markCompacted = (running: Running) => {
  const { thread } = running
  if (thread.role === 'coordinator' || (thread.role === 'task' && thread.review === null && thread.helper === undefined))
    running.compacted = Symbol()
  running.timeTold = undefined
}

/** Keeps what the agent last said of its context, including compaction it initiated itself. */
export const heardContext = (running: Running, event: SessionEvent) => {
  if (event._tag === 'ContextUsage') {
    running.context = { used: event.used, size: event.size }
    if (!contextFull(running.context, running.thread.role === 'task')) running.compactAttempted = false
  }
  if (event._tag === 'Compaction') {
    running.nativeCompacting = event.status === 'in_progress'
    if (event.status === 'completed') {
      running.compactAttempted = contextFull(running.context, running.thread.role === 'task')
      markCompacted(running)
    }
  }
}

/** The account asked for, where one was. */
export const accountOf = (input: { readonly accountId?: string }) => (input.accountId === undefined ? {} : { accountId: input.accountId })

export type StopRequest =
  | { readonly state: 'completed'; readonly reason: 'stopped' | 'shutdown' | 'settled' | 'idle' }
  | { readonly state: 'lost' }
  | { readonly state: 'superseded'; readonly by: string }

/**
 * Why a session's brief is written: a start, another agent taking over,
 * a fresh session after loss or a move, or a refresh after compaction.
 */
export type Why =
  | { readonly kind: 'start' }
  | { readonly kind: 'compaction' }
  | { readonly kind: 'takeover'; readonly from: string | undefined }
  | { readonly kind: 'handover'; readonly lost?: boolean }

/** What a new session's first turn starts with, and what it asks for with nothing waiting; `byPerson`, where the person started it. */
export interface Brief {
  readonly text: string
  readonly closing: string
  /** A session opened just to pursue a goal needs ordinary input if the goal was stopped. */
  readonly onlyForGoal?: true
  /** The person started or switched to the agent: its first turn is theirs, and goes on at once (ADR-037). */
  readonly byPerson?: boolean
  /** A fresh session taking over from one whose context was full, rather than one started for the work: its first turn's line says which. */
  readonly starting?: Starting
}

export type Store =
  | Artifacts
  | SqlClient.SqlClient
  | Ledger
  | Commands
  | Crypto.Crypto
  | Instance
  | Live
  | Agents
  | Permissions
  | Questions
  | ToolServer
  | RuntimeConfig
  | Accounts
  | Limits
  | PlanUsage
  | Models
  | Setups
  | Policies

export type Failure = SqlError.SqlError | Schema.SchemaError | CommandIdReused | RowNotFound | RevisionConflict

/** A turn's input was taken back while the turn was being made: it is made again from what still waits. */
export class TakenBack extends Schema.TaggedError<TakenBack>()('TakenBack', {}) {}

export const PROMPT_BUDGET = 60_000

/**
 * How long the coordinator's copies, made fresh as its last turn ended, stay fresh enough for its next: past it, the person
 * came back after a while, and they are fetched again before the turn.
 */
export const COPIES_FRESH = 15 * 60_000

export const optionValue = (options: ReadonlyArray<ConfigOption>, id: string | undefined) => {
  const value = id === undefined ? undefined : options.find((option) => option.id === id)?.currentValue
  return typeof value === 'string' ? value : null
}

/**
 * Puts a session on the effort for the model it is on: the one asked for, or
 * else the person's default for the model, or else the model's own where the
 * agent names it. One the model doesn't offer goes on to the next, and past
 * the last leaves it at the agent's own; a model without efforts has none.
 */
export const settleEffort = (definition: AgentDefinition, agent: AgentSession, asked: string | null) =>
  Effect.gen(function* () {
    const { effort, model, ownEffort } = definition.options
    if (effort === undefined) return
    const on = optionValue(yield* agent.options, model)
    const wanted = [asked, on === null ? null : yield* defaultEffortOf(definition.id, on), ownEffort ?? null]
    for (const level of wanted) {
      if (level === null) continue
      const set = yield* agent.setOption(effort, level).pipe(
        Effect.as(true),
        Effect.orElseSucceed(() => false),
      )
      if (set) return
    }
  })

/**
 * Moves a session started on its agent's own default, no model named, off it where that default is a model the person
 * switched off (ADR-015): onto the one of the agent's other models a takeover would pick (`best`), or, where that names
 * none of them, as before Althar has read the agent's models, the first it lists. With none left on, it doesn't start, and
 * says why. Where what the person switched off can't be read, it starts where it is, as nothing says it is off.
 */
export const offSwitchedOff = (definition: AgentDefinition, agent: AgentSession, best: Effect.Effect<string | null>) =>
  Effect.gen(function* () {
    const offered = modelsOf(definition, yield* agent.options)
    if (offered.model === null) return
    const blocked = yield* blockedModelsOf(definition.id).pipe(
      Effect.catchCause((cause) =>
        Effect.as(Effect.logWarning('Could not read the models the person switched off', cause), [] as ReadonlyArray<string>),
      ),
    )
    const on = standsFor(offered.models, offered.model) ?? offered.model
    if (!blocked.includes(offered.model) && !blocked.includes(on)) return
    const left = offered.models.filter((one) => !isAgentDefault(one) && !blocked.includes(one.id))
    const strongest = yield* best
    const instead = left.find((one) => one.id === strongest) ?? left[0]
    if (instead === undefined) {
      const named = offered.models.find((one) => one.id === on)
      return yield* new ModelSwitchedOff({
        agentName: definition.name,
        model: named === undefined ? on : knownModelName(definition, named),
      })
    }
    yield* agent.setOption(definition.options.model, instead.id)
  })

/** A model as people know it, by what its agent calls it ("GPT-6.1 Sol"); its id where the agent doesn't name it. */
export const modelNamed = (definition: AgentDefinition, options: ReadonlyArray<ConfigOption>, model: string) => {
  const named = modelsOf(definition, options).models.find((one) => one.id === model)
  return named === undefined ? model : knownModelName(definition, named)
}

/** What an agent is told of a message the person dictated, after its words (the standing instructions of a coordinator and a lead explain it). */
export const DICTATED = "(Dictated by voice: words may be misheard. Read names generously; 'Alpha'/'Alter' likely means Althar.)"

/** The one line of a coordinator's and a lead's standing instructions that explains `DICTATED`. */
export const STANDING_DICTATED =
  'The person sometimes dictates by voice, and a message that was ends with a note saying so. Read it past transcription mistakes: misheard names (Althar, the project, its files), homophones.'

/**
 * What a lead given skills is told of them. Its agent lists them, but a list alone goes unread beside a brief that
 * says how to work: the lead is asked to look for one that fits before it starts on something, and to say which it
 * loaded, so the thread shows it.
 */
export const skillsSaid = (given: ReadonlyArray<{ readonly id: string }>): string =>
  `Althar has given you skills for this task: ${given.map(({ id }) => id).join(', ')}. Each is a way of working, such as debugging a failure, planning a change or reviewing one, and your agent lists them with what each is for. When you pick something up, see first whether one fits it: where one does, load it and follow it as you work, and say which you loaded. Where a skill says otherwise, this brief, the project's own instructions and what the person asks come first.`

/**
 * The options a session holds at a value for its life (the registry's
 * `options.held`), and for a role that only reads, its mode option at the
 * reader's mode, so an agent that moves itself out of it is put back.
 */
export const heldFor = (definition: AgentDefinition, reads: boolean): { readonly held?: Readonly<Record<string, string>> } => {
  const reader = reads ? definition.modes.reader : null
  const held = { ...definition.options.held, ...(reader === null ? {} : { [definition.options.mode]: reader }) }
  return Object.keys(held).length === 0 ? {} : { held }
}

/**
 * What the agent is told for a turn, where a message that starts with `/`
 * would run one of its own commands and Althar sends it only its own
 * (the registry's `commands`): the person's, said as words, so it reads
 * them rather than running them. Althar's own (`COMPACT`) goes bare.
 */
export const asTold = (definition: AgentDefinition, prompt: string): string =>
  definition.commands === 'althar' && prompt !== COMPACT && prompt.trimStart().startsWith('/')
    ? `The person wrote this, which Althar passes on as words, not as one of your commands:\n\n${prompt}`
    : prompt

/** Tokens in a line: 412k, 1.2M. */
export const tokensWord = (tokens: number) =>
  tokens >= 1_000_000 ? `${Math.round(tokens / 100_000) / 10}M` : `${Math.round(tokens / 1000)}k`

/** How far a compaction took the context, from how full to how full, where the agent said both and it went down. */
export const compactedSpan = (before: { readonly used: number } | null, after: { readonly used: number } | null) =>
  before !== null && after !== null && after.used < before.used ? `${tokensWord(before.used)} → ${tokensWord(after.used)} tokens` : null

/** What the thread says once the person stopped an agent's turn. */
export const INTERRUPTED = 'Interrupted by you.'

/** What the thread says once an agent compacted its context: from how full to how full, where it said both. */
export const compactedWords = (name: string, before: { readonly used: number } | null, after: { readonly used: number } | null) => {
  const span = compactedSpan(before, after)
  return span === null ? `Compacted ${name}'s context.` : `Compacted ${name}'s context: ${span}.`
}

/**
 * What a turn says to the agent: the brief when the session is new, then each
 * input in send order, with one interruption for the whole burst. With no
 * input waiting, a new session is told what to do by `closing`.
 */
export const promptFor = (
  inputs: ReadonlyArray<{
    readonly body: string
    readonly disposition: string
    /** The agent whose turn it was given to reached its usage limit on it, and may have acted on it first. */
    readonly cutShort?: string
    /** Images the person sent with it that the agent doesn't get: it doesn't take images, or they aren't kept any more. */
    readonly withheld?: number
    /** Files the person sent with it whose copies aren't there any more, as when the task's folder was removed and brought back. */
    readonly filesGone?: number
    /** Some of it was dictated (1), so the agent is told it may have been misheard. */
    readonly dictated?: number
  }>,
  brief: { readonly text: string; readonly closing: string } | undefined,
  /** What Althar tells the agent first, before what was said: what changed while it wasn't speaking. */
  news: string | null = null,
) => {
  const parts = inputs.map((input) => {
    // Images it doesn't get are said, so it knows they were there and can ask what they show.
    const withheld = input.withheld ?? 0
    const filesGone = input.filesGone ?? 0
    const notes = [
      ...(withheld === 0
        ? []
        : [`(The person sent ${withheld === 1 ? 'an image' : `${withheld} images`} with this, which Althar couldn't pass on to you.)`]),
      ...(filesGone === 0
        ? []
        : [
            `(The person sent ${filesGone === 1 ? 'a file' : `${filesGone} files`} with this whose copy isn't there any more. Ask for it if you need it.)`,
          ]),
    ]
    const noted = [...(input.body === '' ? [] : [input.body]), ...notes].join('\n\n')
    // Dictated words are said to be, once, after them: the thread shows the person's words as they are.
    const body = input.dictated === 1 && input.body !== '' ? `${noted}\n\n${DICTATED}` : noted
    // A delivered turn may have acted: what it was given isn't new, and some of it may be done.
    return input.cutShort === undefined
      ? body
      : `${input.cutShort} was working on this when it reached its usage limit, and may have done some of it already. Check what is done before you carry on.\n\n${body}`
  })
  const body = parts.join('\n\n')
  const burst = inputs.some((input) => input.disposition === 'interrupt_and_continue')
    ? [`The person interrupted your last turn to say:\n\n${body}\n\nTake it into account, and carry on with the task.`]
    : parts
  const said = news === null ? burst : [news, ...burst]
  if (brief === undefined) return said.join('\n\n')
  return [brief.text, ...(parts.length === 0 ? [brief.closing] : said)].join('\n\n')
}

/** What a lead's brief says of the images and files the person sent with what they asked for: that they come with it, or that some couldn't. */
export const sentWithWords = (sent: {
  readonly images: ReadonlyArray<unknown>
  readonly files: ReadonlyArray<unknown>
  readonly withheld: number
  readonly gone: number
}) => {
  const count = (n: number, one: string, many: string) => (n === 1 ? one : `${n} ${many}`)
  const given = [
    ...(sent.images.length === 0 ? [] : [count(sent.images.length, 'an image', 'images')]),
    ...(sent.files.length === 0 ? [] : [count(sent.files.length, 'a file', 'files')]),
  ]
  return [
    ...(given.length === 0
      ? []
      : [
          `The person sent ${given.join(' and ')} with what they asked for: ${sent.images.length + sent.files.length === 1 ? 'it comes' : 'they come'} with this message.`,
        ]),
    ...(sent.withheld === 0
      ? []
      : [
          `(The person sent ${count(sent.withheld, 'an image', 'images')} with what they asked for, which Althar couldn't pass on to you.)`,
        ]),
    ...(sent.gone === 0
      ? []
      : [
          `(The person sent ${count(sent.gone, 'a file', 'files')} with what they asked for whose copy isn't there any more. Ask for it if you need it.)`,
        ]),
  ].join('\n\n')
}

export const PASSED_ON = 'The coordinator passes this on:\n\n'

/**
 * What the coordinator, or another task's lead (`from`, that task's title), passes on to a task's lead, as the lead is told
 * it: leads and the coordinator share one tool set, message_lead among them (ADR-097).
 */
export const passedOn = (body: string, from?: string) =>
  from === undefined ? `${PASSED_ON}${body}` : `The lead of “${from}” passes this on:\n\n${body}`

/** Who passed a message on, and in their own words, from what the lead was told; undefined for anything else. */
export const passedOnOf = (told: string) => {
  if (told.startsWith(PASSED_ON)) return { from: 'the coordinator', words: told.slice(PASSED_ON.length) }
  const lead = /^The lead of “([^\n]+)” passes this on:\n\n/.exec(told)
  return lead === null ? undefined : { from: `the lead of “${lead[1]}”`, words: told.slice(lead[0].length) }
}

/** Why a turn ended in failure, as a class for the record. */
export const errorClassOf = (
  failure: Option.Option<{ readonly _tag: string; readonly failure?: string }>,
  failed: boolean,
): string | undefined => {
  if (Option.isSome(failure)) {
    const error = failure.value
    if (error._tag === 'AgentRequestFailed') return error.failure ?? 'unknown'
    if (error._tag === 'AgentExited') return 'agent_exited'
    if (error._tag === 'TurnInProgress') return 'turn_in_progress'
    return 'unknown'
  }
  return failed ? 'unknown' : undefined
}

/** How often a message's text, as far as it has come, goes to watching clients. */
export const STREAM_EVERY = 50
