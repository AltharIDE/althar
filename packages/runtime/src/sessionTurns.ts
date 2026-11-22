import type { PromptFile } from '@althar/provider-adapters'
import { Ids, newId } from '@althar/domain'
import { type Ledger, type RevisionConflict, type RowNotFound, bumpRevision } from '@althar/persistence-sqlite'
import type { SessionEvent } from '@althar/provider-adapters'
import { Cause, Clock, type Crypto, Deferred, Duration, Effect, Exit, Fiber, Option, Queue, type Schema, type Scope, Stream } from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'
import { acceptingOf } from './admission'
import type { Artifacts } from './Artifacts'
import { touchCard, touchTask } from './cards'
import { COMPACT, contextFull } from './compact'
import { Agents, type RuntimeConfig } from './Config'
import { coordinatorFolder } from './coordinatorFolder'
import { coordinatorNews, modelNamer } from './coordinatorNews'
import type { GitFailed, NoSession, NotFound, TaskRefused } from './errors'
import { contained } from './Failures'
import { git } from './git'
import type { makeInputBatches } from './inputBatches'
import type { Instance, InstanceInfo } from './Instance'
import type { Limits } from './Limits'
import type { Live } from './Live'
import { timeAgain, timeAgainLine, timeLine } from './localTime'
import { change, fact, timestamp } from './records'
import { filesForTurn } from './sentFiles'
import {
  COPIES_FRESH,
  INTERRUPTED,
  type Running,
  STREAM_EVERY,
  type Store,
  TakenBack,
  type TaskThread,
  type ThreadContext,
  type Why,
  asTold,
  automaticCompactionDue,
  compactedSpan,
  compactedWords,
  errorClassOf,
  foldersOf,
  heardContext,
  markCompacted,
  promptFor,
  sentWithWords,
} from './sessionState'
import type { Setups } from './Setups'
import { addItem, recorder } from './threads'
import { endGoalRound, goalBrief, runnableGoal, startGoalRound } from './threadGoals'
import { toolClock } from './turnTimes'
import { checkpointAfterTurn, checkpointBeforeTurn } from './turnUndo'

export interface SessionTurnsDependencies {
  readonly accountLimited: (
    running: Running,
    resetsAt: string | undefined,
  ) => Effect.Effect<void, SqlError.SqlError | Schema.SchemaError, SqlClient.SqlClient | Ledger | Crypto.Crypto>
  readonly applyLead: (running: Running) => Effect.Effect<void, never, Store>
  readonly asideState: (
    taskId: string,
  ) => Effect.Effect<{ aside: boolean; brought: boolean; unsaid: boolean }, SqlError.SqlError, SqlClient.SqlClient>
  readonly betweenAgents: Duration.Duration
  readonly changeHeads: (
    threadId: string,
  ) => Effect.Effect<{ head: string; name: string; own: string | null; path: string }[] | undefined, never, SqlClient.SqlClient>
  readonly afterCompaction: (thread: ThreadContext) => Effect.Effect<string | null, SqlError.SqlError, Store>
  readonly gate: (
    _agent: {
      readonly taskId: string
      readonly threadId: string
      readonly sessionId: string
      readonly review: boolean
      readonly helper?: string
      readonly byPerson: boolean
    },
    work: (begun: Effect.Effect<void>) => Effect.Effect<void>,
  ) => Effect.Effect<boolean>
  readonly handOver: (previous: Running, reason: { readonly lost: string } | 'moved') => Effect.Effect<void, never, Store>
  readonly heardBackground: (running: Running, event: SessionEvent) => Effect.Effect<void>
  readonly heardPlan: (running: Running, event: SessionEvent) => Effect.Effect<void>
  readonly imagesFor: (
    inputIds: ReadonlyArray<string>,
    takes: boolean,
  ) => Effect.Effect<
    { images: Map<string, { readonly data: string; readonly mimeType: string }[]>; withheld: Map<string, number> },
    SqlError.SqlError,
    SqlClient.SqlClient | Artifacts
  >
  readonly inputBatches: ReturnType<typeof makeInputBatches>
  readonly inputWaiting: (threadId: string) => Effect.Effect<boolean, SqlError.SqlError, SqlClient.SqlClient>
  readonly instance: InstanceInfo
  readonly leadTurn: (_lead: { readonly taskId: string; readonly threadId: string }) => Effect.Effect<void>
  readonly limits: Limits['Service']
  readonly live: Live['Service']
  readonly loadThread: (
    threadId: string,
    options?: { restoreFolders?: boolean },
  ) => Effect.Effect<
    ThreadContext,
    SqlError.SqlError | GitFailed | NotFound | Schema.SchemaError | RowNotFound | RevisionConflict | TaskRefused,
    SqlClient.SqlClient | RuntimeConfig | Ledger | Crypto.Crypto | Instance
  >
  readonly notingListening: (running: Running) => Effect.Effect<void>
  readonly personsTurn: (_lead: {
    readonly taskId: string
    readonly threadId: string
    readonly sessionId: string
    readonly deliveryId: string
  }) => Effect.Effect<void>
  readonly run: <A, E>(effect: Effect.Effect<A, E, Store>) => Effect.Effect<A, E>
  readonly sentWithRequest: (
    thread: TaskThread,
    takes: boolean,
  ) => Effect.Effect<
    { images: { readonly data: string; readonly mimeType: string }[]; files: PromptFile[]; withheld: number; gone: number },
    SqlError.SqlError | NotFound,
    SqlClient.SqlClient | RuntimeConfig | Artifacts | Instance
  >
  readonly sessionsScope: Scope.Closeable
  readonly setLeadChoice: (
    running: Running,
    next: Running['nextLead'],
    options?: {
      readonly after?: NonNullable<Running['nextLead']>
      readonly choice?: { readonly agentId: string; readonly model: string | null; readonly effort: string | null }
      readonly resolved?: true
      readonly onlyIfEmpty?: true
    },
  ) => Effect.Effect<
    boolean,
    SqlError.SqlError | Schema.SchemaError | RowNotFound | RevisionConflict | NoSession,
    SqlClient.SqlClient | Ledger
  >
  readonly settleLead: (
    running: Running,
    next: { readonly model?: string; readonly effort?: string },
  ) => Effect.Effect<void, SqlError.SqlError | Schema.SchemaError, SqlClient.SqlClient | Ledger | Crypto.Crypto>
  readonly setups: Setups['Service']
  readonly shownWhereRead: (
    running: Running,
    deliveryId: string,
    inputs: ReadonlyArray<{ readonly id: string; readonly body: string; readonly given: number }>,
  ) => Effect.Effect<
    void,
    SqlError.SqlError | Schema.SchemaError | RowNotFound | RevisionConflict,
    SqlClient.SqlClient | Ledger | Crypto.Crypto
  >
  readonly takeOver: (
    previous: Running,
    next: { readonly agentId: string; readonly model?: string; readonly effort?: string },
  ) => Effect.Effect<void, never, Store>
  readonly taskBrief: (thread: TaskThread, why: Why, replayed?: boolean) => Effect.Effect<string, SqlError.SqlError, Store>
  readonly threads: Map<string, Running>
  readonly zoneOf: () => string
}

export const makeSessionTurns = (dependencies: SessionTurnsDependencies) => {
  const {
    applyLead,
    betweenAgents,
    changeHeads,
    heardBackground,
    heardPlan,
    imagesFor,
    inputBatches,
    inputWaiting,
    instance,
    limits,
    live,
    loadThread,
    notingListening,
    run,
    sentWithRequest,
    sessionsScope,
    setLeadChoice,
    settleLead,
    setups,
    shownWhereRead,
    takeOver,
    threads,
    zoneOf,
  } = dependencies

  /*
   * Each project's coordinator copies (coordinatorFolder.ts), as a turn reads them: when they were last made fresh with no
   * turn of the coordinator's since, which may have written in them (null where one may have), and the refresh under way as
   * its last turn ended, which the next waits for rather than making its own. So a turn goes out at once where the person
   * took longer to answer than the copies took to make, as they nearly always do; they are never older than COPIES_FRESH.
   */
  const copiesOf = new Map<string, { at: number | null; under: Fiber.Fiber<void> | undefined }>()

  const copiesState = (projectId: string) => {
    const known = copiesOf.get(projectId)
    if (known !== undefined) return known
    const made = { at: null, under: undefined }
    copiesOf.set(projectId, made)
    return made
  }

  /** The coordinator's copies made fresh, and known to be so. */
  const freshCopies = (projectId: string) =>
    Effect.gen(function* () {
      const folder = yield* coordinatorFolder(projectId)
      copiesState(projectId).at = yield* Clock.currentTimeMillis
      return folder
    })

  /** Before a coordinator's turn: its copies as its last turn's end made them, or made fresh now; this turn may write in them. */
  const copiesReady = (projectId: string) =>
    Effect.gen(function* () {
      const state = copiesState(projectId)
      if (state.under !== undefined) yield* Fiber.await(state.under)
      const now = yield* Clock.currentTimeMillis
      if (state.at === null || now - state.at > COPIES_FRESH)
        yield* freshCopies(projectId).pipe(
          Effect.catchCause((cause) => Effect.logWarning('Could not refresh the coordinator folder', cause)),
        )
      state.at = null
    })

  /** As a coordinator's turn ends: its copies made fresh again for the next, in the background. */
  const copiesAfter = (projectId: string) =>
    Effect.gen(function* () {
      const state = copiesState(projectId)
      const refresh = freshCopies(projectId).pipe(
        Effect.asVoid,
        Effect.catchCause((cause) => Effect.logWarning('Could not refresh the coordinator folder', cause)),
      )
      const under = yield* Effect.forkIn(refresh, sessionsScope)
      state.under = under
      yield* Effect.forkIn(
        Effect.andThen(
          Fiber.await(under),
          Effect.sync(() => {
            if (state.under === under) state.under = undefined
          }),
        ),
        sessionsScope,
      )
    })

  /**
   * What an aside's lead is told with its next turn once the aside became work and left Scratch: a lead's whole brief, where
   * its worktree stands now and what its sandbox lets through, but not the thread, which it has. Once; null while it is an
   * aside still.
   */
  const workBrief = (running: Running, was: TaskThread, told: NonNullable<Running['aside']>) =>
    Effect.gen(function* () {
      if ((yield* dependencies.asideState(was.taskId)).aside) return null
      running.aside = undefined
      const reread = yield* loadThread(was.threadId).pipe(Effect.orElseSucceed(() => was))
      return [
        "This aside is a task now, on the board: what you do from here is a task's work, as a lead does it.",
        yield* dependencies.taskBrief(reread.role === 'task' ? reread : was, { kind: 'start' }, false),
        ...(told.sandbox === null ? [] : [told.sandbox]),
      ].join('\n\n')
    }).pipe(Effect.catchCause((cause) => Effect.as(Effect.logWarning('Could not brief an aside that became work', cause), null)))

  /** Delivers the queued input as one turn, and records it to its end. */
  const undoing = new Map<string, Deferred.Deferred<void>>()

  const deliver = (running: Running) =>
    Effect.gen(function* () {
      if (undoing.has(running.thread.threadId)) return false
      const sql = yield* SqlClient.SqlClient
      const { thread } = running
      if ((yield* sql`SELECT 1 FROM turn_undo_recoveries WHERE thread_id = ${thread.threadId} AND state = 'prepared' LIMIT 1`).length > 0)
        return false
      // A session being replaced takes no more turns. Keep queued inputs for the replacement.
      if (running.stopping || running.handover === 'under_way' || threads.get(thread.threadId) !== running) return false
      // A model or effort chosen from here is kept for the turn after this one: it is the lead as it stands now that goes out.
      running.leadHeld = true
      yield* inputBatches.ready(thread.threadId)
      // From here to its prompt going out is the turn getting ready, which its timings keep (turnTimes.ts).
      const readying = yield* Clock.currentTimeMillis
      // A lead changed meanwhile takes up what is said to it now, between turns: another agent takes over with it. A session's
      // first turn, its brief, takes up the lead picked while it started (`adopt`), though nothing else waits.
      const briefing = running.adoptedLead === true && running.brief !== undefined && running.waitsForWords !== true
      const availableGoal = thread.role === 'task' && thread.helper === undefined ? yield* runnableGoal(thread.threadId) : null
      if (availableGoal !== null && availableGoal.rounds >= availableGoal.roundLimit)
        yield* endGoalRound(thread.threadId, availableGoal.revision, null)
      const goal = availableGoal !== null && availableGoal.rounds < availableGoal.roundLimit ? availableGoal : null
      const hasWork = () => (goal !== null ? Effect.succeed(true) : inputWaiting(thread.threadId))
      if (running.nextLead !== undefined && (briefing || (yield* hasWork()))) {
        const next = running.nextLead
        if (next.agentId !== running.entry.definition.id) {
          if (!(yield* setLeadChoice(running, undefined, { after: next }))) return true
          running.handover = 'under_way'
          yield* Effect.forkIn(run(takeOver(running, next)), sessionsScope)
          return false
        }
        // Under the lock, and again for whatever is chosen while it is being set: the turn begins on the last choice.
        yield* running.leadLock.withPermits(1)(
          Effect.gen(function* () {
            for (let current = running.nextLead; current !== undefined && current.agentId === running.entry.definition.id;) {
              yield* settleLead(running, current)
              if (yield* setLeadChoice(running, undefined, { after: current, resolved: true })) return
              current = running.nextLead
            }
          }),
        )
      }
      // Its folder moved: a fresh session there takes up what is said now, handed the work so far.
      if (running.moved && running.handover === 'none' && (yield* hasWork())) {
        running.moved = false
        running.handover = 'under_way'
        yield* Effect.forkIn(run(dependencies.handOver(running, 'moved')), sessionsScope)
        return false
      }
      const waiting = yield* sql<{
        id: string
        body: string
        disposition: string
        dictated: number
        author: string
        shown: number
        given: number
        cutBy: string | null
        senderKind: string
        inputOrigin: string
        state: string
      }>`
            SELECT i.id, i.body, i.disposition, i.dictated, i.sender_kind, i.input_origin, i.state, a.kind AS author,
              EXISTS (SELECT 1 FROM thread_items ti WHERE ti.user_input_id = i.id) AS shown,
              -- An earlier turn gave it to an agent already: the thread shows it where that one read it.
              EXISTS (SELECT 1 FROM turn_delivery_inputs di JOIN turn_deliveries d ON d.id = di.delivery_id
                WHERE di.user_input_id = i.id AND d.delivered_at IS NOT NULL) AS given,
              (SELECT s.agent_id FROM turn_delivery_inputs di JOIN turn_deliveries d ON d.id = di.delivery_id
                JOIN provider_sessions s ON s.id = d.provider_session_id
                WHERE di.user_input_id = i.id AND d.error_class = 'usage_limit' ORDER BY d.requested_at DESC LIMIT 1) AS cut_by
            FROM user_inputs i JOIN actors a ON a.id = i.author_actor_id
            WHERE i.thread_id = ${thread.threadId} AND i.state IN ('queued', 'noted')
            ORDER BY i.sequence`
      // While connecting, send has no Running to update. The accepted person message is the durable resume request:
      // it survives another restart, while previously dispatched person input and quiet news never authorize replay.
      if (running.blockedInputs !== undefined && waiting.some((input) => input.author === 'person' && input.given === 0)) {
        running.blockedInputs = undefined
        if (running.deliveryHeld === 'transient' || running.deliveryHeld === 'recovery') running.deliveryHeld = null
      }
      const queued = waiting.filter((input) => !running.blockedInputs?.has(input.id))
      // Compacting the agent's context is a turn of its own, said bare as the agent's own command: what was said before it goes
      // first, and what after, next. A brief not yet read waits for the turn after, so nothing is left behind it.
      // Notes before it start nothing, so they wait for the turn after it.
      const compactAt = queued.findIndex((input) => input.body === COMPACT)
      const beforeCompact = compactAt === -1 ? queued : queued.slice(0, compactAt)
      const manualCompact = compactAt >= 0 && beforeCompact.every((input) => input.state === 'noted')
      // Compact a full coordinator as its turn ends. A lead waits for its next message or goal round.
      const autoCompact =
        compactAt === -1 &&
        automaticCompactionDue(running) &&
        (thread.role === 'coordinator' || goal !== null || queued.some((input) => input.state === 'queued'))
      const compacting = manualCompact || autoCompact
      const selected = autoCompact ? [] : manualCompact ? queued.slice(compactAt, compactAt + 1) : beforeCompact
      const before = running.context
      // Notes alone start no turn: they are read with the next one, whatever starts it.
      const asking = autoCompact || selected.some((input) => input.state === 'queued')
      // Starting for an unsent message doesn't authorize another queued input, or a brief alone if that message was withdrawn.
      if (!asking && running.blockedInputs !== undefined) {
        if (waiting.some((input) => input.state === 'queued' && running.blockedInputs?.has(input.id))) running.deliveryHeld = 'recovery'
        return false
      }
      const activeGoal = compacting ? null : goal
      const goalRound = activeGoal !== null && !asking
      if (!asking && !goalRound && (running.brief === undefined || running.brief.onlyForGoal === true)) return false
      // An aside opened with + waits for the person's first message or goal. The coordinator only answers messages.
      if (!asking && (thread.role === 'coordinator' || (running.waitsForWords === true && !goalRound))) return false
      // The images the person sent with each, read from the store for this turn: only an agent that takes images is sent them.
      const sent = yield* imagesFor(
        selected.map((input) => input.id),
        running.connection.info.images,
      )
      // And the files, linked where their copies are.
      const linked = yield* filesForTurn(selected.map((input) => input.id))
      // What an agent out of usage was given goes on with word of that, by the name of the agent it went to.
      const agents = yield* Agents
      const inputs = selected.map(({ cutBy, ...input }) => {
        const by = cutBy === null ? undefined : (agents.list.find((entry) => entry.definition.id === cutBy)?.definition.name ?? cutBy)
        const withheld = sent.withheld.get(input.id) ?? 0
        const filesGone = linked.gone.get(input.id) ?? 0
        return {
          ...input,
          ...(by === undefined ? {} : { cutShort: by }),
          ...(withheld === 0 ? {} : { withheld }),
          ...(filesGone === 0 ? {} : { filesGone }),
        }
      })
      // A compaction says nothing of the brief: that is read with the next turn.
      const briefOf = compacting ? undefined : running.brief
      // Its copies of the repositories are fresh for each turn: made so as its last turn ended, while the person read and wrote,
      // or now, where they weren't; offline, it reads what it has.
      const copying = yield* Clock.currentTimeMillis
      const readsCopies = thread.role === 'coordinator' && !compacting
      if (readsCopies) yield* copiesReady(thread.projectId)
      const copies = readsCopies ? (yield* Clock.currentTimeMillis) - copying : undefined
      // An aside that became work since its last turn is told, once, what a task's lead does: the brief it started without.
      const becameWork =
        thread.role === 'task' && running.aside !== undefined && running.brief === undefined && !compacting
          ? yield* workBrief(running, thread, running.aside)
          : null
      const brief = briefOf
      const compacted = compacting ? undefined : running.compacted
      const records =
        compacted !== undefined && brief === undefined && becameWork === null
          ? yield* Effect.flatMap(
              thread.role === 'task' ? loadThread(thread.threadId, { restoreFolders: false }) : Effect.succeed(thread),
              dependencies.afterCompaction,
            ).pipe(
              Effect.catchCause((cause) => Effect.as(Effect.logWarning('Could not refresh Althar records after compaction', cause), null)),
            )
          : null
      // The lead is told how its worktrees were set up, in its brief.
      const setUp = thread.role === 'task' && brief !== undefined ? yield* setups.told(thread.taskId) : null
      // And sent the images and files the person sent with what they asked for, with the brief, as with a message of theirs.
      const asked =
        thread.role === 'task' && brief !== undefined
          ? yield* sentWithRequest(thread, running.connection.info.images).pipe(
              Effect.catchCause((cause) =>
                Effect.as(Effect.logWarning('Could not read what the person sent with what they asked for', cause), null),
              ),
            )
          : null
      // A lead and the coordinator are told the person's local date, time and zone from the computer's clock as the turn is
      // made, not as the session started (the coordinator's brief waits for the person's first words): once, in the brief,
      // and again first in the turn after a long gap, a new day or a compaction (localTime.ts).
      const knowsTime = thread.role === 'coordinator' || (thread.role === 'task' && thread.helper === undefined)
      const timeNow = yield* Clock.currentTimeMillis
      const zone = zoneOf()
      const timeBefore = running.timeTold
      const timeNews =
        knowsTime && brief === undefined && !compacting && timeAgain(timeBefore, running.turnEndedAt, timeNow, zone)
          ? timeAgainLine(timeNow, zone)
          : null
      const withRecords = (...news: Array<string | null>) =>
        [timeNews, records, ...news].filter((part) => part !== null).join('\n\n') || null
      const added = [setUp, asked === null ? null : sentWithWords(asked), knowsTime ? timeLine(timeNow, zone) : null].filter(
        (said) => said !== null && said !== '',
      )
      const briefed = brief === undefined || added.length === 0 ? brief : { ...brief, text: [brief.text, ...added].join('\n\n') }
      // The coordinator is told what became of its plans in its models' names, which are read first: asking an agent may take a while.
      const named =
        thread.role === 'coordinator' && !compacting
          ? yield* modelNamer.pipe(
              Effect.catchCause((cause) =>
                Effect.as(Effect.logWarning('Could not read the models to name for the coordinator', cause), null),
              ),
            )
          : null
      const turnId = yield* newId(Ids.turnDelivery)
      const words = promptFor(inputs, briefed, withRecords(becameWork))
      const withGoal = activeGoal === null ? words : `${goalBrief(activeGoal, goalRound, turnId)}\n\n${words}`
      let prompt = compacting ? COMPACT : asTold(running.entry.definition, withGoal)
      const [session] = yield* sql<{
        model: string | null
        effort: string | null
      }>`SELECT model, effort FROM provider_sessions WHERE id = ${running.sessionId}`
      const claimed = yield* sql
        .withTransaction(
          Effect.gen(function* () {
            // A message may have been withdrawn, or another arrived while the prompt was prepared.
            // Read the whole burst again, including attachments still being prepared, before claiming it.
            const waiting = yield* sql<{ id: string }>`SELECT id FROM user_inputs
                  WHERE thread_id = ${thread.threadId} AND state IN ('queued', 'noted') ORDER BY sequence`
            const still = waiting.filter((input) => !running.blockedInputs?.has(input.id))
            if (
              inputBatches.pending(thread.threadId) ||
              (autoCompact && !automaticCompactionDue(running)) ||
              still.length !== queued.length ||
              still.some((input, index) => input.id !== queued[index]?.id)
            )
              return yield* new TakenBack()
            // What became of its plans since it last spoke, which only the cards show the person: read with the turn's record, so none falls between two turns.
            if (thread.role === 'coordinator' && named !== null && !compacting) {
              const news = yield* coordinatorNews(thread.threadId, thread.projectId, named).pipe(
                Effect.catchCause((cause) => Effect.as(Effect.logWarning('Could not read what changed for the coordinator', cause), null)),
              )
              prompt = asTold(running.entry.definition, promptFor(inputs, briefed, withRecords(news)))
            }
            if (activeGoal !== null && (yield* runnableGoal(thread.threadId))?.revision !== activeGoal.revision)
              return yield* new TakenBack()
            const at = yield* timestamp
            yield* sql`INSERT INTO turn_deliveries ${sql.insert({
              id: turnId,
              projectId: thread.projectId,
              threadId: thread.threadId,
              providerSessionId: running.sessionId,
              controllerGeneration: 1,
              model: session?.model ?? null,
              effort: session?.effort ?? null,
              // What the agent is told, kept so it can always be read back (docs/architecture/03).
              prompt,
              goalRevision: activeGoal?.revision ?? null,
              goalRound: goalRound ? 1 : 0,
              state: 'pending',
              origin: inputs.some((i) => i.author === 'person' && (i.senderKind === 'window' || i.senderKind === 'paired_device'))
                ? 'person'
                : inputs.some((i) => i.inputOrigin === 'news')
                  ? 'news'
                  : 'system',
              requestedAt: at,
            })}`
            for (const [index, input] of inputs.entries()) {
              yield* sql`INSERT INTO turn_delivery_inputs ${sql.insert({ projectId: thread.projectId, deliveryId: turnId, userInputId: input.id, position: index + 1 })}`
            }
            yield* fact({
              projectId: thread.projectId,
              aggregateType: 'turn_delivery',
              aggregateId: turnId,
              revision: 1,
              type: 'turn_delivery.requested',
              payload: { inputs: inputs.map((input) => input.id), briefed: brief !== undefined },
              actorId: instance.systemId,
            })
            return true
          }),
        )
        .pipe(Effect.catchTag('TakenBack', () => Effect.succeed(false)))
      if (!claimed) return true
      running.goalRoundTurn = goalRound ? turnId : undefined
      // System-only plan turns before the person speaks have no chat message to undo.
      // Once chat undo is available, keep later system turns in the same restorable suffix.
      if (
        thread.role === 'task' &&
        (inputs.some((input) => input.author === 'person' && input.shown === 1) ||
          (yield* sql`SELECT 1 FROM turn_deliveries WHERE thread_id = ${thread.threadId} AND checkpoints IS NOT NULL AND undone_at IS NULL LIMIT 1`)
            .length > 0)
      )
        yield* checkpointBeforeTurn(thread.threadId, turnId).pipe(
          Effect.catchCause((cause) => Effect.logWarning('Could not checkpoint a chat turn', cause)),
        )
      // What the person committed by hand since the lead's last turn is held before the lead reads anything, so it can't commit
      // on top of it first.
      if (thread.role === 'task' && !compacting)
        yield* dependencies
          .leadTurn({ taskId: thread.taskId, threadId: thread.threadId })
          .pipe(Effect.catchCause((cause) => Effect.logWarning('Could not look at commits made by hand', cause)))
      // What the person says to a task's lead after its plan is a turn: where its worktrees stand is kept before the turn is
      // delivered (Runs.ts), so what it commits can wait for Ship, and its card says it works as soon as it is.
      if (thread.role === 'task' && inputs.some((input) => input.shown === 1))
        yield* dependencies
          .personsTurn({ taskId: thread.taskId, threadId: thread.threadId, sessionId: running.sessionId, deliveryId: turnId })
          .pipe(Effect.catchCause((cause) => Effect.logWarning('Could not keep where the person’s turn began', cause)))
      if (!compacting) {
        running.brief = undefined
        running.waitsForWords = undefined
        running.adoptedLead = undefined
        if (knowsTime && (brief !== undefined || timeNews !== null)) running.timeTold = { at: timeNow, zone }
      } else if (contextFull(before, thread.role === 'task')) running.compactAttempted = true
      running.turnRunning = true
      running.stoppedByPerson = false
      running.turnStartedAt = yield* Clock.currentTimeMillis
      const ready = running.turnStartedAt - readying
      // The agent's first word, thought or call: how long the model took before it said anything.
      let first: number | undefined
      if (!compacting) {
        running.turnHeads = yield* changeHeads(thread.threadId)
        // What it did outside a turn before is over with: this turn is what it is at.
        running.callsOpen.clear()
        running.workedAt = null
        running.wakeAt = null
      }
      const begun = running.begun
      running.begun = undefined
      if (begun !== undefined) yield* begun
      // Images the agent doesn't get are said in the thread as well as to the agent, so none goes missing unsaid.
      const withheld = inputs.reduce((sum, input) => sum + (input.withheld ?? 0), asked?.withheld ?? 0)
      if (withheld > 0)
        yield* addItem(
          { projectId: thread.projectId, threadId: thread.threadId, sessionId: running.sessionId, deliveryId: turnId },
          'notice',
          {
            source: 'runtime',
            severity: 'warning',
            title: running.connection.info.images
              ? withheld === 1
                ? `An image you sent isn't kept any more. ${running.entry.definition.name} didn't get it.`
                : `${withheld} images you sent aren't kept any more. ${running.entry.definition.name} didn't get them.`
              : `${running.entry.definition.name} doesn't take images. ${withheld === 1 ? 'The image' : `The ${withheld} images`} you sent ${withheld === 1 ? "wasn't" : "weren't"} passed on.`,
          },
        )
      // A task's card says when its lead or reviewer is at work, and so does its thread, open: what was read of it while a round
      // opened for the person's words (ADR-034), before this, says it isn't.
      if (thread.role !== 'coordinator') yield* touchTask(thread.taskId)
      // Said once the agent has the prompt and its turn can be stopped: what hears it may stop it at once, as a spent budget of turns does.
      const promptSent = yield* Deferred.make<void>()
      running.promptSent = promptSent
      let received = false
      const started = Effect.suspend(() => {
        if (received) return Effect.void
        received = true
        return Effect.andThen(
          sql
            .withTransaction(
              Effect.gen(function* () {
                const [turn] = yield* sql<{ revision: number }>`SELECT revision FROM turn_deliveries WHERE id = ${turnId}`
                if (turn === undefined) return
                // A receipt is positive evidence even if it arrives late. It never changes the delivery's lifecycle state.
                const revision = yield* bumpRevision('turn_deliveries', turnId, turn.revision)
                yield* fact({
                  projectId: thread.projectId,
                  aggregateType: 'turn_delivery',
                  aggregateId: turnId,
                  revision,
                  type: 'turn_delivery.prompt_sent',
                  actorId: instance.systemId,
                })
              }),
            )
            .pipe(Effect.catchCause((cause) => Effect.logWarning('Could not record prompt receipt', cause))),
          Effect.andThen(
            Effect.suspend(() =>
              running.turnRunning && running.promptSent === promptSent && !running.stopping
                ? live.publish({
                    _tag: 'TurnStarted',
                    threadId: thread.threadId,
                    turnId,
                    // Keep the stall watch's shown-message signal separate from asked-for authorization.
                    byPerson: inputs.some(
                      (input) =>
                        input.shown === 1 ||
                        (input.author === 'person' && (input.senderKind === 'window' || input.senderKind === 'paired_device')),
                    ),
                  })
                : Effect.void,
            ),
            Effect.asVoid(Deferred.succeed(promptSent, undefined)),
          ),
        )
      }).pipe(Effect.ensuring(Deferred.succeed(promptSent, undefined)))
      // The app's log has each turn's start and end by its ids, never what was said (DEV-61).
      const turnLog = {
        turn: turnId,
        thread: thread.threadId,
        session: running.sessionId,
        agent: running.entry.definition.id,
        ...(session?.model == null ? {} : { model: session.model }),
      }
      yield* Effect.logInfo('Turn started').pipe(Effect.annotateLogs(turnLog))

      const items = recorder({
        projectId: thread.projectId,
        threadId: thread.threadId,
        sessionId: running.sessionId,
        deliveryId: turnId,
        folders: foldersOf(thread),
        sandboxed: running.requestContext.sandbox !== undefined,
        ...(thread.role === 'task' ? { lead: running.entry.definition.name, leadId: running.entry.definition.id } : {}),
      })
      // What it was saying between turns ends here: what follows belongs after this turn's input.
      yield* running.settleBetween
      running.recording = items
      let ended: Extract<SessionEvent, { _tag: 'TurnEnded' }> | undefined
      let compactFailed = false
      // What the turn spent before it was delivered is its own, and the next one's starts from nothing.
      const spent = running.before
      running.before = { session: 0, starting: null, place: 0 }
      const tools = toolClock()
      // A failure to record one event doesn't stop the runtime reading the rest of the turn.
      const record = (event: SessionEvent) =>
        items.record(event).pipe(Effect.catchCause((cause) => Effect.logWarning('Could not record an agent event', cause)))
      /*
       * The text being written goes to watching clients whole, at most every
       * STREAM_EVERY, and once more after the last piece, so a long message
       * doesn't cost the square of its length on the way. So does each
       * command's output that grew, as its last lines.
       */
      const streaming = { sentAt: 0, trailing: false }
      const sendOpen = Effect.flatMap(Clock.currentTimeMillis, (now) => {
        streaming.sentAt = now
        const open = items.current()
        const message =
          open === undefined
            ? Effect.void
            : live.publish({
                _tag: 'Streaming',
                threadId: thread.threadId,
                itemId: open.id,
                sequence: open.sequence,
                kind: open.kind,
                agentId: running.entry.definition.id,
                text: open.text,
              })
        return Effect.andThen(
          message,
          Effect.forEach(items.outputsSoFar(), (output) => live.publish({ _tag: 'Output', threadId: thread.threadId, ...output }), {
            discard: true,
          }),
        )
      })
      const stream = Effect.flatMap(Clock.currentTimeMillis, (now) => {
        const wait = STREAM_EVERY - (now - streaming.sentAt)
        if (wait <= 0) return sendOpen
        if (streaming.trailing) return Effect.void
        streaming.trailing = true
        return Effect.asVoid(
          Effect.forkChild(
            Effect.andThen(
              Effect.sleep(Duration.millis(wait)),
              Effect.andThen(
                Effect.sync(() => {
                  streaming.trailing = false
                }),
                sendOpen,
              ),
            ),
          ),
        )
      })
      // Each input's images, then its files, in the order the inputs are said.
      // What came with the person's request first, with the brief.
      const parts = [
        ...(asked?.images ?? []),
        ...(asked?.files ?? []),
        ...inputs.flatMap((input) => [...(sent.images.get(input.id) ?? []), ...(linked.files.get(input.id) ?? [])]),
      ]
      yield* notingListening(running)
      // A turn that fails before its prompt reaches the agent never has one to stop: told either way, so an interrupt
      // waiting for it doesn't wait forever.
      let prevented = false
      const streamed = yield* Effect.suspend(() => {
        // Preparation, the place's begun hook and the listening baseline can all yield. Ownership is checked at dispatch,
        // so a stop or takeover during any of them never sends a prompt to the outgoing agent.
        if (running.stopping || running.handover === 'under_way' || threads.get(thread.threadId) !== running) {
          prevented = true
          return Effect.void
        }
        return Effect.gen(function* () {
          // Recorded as delivered before the prompt goes out: after a crash, a delivered turn may have acted.
          const admitted = yield* sql.withTransaction(
            Effect.gen(function* () {
              if (goalRound && (inputBatches.pending(thread.threadId) || (yield* inputWaiting(thread.threadId)))) return false
              if (activeGoal !== null && !(yield* startGoalRound(thread.threadId, activeGoal, goalRound))) return false
              const revision = yield* change('turn_deliveries', turnId, { state: 'delivered', deliveredAt: yield* timestamp })
              yield* fact({
                projectId: thread.projectId,
                aggregateType: 'turn_delivery',
                aggregateId: turnId,
                revision,
                type: 'turn_delivery.delivered',
                actorId: instance.systemId,
              })
              for (const input of inputs) {
                const inputRevision = yield* change('user_inputs', input.id, { state: 'delivered' })
                yield* fact({
                  projectId: thread.projectId,
                  aggregateType: 'user_input',
                  aggregateId: input.id,
                  revision: inputRevision,
                  type: 'user_input.delivered',
                  actorId: instance.systemId,
                })
              }
              // How the thread shows it never stops the turn: each change to it is its own savepoint, undone where it fails.
              yield* shownWhereRead(running, turnId, inputs).pipe(
                Effect.catchCause((cause) => Effect.logWarning('Could not show what a turn gives the agent where it reads it', cause)),
              )
              return true
            }),
          )
          if (!admitted) {
            prevented = true
            return
          }
          // Recording delivery and dispatch are one boundary: any crash from here may have reached the agent.
          if (running.stopping || running.handover === 'under_way' || threads.get(thread.threadId) !== running) {
            prevented = true
            return
          }
          return yield* Stream.runForEach(running.agent.prompt(prompt, parts, run(started)), (event) =>
            Effect.gen(function* () {
              if (event._tag === 'TurnEnded') ended = event
              const heardAt = yield* Clock.currentTimeMillis
              if (
                first === undefined &&
                (event._tag === 'AgentMessage' || event._tag === 'AgentThought' || event._tag === 'ToolCall') &&
                running.turnStartedAt !== null
              )
                first = Math.max(0, heardAt - running.turnStartedAt)
              tools.heard(event, heardAt)
              // An agent may say its compaction failed in a call of its own, and end its turn as usual (Claude Code).
              // One that reports its compaction as such (ACP's `compaction_update`) says so there.
              if (
                compacting &&
                ((event._tag === 'ToolCallUpdate' && event.status === 'failed') ||
                  (event._tag === 'Compaction' && event.status === 'failed'))
              )
                compactFailed = true
              heardContext(running, event)
              yield* heardPlan(running, event)
              yield* record(event)
              yield* heardBackground(running, event)
              yield* live.publish({ _tag: 'Agent', threadId: thread.threadId, event })
              if (event._tag === 'AgentMessage' || event._tag === 'AgentThought' || event._tag === 'ToolCallUpdate') yield* stream
            }),
          )
        })
      }).pipe(Effect.ensuring(Deferred.succeed(promptSent, undefined)), Effect.exit)
      // What the turn left open is kept as far as it came: the message being written, and any command's output.
      yield* items.end.pipe(Effect.catchCause((cause) => Effect.logWarning('Could not record the end of a message', cause)))
      if (thread.role === 'task')
        yield* checkpointAfterTurn(turnId).pipe(
          Effect.catchCause((cause) => Effect.logWarning('Could not finish a chat checkpoint', cause)),
        )
      running.turnRunning = false
      running.promptSent = null
      running.goalRoundTurn = undefined
      running.turnEndedAt = yield* Clock.currentTimeMillis
      // Its copies made fresh again for its next turn now, while the person reads and writes, rather than as they wait.
      if (readsCopies) yield* copiesAfter(thread.projectId)
      // A model or effort chosen while the turn ran is set on its agent now, rather than when something is said next.
      if (running.nextLead?.agentId === running.entry.definition.id) yield* Effect.forkIn(run(applyLead(running)), sessionsScope)
      // A session started for a step that waited for a place counts that wait in its first turn (Runs' `startPlaced`).
      const [placed] =
        spent.starting === null
          ? []
          : yield* sql<{ waited: number | null }>`
                  SELECT json_extract(f.payload, '$.waited') AS waited FROM record_events f
                  JOIN node_attempts a ON a.id = f.aggregate_id AND f.aggregate_type = 'node_attempt'
                  WHERE a.provider_session_id = ${running.sessionId} AND f.type = 'node_attempt.admitted'
                    AND json_extract(f.payload, '$.waited') IS NOT NULL
                  ORDER BY f.sequence DESC LIMIT 1`.pipe(Effect.orElseSucceed(() => []))
      // In a task of several changes, how many commits it made in each, from where each stood as it began.
      const went = yield* Effect.forEach(running.turnHeads ?? [], (one) =>
        git(one.path, 'rev-list', '--count', `${one.head}..HEAD`).pipe(
          Effect.map((count) => ({ name: one.name, commits: Number(count) || 0 })),
          Effect.orElseSucceed(() => ({ name: one.name, commits: 0 })),
        ),
      )
      running.turnHeads = undefined
      const committed = went.filter((one) => one.commits > 0)
      const timings = {
        place: spent.place + Math.max(0, placed?.waited ?? 0),
        session: spent.starting === null ? 0 : spent.session,
        starting: spent.starting,
        work: Math.max(0, running.turnEndedAt - (running.turnStartedAt ?? running.turnEndedAt)),
        tools: tools.total(running.turnEndedAt),
        ...(committed.length === 0 ? {} : { changes: committed }),
        ready: Math.max(0, ready),
        ...(copies === undefined ? {} : { copies: Math.max(0, copies) }),
        ...(first === undefined ? {} : { first }),
      }

      const failure = Exit.isFailure(streamed) ? Cause.findErrorOption(streamed.cause) : Option.none()
      const errorClass = errorClassOf(failure, Exit.isFailure(streamed)) ?? ended?.failure?.failure
      // The agent refused the prompt: nothing was delivered, so the input goes back in the queue.
      const refused = errorClass === 'turn_in_progress'
      // The agent no longer has the session, as Claude Code's adapter drops one whose process died: nothing was delivered,
      // so the input goes back in the queue, for a fresh session briefed from Althar's records (`handOver`). A compaction
      // isn't wanted there.
      const lost = errorClass === 'session_lost'
      // Out of usage, or its service out of reach (ADR-060): nothing more goes to it until what carries the work on says so.
      const held = errorClass === 'usage_limit' || (!compacting && errorClass === 'transient')
      const state = prevented
        ? 'interrupted'
        : errorClass !== undefined
          ? 'failed'
          : ended?.stopReason === 'cancelled'
            ? 'interrupted'
            : 'completed'
      running.deliveryHeld = held ? errorClass : null
      running.heldTurn = held ? turnId : undefined
      yield* sql.withTransaction(
        Effect.gen(function* () {
          const revision = yield* change('turn_deliveries', turnId, {
            state,
            stopReason: ended?.stopReason ?? null,
            usage: ended?.usage === undefined ? null : JSON.stringify(ended.usage),
            errorClass: errorClass ?? null,
            ...(prevented ? { deliveredAt: null } : {}),
            endedAt: yield* timestamp,
            timings: JSON.stringify(timings),
          })
          yield* fact({
            projectId: thread.projectId,
            aggregateType: 'turn_delivery',
            aggregateId: turnId,
            revision,
            type: `turn_delivery.${state}`,
            payload: { stopReason: ended?.stopReason, errorClass },
            actorId: instance.systemId,
          })
          if (activeGoal !== null && !prevented) {
            const endedEarly =
              state === 'interrupted' && !running.stopping && running.handover === 'none' && !(yield* inputWaiting(thread.threadId))
            const stopped =
              ended?.stopReason === 'refusal' || endedEarly
                ? 'The agent stopped without working on the goal.'
                : state === 'failed' && !lost && (!held || (goalRound && errorClass === 'transient'))
                  ? 'The agent could not continue. Resume the goal to try again.'
                  : null
            yield* endGoalRound(thread.threadId, activeGoal.revision, stopped)
          }
          // Refused, nothing was delivered. Out of usage, or its service out of reach, what the person said waits for the
          // agent that carries on; Althar's own prompts are given again by what carries the work on.
          const back = prevented || refused ? inputs : lost ? inputs.filter((input) => input.body !== COMPACT) : held ? inputs : []
          for (const input of back) {
            // A note goes back to being one: it still starts no turn of its own.
            const inputRevision = yield* change('user_inputs', input.id, { state: input.state === 'noted' ? 'noted' : 'queued' })
            yield* fact({
              projectId: thread.projectId,
              aggregateType: 'user_input',
              aggregateId: input.id,
              revision: inputRevision,
              type: 'user_input.requeued',
              actorId: instance.systemId,
            })
          }
        }),
      )
      // A brief the agent never read goes with the next turn: refused, or out of usage before it began.
      // A compaction left the brief where it was.
      // So does the time it was told first, after a gap: its turn has ended since, so it isn't owed it by the gap any more.
      if ((prevented || refused || held) && !compacting) {
        running.brief = brief
        running.timeTold = timeNews === null ? timeBefore : undefined
      }
      // Refused, its prompt never went: what it spent before is the turn's that tries again.
      if (refused) running.before = spent
      running.retryBrief = state === 'failed' && !compacting ? brief : undefined
      if (!held && running.blockedInputs !== undefined) {
        const waiting = yield* sql<{ id: string }>`SELECT id FROM user_inputs
              WHERE thread_id = ${thread.threadId} AND state = 'queued'`
        if (waiting.length > 0 && waiting.every((input) => running.blockedInputs?.has(input.id))) running.deliveryHeld = 'recovery'
      }
      if (refused) {
        // Tried again shortly, rather than straight away.
        yield* Effect.forkIn(Effect.delay(Queue.offer(running.wake, undefined), Duration.seconds(1)), running.scope)
      }
      // What the agent said went wrong, for what carries the work on to say.
      const said = Option.isSome(failure) && 'message' in failure.value ? failure.value.message : ended?.failure?.message
      // A prompt the agent failed ends its turn with the agent's error, or the person waits on an answer that isn't coming:
      // thrown, or on the prompt's response, as Claude Code and Codex end a turn on a lost connection (ADR-060).
      // A usage limit is said by what carries the work on, as a step's lost connection is; a refused prompt is tried again.
      const failed = (Option.isSome(failure) && failure.value._tag === 'AgentRequestFailed') || ended?.failure !== undefined
      // A lost session is said where it is started afresh, or where it can't be.
      const workflowOwnsFailure =
        !compacting &&
        errorClass === 'transient' &&
        (yield* sql`SELECT a.id FROM node_attempts a JOIN nodes n ON n.id = a.node_id
              JOIN workflow_executions e ON e.id = n.execution_id JOIN runs r ON r.id = e.run_id
              WHERE a.provider_session_id = ${running.sessionId} AND r.state = 'running'
                AND (a.state IN ('admitted', 'running') OR (a.state = 'held' AND a.hold_reason = 'agent_unavailable')) LIMIT 1`).length > 0
      const saidElsewhere = errorClass === 'usage_limit' || workflowOwnsFailure || lost
      if (failed && !saidElsewhere && !refused)
        yield* addItem(
          { projectId: thread.projectId, threadId: thread.threadId, sessionId: running.sessionId, deliveryId: turnId },
          'notice',
          {
            source: 'agent',
            severity: 'error',
            // Signed out, the agent's own words ("Authentication required") stay as its detail, under a headline that says it plainly.
            title:
              errorClass === 'auth_required'
                ? `${running.entry.definition.name} is signed out.`
                : `${running.entry.definition.name} couldn't answer.`,
            ...(typeof said === 'string' && said !== '' ? { description: said } : {}),
            failure: errorClass,
          },
        )
      // A step can report mid-turn, so its task is ready only once the turn is over: its card is read again.
      // Its commits go up a moment after (ADR-072), under way meanwhile: once that moment is over, it is read again (DEV-173).
      if (thread.role !== 'coordinator') {
        yield* touchCard(thread.taskId)
        yield* Effect.forkIn(run(Effect.ignore(Effect.delay(touchCard(thread.taskId), betweenAgents))), sessionsScope)
      }
      const resetsAt =
        Option.isSome(failure) && failure.value._tag === 'AgentRequestFailed' ? failure.value.resetsAt : ended?.failure?.resetsAt
      if (errorClass === 'usage_limit') yield* dependencies.accountLimited(running, resetsAt)
      // A compaction the agent left under way ends with its turn: done where the turn was, stopped otherwise.
      if (items.compaction() === 'in_progress') {
        running.nativeCompacting = false
        if (state === 'completed') markCompacted(running)
        yield* Effect.ignore(items.settleCompaction(state === 'completed' ? 'completed' : 'cancelled'))
      }
      // The person stopped it: the thread says so where it stopped.
      if (state === 'interrupted' && running.stoppedByPerson)
        yield* addItem(
          { projectId: thread.projectId, threadId: thread.threadId, sessionId: running.sessionId, deliveryId: turnId },
          'notice',
          { source: 'runtime', severity: 'info', role: 'interrupted', title: INTERRUPTED },
        )
      running.stoppedByPerson = false
      // A compaction the agent reported as one has its own line already: how far it took the context goes under it.
      const reported = items.compaction()
      const span = compactedSpan(before, running.context)
      if (
        compacted !== undefined &&
        running.compacted === compacted &&
        (records !== null || brief !== undefined || becameWork !== null) &&
        !prevented &&
        (state === 'completed' || (received && state === 'interrupted'))
      )
        delete running.compacted
      // Some adapters finish the command without a lifecycle update. Others may leave one in progress as the turn ends.
      if (compacting && state === 'completed' && !compactFailed && (reported === undefined || reported === 'completed'))
        markCompacted(running)
      if (compacting && reported === 'completed' && span !== null) yield* Effect.ignore(items.describeCompaction(span))
      // Otherwise a compaction says how far it took the context, as the agent says it; or that it didn't.
      if (compacting && state === 'completed' && reported === undefined)
        yield* addItem(
          { projectId: thread.projectId, threadId: thread.threadId, sessionId: running.sessionId, deliveryId: turnId },
          'notice',
          compactFailed
            ? { source: 'runtime', severity: 'warning', title: `${running.entry.definition.name} couldn't compact its context.` }
            : { source: 'runtime', severity: 'info', title: compactedWords(running.entry.definition.name, before, running.context) },
        )
      yield* (state === 'failed' ? Effect.logWarning : Effect.logInfo)('Turn ended').pipe(
        Effect.annotateLogs({
          ...turnLog,
          state,
          ...(ended === undefined ? {} : { stopReason: ended.stopReason }),
          ...(errorClass === undefined ? {} : { errorClass }),
          ...(Option.isSome(failure) ? { failure: failure.value._tag } : {}),
        }),
      )
      yield* live.publish({
        _tag: 'TurnEnded',
        threadId: thread.threadId,
        turnId,
        state,
        ...(compacting ? { compacting: true } : {}),
        ...(errorClass === undefined ? {} : { errorClass }),
        ...(errorClass === undefined || typeof said !== 'string' || said === '' ? {} : { failure: said }),
        ...(ended === undefined ? {} : { stopReason: ended.stopReason }),
      })
      // Lost, it takes no more turns: a fresh session takes what waits.
      if (lost) {
        running.handover = 'under_way'
        yield* Effect.forkIn(run(dependencies.handOver(running, { lost: typeof said === 'string' ? said : '' })), sessionsScope)
      }
      // Out of usage, or out of reach, nothing more goes to it until what carries the work on says so.
      return !prevented && (!refused || autoCompact) && !held && !lost && running.deliveryHeld !== 'recovery'
    }).pipe(
      Effect.ensuring(
        Effect.suspend(() => {
          running.leadHeld = false
          // Nothing began, and a pick came meanwhile: it is set now, as no turn will end to do it.
          return !running.turnRunning && running.nextLead?.agentId === running.entry.definition.id
            ? Effect.forkIn(run(applyLead(running)), sessionsScope).pipe(Effect.asVoid)
            : Effect.void
        }),
      ),
    )

  /**
   * Whether a new message waits behind work already claimed: a turn
   * running or still preparing its prompt, a handover, a compaction waiting, or no session held while
   * the thread waits for a place. A session merely starting is not work
   * ahead: what the person sends then is the turn that start reads, and
   * shows in the thread. The window reads the same answer as
   * `snapshot.accepting`.
   */
  const placement = (threadId: string) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const running = threads.get(threadId)
      const [claimed] = yield* sql<{ one: number }>`SELECT 1 AS one FROM turn_deliveries
            WHERE thread_id = ${threadId} AND state IN ('pending', 'delivered') LIMIT 1`
      const [waiting] = yield* sql<{ waits: string | null }>`SELECT waits_for_place AS waits FROM threads WHERE id = ${threadId}`
      // No session holds the thread, and its task waits for a place of its own to start one.
      const [busy] = yield* sql<{ one: number }>`
            SELECT 1 AS one FROM node_attempts a
            JOIN nodes n ON n.id = a.node_id
            JOIN workflow_executions e ON e.id = n.execution_id
            JOIN runs r ON r.id = e.run_id
            JOIN threads h ON h.task_id = r.task_id
            WHERE h.id = ${threadId} AND a.state = 'held' AND a.hold_reason = 'machine_busy' LIMIT 1`
      return acceptingOf({
        turnRunning: running?.turnRunning === true,
        handingOver: running?.handover === 'under_way',
        nextLead: running?.nextLead !== undefined,
        moved: running?.moved === true,
        claimed: claimed !== undefined,
        compactQueued: yield* compactQueued(threadId),
        waitingForPlace: running === undefined && (waiting?.waits != null || busy !== undefined),
      })
    })

  /** Whether a compaction (`COMPACT`) waits anywhere in the thread's queue: the context ring shows it is waiting. */
  const compactQueued = (threadId: string) =>
    run(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const [one] = yield* sql<{ id: string }>`
              SELECT id FROM user_inputs WHERE thread_id = ${threadId} AND state = 'queued' AND body = ${COMPACT} LIMIT 1`
        return one !== undefined
      }),
    ).pipe(Effect.orElseSucceed(() => false))

  /** Whether what the thread's agent is given next is a compaction (`COMPACT`), in the order turns take their input. */
  const compactsNext = (running: Running) =>
    run(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const waiting = yield* sql<{ id: string; body: string }>`
            SELECT id, body FROM user_inputs WHERE thread_id = ${running.thread.threadId} AND state = 'queued'
            ORDER BY sequence`
        const next = waiting.find((input) => !running.blockedInputs?.has(input.id))
        return next?.body === COMPACT
      }),
    ).pipe(Effect.orElseSucceed(() => false))

  const hasQueued = (threadId: string) =>
    run(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const [one] = yield* sql<{ id: string }>`SELECT id FROM user_inputs WHERE thread_id = ${threadId} AND state = 'queued' LIMIT 1`
        return one !== undefined
      }),
    ).pipe(Effect.orElseSucceed(() => true))

  /** Its queued turn waits for its account's reset, until `out.until`: its card says so once it begins to, and then each time the reset moves. */
  const heldForUsage = (running: Running, out: { readonly agentId: string; readonly accountId: string; readonly until: string }) =>
    Effect.suspend(() => {
      const said = running.usageOut
      running.usageOut = { agentId: out.agentId, accountId: out.accountId, until: out.until }
      return running.thread.role === 'coordinator' ||
        (said?.until === out.until && said.accountId === out.accountId && said.agentId === out.agentId)
        ? Effect.void
        : Effect.ignore(run(touchTask(running.thread.taskId)))
    })

  /** Delivers queued input, one turn at a time, until the session stops. */
  const deliveries = (running: Running) =>
    Effect.forever(
      Effect.gen(function* () {
        yield* Queue.take(running.wake)
        // A lead's turn waits for its worktrees to be set up (Setups.ts), and so has what was said meanwhile: its first, and one
        // after an aside became work, by the person's word or its lead's, whose copy was never set up as an aside (nothing to wait
        // for, an aside's own, or one set up already). It waits before it holds the turn, so the lead can be stopped meanwhile.
        // Its first turn counts the wait as its start.
        if (running.thread.role === 'task') {
          const from = yield* Clock.currentTimeMillis
          yield* setups.ready(running.thread.taskId)
          if (running.brief !== undefined) running.before.session += Math.max(0, (yield* Clock.currentTimeMillis) - from)
        }
        const { thread } = running
        if (running.deliveryHeld === 'recovery') {
          const waiting = yield* run(
            Effect.gen(function* () {
              const sql = yield* SqlClient.SqlClient
              return yield* sql<{ id: string }>`SELECT id FROM user_inputs WHERE thread_id = ${thread.threadId} AND state = 'queued'`
            }),
          )
          if (!waiting.some((input) => !running.blockedInputs?.has(input.id))) return
          running.deliveryHeld = null
        }
        if (running.deliveryHeld === 'transient') {
          const fresh = yield* run(
            Effect.gen(function* () {
              const sql = yield* SqlClient.SqlClient
              return (yield* sql<{ id: string }>`SELECT i.id FROM user_inputs i JOIN actors a ON a.id = i.author_actor_id
                  WHERE i.thread_id = ${thread.threadId} AND i.state = 'queued' AND a.kind = 'person'
                    AND NOT EXISTS (SELECT 1 FROM turn_delivery_inputs di WHERE di.user_input_id = i.id
                      AND di.delivery_id = ${running.heldTurn ?? ''})`).some((input) => !running.blockedInputs?.has(input.id))
            }),
          )
          if (!fresh) return
          running.deliveryHeld = null
        }
        if (running.deliveryHeld === 'usage_limit') {
          const out = yield* run(limits.outAccount(running.account.id))
          if (Option.isSome(out)) {
            yield* heldForUsage(running, out.value)
            yield* Effect.sleep(
              Duration.millis(Math.min(1000, Math.max(1, Date.parse(out.value.until) - (yield* Clock.currentTimeMillis)))),
            )
            if (!running.stopping) yield* Queue.offer(running.wake, undefined)
            return
          }
          running.deliveryHeld = null
          // Back in usage: its card no longer says it waits for the reset.
          if (running.usageOut !== undefined) {
            running.usageOut = undefined
            if (thread.role !== 'coordinator') yield* Effect.ignore(run(touchTask(thread.taskId)))
          }
        }
        // A turn that couldn't be delivered is kept to that turn: the next message wakes the loop again.
        if (thread.role === 'coordinator')
          return yield* running.delivering.withPermits(1)(
            Effect.gen(function* () {
              while (!running.stopping && (yield* deliver(running))) {
                // Each turn may leave more input queued, such as what arrived while it ran.
              }
            }).pipe(contained('Sessions.deliver', () => undefined, running.entry.definition.id)),
          )
        // A lead's or a reviewer's turns, one at a time, each waiting for a place among the agents at work here: what
        // is still queued after one wakes it again, and asks again.
        if (
          running.stopping ||
          !(
            running.brief !== undefined ||
            (yield* hasQueued(thread.threadId)) ||
            (thread.role === 'task' && thread.helper === undefined && (yield* runnableGoal(thread.threadId)) !== null)
          )
        )
          return
        // A compaction is one call of the agent's own, and loads nothing here: it never waits for a place.
        const delivered = (effect: Effect.Effect<boolean, unknown, Store>) =>
          run(effect).pipe(
            Effect.flatMap((more) => (more ? Queue.offer(running.wake, undefined) : Effect.succeed(false))),
            Effect.asVoid,
            Effect.catchCause((cause) => Effect.logWarning('Could not deliver a turn', cause)),
          )
        if (yield* compactsNext(running)) return yield* delivered(running.delivering.withPermits(1)(deliver(running)))
        // News can start a stopped session outside a workflow step. Keep its input queued until
        // this account has usage again, before asking Busy for a place. That wait is the account's,
        // not a place's: it stays off the thread's `waits_for_place`, which says an agent is
        // waited for (its card would say "Waiting", the agents busy, with places free), and
        // which only Busy keeps and lets go. After a restart its queued input starts its agent
        // again (`recoverQueued`), and the wait is found again here.
        const inWorkflow = yield* run(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient
            return (
              (yield* sql`SELECT id FROM runs WHERE task_id = ${thread.taskId} AND state IN ('running', 'suspended') LIMIT 1`).length > 0
            )
          }),
        )
        const out = inWorkflow ? Option.none() : yield* run(limits.outAccount(running.account.id))
        if (Option.isSome(out)) {
          running.deliveryHeld = 'usage_limit'
          yield* heldForUsage(running, out.value)
          yield* Effect.sleep(Duration.millis(Math.min(1000, Math.max(1, Date.parse(out.value.until) - (yield* Clock.currentTimeMillis)))))
          if (!running.stopping) yield* Queue.offer(running.wake, undefined)
          return
        }
        // From asking for a place to being given one: what its turn counts as waiting for one.
        const asked = yield* Clock.currentTimeMillis
        yield* dependencies.gate(
          {
            taskId: thread.taskId,
            threadId: thread.threadId,
            sessionId: running.sessionId,
            review: thread.role === 'reviewer',
            ...(thread.role === 'task' && thread.helper !== undefined ? { helper: thread.threadId } : {}),
            byPerson: running.brief?.byPerson === true,
          },
          (begun) =>
            Effect.flatMap(Clock.currentTimeMillis, (given) => {
              if (running.stopping || running.handover === 'under_way' || threads.get(thread.threadId) !== running)
                return Effect.succeed(false)
              running.begun = begun
              running.before.place += Math.max(0, given - asked)
              return run(running.delivering.withPermits(1)(deliver(running)))
            }).pipe(
              Effect.flatMap((delivered) => (delivered ? Queue.offer(running.wake, undefined) : Effect.succeed(false))),
              Effect.asVoid,
              Effect.catchCause((cause) => Effect.logWarning('Could not deliver a turn', cause)),
              Effect.ensuring(Effect.sync(() => (running.begun = undefined))),
            ),
        )
      }),
    )

  return { deliveries, freshCopies, placement, undoing }
}
