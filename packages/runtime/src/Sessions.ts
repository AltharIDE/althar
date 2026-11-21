import type { MessageSender, SentCanvasComment, UndoTurnResult } from '@althar/contracts'
import { type CommandEnvelope, Ids, type ProjectId, newId } from '@althar/domain'
import { Commands, bumpRevision } from '@althar/persistence-sqlite'
import {
  type AgentExited,
  AgentRequestFailed,
  type PermissionDecision,
  type PermissionRequest,
  type SessionEvent,
} from '@althar/provider-adapters'
import { Clock, Context, Deferred, Duration, Effect, Fiber, Layer, Option, Queue, Schema, Scope } from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'
import { type Account, Accounts } from './Accounts'
import type { Accepting } from './admission'
import { syncIo } from './agentTools'
import { Artifacts } from './Artifacts'
import { bringBackFor } from './bringBack'
import { keepComments } from './Canvases'
import { touchTask } from './cards'
import { coordinatorRow, forgetItems } from './chatView'
import { COMPACT } from './compact'
import { Agents, RuntimeConfig } from './Config'
import {
  AlreadyDelivered,
  EffortUnchanged,
  type GitFailed,
  ModelUnchanged,
  NoSession,
  NotFound,
  SessionFailed,
  SessionRunning,
  TaskRefused,
  UndoRefused,
  type UnknownAgent,
} from './errors'
import { Failures } from './Failures'
import { git } from './git'
import { dueForHandover, dueForLeadHandover, roomFor, shrinks } from './handover'
import { makeInputBatches } from './inputBatches'
import { Instance } from './Instance'
import { makeKeyedLock } from './keyedLock'
import {
  type LeftRunning,
  QUIET_FOR,
  type ShownLeftRunning,
  TRAILS_FOR,
  WAKE_FOR,
  addressOf,
  commandOfCall,
  exitCodeIn,
  printedMore,
  servingAt,
  shownOf,
  tailOf,
  uncoloured,
} from './leftRunning'
import { Limits, backWords } from './Limits'
import { type KeptLineComment, withLineComments } from './lineComments'
import { Live } from './Live'
import { noteServerStatus } from './mcpHealth'
import { BETWEEN_AGENTS_MS } from './needsYou'
import { Permissions } from './Permissions'
import { PlanUsage } from './PlanUsage'
import { Policies } from './Policies'
import { holding, portFor, portsBelow } from './ports'
import { Questions } from './Questions'
import { outputText } from './reading'
import { change, fact, timestamp } from './records'
import { MERGE_REVIEW, mergeCopyOf, reviewCopyOf } from './reviewCopy'
import { type InputFile, keptId, requestFilesForTurn } from './sentFiles'
import type { InputImage } from './sentImages'
import { makeSessionBriefs } from './sessionBriefs'
import { type SessionConnectionsDependencies, makeSessionConnections } from './sessionConnections'
import {
  AcceptedInput,
  BASELINE_WITHIN,
  type Disposition,
  type Failure,
  IDLE_EVERY,
  PORTS_EVERY,
  type Running,
  SERVING_EVERY,
  SERVING_TRIES,
  type Store,
  type TaskRepository,
  type TaskThread,
  type ThreadContext,
  accountOf,
  optionValue,
  passedOnOf,
  settleEffort,
  startIn,
} from './sessionState'
import { type SessionTurnsDependencies, makeSessionTurns } from './sessionTurns'
import { Setups } from './Setups'
import { localZone } from './slots'
import { type StandIn, isBack, standInOf } from './standIn'
import { stopProcesses, treeOfCommand } from './stopping'
import { teamLeadOf } from './teamLead'
import { type OutputSoFar, addItem, keepAltharCall, moveToEnd, toolItem } from './threads'
import { ToolServer } from './ToolServer'
import { canUndoTask, recoverTurnUndo, undoConversation, undoTarget } from './turnUndo'
import { agentSaid, lostWords, startedAfreshWords } from './words'

export { COMPACT } from './compact'
export {
  AcceptedInput,
  CLI_SIGN_IN_WORDS,
  DICTATED,
  type Disposition,
  INTERRUPTED,
  ModelSwitchedOff,
  OTHER_TASKS,
  StartTimedOut,
  agentLost,
  asTold,
  compactedSpan,
  compactedWords,
  errorClassOf,
  heldFor,
  localBrief,
  onlyReads,
  passedOn,
  promptFor,
  sentWithWords,
  skillsSaid,
  upFrontSaid,
} from './sessionState'

export class Sessions extends Context.Service<
  Sessions,
  {
    /** Starts an agent session on a task's thread, in the task's worktree. */
    start(input: {
      readonly threadId: string
      readonly agentId: string
      readonly model?: string
      /** How hard it thinks, where the agent offers a choice; the agent's own default without one. */
      readonly effort?: string
      /** The account it runs on, where the person picked one; else as `Limits.pick` says. */
      readonly accountId?: string
      /** Who it stands in for, where Althar started it in place of the lead the task was given (standIn.ts). */
      readonly standsIn?: StandIn
    }): Effect.Effect<string, SessionRunning | NotFound | UnknownAgent | SessionFailed | GitFailed | TaskRefused | Failure>
    /**
     * Starts the agent last on the thread again, on the model and effort it
     * had, for what waits in its queue: false, and nothing started, where no
     * agent has been on it.
     */
    startLast(
      threadId: string,
    ): Effect.Effect<boolean, SessionRunning | NotFound | UnknownAgent | SessionFailed | GitFailed | TaskRefused | Failure>
    /**
     * Tries the thread's last turn again, as the person asked, where it
     * failed (ADR-060): what they said in it goes again, with what waits
     * since, to the agent on the thread, started again where it went. False,
     * and nothing done, where neither a failed turn nor an ended session can be retried.
     */
    tryAgain(
      threadId: string,
    ): Effect.Effect<boolean, SessionRunning | NotFound | UnknownAgent | SessionFailed | GitFailed | TaskRefused | Failure>
    /** Whether Try again can act now: the same rule the window uses for its error's action. */
    retryable(threadId: string): Effect.Effect<boolean, SqlError.SqlError>
    /** Serializes preparation and acceptance in arrival order, holding delivery until the whole burst is ready. */
    accepting<A, E, R>(threadId: string, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R>
    /**
     * Whether a new message waits behind work already claimed on this thread
     * (`queued`) or is taken as the next turn (`now`). The window draws an
     * optimistic send from the same answer (`snapshot.accepting`).
     */
    placement(threadId: string): Effect.Effect<Accepting, SqlError.SqlError>
    /** Accepts input into the thread's queue, and delivers it when the session can take it. */
    send(input: {
      readonly envelope: CommandEnvelope
      readonly threadId: string
      readonly body: string
      readonly disposition?: Disposition
      /** Images the person sent with it, in the store already (`keepSent`): sent with its words in every turn that delivers it. */
      readonly images?: ReadonlyArray<InputImage>
      /** Files and folders the person sent with it, copied where the agent reads already (`keepFiles`): linked in every turn that delivers it. */
      readonly files?: ReadonlyArray<InputFile>
      /** Some of its words came from dictation: every turn that delivers it says so, so the agent reads past what was misheard. */
      readonly dictated?: boolean
      /** Comments on lines of the task's diff, each with the tree it was made on (decisions: desktop-app § Comments on the diff): the agent reads them after the words, the thread shows them with them. */
      readonly comments?: ReadonlyArray<KeptLineComment>
      readonly sender?: MessageSender
      readonly origin?: 'news' | 'system'
      /** Input Althar writes, such as findings to settle: delivered, but shown in the thread by what it came from, not as the person's message. */
      readonly quiet?: boolean
      /**
       * What Althar tells it that needs nothing done now, quiet: it starts no turn, and waits for no place among the agents at
       * work, but is noted, and read with the agent's next turn, whatever starts that.
       */
      readonly note?: boolean
    }): Effect.Effect<AcceptedInput, NotFound | Failure>
    /**
     * Notes what waits in a thread's queue for Althar's own turn there, so it starts none: its agent reads it with its next
     * turn. What the person said stays as it is. How many were noted.
     */
    noteQueued(threadId: string): Effect.Effect<number, unknown>
    /**
     * Asks the thread's agent to compact its context, with its own command
     * (`COMPACT`), as a turn of its own after what was said before it. It
     * never waits for a place among the agents at work: it is one call of the
     * agent's, and loads nothing here. Refused where no agent is on the thread.
     */
    compact(input: { readonly envelope: CommandEnvelope; readonly threadId: string }): Effect.Effect<void, NotFound | Failure>
    /**
     * Forgets the coordinator's conversation: its session ends (the turn it was
     * on cut short), what waits in its queue is withdrawn, and its items are
     * deleted, but for what is still open, so nothing of it can be read again
     * (`transcript`, read_thread, a handover's brief). The next message starts
     * a session afresh, briefed from the project's records. Refused for any
     * thread but a project's coordinator.
     */
    forget(input: { readonly envelope: CommandEnvelope; readonly threadId: string }): Effect.Effect<void, NotFound | Failure>
    /** Takes back a message still waiting its turn, by its thread item: the agent never reads it. One the agent has stays. */
    takeBack(input: {
      readonly envelope: CommandEnvelope
      readonly itemId: string
    }): Effect.Effect<void, NotFound | AlreadyDelivered | Failure>
    /** Undoes this delivered turn and the later conversation, restoring its worktrees and ending stale agent context. */
    undoTurn(input: {
      readonly envelope: CommandEnvelope
      readonly itemId: string
    }): Effect.Effect<UndoTurnResult, UndoRefused | NotFound | GitFailed | Failure>
    /** Changes the session's model; the session and its context carry on. */
    setModel(input: { readonly threadId: string; readonly model: string }): Effect.Effect<void, NoSession | ModelUnchanged | Failure>
    /** How hard the running session's agent thinks, from here on. */
    setEffort(input: { readonly threadId: string; readonly effort: string }): Effect.Effect<void, NoSession | EffortUnchanged | Failure>
    /**
     * The person's pick of the same agent's model or effort, as the picker makes it: recorded at once as who leads from the
     * next turn (`nextLead`, which the thread's session shows), and set on the agent in the background, once no turn runs, since
     * an agent answers one request at a time and one asked mid-turn waits for the turn to end. What it wouldn't take is said in
     * the thread, and the lead stays as it was. Where it merges with an earlier pick not yet set, the later of each wins.
     */
    chooseLead(input: {
      readonly threadId: string
      readonly model?: string
      readonly effort?: string
    }): Effect.Effect<'later' | 'same', NoSession | Failure>
    /** Explicitly resumes retained input after a failed turn or a usage reset; an ordinary input-batch wake does not retry failures. */
    wake(threadId: string): Effect.Effect<void>
    /** Starts the startup snapshot once Runtime has installed turn gates, recording hooks and tools. */
    readonly recoverQueued: Effect.Effect<void>
    /**
     * Puts the thread's lead on another model, effort or agent from its next turn: never in the one it is in. Another agent
     * takes over as `switchAgent` hands over, with the work so far, when the next thing said to the thread is delivered; the
     * same agent's model and effort are set then. `later` where a session holds the thread and will change; `same` where it is on
     * that already; `none` where no session holds it, so the next one starts as asked.
     */
    changeLead(input: {
      readonly threadId: string
      readonly agentId: string
      readonly model?: string
      readonly effort?: string
    }): Effect.Effect<'later' | 'same' | 'none'>
    /**
     * The lead a session stands in for takes the thread back from its next turn (standIn.ts), where that session still leads
     * and stands in, and nothing was chosen for it since: whether it was queued.
     */
    giveBack(input: { readonly threadId: string; readonly sessionId: string }): Effect.Effect<boolean>
    /** Hands the thread to another agent: a new session, briefed with the thread so far (ADR-005). */
    switchAgent(input: {
      readonly threadId: string
      readonly agentId: string
      readonly model?: string
      readonly effort?: string
      /** What the thread says of the switch, in place of who switched to whom: why it happened. */
      readonly said?: string
      /** What the loop dealt with by switching, for the home: an agent's usage limit, or a step gone quiet. */
      readonly about?: 'limit' | 'stall'
      /** The step attempt it hands on, for a stall: the new lead stands in until that is over (standIn.ts). */
      readonly attemptId?: string
      /** What the person said with it, and any images and files: the new agent's first turn, after its brief, and never the old one's. */
      readonly message?: {
        readonly envelope: CommandEnvelope
        readonly body: string
        readonly images?: ReadonlyArray<InputImage>
        readonly files?: ReadonlyArray<InputFile>
        /** Some of it was dictated. */
        readonly dictated?: boolean
        readonly comments?: ReadonlyArray<KeptLineComment>
        readonly sender?: MessageSender
        readonly origin?: 'news' | 'system'
      }
      /** The account it runs on, where the person picked one; else as `Limits.pick` says. */
      readonly accountId?: string
      /** The person switched, not Althar: the new agent's first turn is theirs, and goes on at once (ADR-037). */
      readonly byPerson?: boolean
    }): Effect.Effect<string, NotFound | UnknownAgent | SessionFailed | GitFailed | TaskRefused | Failure>
    /** Stops the turn running, if there is one; the session waits for what comes next. */
    interrupt(threadId: string, by?: 'person', background?: boolean): Effect.Effect<void, NoSession>
    /** Stops the thread's session, after ending its turn. */
    stop(threadId: string): Effect.Effect<void, NoSession>
    /** Stops a command the thread's session left running; it goes from the list. Nothing, where the session or the command is gone already. */
    stopBackground(threadId: string, id: string): Effect.Effect<void, AgentRequestFailed | AgentExited>
    /** Clears one that ended by itself from the list. */
    clearBackground(threadId: string, id: string): Effect.Effect<void>
    /** What one left running has printed, as far as it is read: the end of it. */
    backgroundOutput(threadId: string, id: string): Effect.Effect<{ readonly text: string; readonly dropped: number }, NotFound>
    /**
     * Runs `effect` while no agent is on the thread, and none can start on it
     * meanwhile: a finished task's folders go so (ADR-056). Null, and nothing
     * run, where one is on it.
     */
    quiet<A, E, R>(threadId: string, effect: Effect.Effect<A, E, R>): Effect.Effect<A | null, E, R>
    /** The session running on a thread, if there is one. */
    running(threadId: string): Effect.Effect<
      Option.Option<{
        readonly sessionId: string
        readonly agentId: string
        readonly accountId: string
        readonly turnRunning: boolean
        /** When the turn running started, in milliseconds; null between turns. */
        readonly turnStartedAt: number | null
        /** When its last turn ended, in milliseconds; null before its first. */
        readonly turnEndedAt: number | null
        /** The agent's process, where it runs as one. */
        readonly pid: number | null
        /** How full its context is, in tokens, as the agent last said; null until it says. */
        readonly context: { readonly used: number; readonly size: number } | null
        /** It is being stopped: on its way out, not one to carry on with. */
        readonly stopping: boolean
        /** What it left running in the background. */
        readonly background: ReadonlyArray<ShownLeftRunning>
        /** Who leads from its next turn, where `changeLead` changed that. */
        readonly nextLead?: { readonly agentId: string; readonly model?: string; readonly effort?: string }
        /** Its queued turn waits for its account's usage limit to reset: which agent and account, and until when. */
        readonly usageOut?: { readonly agentId: string; readonly accountId: string; readonly until: string }
      }>
    >
    /**
     * Decides something Althar does for the thread's session as one of its
     * own requests would be (ADR-013): by the rules, the coordinator or the
     * person, who sees it in the thread as any other. The session waits on it
     * as it would on its own.
     */
    askPermission(threadId: string, request: PermissionRequest): Effect.Effect<PermissionDecision, NoSession>
    /** What a command on a thread has printed so far, while it runs: its last lines, and how many came before them. */
    outputSoFar(threadId: string, itemId: string): Effect.Effect<Option.Option<OutputSoFar>>
    /**
     * Every session on a task's threads, its lead's or a step's, with whether
     * it is in a turn and whether something it left running still runs: what
     * counts toward the agents at work on this machine (Busy.ts). Never the
     * coordinator's.
     */
    readonly onTasks: Effect.Effect<
      ReadonlyArray<{
        readonly sessionId: string
        readonly threadId: string
        readonly taskId: string
        /** A task's reviewer, not its lead. */
        readonly reviewer: boolean
        /** One of its lead's helpers (ADR-087): a place of its own. */
        readonly helper: boolean
        /** Queued words can become a turn, rather than waiting for a failed delivery's retry or reset. */
        readonly acceptingTurns?: boolean
        readonly turnRunning: boolean
        readonly background: boolean
        /** The agent's process, where it runs as one: what its left running is a part of, and is read for CPU (Busy.ts). */
        readonly pid: number | null
      }>
    >
    /**
     * What a lead's or a reviewer's turns wait for before they are delivered:
     * a place among the agents at work on this machine (Busy.ts). `work`
     * delivers what the thread has queued; the gate runs it now, or once
     * there is a place.
     */
    /**
     * What happens as a lead's turn that delivers the person's own words
     * begins, before the agent reads them: after its task's plan, where each
     * of its worktrees stands is kept with the turn's delivery (Runs.ts; a
     * task is a conversation plus parts), so what the turn commits waits for
     * Ship. It is done once, and never fails the turn.
     */
    /**
     * What happens as any turn of a task's lead begins, before the agent
     * reads its prompt: what the person committed by hand since the lead's
     * last turn is held for Ship then (Changes.ts; a task is a conversation
     * plus parts), before the lead can commit on top of it. Never fails the
     * turn.
     */
    onLeadTurn(next: (lead: { readonly taskId: string; readonly threadId: string }) => Effect.Effect<void>): Effect.Effect<void>
    onPersonsTurn(
      next: (lead: {
        readonly taskId: string
        readonly threadId: string
        readonly sessionId: string
        readonly deliveryId: string
      }) => Effect.Effect<void>,
    ): Effect.Effect<void>
    gateTurns(
      gate: (
        agent: {
          readonly taskId: string
          readonly threadId: string
          readonly sessionId: string
          readonly review: boolean
          /** One of a lead's helpers (ADR-087), by its thread: a place of its own. */
          readonly helper?: string
          /** Its first turn after the person started or switched to it: theirs, as what they say is. */
          readonly byPerson: boolean
        },
        work: (begun: Effect.Effect<void>) => Effect.Effect<void>,
      ) => Effect.Effect<boolean>,
    ): Effect.Effect<void>
    /**
     * Whether the thread's agent is still at work, though its turn has ended:
     * it left a command running, is in a call of its own, or spoke outside a
     * turn Althar sent a moment ago, as Claude Code does once something it
     * left running ends (leftRunning.ts, `stillBusy`). False where no
     * session is.
     */
    busy(threadId: string): Effect.Effect<boolean>
    /**
     * Waits until the agent isn't (`idle`), or its session ends (`gone`), or
     * it is still at work once `within` has passed (`late`).
     */
    untilIdle(threadId: string, within: Duration.Duration): Effect.Effect<'idle' | 'gone' | 'late'>
    /**
     * The lead's folder moved (a worktree to Local, or back): what is said to it next starts a fresh session in the new
     * folder, handed the work so far. Nothing where no session is: the next starts there anyway.
     */
    moved(threadId: string): Effect.Effect<void>
  }
>()('@althar/runtime/Sessions') {
  static readonly layer: Layer.Layer<Sessions, never, Store> = Layer.effect(
    Sessions,
    Effect.gen(function* () {
      const context = yield* Effect.context<Store>()
      const instance = yield* Instance
      const live = yield* Live
      const policies = yield* Policies
      const permissions = yield* Permissions
      const questions = yield* Questions
      const failures = yield* Failures
      const accounts = yield* Accounts
      const limits = yield* Limits
      const planUsage = yield* PlanUsage
      const sessionsSql = yield* SqlClient.SqlClient
      /*
       * Claude Code's adapter says the plan's windows with the usage it streams:
       * kept for the account the session runs on, in a fiber of its own, so
       * the stream never waits on the store or the view.
       */
      /* The cost each session's agent last said, so the store is written only when it moves. */
      const costs = new Map<string, number>()
      /*
       * And the cost it says, a running total for the session (ACP's usage_update): kept on the session, as what was paid
       * per use (ADR-084).
       */
      const heardCost = (running: Running, event: SessionEvent) => {
        if (event._tag !== 'ContextUsage' || event.cost === undefined) return Effect.void
        const { amount, currency } = event.cost
        if (!Number.isFinite(amount) || amount < 0 || costs.get(running.sessionId) === amount) return Effect.void
        costs.set(running.sessionId, amount)
        return Effect.asVoid(
          Effect.forkIn(
            sessionsSql`UPDATE provider_sessions SET reported_cost = ${amount}, reported_currency = ${currency} WHERE id = ${running.sessionId}`.pipe(
              Effect.catchCause((cause) => Effect.logWarning('Could not keep what a session cost', cause)),
            ),
            sessionsScope,
          ),
        )
      }
      // What a session says of one of the person's servers, kept for Settings' tiles (mcpHealth.ts); Claude Code is who says it.
      const heardServer = (event: SessionEvent) => {
        const server = event._tag === 'Notice' ? event.server : undefined
        if (event._tag !== 'Notice' || server === undefined) return Effect.void
        return Effect.gen(function* () {
          const io = yield* syncIo.pipe(Effect.provideService(RuntimeConfig, runtimeConfig))
          const why = [event.title, event.description ?? ''].filter((words) => words.trim() !== '').join(' ')
          if (io !== undefined) noteServerStatus(io, 'claude', server.name, server.status, why)
        }).pipe(Effect.ignore)
      }
      /**
       * Where each of a task's several changes stands as its lead's turn starts (a task is a conversation plus parts, "Where
       * a turn's time goes": with several changes, its line says where its commits went). None for one change, or another
       * thread.
       */
      const changeHeads = (threadId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const rows = yield* sql<{ name: string; own: string | null; path: string }>`
            SELECT coalesce(w.name, w.branch) AS name, w.name AS own, w.path FROM threads t JOIN workspaces w ON w.task_id = t.task_id
            WHERE t.id = ${threadId} AND t.kind = 'task' AND w.access = 'write' AND w.reviewing IS NULL AND w.state = 'ready'
              AND w.branched_at IS NOT NULL
            ORDER BY w.created_at, w.rowid`
          // One change, though in several repositories, has nothing to tell apart.
          if (new Set(rows.map((row) => row.own ?? '')).size < 2) return undefined
          const heads = yield* Effect.forEach(rows, (row) =>
            git(row.path, 'rev-parse', 'HEAD').pipe(
              Effect.map((head) => ({ ...row, head })),
              Effect.orElseSucceed(() => undefined),
            ),
          )
          return heads.filter((one) => one !== undefined)
        }).pipe(Effect.orElseSucceed(() => undefined))

      const heardPlan = (running: Running, event: SessionEvent) => {
        const windows = event._tag === 'PlanWindows' ? event.windows : event._tag === 'ContextUsage' ? event.planWindows : undefined
        return Effect.andThen(
          Effect.andThen(heardServer(event), heardCost(running, event)),
          windows === undefined
            ? Effect.void
            : Effect.asVoid(Effect.forkIn(planUsage.heard(running.account.id, running.entry.definition.id, windows), sessionsScope)),
        )
      }
      const toolServer = yield* ToolServer
      // A call an agent made inside a tool of its own (OpenCode's `execute`) is kept on that tool's item in the thread.
      yield* toolServer.observe((called) =>
        keepAltharCall(
          { projectId: called.access.projectId as ProjectId, threadId: called.access.threadId, sessionId: called.access.sessionId },
          called,
        ).pipe(Effect.provideContext(context), Effect.ignore),
      )
      const setups = yield* Setups
      const runtimeConfig = yield* RuntimeConfig
      const skillsConfig = runtimeConfig.skills
      const stopGrace = (yield* RuntimeConfig).stopGrace ?? Duration.seconds(10)
      // How long a task is under way after its last agent went or its lead's turn ended, before its card is read again (DEV-173).
      const betweenAgents = (yield* RuntimeConfig).betweenAgents ?? Duration.millis(BETWEEN_AGENTS_MS)
      const quietFor = (yield* RuntimeConfig).idle?.quiet ?? QUIET_FOR
      const wakeFor = (yield* RuntimeConfig).idle?.wake ?? WAKE_FOR
      const trailsFor = Duration.toMillis((yield* RuntimeConfig).idle?.trails ?? TRAILS_FOR)
      // The zone the person's local time is told in: the computer's, as its clock says now (localTime.ts).
      const zoneOf = runtimeConfig.zone ?? localZone
      // Sessions live in a scope of their own, closed only after the finalizer below has stopped each one and recorded it.
      const sessionsScope = yield* Scope.fork(yield* Effect.scope, 'sequential')
      const threads = new Map<string, Running>()
      // Snapshot the old queue before callers can add new work. Only input never dispatched is replayable; an uncertain
      // delivery belongs to the person or its workflow. First stop intent makes Stop durable even if cancellation crashed.
      const recoverable = sessionsSql<{ threadId: string; sessionId: string; inputId: string; projectId: ProjectId }>`
        SELECT t.id AS thread_id, s.id AS session_id, i.id AS input_id, t.project_id
        FROM threads t JOIN projects p ON p.id = t.project_id
        JOIN provider_sessions s ON s.id = (SELECT prior.id FROM provider_sessions prior WHERE prior.thread_id = t.id
          ORDER BY (SELECT max(f.sequence) FROM record_events f WHERE f.aggregate_type = 'provider_session' AND f.aggregate_id = prior.id) DESC,
            prior.started_at DESC, prior.rowid DESC LIMIT 1)
        JOIN user_inputs i ON i.thread_id = t.id AND i.state = 'queued'
        WHERE t.kind IN ('coordinator', 'task') AND p.archived_at IS NULL
          AND t.waits_for_place IS NULL
          AND NOT EXISTS (SELECT 1 FROM helpers h WHERE h.thread_id = t.id)
          AND NOT EXISTS (SELECT 1 FROM tasks k WHERE k.id = t.task_id AND k.state = 'abandoned')
          AND NOT EXISTS (SELECT 1 FROM runs r WHERE r.task_id = t.task_id AND r.state IN ('running', 'suspended'))
          AND NOT EXISTS (SELECT 1 FROM turn_delivery_inputs di JOIN turn_deliveries d ON d.id = di.delivery_id
            WHERE di.user_input_id = i.id AND d.delivered_at IS NOT NULL)
          AND NOT EXISTS (SELECT 1 FROM record_events f WHERE f.aggregate_type = 'provider_session' AND f.aggregate_id = s.id AND f.type = 'provider_session.stop_requested'
            AND (json_extract(f.payload, '$.state') <> 'completed' OR coalesce(json_extract(f.payload, '$.reason'), '') <> 'shutdown'))
          AND ((s.state = 'completed' AND EXISTS (SELECT 1 FROM record_events f WHERE f.aggregate_type = 'provider_session' AND f.aggregate_id = s.id
              AND f.type = 'provider_session.completed' AND json_extract(f.payload, '$.reason') = 'shutdown'))
            OR (s.state IN ('lost', 'failed') AND EXISTS (SELECT 1 FROM record_events f WHERE f.aggregate_type = 'provider_session' AND f.aggregate_id = s.id
              AND f.type IN ('provider_session.lost', 'provider_session.failed') AND json_extract(f.payload, '$.reason') = 'runtime_restarted')))`
      const recovery = yield* recoverable.pipe(Effect.orDie)
      const recoveryInputs = new Set(recovery.map((one) => one.inputId))
      /* What any turn of a task's lead starts, once Changes says (onLeadTurn): until then, nothing. */
      let leadTurn = (_lead: { readonly taskId: string; readonly threadId: string }): Effect.Effect<void> => Effect.void
      /* What a lead's turn that delivers the person's words starts, once Runs says (onPersonsTurn): until then, nothing. */
      let personsTurn = (_lead: {
        readonly taskId: string
        readonly threadId: string
        readonly sessionId: string
        readonly deliveryId: string
      }): Effect.Effect<void> => Effect.void
      /* What a lead's or a reviewer's turns wait for, once Busy says (gateTurns): until then, nothing. */
      let gate = (
        _agent: {
          readonly taskId: string
          readonly threadId: string
          readonly sessionId: string
          readonly review: boolean
          readonly helper?: string
          readonly byPerson: boolean
        },
        work: (begun: Effect.Effect<void>) => Effect.Effect<void>,
      ) => Effect.as(work(Effect.void), true)
      const run = <A, E>(effect: Effect.Effect<A, E, Store>) => Effect.provideContext(effect, context)
      // A crash between file writes and the command receipt restores the saved originals before sessions can start.
      yield* run(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const pending = yield* sql<{ threadId: string }>`SELECT DISTINCT thread_id FROM turn_undo_recoveries WHERE state = 'prepared'`
          for (const row of pending)
            yield* recoverTurnUndo(row.threadId).pipe(
              Effect.catchCause((cause) => Effect.logError('An interrupted chat undo needs recovery', { threadId: row.threadId, cause })),
            )
        }),
      ).pipe(Effect.orDie)
      const inputBatches = makeInputBatches(sessionsScope, (threadId) =>
        Effect.gen(function* () {
          const running = threads.get(threadId)
          if (running === undefined) return
          const interrupting = yield* run(
            Effect.gen(function* () {
              const sql = yield* SqlClient.SqlClient
              return (
                (yield* sql`SELECT id FROM user_inputs WHERE thread_id = ${threadId} AND state = 'queued'
            AND disposition = 'interrupt_and_continue' LIMIT 1`).length > 0
              )
            }),
          ).pipe(Effect.orElseSucceed(() => false))
          if (interrupting && running.turnRunning) {
            const sent = running.promptSent
            // Keep cancellation off the delivery path: an agent may not acknowledge it. Stop only this turn,
            // once its prompt has gone out, never a later turn that started while cancellation was waiting.
            yield* Effect.forkIn(
              (sent === null ? Effect.void : Deferred.await(sent)).pipe(
                Effect.timeoutOption(Duration.seconds(5)),
                Effect.andThen(
                  Effect.suspend(() =>
                    running.turnRunning && running.promptSent === sent ? Effect.ignore(running.agent.interrupt) : Effect.void,
                  ),
                ),
              ),
              sessionsScope,
            )
          }
          yield* Queue.offer(running.wake, undefined)
        }),
      )

      /** Tells watching clients what a session has left running, whole. */
      const toldBackground = (running: Running) =>
        live.publish({ _tag: 'Background', threadId: running.thread.threadId, background: [...running.background.values()].map(shownOf) })

      /** What one has printed: its file, where the agent says, else what came on its tool call. */
      const printedBy = (left: LeftRunning) => (left.outputPath !== null ? tailOf(left.outputPath) : Effect.succeed(left.printed))

      /** What its tool call printed before the agent said it left it running: in the turn still, or kept when the turn ended. */
      const printedBefore = (running: Running, itemId: string | undefined) =>
        itemId === undefined
          ? Effect.succeed('')
          : Option.match(Option.fromNullishOr(running.recording?.outputOf(itemId)), {
              onSome: (soFar) => Effect.succeed(soFar.text),
              onNone: () =>
                outputText(running.thread.threadId, itemId).pipe(
                  Effect.map((kept) => kept.text),
                  Effect.orElseSucceed(() => ''),
                ),
            })

      /** The processes a command it left running runs as, with all they started, while it runs (stopping.ts). */
      const treeOfLeft = (running: Running, left: LeftRunning) =>
        left.ended === null ? treeOfCommand(left.outputPath, running.connection.process?.pid) : Effect.succeed([])

      /** Stops what commands it left running run as; logs what wouldn't stop. */
      const stopTrees = (running: Running, trees: ReadonlyArray<ReadonlyArray<number>>) =>
        Effect.gen(function* () {
          const outlived = yield* stopProcesses(trees.flat())
          if (outlived.length > 0)
            yield* Effect.logWarning('What an agent left running would not stop', { pids: outlived }).pipe(
              Effect.annotateLogs({ thread: running.thread.threadId }),
            )
        })

      /**
       * The port one listens on, found from the processes it started: those
       * holding the file its output goes to (Claude Code), whose tree is its
       * own; else the agent's whole tree, where only one new port with no
       * other command left without an address is taken as it (`portFor`).
       * `known` is what the agent's tree listened on before the turn the
       * command began in, not when it was reported: Codex reports one after
       * the turn, by when a quiet server is already listening.
       */
      const listeningPort = (running: Running, left: LeftRunning, known: ReadonlySet<number>) =>
        Effect.gen(function* () {
          const held = left.outputPath === null ? [] : yield* holding(left.outputPath)
          const agent = running.connection.process?.pid
          const roots = held.length > 0 ? held : agent === undefined ? [] : [agent]
          const found = yield* portsBelow(roots)
          // Taken after the lookup, which others ran at the same time: a port is claimed by one only.
          const others = [...running.background.values()].filter((other) => other !== left)
          const claimed = new Set(others.flatMap((other) => (other.url === null ? [] : [Number(new URL(other.url).port)])))
          const rivals = others.filter((other) => other.ended === null && other.url === null).length
          return portFor({ found, claimed, own: held.length > 0, known, rivals })
        })

      /**
       * Reads where the agent's tree listens as its turn begins. The turn waits
       * for it, a moment, before the prompt goes: a server it starts must not
       * be in what listened before. Bounded, for a lookup that hangs.
       */
      const notingListening = (running: Running) =>
        Effect.gen(function* () {
          const agent = running.connection.process?.pid
          const ports =
            agent === undefined
              ? []
              : yield* portsBelow([agent]).pipe(Effect.timeoutOption(BASELINE_WITHIN), Effect.map(Option.getOrElse(() => [])))
          const before = yield* Deferred.make<ReadonlySet<number>>()
          yield* Deferred.succeed(before, new Set(ports))
          running.listeningBefore = before
        })

      /**
       * Reads what one prints, now and then, and where its processes listen,
       * until what it prints says where it answers, it ends, or ten minutes
       * go by. An address from a port stands until its output says another.
       */
      const watchServing = (running: Running, id: string, before: Deferred.Deferred<ReadonlySet<number>>) =>
        Effect.gen(function* () {
          const known = yield* Deferred.await(before)
          for (let tries = 0; tries < SERVING_TRIES; tries += 1) {
            const left = running.background.get(id)
            if (left === undefined || left.ended !== null) return
            const printed = yield* printedBy(left)
            const port =
              left.url === null && servingAt(printed) === null && tries % PORTS_EVERY === PORTS_EVERY - 1
                ? yield* listeningPort(running, left, known)
                : null
            const now = running.background.get(id)
            if (now === undefined || now.ended !== null) return
            const found = addressOf(now, printed, port)
            if (found !== null) {
              now.url = found.url
              now.inferred = found.inferred
              yield* toldBackground(running)
              if (!found.inferred) return
            }
            yield* Effect.sleep(SERVING_EVERY)
          }
        })

      /** Keeps what the agent says of what it left running, from an event it streamed, in a turn or between. */
      const heardBackground = (running: Running, event: SessionEvent) =>
        run(
          Effect.gen(function* () {
            switch (event._tag) {
              case 'BackgroundStarted': {
                // The thread has its tool call already: the agent says what it left running once the call is made.
                const item = event.toolCallId === undefined ? undefined : yield* toolItem(running.sessionId, event.toolCallId)
                running.background.set(event.id, {
                  id: event.id,
                  command: commandOfCall(item?.content, event.name),
                  name: event.name,
                  toolCallId: event.toolCallId ?? null,
                  outputPath: event.outputPath ?? null,
                  printed: yield* printedBefore(running, item?.id),
                  url: null,
                  inferred: false,
                  startedAt: yield* timestamp,
                  ended: null,
                })
                // Left running, its call is no longer one the agent has open.
                if (event.toolCallId !== undefined) running.callsOpen.delete(event.toolCallId)
                yield* toldBackground(running)
                yield* Effect.forkIn(watchServing(running, event.id, running.listeningBefore), running.scope)
                return
              }
              case 'ToolCallUpdate': {
                const more = event.terminal?.output
                if (more === undefined) return
                for (const left of running.background.values())
                  if (left.toolCallId === event.toolCallId) left.printed = printedMore(left.printed, more)
                return
              }
              case 'BackgroundOutput': {
                const left = running.background.get(event.id)
                if (left !== undefined) left.outputPath = event.outputPath
                return
              }
              case 'BackgroundEnded': {
                const left = running.background.get(event.id)
                if (left === undefined) return
                // Claude Code may start a turn of its own now (ADR-022).
                running.workedAt = yield* Clock.currentTimeMillis
                if (!running.turnRunning && event.end !== 'stopped') running.wakeAt = running.workedAt
                // Stopped, it goes, whoever stopped it. Ended by itself, it stays, to say how.
                if (event.end === 'stopped') running.background.delete(event.id)
                else {
                  const code = exitCodeIn(yield* printedBy(left)) ?? (event.end === 'completed' ? 0 : null)
                  left.ended = { at: yield* timestamp, code }
                }
                return yield* toldBackground(running)
              }
              default:
                return
            }
          }),
        ).pipe(Effect.catchCause((cause) => Effect.logWarning('Could not keep what an agent left running', cause)))

      /**
       * Keeps that the agent is at work outside a turn Althar sent, from an
       * event it streamed between turns: it speaks, or makes a call and has
       * not finished it. Nothing says when such a turn ends, so it is taken
       * as over once the agent has said nothing for a while (`stillBusy`).
       * What it says just after its turn ended is that turn's last words,
       * heard late (`TRAILS_FOR`): no more work, unless it begins a call.
       */
      const heardWork = (running: Running, event: SessionEvent) =>
        Effect.gen(function* () {
          let begins = false
          switch (event._tag) {
            case 'AgentMessage':
            case 'AgentContent':
            case 'AgentThought':
            case 'Plan':
              break
            case 'ToolCall':
              begins = event.status === 'pending' || event.status === 'in_progress'
              if (begins) running.callsOpen.add(event.toolCallId)
              else running.callsOpen.delete(event.toolCallId)
              break
            case 'ToolCallUpdate':
              if (event.status === 'completed' || event.status === 'failed') running.callsOpen.delete(event.toolCallId)
              // What a command it left running prints isn't the agent at work.
              if ([...running.background.values()].some((left) => left.toolCallId === event.toolCallId)) return
              break
            default:
              return
          }
          const now = yield* Clock.currentTimeMillis
          // Heard before its turn is recorded as ended, or just after, it is still the turn's.
          if (!begins && (running.turnRunning || (running.turnEndedAt !== null && now - running.turnEndedAt < trailsFor))) return
          running.workedAt = now
          running.wakeAt = null
        })

      /** No agent starts, and nothing is said to one, in a project removed from Althar: a window that hadn't heard yet is told it's gone. */
      const inLiveProject = (threadId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [removed] = yield* sql<{ projectId: string }>`
            SELECT p.id AS project_id FROM threads t JOIN projects p ON p.id = t.project_id
            WHERE t.id = ${threadId} AND p.archived_at IS NOT NULL`
          if (removed !== undefined) return yield* new NotFound({ kind: 'project', id: removed.projectId })
        })

      /** An abandoned task has no agent on it until it is reopened. */
      const notAbandoned = (threadId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [abandoned] = yield* sql<{ taskId: string }>`
            SELECT k.id AS task_id FROM threads t JOIN tasks k ON k.id = t.task_id WHERE t.id = ${threadId} AND k.state = 'abandoned'`
          if (abandoned !== undefined) return yield* new TaskRefused({ taskId: abandoned.taskId, why: 'abandoned' })
        })

      const loadThread = (threadId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [kind] = yield* sql<{ kind: string; projectId: ProjectId; projectName: string }>`
            SELECT t.kind, t.project_id, p.name AS project_name FROM threads t JOIN projects p ON p.id = t.project_id WHERE t.id = ${threadId}`
          // A review after a merge reads a copy at the merged head, beside the task's folder: whether that folder is here or not.
          const merged = kind?.kind === 'step' ? yield* mergedReviewOf(threadId) : undefined
          if (merged !== undefined) return merged
          // A helper works in the worktree of the change it was handed, not a reviewer's copy.
          const helped = kind?.kind === 'step' ? yield* helperThreadOf(threadId) : undefined
          if (helped !== undefined) return helped
          // A finished task's folder that was removed comes back before an agent starts in it, and is set up again (ADR-056).
          if (kind !== undefined && kind.kind !== 'coordinator') {
            const back = yield* bringBackFor(threadId, instance.systemId)
            if (back !== null) yield* setups.begin(back)
          }
          if (kind?.kind === 'coordinator')
            return {
              role: 'coordinator',
              threadId,
              projectId: kind.projectId,
              projectName: kind.projectName,
              folder: yield* freshCopies(kind.projectId),
            } satisfies ThreadContext as ThreadContext
          // The task's repositories, each in its worktree here, the first first.
          const repositories = yield* sql<TaskRepository>`
            SELECT b.display_name AS name, b.role, w.path AS worktree, w.branch, w.branched_at IS NOT NULL AS branched, w.base_ref,
              w.base_commit, coalesce(b.default_base_ref, w.base_ref) AS default_branch, w.toward, b.folder AS within,
              w.kind IS 'checkout' AS local, w.name AS change
            FROM threads t
            JOIN workspaces w ON w.task_id = t.task_id AND w.device_id = ${instance.deviceId} AND w.state = 'ready'
            JOIN repository_bindings b ON b.id = w.binding_id
            WHERE t.id = ${threadId}
            ORDER BY b.created_at, b.rowid`
          const [task] = yield* sql<{ projectId: ProjectId; taskId: string; title: string; description: string; request: string | null }>`
            SELECT t.project_id, t.task_id, k.title, k.description, k.request FROM threads t JOIN tasks k ON k.id = t.task_id WHERE t.id = ${threadId}`
          const [first] = repositories
          if (task === undefined || first === undefined)
            return yield* new NotFound({ kind: 'task thread with a ready worktree', id: threadId })
          // A reviewer reads a throwaway copy of each of the lead's worktrees, not the worktrees themselves.
          if (kind?.kind === 'step') {
            const copies = repositories.map((repository) => ({ ...repository, worktree: reviewCopyOf(repository.worktree) }))
            return {
              role: 'reviewer',
              threadId,
              ...task,
              repositories: copies,
              cwd: startIn(copies),
            } satisfies ThreadContext as ThreadContext
          }
          return {
            role: 'task',
            threadId,
            ...task,
            worktree: first.worktree,
            branch: first.branch,
            baseRef: first.baseRef,
            baseCommit: first.baseCommit,
            defaultBranch: first.defaultBranch,
            repositories,
            cwd: startIn(repositories),
            ...(yield* reviewingOf(task.taskId)),
          } satisfies ThreadContext as ThreadContext
        })

      /**
       * The thread of a review after a merge, where it is one (MergeReviews.ts): its copy is at the merged head, and the change is
       * what merged since what the last review read. Undefined for any other thread.
       */
      const mergedReviewOf = (threadId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [review] = yield* sql<{ number: number | null; base: string | null; url: string; bringsBack: string | null }>`
            SELECT r.number, r.base, r.url, json_extract(r.reviewer, '$.bringsBack') AS brings_back
            FROM threads t JOIN merge_reviews r ON r.task_id = t.task_id
            WHERE t.id = ${threadId} AND t.kind = 'step' AND t.node_key = ${MERGE_REVIEW} AND r.state IN ('running', 'owed')
            ORDER BY r.state = 'running' DESC, r.updated_at DESC LIMIT 1`
          if (review === undefined) return undefined
          const repositories = yield* sql<TaskRepository>`
            SELECT b.display_name AS name, b.role, w.path AS worktree, w.branch, w.branched_at IS NOT NULL AS branched, w.base_ref,
              w.base_commit, coalesce(b.default_base_ref, w.base_ref) AS default_branch, w.toward, b.folder AS within,
              w.kind IS 'checkout' AS local
            FROM threads t
            JOIN workspaces w ON w.task_id = t.task_id AND w.device_id = ${instance.deviceId}
            JOIN repository_bindings b ON b.id = w.binding_id
            LEFT JOIN repository_changes c ON c.workspace_id = w.id AND c.pull_request_url = ${review.url}
            WHERE t.id = ${threadId}
            ORDER BY c.id IS NULL, b.created_at, b.rowid LIMIT 1`
          const [task] = yield* sql<{ projectId: ProjectId; taskId: string; title: string; description: string; request: string | null }>`
            SELECT t.project_id, t.task_id, k.title, k.description, k.request FROM threads t JOIN tasks k ON k.id = t.task_id WHERE t.id = ${threadId}`
          const [first] = repositories
          if (task === undefined || first === undefined) return yield* new NotFound({ kind: 'review after a merge', id: threadId })
          const copies = [{ ...first, worktree: mergeCopyOf(first.worktree, review.number), baseCommit: review.base ?? first.baseCommit }]
          return {
            role: 'reviewer',
            merged: {
              words: review.number === null ? 'the pull request' : `#${review.number}`,
              bringsBack: review.bringsBack === 'all' ? 'all' : 'major',
            },
            threadId,
            ...task,
            repositories: copies,
            cwd: startIn(copies),
          } satisfies ThreadContext as ThreadContext
        })

      /** A helper's thread, as its session reads it: its task, its change's worktree, and what it was asked. */
      const helperThreadOf = (threadId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [helper] = yield* sql<{
            name: string
            brief: string
            workspaceId: string | null
            copyPath: string | null
            writes: number
          }>`SELECT name, brief, workspace_id, copy_path, writes FROM helpers WHERE thread_id = ${threadId}`
          if (helper === undefined) return undefined
          const repositories = yield* sql<TaskRepository>`
            SELECT b.display_name AS name, b.role, w.path AS worktree, w.branch, w.branched_at IS NOT NULL AS branched, w.base_ref,
              w.base_commit, coalesce(b.default_base_ref, w.base_ref) AS default_branch, w.toward, b.folder AS within,
              w.kind IS 'checkout' AS local, w.name AS change
            FROM threads t JOIN workspaces w ON w.task_id = t.task_id AND w.device_id = ${instance.deviceId} AND w.state = 'ready'
              AND w.access = 'write'
            JOIN repository_bindings b ON b.id = w.binding_id
            WHERE t.id = ${threadId} AND (${helper.workspaceId} IS NULL OR w.id = ${helper.workspaceId})
            ORDER BY b.created_at, b.rowid LIMIT 1`
          const [task] = yield* sql<{ projectId: ProjectId; taskId: string; title: string; description: string; request: string | null }>`
            SELECT t.project_id, t.task_id, k.title, k.description, k.request FROM threads t JOIN tasks k ON k.id = t.task_id WHERE t.id = ${threadId}`
          const [found] = repositories
          if (task === undefined || found === undefined) return yield* new NotFound({ kind: 'helper with a ready worktree', id: threadId })
          // One given no change works in a copy of its own, its only folder (ADR-087, task 6).
          const first = helper.copyPath === null ? found : { ...found, worktree: helper.copyPath }
          return {
            role: 'task',
            threadId,
            ...task,
            worktree: first.worktree,
            branch: first.branch,
            baseRef: first.baseRef,
            baseCommit: first.baseCommit,
            defaultBranch: first.defaultBranch,
            repositories: helper.copyPath === null ? repositories : [first],
            cwd: first.worktree,
            review: null,
            trust: null,
            helper: {
              name: helper.name,
              brief: helper.brief,
              change: first.change ?? null,
              ...(helper.copyPath === null ? {} : { copy: true, writes: helper.writes === 1 }),
            },
          } satisfies ThreadContext as ThreadContext
        })

      const sessionFact = (thread: ThreadContext, sessionId: string, revision: number, type: string, payload: unknown = {}) =>
        fact({
          projectId: thread.projectId,
          aggregateType: 'provider_session',
          aggregateId: sessionId,
          revision,
          type,
          payload,
          actorId: instance.systemId,
        })

      /** Records a new session, still starting, on the account it runs on. */
      /** A session, starting; on the model asked for, so it is named by it from the first. */
      /** `standsIn`: who it stands in for, where a usage limit handed it the thread (standIn.ts). */
      const createSession = (thread: ThreadContext, agentId: string, account: Account, model?: string, standsIn?: StandIn) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const sessionId = yield* newId(Ids.providerSession)
          yield* sql.withTransaction(
            Effect.gen(function* () {
              // Checked where the session is written: a removal is a transaction too, so it either sees this session and
              // stops it, or came first and this one never starts.
              yield* inLiveProject(thread.threadId)
              yield* sql`INSERT INTO provider_sessions ${sql.insert({
                id: sessionId,
                projectId: thread.projectId,
                threadId: thread.threadId,
                agentId,
                accountId: account.id,
                controllerGeneration: 1,
                state: 'starting',
                ...(model === undefined ? {} : { model }),
                startedAt: yield* timestamp,
              })}`
              yield* sessionFact(thread, sessionId, 1, 'provider_session.starting', {
                agentId,
                accountId: account.id,
                // On the given lead's own agent, a lead given no model of its own has none to go back to: it doesn't stand in.
                ...(standsIn === undefined || (standsIn.agentId === agentId && standsIn.model === null) ? {} : { standsIn }),
              })
            }),
          )
          return sessionId
        })

      /**
       * The images sent with each input, from the store, in order, for an
       * agent that takes images; and how many of each it doesn't get: all of
       * them where it doesn't take images, else any no longer kept.
       */
      const imagesFor = (inputIds: ReadonlyArray<string>, takes: boolean) =>
        Effect.gen(function* () {
          const images = new Map<string, Array<{ readonly data: string; readonly mimeType: string }>>()
          const withheld = new Map<string, number>()
          if (inputIds.length === 0) return { images, withheld }
          const sql = yield* SqlClient.SqlClient
          const artifacts = yield* Artifacts
          const rows = yield* sql<{ userInputId: string; sha256: string; mediaType: string }>`
            SELECT ii.user_input_id, a.sha256, a.media_type
            FROM user_input_images ii JOIN artifacts a ON a.id = ii.artifact_id
            WHERE ii.user_input_id IN ${sql.in(inputIds)} ORDER BY ii.user_input_id, ii.position`
          for (const row of rows) {
            const bytes = takes ? yield* artifacts.read(row.sha256) : null
            if (bytes === null) withheld.set(row.userInputId, (withheld.get(row.userInputId) ?? 0) + 1)
            else
              images.set(row.userInputId, [
                ...(images.get(row.userInputId) ?? []),
                { data: Buffer.from(bytes).toString('base64'), mimeType: row.mediaType },
              ])
          }
          return { images, withheld }
        })

      /**
       * The images and files the person sent with what a task was asked for,
       * in their messages to the coordinator, for the turn that gives its lead
       * its brief: the images as `imagesFor` reads them, the files copied
       * where the lead reads; and how many of each it doesn't get.
       */
      const sentWithRequest = (thread: TaskThread, takes: boolean) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const ids = (yield* sql<{ userInputId: string }>`
            SELECT user_input_id FROM task_request_inputs WHERE task_id = ${thread.taskId} ORDER BY position`).map((row) => row.userInputId)
          const sent = yield* imagesFor(ids, takes)
          const images = ids.flatMap((id) => sent.images.get(id) ?? [])
          const withheld = ids.reduce((sum, id) => sum + (sent.withheld.get(id) ?? 0), 0)
          const { files, gone } = yield* requestFilesForTurn(thread.threadId, thread.taskId)
          return { images, files, withheld, gone }
        })

      /**
       * The thread shows what a turn gives the agent where the agent reads it,
       * in the order it reads it: once the turn before has ended, not where
       * it was sent. What the person said moves to the end of the thread,
       * unless nothing but what comes after it in this turn follows it
       * already; what the coordinator passed on is said now (a lead mid-turn
       * reads it only once that turn ends, and one that isn't running only
       * once one starts). What an earlier turn gave an agent stays where that
       * one read it.
       */
      const shownWhereRead = (
        running: Running,
        deliveryId: string,
        inputs: ReadonlyArray<{ readonly id: string; readonly body: string; readonly given: number }>,
      ) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const { thread } = running
          const fresh = inputs.filter((input) => input.given === 0)
          if (fresh.length === 0) return
          const shown = yield* sql<{ id: string; userInputId: string }>`
            SELECT id, user_input_id FROM thread_items
            WHERE thread_id = ${thread.threadId} AND user_input_id IN ${sql.in(fresh.map((input) => input.id))}`
          const itemsOf = (input: { readonly id: string }) => shown.filter((item) => item.userInputId === input.id).map((item) => item.id)
          for (const [index, input] of fresh.entries()) {
            // What the coordinator passed on, by the words it is passed on with: Althar writes the input for it, as for every quiet one.
            const relayed = passedOnOf(input.body)
            if (relayed !== undefined)
              yield* addItem(
                { projectId: thread.projectId, threadId: thread.threadId, sessionId: running.sessionId, deliveryId },
                'notice',
                {
                  source: 'runtime',
                  severity: 'info',
                  title: `From ${relayed.from}:`,
                  description: relayed.words,
                  role: 'relayed',
                },
              )
            for (const itemId of itemsOf(input))
              yield* moveToEnd(thread.projectId, thread.threadId, itemId, fresh.slice(index + 1).flatMap(itemsOf))
          }
        })

      /**
       * Whether a session is handed to a fresh one before its next turn: a
       * coordinator whose context is filling up (ADR-031); a task's lead whose
       * context is past its mark, or past a smaller one at a break in its work
       * (a step done, the task made a change, or idle past its cache's life),
       * unless something it left running still runs, which closing its
       * session would stop (ADR-038).
       */
      const dueToHandOver = (running: Running) =>
        Effect.gen(function* () {
          const { thread } = running
          if (thread.role === 'coordinator') return dueForHandover(running.context)
          if (thread.role !== 'task' || thread.review !== null) return false
          if ([...running.background.values()].some((left) => left.ended === null)) return false
          // Still at work though its turn ended, or within the moment an agent takes to say what it left running (Codex says so
          // after its turn): not yet.
          if (yield* busyNow(thread.threadId)) return false
          return dueForLeadHandover(running.context)
        })

      /** Whether anything waits in the thread's queue. */
      const inputWaiting = (threadId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [waiting] = yield* sql<{
            one: number
          }>`SELECT 1 AS one FROM user_inputs WHERE thread_id = ${threadId} AND state = 'queued' LIMIT 1`
          return waiting !== undefined
        })

      /** What the thread says as the lead a session stood in for takes it back from it. */
      const backSaid = (standsIn: StandIn, standIn: Running) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [on] = yield* sql<{ model: string | null }>`SELECT model FROM provider_sessions WHERE id = ${standIn.sessionId}`
          return backWords({
            given: yield* limits.named(standsIn.agentId, standsIn.model, standsIn.accountId),
            standIn: yield* limits.named(standIn.entry.definition.id, on?.model ?? null, standIn.account.id),
            ...(standsIn.why === undefined ? {} : { why: standsIn.why }),
          })
        }).pipe(Effect.orElseSucceed(() => undefined))

      /** Pending intent has a feed revision of its own; it never changes what the agent has actually accepted. */
      const setLeadChoice = (
        running: Running,
        next: Running['nextLead'],
        options?: {
          readonly after?: NonNullable<Running['nextLead']>
          readonly choice?: { readonly agentId: string; readonly model: string | null; readonly effort: string | null }
          /** The agent accepted or refused this choice; clearing for a takeover has not resolved it yet. */
          readonly resolved?: true
          readonly onlyIfEmpty?: true
        },
      ) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          return yield* sql.withTransaction(
            Effect.gen(function* () {
              if (running.stopping || threads.get(running.thread.threadId) !== running) return false
              if (options?.after !== undefined && running.nextLead !== options.after) return false
              if (options?.onlyIfEmpty === true && running.nextLead !== undefined) return false
              if (options?.choice === undefined && options?.resolved !== true && running.nextLead === next) return true
              const [session] = yield* sql<{ revision: number }>`SELECT revision FROM provider_sessions WHERE id = ${running.sessionId}`
              if (session === undefined) return yield* new NoSession({ threadId: running.thread.threadId })
              const revision = yield* bumpRevision('provider_sessions', running.sessionId, session.revision)
              yield* sessionFact(running.thread, running.sessionId, revision, 'provider_session.lead_choice_changed', {
                nextLead: next ?? null,
                ...(options?.choice === undefined ? {} : { choice: options.choice }),
                ...(options?.resolved === true ? { resolved: true } : {}),
              })
              if (running.thread.role !== 'coordinator') yield* touchTask(running.thread.taskId)
              running.nextLead = next
              return true
            }),
          )
        })

      /**
       * The same agent on another model or effort, set between turns as the composer sets them. One it won't take stays as it is,
       * said with why. Held under `leadLock` by whoever calls it, so two settings never cross.
       */
      const settleLead = (running: Running, next: { readonly model?: string; readonly effort?: string }) =>
        Effect.gen(function* () {
          running.settingLead = true
          const sql = yield* SqlClient.SqlClient
          const { threadId } = running.thread
          const [now] = yield* sql<{ model: string | null; effort: string | null }>`
              SELECT model, effort FROM provider_sessions WHERE id = ${running.sessionId}`
          const refused = (what: string, why: string) =>
            addItem({ projectId: running.thread.projectId, threadId, sessionId: running.sessionId }, 'notice', {
              source: 'runtime',
              severity: 'warning',
              title: `${running.entry.definition.name} stays on ${what} as it is: ${why}`,
            })
          const because = (error: { readonly _tag: string; readonly summary?: string }) =>
            error._tag === 'ModelUnchanged' || error._tag === 'EffortUnchanged'
              ? (error.summary ?? 'it wouldn’t change.')
              : 'it wouldn’t change.'
          if (next.model !== undefined && next.model !== now?.model)
            yield* setModel({ threadId, model: next.model }).pipe(Effect.catch((error) => refused('its model', because(error))))
          if (next.effort !== undefined && next.effort !== now?.effort)
            yield* setEffort({ threadId, effort: next.effort }).pipe(Effect.catch((error) => refused('its effort', because(error))))
        }).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              running.settingLead = false
            }),
          ),
        )

      /**
       * What the person chose of the same agent's model or effort is set on the agent, where nothing runs: the lead taken up as
       * chosen, whatever was chosen since while it was being set. A turn at work waits: it is set when the turn ends, or
       * between turns as what is said next is delivered (`deliver`).
       */
      const applyLead = (running: Running): Effect.Effect<void, never, Store> =>
        running.leadLock
          .withPermits(1)(
            Effect.gen(function* () {
              // Read under the lock, as what was chosen last: a turn that began, or was being delivered, while this waited has it.
              for (;;) {
                if (running.turnRunning || running.leadHeld || running.stopping || threads.get(running.thread.threadId) !== running) return
                const next = running.nextLead
                if (next === undefined || next.agentId !== running.entry.definition.id) return
                yield* settleLead(running, next)
                // Taken up once set, or refused: until then the thread says it leads from here. Chosen again meanwhile, that one next.
                if (yield* setLeadChoice(running, undefined, { after: next, resolved: true })) return
              }
            }),
          )
          .pipe(Effect.catchCause((cause) => Effect.logWarning('Could not set the lead as chosen', cause)))

      /**
       * Another agent takes over a lead between turns, as it was changed: the same hand-over as the composer's, with what waits
       * for the lead going to the new agent. One that can't start leaves the lead as it is, said.
       */
      const takeOver = (
        previous: Running,
        next: { readonly agentId: string; readonly model?: string; readonly effort?: string },
      ): Effect.Effect<void, never, Store> =>
        Effect.gen(function* () {
          // The lead a stand-in stood in for, taking the thread back as Althar queued it (`giveBack`): said now it does.
          const standing = Option.getOrUndefined(
            yield* standInOf(previous.sessionId).pipe(Effect.orElseSucceed(() => Option.none<StandIn>())),
          )
          const back =
            standing !== undefined && standing.agentId === next.agentId && (next.model === undefined || next.model === standing.model)
              ? yield* backSaid(standing, previous)
              : undefined
          return yield* switchAgent({
            threadId: previous.thread.threadId,
            ...next,
            ...(back === undefined ? {} : { said: back, about: standing?.why === 'stall' ? ('stall' as const) : ('limit' as const) }),
          })
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.andThen(
              Effect.logWarning('Could not hand a lead to the agent it was changed to', cause),
              Effect.suspend(() => {
                if (threads.get(previous.thread.threadId) !== previous) return Effect.void
                previous.handover = 'none'
                return Effect.andThen(
                  setLeadChoice(previous, undefined, { resolved: true, onlyIfEmpty: true }),
                  Effect.andThen(
                    addItem(
                      { projectId: previous.thread.projectId, threadId: previous.thread.threadId, sessionId: previous.sessionId },
                      'notice',
                      {
                        source: 'runtime',
                        severity: 'warning',
                        title: `${previous.entry.definition.name} carries on: the agent it was changed to couldn’t start.`,
                      },
                    ),
                    Queue.offer(previous.wake, undefined),
                  ),
                )
              }),
            ),
          ),
          Effect.catchCause((cause) => Effect.logWarning('Could not say a lead stayed as it was', cause)),
          Effect.asVoid,
        )
      const { deliveries, freshCopies, placement, undoing } = makeSessionTurns({
        get accountLimited(): SessionTurnsDependencies['accountLimited'] {
          return accountLimited
        },
        applyLead,
        get asideState(): SessionTurnsDependencies['asideState'] {
          return asideState
        },
        betweenAgents,
        changeHeads,
        dueToHandOver,
        // Callbacks can be registered after the layer starts. Turns use the current callback.
        get gate(): SessionTurnsDependencies['gate'] {
          return gate
        },
        get handOver(): SessionTurnsDependencies['handOver'] {
          return handOver
        },
        heardBackground,
        heardPlan,
        imagesFor,
        inputBatches,
        inputWaiting,
        instance,
        get leadTurn(): SessionTurnsDependencies['leadTurn'] {
          return leadTurn
        },
        limits,
        live,
        loadThread,
        notingListening,
        get personsTurn(): SessionTurnsDependencies['personsTurn'] {
          return personsTurn
        },
        run,
        sentWithRequest,
        sessionsScope,
        setLeadChoice,
        settleLead,
        setups,
        shownWhereRead,
        takeOver,
        get taskBrief(): SessionTurnsDependencies['taskBrief'] {
          return taskBrief
        },
        threads,
        zoneOf,
      })

      /** A usage limit belongs to the account the session runs on (docs/architecture/03, ADR-012), not the agent. */
      const accountLimited = (running: Running, resetsAt: string | undefined) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const agentId = running.entry.definition.id
          const accountId = running.account.id
          // A cached reading may still say 98% when the turn runs out. Read the account before publishing its limit so
          // steering can wait for the real reset; provider failures retain the last reading and never hide the turn's error.
          if (resetsAt === undefined)
            yield* planUsage
              .refresh([accountId], true)
              .pipe(Effect.catch((error) => Effect.logWarning('Could not refresh usage after a limit', error)))
          yield* sql.withTransaction(
            Effect.gen(function* () {
              const [known] = yield* sql<{
                id: string
              }>`SELECT id FROM principals WHERE account_id = ${accountId} ORDER BY observed_at DESC LIMIT 1`
              const principalId = known?.id ?? (yield* newId(Ids.principal))
              if (known === undefined) {
                yield* sql`INSERT INTO principals ${sql.insert({ id: principalId, agentId, accountId, deviceId: instance.deviceId, subjectHint: `${running.entry.definition.name} sign-in`, authMode: 'vendor_cli', observedAt: yield* timestamp })}`
              }
              const id = yield* newId(Ids.accountStatus)
              yield* sql`INSERT INTO account_statuses ${sql.insert({
                id,
                principalId,
                state: 'limited',
                windows: JSON.stringify([{ kind: 'usage', ...(resetsAt === undefined ? {} : { resetsAt }) }]),
                source: 'error',
                observedAt: yield* timestamp,
              })}`
              yield* fact({
                projectId: running.thread.projectId,
                aggregateType: 'account_status',
                aggregateId: id,
                revision: 1,
                type: 'account_status.limited',
                payload: { agentId, accountId, resetsAt },
                actorId: instance.systemId,
              })
            }),
          )
        })

      const { activate, beforeTakingOver, busyNow, connectSession, stopRunning } = makeSessionConnections({
        accounts,
        get asideState(): SessionConnectionsDependencies['asideState'] {
          return asideState
        },
        betweenAgents,
        deliveries,
        failures,
        heardBackground,
        heardPlan,
        heardWork,
        instance,
        limits,
        live,
        permissions,
        policies,
        questions,
        quietFor,
        run,
        runtimeConfig,
        sessionFact,
        sessionsScope,
        sessionsSql,
        skillsConfig,
        stopGrace,
        stopTrees,
        threads,
        toolServer,
        treeOfLeft,
        wakeFor,
      })

      /** Start, switch and stop on one thread happen one at a time. */
      const locks = makeKeyedLock()
      const exclusive = locks.withLock

      const start = (input: {
        readonly threadId: string
        readonly agentId: string
        readonly model?: string
        readonly effort?: string
        readonly accountId?: string
        readonly recovering?: string
        /** Who it stands in for, as the session it starts again after did. */
        readonly standsIn?: StandIn
      }) =>
        exclusive(
          input.threadId,
          Effect.gen(function* () {
            const current = threads.get(input.threadId)
            if (current !== undefined) {
              // A live request may have resumed it before startup recovery took the lock. That already owns the queue.
              if (input.recovering !== undefined) return current.sessionId
              return yield* new SessionRunning({ threadId: input.threadId })
            }
            if (
              input.recovering !== undefined &&
              !(yield* recoverable).some(
                (one) => one.threadId === input.threadId && one.sessionId === input.recovering && recoveryInputs.has(one.inputId),
              )
            )
              return input.recovering
            yield* inLiveProject(input.threadId)
            yield* notAbandoned(input.threadId)
            const thread = yield* loadThread(input.threadId)
            const sql = yield* SqlClient.SqlClient
            const [recovery] =
              yield* sql`SELECT 1 FROM turn_undo_recoveries WHERE thread_id = ${input.threadId} AND state = 'prepared' LIMIT 1`
            if (recovery !== undefined)
              return yield* new SessionFailed({
                agentId: input.agentId,
                reason: 'A chat undo recovery is still prepared.',
                summary:
                  'An interrupted chat undo needs recovery. Keep or move later file edits, then retry Undo from here before starting the agent.',
              })
            const entry = yield* (yield* Agents).get(input.agentId)
            const account = yield* limits.pick({
              agentId: entry.definition.id,
              projectId: thread.projectId,
              threadId: input.threadId,
              ...accountOf(input),
              ...(input.model === undefined ? {} : { model: input.model }),
            })
            const blocked =
              input.recovering === undefined
                ? undefined
                : new Set(
                    (yield* sessionsSql<{ id: string }>`
              SELECT i.id FROM user_inputs i WHERE i.thread_id = ${input.threadId} AND i.state IN ('queued', 'noted')
                AND EXISTS (SELECT 1 FROM turn_delivery_inputs di JOIN turn_deliveries d ON d.id = di.delivery_id
                  WHERE di.user_input_id = i.id AND d.delivered_at IS NOT NULL)`).map((one) => one.id),
                  )
            // The coordinator's brief reads the project's records and its copies, and nothing of the session: it is written while
            // the agent starts, which takes longer, so the person's first words to it wait for neither twice.
            const briefing = thread.role === 'coordinator' ? yield* Effect.forkChild(briefFor(thread, { kind: 'start' })) : undefined
            const sessionId = yield* createSession(thread, entry.definition.id, account, input.model, input.standsIn).pipe(
              Effect.onError(() => (briefing === undefined ? Effect.void : Fiber.interrupt(briefing))),
            )
            const connected = yield* connectSession(thread, sessionId, entry, account, input.model, input.effort).pipe(
              Effect.onError(() => (briefing === undefined ? Effect.void : Fiber.interrupt(briefing))),
            )
            // Every session starts from a brief (ADR-005), even the first on a task.
            const brief = yield* (briefing === undefined ? briefFor(thread, { kind: 'start' }) : Fiber.join(briefing)).pipe(
              beforeTakingOver(connected),
            )
            return yield* activate(
              connected,
              {
                text: brief,
                closing: thread.role === 'reviewer' ? 'Review the change.' : 'Start on the task.',
              },
              blocked,
            )
          }),
        )

      /*
       * A message is taken back only while it waits: not once a turn has it.
       * A turn takes its input in a transaction that checks it still waits,
       * and this one checks no turn has it, so the two can't both have it.
       */
      const takeBack = (input: { readonly envelope: CommandEnvelope; readonly itemId: string }) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const commands = yield* Commands
          const [item] = yield* sql<{
            inputId: string
            projectId: ProjectId
          }>`SELECT user_input_id AS input_id, project_id FROM thread_items WHERE id = ${input.itemId} AND user_input_id IS NOT NULL`
          if (item === undefined) return yield* new NotFound({ kind: 'thread item', id: input.itemId })
          yield* commands.execute({
            envelope: input.envelope,
            projectId: item.projectId,
            result: Schema.Void,
            handle: Effect.gen(function* () {
              const [waiting] = yield* sql<{ id: string }>`
                SELECT u.id FROM user_inputs u
                WHERE u.id = ${item.inputId} AND u.state = 'queued'
                  AND NOT EXISTS (SELECT 1 FROM turn_delivery_inputs di JOIN turn_deliveries d ON d.id = di.delivery_id
                    WHERE di.user_input_id = u.id AND d.state = 'pending')`
              if (waiting === undefined) return yield* new AlreadyDelivered({ itemId: input.itemId })
              const revision = yield* change('user_inputs', item.inputId, { state: 'withdrawn' })
              yield* fact({
                projectId: item.projectId,
                aggregateType: 'user_input',
                aggregateId: item.inputId,
                revision,
                type: 'user_input.withdrawn',
                actorId: input.envelope.actorId,
                commandId: input.envelope.commandId,
              })
            }),
          })
        })

      // Always inserts `queued`. Whether the window draws that as the composer
      // queue or as sent is `placement`: delivery claims the row now, or leaves
      // it waiting behind a turn, a start, a handover, a compaction, or a place.
      const send = (input: {
        readonly envelope: CommandEnvelope
        readonly threadId: string
        readonly body: string
        readonly disposition?: Disposition
        readonly images?: ReadonlyArray<InputImage>
        readonly files?: ReadonlyArray<InputFile>
        readonly dictated?: boolean
        /** Comments on lines of the task's diff (decisions: desktop-app § Comments on the diff): the agent reads them after the words; the thread shows them beside them. */
        readonly comments?: ReadonlyArray<KeptLineComment>
        readonly canvasComments?: ReadonlyArray<SentCanvasComment>
        readonly sender?: MessageSender
        readonly origin?: 'news' | 'system'
        readonly quiet?: boolean
        readonly note?: boolean
      }) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const commands = yield* Commands
          const artifacts = yield* Artifacts
          const images = input.images ?? []
          const files = input.files ?? []
          const disposition = input.disposition ?? 'after_current'
          const undo = undoing.get(input.threadId)
          if (undo !== undefined) yield* Deferred.await(undo)
          const [thread] = yield* sql<{ projectId: ProjectId }>`SELECT project_id FROM threads WHERE id = ${input.threadId}`
          if (thread === undefined) return yield* new NotFound({ kind: 'thread', id: input.threadId })
          const accepted = yield* commands.execute({
            envelope: input.envelope,
            projectId: thread.projectId,
            result: AcceptedInput,
            handle: Effect.gen(function* () {
              // In the command's transaction, so a removal either came first or sees what was said.
              yield* inLiveProject(input.threadId)
              const inputId = yield* newId(Ids.userInput)
              const [next] = yield* sql<{
                sequence: number
              }>`SELECT coalesce(max(sequence), 0) + 1 AS sequence FROM user_inputs WHERE thread_id = ${input.threadId}`
              const sequence = next?.sequence ?? 1
              yield* sql`INSERT INTO user_inputs ${sql.insert({
                id: inputId,
                projectId: thread.projectId,
                threadId: input.threadId,
                sequence,
                commandId: input.envelope.commandId,
                disposition,
                // What the agent reads: the person's words, then their comments on the diff, each with its file, lines and code.
                body: withLineComments(input.body, input.comments ?? []),
                dictated: input.dictated === true ? 1 : 0,
                senderKind: input.quiet === true ? 'internal' : (input.sender?.kind ?? 'internal'),
                senderDeviceId: input.sender?.kind === 'paired_device' ? input.sender.deviceId : null,
                inputOrigin: input.origin ?? 'system',
                // What Althar writes quietly is its own, whoever's command it came with: the person's words are only what they say.
                authorActorId: input.quiet === true ? instance.systemId : input.envelope.actorId,
                // A note waits for the agent's next turn rather than starting one: only Althar's own, quiet words are noted.
                state: input.note === true && input.quiet === true ? 'noted' : 'queued',
                acceptedAt: yield* timestamp,
              })}`
              // Its images, in order, each an artifact the input refers to; their bytes are in the store already.
              const kept = yield* Effect.forEach(images, (image, index) =>
                Effect.gen(function* () {
                  const artifact = {
                    projectId: thread.projectId,
                    sha256: image.sha256,
                    size: image.size,
                    mediaType: image.mediaType,
                    kind: 'image' as const,
                    // A screenshot can show anything on the screen.
                    sensitivity: 'may_contain_secrets' as const,
                  }
                  const artifactId = yield* artifacts.record({ ...artifact, subject: { type: 'user_input', id: inputId, role: 'image' } })
                  yield* sql`INSERT INTO user_input_images ${sql.insert({ projectId: thread.projectId, userInputId: inputId, position: index + 1, artifactId })}`
                  return { artifact, picture: { artifactId, ...image, bytes: image.size } }
                }),
              )
              // Its comments on canvases, kept with it and nowhere before (ADR-104): until now each was only the person's draft.
              if (input.canvasComments !== undefined && input.canvasComments.length > 0)
                yield* keepComments({
                  projectId: thread.projectId,
                  threadId: input.threadId,
                  inputId,
                  actorId: input.envelope.actorId,
                  comments: input.canvasComments,
                })
              // Its files, in order, each by where its copy is; the copies are there already.
              for (const [index, file] of files.entries())
                yield* sql`INSERT INTO user_input_files ${sql.insert({
                  projectId: thread.projectId,
                  userInputId: inputId,
                  position: index + 1,
                  name: file.name,
                  kind: file.kind,
                  mediaType: file.mediaType,
                  bytes: file.bytes,
                  entries: file.entries,
                  path: file.path,
                })}`
              if (input.quiet !== true) {
                const itemId = yield* addItem(
                  { projectId: thread.projectId, threadId: input.threadId },
                  'user_message',
                  {
                    text: input.body,
                    sender: input.sender ?? { kind: 'internal' },
                    // As a picture an agent hands back is kept on its item: what it is, and its digest.
                    ...(kept.length === 0
                      ? {}
                      : {
                          pictures: kept.map(({ picture }) => ({
                            artifactId: picture.artifactId,
                            sha256: picture.sha256,
                            mediaType: picture.mediaType,
                            bytes: picture.bytes,
                            width: picture.width,
                            height: picture.height,
                            name: picture.name,
                          })),
                        }),
                    ...(files.length === 0 ? {} : { files: files.map((file, index) => ({ id: keptId(inputId, index + 1), ...file })) }),
                    ...(input.comments === undefined || input.comments.length === 0 ? {} : { comments: input.comments }),
                  },
                  { userInputId: inputId },
                )
                // The item names them too, so it is one of what refers to them.
                for (const { artifact } of kept)
                  yield* artifacts.record({ ...artifact, subject: { type: 'thread_item', id: itemId, role: 'image' } })
              }
              yield* fact({
                projectId: thread.projectId,
                aggregateType: 'user_input',
                aggregateId: inputId,
                revision: 1,
                type: disposition === 'interrupt_and_continue' ? 'user_input.interrupt_requested' : 'user_input.accepted',
                payload: {
                  disposition,
                  sequence,
                  ...(images.length === 0 ? {} : { images: images.map((image) => image.sha256) }),
                  ...(files.length === 0 ? {} : { files: files.length }),
                },
                actorId: input.envelope.actorId,
                commandId: input.envelope.commandId,
              })
              return { inputId, sequence }
            }),
          })
          const running = threads.get(input.threadId)
          if (running !== undefined && input.quiet !== true && input.envelope.actorId === instance.personId) {
            running.blockedInputs = undefined
            if (running.deliveryHeld === 'transient' || running.deliveryHeld === 'recovery') running.deliveryHeld = null
          }
          // The person's word, said now: what waits on it hears it as they send, not when a turn takes it up. Althar's own
          // words, and what other tasks' leads and the coordinator pass on, are not the person's.
          if (input.quiet !== true && (input.sender?.kind === 'window' || input.sender?.kind === 'paired_device'))
            yield* live.publish({ _tag: 'PersonSaid', threadId: input.threadId })
          return accepted
        }).pipe((effect) => inputBatches.hold(input.threadId, effect))

      const setModel = (input: { readonly threadId: string; readonly model: string }) =>
        Effect.gen(function* () {
          const running = threads.get(input.threadId)
          if (running === undefined) return yield* new NoSession({ threadId: input.threadId })
          const { definition } = running.entry
          const was = optionValue(yield* running.agent.options, definition.options.effort)
          yield* running.agent
            .setOption(definition.options.model, input.model)
            .pipe(
              Effect.mapError(
                (error) => new ModelUnchanged({ agentId: definition.id, model: input.model, summary: agentSaid(error) ?? error.message }),
              ),
            )
          // It keeps its effort where the model offers it, as most agents do by themselves; else the person's default for it, or its own.
          yield* settleEffort(definition, running.agent, was)
          const options = yield* running.agent.options
          // What the agent says it is on now, which is what the thread says too, whatever was asked for.
          const model = optionValue(options, definition.options.model) ?? input.model
          const sql = yield* SqlClient.SqlClient
          yield* sql.withTransaction(
            Effect.gen(function* () {
              const revision = yield* change('provider_sessions', running.sessionId, {
                model,
                effort: optionValue(options, definition.options.effort),
              })
              yield* sessionFact(running.thread, running.sessionId, revision, 'provider_session.model_changed', {
                model,
                ...(model === input.model ? {} : { asked: input.model }),
              })
            }),
          )
          yield* addItem({ projectId: running.thread.projectId, threadId: input.threadId, sessionId: running.sessionId }, 'notice', {
            source: 'runtime',
            severity: 'info',
            title: `Model changed to ${model}.`,
          })
        })

      const setEffort = (input: { readonly threadId: string; readonly effort: string }) =>
        Effect.gen(function* () {
          const running = threads.get(input.threadId)
          if (running === undefined) return yield* new NoSession({ threadId: input.threadId })
          const { definition } = running.entry
          const unchanged = (summary: string) => new EffortUnchanged({ agentId: definition.id, effort: input.effort, summary })
          if (definition.options.effort === undefined) return yield* unchanged('It offers no choice of effort.')
          const options = yield* running.agent
            .setOption(definition.options.effort, input.effort)
            .pipe(Effect.mapError((error) => unchanged(agentSaid(error) ?? error.message)))
          const sql = yield* SqlClient.SqlClient
          yield* sql.withTransaction(
            Effect.gen(function* () {
              const revision = yield* change('provider_sessions', running.sessionId, {
                effort: optionValue(options, definition.options.effort),
              })
              yield* sessionFact(running.thread, running.sessionId, revision, 'provider_session.effort_changed', { effort: input.effort })
            }),
          )
          const named = options
            .find((option) => option.id === definition.options.effort)
            ?.choices.find((choice) => choice.value === input.effort)
          yield* addItem({ projectId: running.thread.projectId, threadId: input.threadId, sessionId: running.sessionId }, 'notice', {
            source: 'runtime',
            severity: 'info',
            title: `Effort changed to ${(named?.name ?? input.effort).toLowerCase()}.`,
          })
        })
      const { asideState, briefFor, handoverBrief, reviewingOf, taskBrief } = makeSessionBriefs({ instance, policies, threads })

      /**
       * Hands the thread to another agent. The new agent is started first; only
       * once it is ready is the old one stopped, so a switch that fails leaves
       * the old agent working. The brief is written after the old one stops, so
       * it holds everything the old one did. What the person said with the
       * switch is queued once the old one has stopped, so it is the new one's
       * first turn, after the brief, and never the old one's.
       */
      /**
       * Who a session Althar hands the thread to, for a usage limit or a step gone without its report, stands in for: the lead
       * the previous one stood in for, where it did, on the same terms; else the previous one itself, as it ran, until its
       * reset or the end of the step it failed (`attemptId`). None where it is the same lead again (started afresh, or on
       * another of its accounts) or the one it stood in for taking the thread back.
       */
      const standInFor = (
        previous: Running,
        projectId: string,
        agentId: string,
        model: string | undefined,
        why: 'limit' | 'stall',
        attemptId: string | undefined,
      ) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [was] = yield* sql<{ model: string | null; effort: string | null }>`
            SELECT model, effort FROM provider_sessions WHERE id = ${previous.sessionId}`
          const kept = Option.getOrUndefined(yield* standInOf(previous.sessionId))
          const given = kept ?? {
            agentId: previous.entry.definition.id,
            model: was?.model ?? null,
            effort: was?.effort ?? null,
            accountId: previous.account.id,
          }
          if (given.agentId === agentId && (model === undefined || model === given.model)) return undefined
          if (kept !== undefined) return kept
          if (why === 'stall') return { ...given, until: null, why, ...(attemptId === undefined ? {} : { attemptId }) } satisfies StandIn
          const out = yield* given.accountId === null ? limits.out(given.agentId, projectId) : limits.outAccount(given.accountId)
          if (Option.isSome(out)) return { ...given, until: out.value.until } satisfies StandIn
          // Handed on while only nearly out, it isn't out at all: it is back once its window resets, not at once.
          const low = yield* limits.nearlyOut(given.agentId, projectId, given.model ?? undefined)
          const until =
            Option.getOrUndefined(low)?.resetsAt ??
            new Date((yield* Clock.currentTimeMillis) + Duration.toMillis(Duration.hours(1))).toISOString()
          return { ...given, until, why: 'low' } satisfies StandIn
        })

      /** Whether the lead a session stands in for is back: its usage again, or the step it failed over (standIn.ts). */
      const backFrom = (standsIn: StandIn, projectId: string) =>
        isBack(standsIn, (one) => (one.accountId === null ? limits.out(one.agentId, projectId) : limits.outAccount(one.accountId)))

      const switchAgent = (input: {
        readonly threadId: string
        readonly agentId: string
        readonly model?: string
        readonly effort?: string
        readonly said?: string
        readonly about?: 'limit' | 'stall'
        readonly attemptId?: string
        readonly accountId?: string
        readonly message?: {
          readonly envelope: CommandEnvelope
          readonly body: string
          readonly images?: ReadonlyArray<InputImage>
          readonly files?: ReadonlyArray<InputFile>
          readonly dictated?: boolean
          readonly comments?: ReadonlyArray<KeptLineComment>
          readonly sender?: MessageSender
          readonly origin?: 'news' | 'system'
        }
        readonly byPerson?: boolean
      }) =>
        exclusive(
          input.threadId,
          Effect.gen(function* () {
            yield* notAbandoned(input.threadId)
            const thread = yield* loadThread(input.threadId)
            const entry = yield* (yield* Agents).get(input.agentId)
            const previous = threads.get(input.threadId)
            const from = previous?.entry.definition.name
            const previousHandover = previous?.handover
            const account = yield* limits.pick({
              agentId: entry.definition.id,
              projectId: thread.projectId,
              threadId: input.threadId,
              ...accountOf(input),
              ...(input.model === undefined ? {} : { model: input.model }),
            })
            // Another agent or model takes the thread, not the same one on another of its accounts: always said in the window.
            const [was] =
              previous === undefined
                ? []
                : yield* (yield* SqlClient.SqlClient)<{ model: string | null }>`
                    SELECT model FROM provider_sessions WHERE id = ${previous.sessionId}`
            const moved =
              previous === undefined ||
              previous.entry.definition.id !== entry.definition.id ||
              (input.model !== undefined && input.model !== was?.model)
            // A usage limit or a failed step hands the lead on for a while: the new one stands in for the lead the task was given,
            // which takes it back. Chosen (no `about`), it leads as chosen.
            const standsIn =
              input.about !== undefined && previous !== undefined
                ? yield* standInFor(previous, thread.projectId, entry.definition.id, input.model, input.about, input.attemptId)
                : undefined
            // Starting a replacement can take arbitrarily long. Future input belongs to it from here, while the old turn may finish.
            if (previous !== undefined) previous.handover = 'under_way'
            return yield* Effect.gen(function* () {
              const sessionId = yield* createSession(thread, entry.definition.id, account, input.model, standsIn)
              const connected = yield* connectSession(thread, sessionId, entry, account, input.model, input.effort)
              const brief = yield* Effect.gen(function* () {
                if (previous !== undefined) yield* stopRunning(previous, { state: 'superseded', by: sessionId })
                yield* addItem({ projectId: thread.projectId, threadId: thread.threadId, sessionId }, 'notice', {
                  source: 'runtime',
                  severity: 'info',
                  title:
                    input.said ??
                    (from === undefined ? `${entry.definition.name} takes over.` : `Switched from ${from} to ${entry.definition.name}.`),
                  // Another model takes the thread: always shown, whatever made the switch (never a silent one).
                  ...(input.about === undefined ? {} : { about: input.about, ...(moved ? { handover: true } : {}) }),
                })
                if (input.message !== undefined)
                  yield* send({
                    envelope: input.message.envelope,
                    threadId: input.threadId,
                    body: input.message.body,
                    ...(input.message.images === undefined ? {} : { images: input.message.images }),
                    ...(input.message.files === undefined ? {} : { files: input.message.files }),
                    ...(input.message.dictated === true ? { dictated: true } : {}),
                    ...(input.message.comments === undefined ? {} : { comments: input.message.comments }),
                  })
                return yield* briefFor(thread, { kind: 'takeover', from })
              }).pipe(beforeTakingOver(connected))
              return yield* activate(
                connected,
                {
                  text: brief,
                  closing: 'Carry on with the task from where it stands.',
                  ...(input.byPerson === true ? { byPerson: true } : {}),
                },
                input.byPerson === true ? undefined : previous?.blockedInputs,
              )
            }).pipe(
              Effect.onError(() =>
                Effect.suspend(() => {
                  if (previous === undefined || threads.get(input.threadId) !== previous || previous.stopping) return Effect.void
                  previous.handover = previousHandover ?? 'none'
                  return Effect.asVoid(Queue.offer(previous.wake, undefined))
                }),
              ),
            )
          }),
        )

      /**
       * Hands a coordinator's conversation, or a task lead's work, to a fresh
       * session once its context is filling up, or for a lead, at a break in
       * its work (ADR-031, ADR-038): the same agent, account, model and
       * effort, briefed from Althar's records. It starts between turns: the
       * old session takes no more, and what the person says meanwhile waits
       * for the new one. The new session is started before the old one stops,
       * so a handover that fails leaves the old one carrying on, its agent
       * compacting its context itself as before.
       *
       * `lost`, what the agent said when it no longer had the session, as
       * Claude Code's adapter drops one whose process died: it can't carry
       * on, so it is handed over whatever its context, and a handover that
       * fails, or a reviewer's, which isn't handed over, stops it, so Try again
       * starts a fresh one.
       */
      const handOver = (previous: Running, lost?: string, moved = false): Effect.Effect<void, never, Store> =>
        exclusive(
          previous.thread.threadId,
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient
            // Stopped or switched while it waited: nothing is left to hand over.
            if (threads.get(previous.thread.threadId) !== previous || previous.stopping) return
            if (previous.thread.role === 'reviewer') {
              if (lost !== undefined) yield* cannotCarryOn(previous, lost)
              return
            }
            // A lead's task as it is now, not as its session found it: it may have a branch, a pull request or a new name since.
            const thread = previous.thread.role === 'task' ? yield* loadThread(previous.thread.threadId) : previous.thread
            // Something it left running since it was due would stop with it: it carries on as it is, and is looked at again.
            if (
              lost === undefined &&
              !moved &&
              thread.role === 'task' &&
              [...previous.background.values()].some((left) => left.ended === null)
            ) {
              previous.handover = 'none'
              return yield* Queue.offer(previous.wake, undefined)
            }
            const [session] = yield* sql<{ model: string | null; effort: string | null }>`
              SELECT model, effort FROM provider_sessions WHERE id = ${previous.sessionId}`
            const model = session?.model ?? undefined
            const effort = session?.effort ?? undefined
            // Written first: the old session takes no more turns, so the record already holds everything it did.
            const brief =
              thread.role === 'coordinator'
                ? yield* handoverBrief(thread)
                : { text: yield* briefFor(thread, { kind: 'handover', ...(lost === undefined ? {} : { lost: true }) }), open: null }
            // A brief that would fill a fresh session as far would only be due again, and a lead's that saves little isn't
            // worth its thread of thought: the old one carries on as it is. A lost one can't.
            // Its folder moved, it can't carry on where it is: it is handed over whatever its context.
            if (
              lost === undefined &&
              !moved &&
              (!roomFor(brief.text, previous.context) || (thread.role === 'task' && !shrinks(brief.text, previous.context)))
            ) {
              yield* Effect.logWarning(
                `The ${thread.role === 'task' ? 'lead' : 'coordinator'} is left to compact by itself: its brief would fill a fresh session`,
              )
              previous.handover = 'left'
              return yield* Queue.offer(previous.wake, undefined)
            }
            // Started afresh, a stand-in still stands in for the lead it was given.
            const standsIn = Option.getOrUndefined(yield* standInOf(previous.sessionId))
            const sessionId = yield* createSession(thread, previous.entry.definition.id, previous.account, model, standsIn)
            const connected = yield* connectSession(thread, sessionId, previous.entry, previous.account, model, effort)
            yield* Effect.andThen(
              stopRunning(previous, { state: 'superseded', by: sessionId }),
              addItem({ projectId: thread.projectId, threadId: thread.threadId, sessionId }, 'notice', {
                source: 'runtime',
                severity: 'info',
                title:
                  lost !== undefined
                    ? startedAfreshWords(previous.entry.definition.name)
                    : moved
                      ? `Started ${previous.entry.definition.name} afresh in its new folder.`
                      : brief.open === null
                        ? `Started ${previous.entry.definition.name} afresh.`
                        : 'Started a fresh session.',
              }),
            ).pipe(beforeTakingOver(connected))
            yield* activate(
              connected,
              {
                text: brief.text,
                closing:
                  thread.role === 'coordinator'
                    ? 'Carry the conversation on from where it stands.'
                    : 'Carry on with the task from where it stands.',
                starting: 'handover',
              },
              previous.blockedInputs,
            )
          }),
        ).pipe(
          Effect.catchCause((cause) =>
            Effect.andThen(
              Effect.logWarning('Could not hand a session to a fresh one', cause),
              Effect.suspend(() => {
                if (threads.get(previous.thread.threadId) !== previous) return Effect.void
                // Lost, it can't carry on: it stops, and the person is told.
                if (lost !== undefined) return exclusive(previous.thread.threadId, cannotCarryOn(previous, lost))
                // It carries on as it is, with what waited for it.
                previous.handover = 'left'
                return Queue.offer(previous.wake, undefined)
              }),
            ),
          ),
        )

      /**
       * A lost session that isn't started afresh: the turn's failure, said
       * plainly with the agent's own words under it, and the session
       * stopped, so Try again starts a fresh one rather than send to it again.
       */
      const cannotCarryOn = (previous: Running, said: string) =>
        Effect.gen(function* () {
          const { thread } = previous
          const name = previous.entry.definition.name
          yield* addItem({ projectId: thread.projectId, threadId: thread.threadId, sessionId: previous.sessionId }, 'notice', {
            source: 'agent',
            severity: 'error',
            title: lostWords(name),
            ...(said === '' ? {} : { description: said }),
            failure: 'session_lost',
          })
          yield* stopRunning(previous, { state: 'completed', reason: 'settled' })
        }).pipe(Effect.catchCause((cause) => Effect.logWarning('Could not stop a lost session', cause)))

      // Quitting stops every session the way `stop` does: the turn ends, the process stops, and both are recorded.
      yield* Effect.addFinalizer(() =>
        Effect.forEach(
          [...threads.values()],
          (running) =>
            Effect.ignore(stopRunning(running, { state: 'completed', reason: 'shutdown' }).pipe(Effect.timeout(Duration.seconds(15)))),
          {
            concurrency: 'unbounded',
            discard: true,
          },
        ),
      )

      const startLast = (threadId: string, recovering?: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [last] = yield* sql<{
            id: string
            projectId: ProjectId
            agentId: string
            accountId: string | null
            model: string | null
            effort: string | null
            startedAt: string
          }>`
            SELECT s.id, s.project_id, s.agent_id, s.account_id, s.model, s.effort, s.started_at FROM provider_sessions s
            WHERE s.thread_id = ${threadId}
            ORDER BY (SELECT max(f.sequence) FROM record_events f WHERE f.aggregate_type = 'provider_session' AND f.aggregate_id = s.id) DESC,
              s.started_at DESC, s.rowid DESC LIMIT 1`
          if (last === undefined) return false
          // Start on the same effective team every view shows, including a pick made after a prior change to its plan.
          const [changed] = yield* sql<{ at: string | null; agentId: string | null; model: string | null; effort: string | null }>`
            SELECT coalesce(json_extract(p.parameters, '$.leadChanged'), p.proposed_at) AS at, json_extract(s.value, '$.agentId') AS agent_id,
              json_extract(s.value, '$.model') AS model, json_extract(s.value, '$.effort') AS effort
            FROM threads t JOIN task_plans p ON p.task_id = t.task_id AND p.state IN ('proposed', 'accepted'),
              json_each(p.parameters, '$.steps') s
            WHERE t.id = ${threadId} AND t.kind = 'task' AND json_extract(s.value, '$.key') = 'implement'
            ORDER BY p.proposed_at DESC LIMIT 1`
          const on =
            changed?.agentId == null
              ? last
              : yield* teamLeadOf(
                  threadId,
                  {
                    key: 'implement',
                    agentId: changed.agentId,
                    model: changed.model,
                    ...(changed.effort === null ? {} : { effort: changed.effort }),
                    skipped: false,
                  },
                  changed.at,
                  threads.get(threadId),
                )
          // The last lead stood in for the one a usage limit stopped (standIn.ts): that one leads again where it has usage again,
          // after a stop or a restart too; else the stand-in carries on standing in.
          const standing =
            on.agentId === last.agentId && on.model === last.model ? Option.getOrUndefined(yield* standInOf(last.id)) : undefined
          // Queued back by `giveBack` before the stop, it is still standing in: the given lead starts, as it would have.
          if (standing !== undefined && (yield* backFrom(standing, last.projectId))) {
            yield* start({
              threadId,
              agentId: standing.agentId,
              ...(recovering === undefined ? {} : { recovering }),
              ...(standing.model === null ? {} : { model: standing.model }),
              ...(standing.effort === null ? {} : { effort: standing.effort }),
            })
            yield* addItem({ projectId: last.projectId, threadId }, 'notice', {
              source: 'runtime',
              severity: 'info',
              title: backWords({
                given: yield* limits.named(standing.agentId, standing.model, standing.accountId),
                standIn: yield* limits.named(last.agentId, last.model, last.accountId),
                ...(standing.why === undefined ? {} : { why: standing.why }),
              }),
              about: standing.why === 'stall' ? 'stall' : 'limit',
              handover: true,
            })
            return true
          }
          yield* start({
            threadId,
            agentId: on.agentId,
            ...(recovering === undefined ? {} : { recovering }),
            ...(on.model === null ? {} : { model: on.model }),
            ...(on.effort == null ? {} : { effort: on.effort }),
            ...(standing === undefined ? {} : { standsIn: standing }),
          })
          return true
        })

      let recovering = false
      const recoverQueued = Effect.suspend(() => {
        if (recovering) return Effect.void
        recovering = true
        return Effect.asVoid(
          Effect.forkIn(
            Effect.forEach(
              [...new Map(recovery.map((one) => [one.threadId, one])).values()],
              (one) =>
                run(startLast(one.threadId, one.sessionId)).pipe(
                  Effect.catchCause((cause) =>
                    Effect.andThen(
                      Effect.logWarning('Could not resume queued input after restart', cause),
                      run(
                        addItem({ projectId: one.projectId, threadId: one.threadId }, 'notice', {
                          source: 'runtime',
                          severity: 'error',
                          title: 'The waiting message could not resume.',
                          description: 'Start the agent again to carry on. Your message is still queued.',
                        }),
                      ).pipe(Effect.ignore),
                    ),
                  ),
                ),
              { discard: true },
            ),
            sessionsScope,
          ),
        )
      })

      const retryOf = (threadId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [last] = yield* sql<{ id: string; state: string; projectId: ProjectId }>`
            SELECT d.id, d.state, t.project_id FROM turn_deliveries d JOIN threads t ON t.id = d.thread_id
            WHERE d.thread_id = ${threadId} ORDER BY d.requested_at DESC, d.rowid DESC LIMIT 1`
          const [session] = yield* sql<{ id: string; state: string }>`
            SELECT id, state FROM provider_sessions WHERE thread_id = ${threadId} ORDER BY started_at DESC, rowid DESC LIMIT 1`
          const running = threads.get(threadId)
          const ready =
            session !== undefined &&
            session.state !== 'starting' &&
            !running?.stopping &&
            !running?.turnRunning &&
            last?.state !== 'pending' &&
            last?.state !== 'delivered'
          return { last, retryable: ready && (last?.state === 'failed' || running === undefined || running.deliveryHeld === 'recovery') }
        })

      const tryAgain = (threadId: string) =>
        Effect.gen(function* () {
          const { last, retryable } = yield* retryOf(threadId)
          if (!retryable) return false
          const previous = threads.get(threadId)
          if (previous?.deliveryHeld === 'recovery') {
            previous.blockedInputs = undefined
            previous.deliveryHeld = null
            yield* Queue.offer(previous.wake, undefined)
            return true
          }
          // A lost idle session, including an error kept by an older version: start afresh from the thread's record.
          if (last?.state !== 'failed') return yield* startLast(threadId)
          const sql = yield* SqlClient.SqlClient
          // Its input, including news, unless it waits already, as after a usage limit or a lost connection.
          const said = yield* sql<{ id: string }>`
            SELECT i.id FROM turn_delivery_inputs di JOIN user_inputs i ON i.id = di.user_input_id
            WHERE di.delivery_id = ${last.id} AND i.state NOT IN ('queued', 'withdrawn')`
          yield* sql.withTransaction(
            Effect.forEach(
              said,
              (input) =>
                Effect.gen(function* () {
                  const revision = yield* change('user_inputs', input.id, { state: 'queued' })
                  yield* fact({
                    projectId: last.projectId,
                    aggregateType: 'user_input',
                    aggregateId: input.id,
                    revision,
                    type: 'user_input.requeued',
                    actorId: instance.personId,
                  })
                }),
              { discard: true },
            ),
          )
          const running = threads.get(threadId)
          if (running !== undefined && !running.stopping) {
            running.blockedInputs = undefined
            running.deliveryHeld = null
            if (running.retryBrief !== undefined) running.brief = running.retryBrief
            yield* Queue.offer(running.wake, undefined)
          } else return yield* startLast(threadId)
          return true
        })

      return Sessions.of({
        recoverQueued,
        start: (input) => run(start(input)),
        startLast: (threadId) => run(startLast(threadId)),
        tryAgain: (threadId) => run(tryAgain(threadId)),
        retryable: (threadId) => run(Effect.map(retryOf(threadId), (retry) => retry.retryable)),
        accepting: inputBatches.accepting,
        placement: (threadId) => run(placement(threadId)),
        send: (input) => run(send(input)),
        noteQueued: (threadId) =>
          run(
            Effect.gen(function* () {
              const sql = yield* SqlClient.SqlClient
              const [thread] = yield* sql<{ projectId: ProjectId }>`SELECT project_id FROM threads WHERE id = ${threadId}`
              if (thread === undefined) return 0
              const waiting = yield* sql<{ id: string }>`
                SELECT i.id FROM user_inputs i JOIN actors a ON a.id = i.author_actor_id
                WHERE i.thread_id = ${threadId} AND i.state = 'queued' AND a.kind <> 'person' AND i.body <> ${COMPACT}`
              yield* sql.withTransaction(
                Effect.forEach(
                  waiting,
                  (input) =>
                    Effect.gen(function* () {
                      const revision = yield* change('user_inputs', input.id, { state: 'noted' })
                      yield* fact({
                        projectId: thread.projectId,
                        aggregateType: 'user_input',
                        aggregateId: input.id,
                        revision,
                        type: 'user_input.noted',
                        actorId: instance.systemId,
                      })
                    }),
                  { discard: true },
                ),
              )
              return waiting.length
            }),
          ),
        compact: (input) =>
          run(
            Effect.gen(function* () {
              if (!threads.has(input.threadId)) return yield* new NotFound({ kind: 'agent on the thread', id: input.threadId })
              yield* send({ envelope: input.envelope, threadId: input.threadId, body: COMPACT, disposition: 'after_current', quiet: true })
            }),
          ),
        forget: (input) =>
          run(
            exclusive(
              input.threadId,
              Effect.gen(function* () {
                // Only a project's coordinator forgets: a task's lead is stopped by Stop, not by this.
                yield* coordinatorRow(input.threadId)
                const running = threads.get(input.threadId)
                if (running !== undefined) yield* stopRunning(running, { state: 'completed', reason: 'stopped' })
                yield* forgetItems({ envelope: input.envelope, threadId: input.threadId, ended: running !== undefined })
              }),
            ),
          ),
        takeBack: (input) => run(takeBack(input)),
        undoTurn: (input) =>
          run(
            Effect.gen(function* () {
              const sql = yield* SqlClient.SqlClient
              const [item] = yield* sql<{ threadId: string }>`SELECT thread_id FROM thread_items WHERE id = ${input.itemId}`
              if (item === undefined) return yield* new NotFound({ kind: 'message', id: input.itemId })
              return yield* exclusive(
                item.threadId,
                Effect.gen(function* () {
                  const [receipt] =
                    yield* sql`SELECT 1 FROM command_receipts WHERE actor_id = ${input.envelope.actorId} AND command_id = ${input.envelope.commandId}`
                  if (receipt !== undefined) return yield* undoConversation(input)
                  const target = yield* undoTarget(input.itemId)
                  yield* canUndoTask(target.taskId, target.threadId)
                  const running = threads.get(item.threadId)
                  if (running !== undefined && (running.turnRunning || running.background.size > 0 || running.callsOpen.size > 0))
                    return yield* new UndoRefused({ message: 'Stop the agent and its background commands before undoing.', files: [] })
                  const gate = yield* Deferred.make<void>()
                  undoing.set(item.threadId, gate)
                  return yield* Effect.gen(function* () {
                    if (running !== undefined) yield* stopRunning(running, { state: 'completed', reason: 'stopped' })
                    yield* recoverTurnUndo(item.threadId)
                    return yield* undoConversation(input)
                  }).pipe(
                    Effect.ensuring(
                      Effect.andThen(
                        Effect.sync(() => undoing.delete(item.threadId)),
                        Deferred.succeed(gate, undefined),
                      ),
                    ),
                  )
                }),
              )
            }),
          ),
        setModel: (input) => run(setModel(input)),
        setEffort: (input) => run(setEffort(input)),
        chooseLead: (input) =>
          run(
            Effect.gen(function* () {
              const running = threads.get(input.threadId)
              if (running === undefined || running.stopping) return yield* new NoSession({ threadId: input.threadId })
              const sql = yield* SqlClient.SqlClient
              const result = yield* sql.withTransaction(
                Effect.gen(function* () {
                  const [now] = yield* sql<{ model: string | null; effort: string | null }>`
                SELECT model, effort FROM provider_sessions WHERE id = ${running.sessionId}`
                  const agentId = running.entry.definition.id
                  // What was chosen before and isn't set yet stands, but for what is chosen now.
                  const before = running.nextLead?.agentId === agentId ? running.nextLead : undefined
                  const model = input.model ?? before?.model
                  const effort = input.effort ?? before?.effort
                  const same = (model === undefined || model === now?.model) && (effort === undefined || effort === now?.effort)
                  // Back on what it is on, with nothing being set: nothing is left to take up. While one is being set it is kept, so it
                  // is set back after.
                  const next =
                    same && !running.settingLead
                      ? undefined
                      : {
                          agentId,
                          ...(model === undefined ? {} : { model }),
                          ...(effort === undefined ? {} : { effort }),
                        }
                  if (
                    !(yield* setLeadChoice(running, next, {
                      choice: {
                        agentId,
                        model: model ?? now?.model ?? null,
                        effort: effort ?? now?.effort ?? null,
                      },
                    }))
                  )
                    return yield* new NoSession({ threadId: input.threadId })
                  return same ? ('same' as const) : ('later' as const)
                }),
              )
              if (running.nextLead !== undefined) yield* Effect.forkIn(run(applyLead(running)), sessionsScope)
              return result
            }),
          ),
        wake: (threadId) =>
          Effect.suspend(() => {
            const running = threads.get(threadId)
            if (running === undefined) return Effect.void
            if (running.deliveryHeld === 'transient') running.deliveryHeld = null
            return Queue.offer(running.wake, undefined).pipe(Effect.asVoid)
          }),
        changeLead: (input) =>
          run(
            Effect.gen(function* () {
              const running = threads.get(input.threadId)
              if (running === undefined || running.stopping) return 'none' as const
              const sql = yield* SqlClient.SqlClient
              return yield* sql.withTransaction(
                Effect.gen(function* () {
                  const [now] = yield* sql<{ model: string | null; effort: string | null }>`
                SELECT model, effort FROM provider_sessions WHERE id = ${running.sessionId}`
                  const same =
                    running.entry.definition.id === input.agentId &&
                    (input.model === undefined || input.model === now?.model) &&
                    (input.effort === undefined || input.effort === now?.effort)
                  const next = same
                    ? undefined
                    : {
                        agentId: input.agentId,
                        ...(input.model === undefined ? {} : { model: input.model }),
                        ...(input.effort === undefined ? {} : { effort: input.effort }),
                      }
                  const sameAgent = running.entry.definition.id === input.agentId
                  if (
                    !(yield* setLeadChoice(running, next, {
                      choice: {
                        agentId: input.agentId,
                        model: input.model ?? (sameAgent ? (now?.model ?? null) : null),
                        effort: input.effort ?? (sameAgent ? (now?.effort ?? null) : null),
                      },
                    }))
                  )
                    return 'none' as const
                  return same ? ('same' as const) : ('later' as const)
                }),
              )
            }).pipe(Effect.orDie),
          ),
        giveBack: (input) =>
          run(
            Effect.gen(function* () {
              const running = threads.get(input.threadId)
              if (running === undefined) return false
              const sql = yield* SqlClient.SqlClient
              // One transaction: the stand-in still the lead, still standing in, and nothing chosen for it since, as the lead given
              // back is queued; a choice made meanwhile (chooseLead, changeLead) is never overwritten. No `choice` is recorded, so
              // the stand-in stays one until the given lead has started (`takeOver`), and a stop or restart before still gives it back.
              const queued = yield* sql.withTransaction(
                Effect.gen(function* () {
                  if (running.stopping || running.sessionId !== input.sessionId || running.handover !== 'none') return undefined
                  if (threads.get(input.threadId) !== running || running.nextLead !== undefined) return undefined
                  const standsIn = Option.getOrUndefined(yield* standInOf(input.sessionId))
                  if (standsIn === undefined) return undefined
                  const next = {
                    agentId: standsIn.agentId,
                    ...(standsIn.model === null ? {} : { model: standsIn.model }),
                    ...(standsIn.effort === null ? {} : { effort: standsIn.effort }),
                  }
                  return (yield* setLeadChoice(running, next, { onlyIfEmpty: true })) ? standsIn : undefined
                }),
              )
              if (queued === undefined) return false
              // The same agent on its own model again is set between turns, with no hand-over to say it: said here.
              if (queued.agentId === running.entry.definition.id) {
                const said = yield* backSaid(queued, running)
                if (said !== undefined)
                  yield* addItem({ projectId: running.thread.projectId, threadId: input.threadId }, 'notice', {
                    source: 'runtime',
                    severity: 'info',
                    title: said,
                    about: queued.why === 'stall' ? 'stall' : 'limit',
                    handover: true,
                  })
                yield* Effect.forkIn(run(applyLead(running)), sessionsScope)
              }
              return true
            }).pipe(Effect.catchCause((cause) => Effect.as(Effect.logWarning('Could not give a lead back', cause), false))),
          ),
        switchAgent: (input) => run(switchAgent(input)),
        moved: (threadId) =>
          Effect.sync(() => {
            const running = threads.get(threadId)
            if (running !== undefined) running.moved = true
          }),
        interrupt: (threadId, by, background = false) =>
          Effect.suspend(() => {
            const running = threads.get(threadId)
            if (running === undefined) return Effect.fail(new NoSession({ threadId }))
            // The person's stop, of a turn running: its end says so in the thread.
            if (by === 'person' && running.turnRunning) running.stoppedByPerson = true
            // Asked to stop before the prompt has reached the agent, there is nothing to cancel yet: the agent would take
            // the stop for the turn before this one, or lose it, while its prompt goes on. Wait until it has the prompt.
            const sent = running.promptSent
            const wasRunning = running.turnRunning
            const cancel = (sent === null ? Effect.void : Deferred.await(sent)).pipe(
              // A stop never waits longer than a turn's start would: a prompt that never went out has nothing to cancel.
              Effect.timeoutOption(Duration.seconds(5)),
              Effect.flatMap((ready) =>
                Effect.suspend(() =>
                  Option.isSome(ready) &&
                  threads.get(threadId) === running &&
                  running.promptSent === sent &&
                  running.turnRunning === wasRunning
                    ? Effect.ignore(running.agent.interrupt)
                    : Effect.void,
                ),
              ),
            )
            return background ? Effect.asVoid(Effect.forkIn(cancel, running.scope)) : cancel
          }),
        stop: (threadId) =>
          exclusive(
            threadId,
            Effect.suspend(() => {
              // A stop also cancels startup recovery that has not yet acquired this thread's lock.
              for (const one of recovery) if (one.threadId === threadId) recoveryInputs.delete(one.inputId)
              const running = threads.get(threadId)
              return running === undefined
                ? Effect.fail(new NoSession({ threadId }))
                : stopRunning(running, { state: 'completed', reason: 'stopped' })
            }),
          ),
        quiet: (threadId, effect) =>
          exclusive(
            threadId,
            Effect.suspend(() => (threads.has(threadId) ? Effect.succeed(null) : effect)),
          ),
        running: (threadId) =>
          Effect.sync(() => {
            const running = threads.get(threadId)
            return running === undefined
              ? Option.none()
              : Option.some({
                  sessionId: running.sessionId,
                  agentId: running.entry.definition.id,
                  accountId: running.account.id,
                  turnRunning: running.turnRunning,
                  turnStartedAt: running.turnRunning ? running.turnStartedAt : null,
                  turnEndedAt: running.turnEndedAt,
                  pid: running.connection.process?.pid ?? null,
                  context: running.context,
                  stopping: running.stopping,
                  background: [...running.background.values()].map(shownOf),
                  ...(running.nextLead === undefined ? {} : { nextLead: running.nextLead }),
                  ...(running.deliveryHeld === 'usage_limit' && running.usageOut !== undefined ? { usageOut: running.usageOut } : {}),
                })
          }),
        askPermission: (threadId, request) =>
          Effect.suspend(() => {
            const running = threads.get(threadId)
            return running === undefined ? Effect.fail(new NoSession({ threadId })) : permissions.decide(running.requestContext, request)
          }),
        stopBackground: (threadId, id) =>
          Effect.gen(function* () {
            const running = threads.get(threadId)
            const left = running?.background.get(id)
            if (running === undefined || left === undefined) return
            // Ended by itself, there is nothing to stop. Gone already as the agent tells it, it goes from the list all the same.
            // Stopped through the agent, which ends its shell only: what the shell started is stopped after it (stopping.ts).
            if (left.ended === null) {
              const tree = yield* treeOfLeft(running, left)
              yield* running.agent.stopBackground(id).pipe(Effect.ensuring(stopTrees(running, [tree])))
            }
            running.background.delete(id)
            yield* toldBackground(running)
          }),
        clearBackground: (threadId, id) =>
          Effect.gen(function* () {
            const running = threads.get(threadId)
            if (running === undefined || running.background.get(id)?.ended == null) return
            running.background.delete(id)
            yield* toldBackground(running)
          }),
        backgroundOutput: (threadId, id) =>
          Effect.gen(function* () {
            const left = threads.get(threadId)?.background.get(id)
            if (left === undefined) return yield* Effect.fail(new NotFound({ kind: 'background command', id }))
            return { text: uncoloured(yield* printedBy(left)), dropped: 0 }
          }),
        outputSoFar: (threadId, itemId) => Effect.sync(() => Option.fromNullishOr(threads.get(threadId)?.recording?.outputOf(itemId))),
        busy: (threadId) => busyNow(threadId),
        untilIdle: (threadId, within) =>
          Effect.gen(function* () {
            const give = Duration.toMillis(within)
            const began = yield* Clock.currentTimeMillis
            // In memory, and only while a round waits on it: looked at often enough that a short quiet is noticed.
            const every = Duration.min(IDLE_EVERY, quietFor)
            for (;;) {
              if (!threads.has(threadId)) return 'gone' as const
              if (!(yield* busyNow(threadId))) return 'idle' as const
              if ((yield* Clock.currentTimeMillis) - began >= give) return 'late' as const
              yield* Effect.sleep(every)
            }
          }),
        gateTurns: (next) =>
          Effect.sync(() => {
            gate = next
          }),
        onLeadTurn: (next) =>
          Effect.sync(() => {
            leadTurn = next
          }),
        onPersonsTurn: (next) =>
          Effect.sync(() => {
            personsTurn = next
          }),
        onTasks: Effect.sync(() =>
          [...threads.values()].flatMap((running) =>
            running.thread.role === 'coordinator'
              ? []
              : [
                  {
                    sessionId: running.sessionId,
                    threadId: running.thread.threadId,
                    taskId: running.thread.taskId,
                    reviewer: running.thread.role === 'reviewer',
                    helper: running.thread.role === 'task' && running.thread.helper !== undefined,
                    turnRunning: running.turnRunning,
                    acceptingTurns: !running.stopping && running.handover !== 'under_way' && running.deliveryHeld === null,
                    background: [...running.background.values()].some((left) => left.ended === null),
                    pid: running.connection.process?.pid ?? null,
                  },
                ],
          ),
        ),
      })
    }),
  )
}
