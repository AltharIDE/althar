import { type CommandEnvelope, Ids, newId, type ProjectId } from '@charrette/domain'
import { Commands, type CommandIdReused, Ledger, type RevisionConflict, type RowNotFound } from '@charrette/persistence-sqlite'
import {
  type AgentConnection,
  type AgentSession,
  connect,
  type ConfigOption,
  type SessionEvent,
  type StopReport,
} from '@charrette/provider-adapters'
import { Cause, Context, Crypto, Deferred, Duration, Effect, Exit, Layer, Option, Queue, Schema, Scope, Semaphore, Stream } from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'

import { Agents, type AgentEntry } from './Config'
import { ModelUnchanged, NoSession, NotFound, SessionFailed, SessionRunning, type UnknownAgent } from './errors'
import { Instance } from './Instance'
import { Live } from './Live'
import { moveSession, Permissions, type RequestContext } from './Permissions'
import { change, fact, timestamp } from './records'
import { git } from './git'
import { addItem, recorder, transcript } from './threads'
import { agentSaid, summarize } from './words'

/*
 * Agent sessions on a task's thread (docs/architecture/03). The runtime
 * starts the agent as a process it records, starts a session in the mode
 * that asks, and delivers the thread's input to it one turn at a time.
 * Everything the agent says becomes thread items; every turn, session and
 * process is recorded with how it ended.
 *
 * Input is accepted into the thread's queue first, durably, and delivered
 * after (docs/architecture/01): `after_current` waits for the turn running,
 * `interrupt_and_continue` stops it and goes first.
 */

export type Disposition = 'after_current' | 'interrupt_and_continue'

export const AcceptedInput = Schema.Struct({ inputId: Schema.String, sequence: Schema.Int })
export type AcceptedInput = typeof AcceptedInput.Type

interface ThreadContext {
  readonly threadId: string
  readonly projectId: ProjectId
  readonly taskId: string
  readonly title: string
  readonly description: string
  readonly worktree: string
  readonly branch: string
  readonly baseRef: string
  readonly baseCommit: string | null
  readonly defaultBranch: string
}

interface Running {
  readonly sessionId: string
  readonly entry: AgentEntry
  readonly thread: ThreadContext
  readonly agent: AgentSession
  readonly connection: AgentConnection
  readonly scope: Scope.Closeable
  readonly wake: Queue.Queue<void>
  /** Held while a turn is delivered, so stopping waits for the turn to be recorded. */
  readonly delivering: Semaphore.Semaphore
  readonly stopRequest: Deferred.Deferred<StopRequest>
  readonly ended: Deferred.Deferred<void>
  /** The brief the session's first turn starts with, and what it asks for when no input is waiting. */
  brief: { readonly text: string; readonly closing: string } | undefined
  turnRunning: boolean
  stopping: boolean
}

type StopRequest = { readonly state: 'completed' } | { readonly state: 'superseded'; readonly by: string }

type Store = SqlClient.SqlClient | Ledger | Commands | Crypto.Crypto | Instance | Live | Agents | Permissions
type Failure = SqlError.SqlError | Schema.SchemaError | CommandIdReused | RowNotFound | RevisionConflict

const PROMPT_BUDGET = 60_000

const optionValue = (options: ReadonlyArray<ConfigOption>, id: string | undefined) => {
  const value = id === undefined ? undefined : options.find((option) => option.id === id)?.currentValue
  return typeof value === 'string' ? value : null
}

/**
 * What a turn says to the agent: the brief when the session is new, then each
 * input, an interrupting one first. With no input waiting, a new session is
 * told what to do by `closing`.
 */
export const promptFor = (
  inputs: ReadonlyArray<{ readonly body: string; readonly disposition: string }>,
  brief: { readonly text: string; readonly closing: string } | undefined,
) => {
  const parts = inputs.map((input) =>
    input.disposition === 'interrupt_and_continue'
      ? `The person interrupted your last turn to say:\n\n${input.body}\n\nTake it into account, and carry on with the task.`
      : input.body,
  )
  if (brief === undefined) return parts.join('\n\n')
  return [brief.text, ...(parts.length === 0 ? [brief.closing] : parts)].join('\n\n')
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
const STREAM_EVERY = 80

export class Sessions extends Context.Service<
  Sessions,
  {
    /** Starts an agent session on a task's thread, in the task's worktree. */
    start(input: {
      readonly threadId: string
      readonly agentId: string
      readonly model?: string
    }): Effect.Effect<string, SessionRunning | NotFound | UnknownAgent | SessionFailed | Failure>
    /** Accepts input into the thread's queue, and delivers it when the session can take it. */
    send(input: {
      readonly envelope: CommandEnvelope
      readonly threadId: string
      readonly body: string
      readonly disposition?: Disposition
    }): Effect.Effect<AcceptedInput, NotFound | Failure>
    /** Changes the session's model; the session and its context carry on. */
    setModel(input: { readonly threadId: string; readonly model: string }): Effect.Effect<void, NoSession | ModelUnchanged | Failure>
    /** Hands the thread to another agent: a new session, briefed with the thread so far (ADR-005). */
    switchAgent(input: {
      readonly threadId: string
      readonly agentId: string
      readonly model?: string
    }): Effect.Effect<string, NotFound | UnknownAgent | SessionFailed | Failure>
    /** Stops the turn running, if there is one; the session waits for what comes next. */
    interrupt(threadId: string): Effect.Effect<void, NoSession>
    /** Stops the thread's session, after ending its turn. */
    stop(threadId: string): Effect.Effect<void, NoSession>
    /** The session running on a thread, if there is one. */
    running(
      threadId: string,
    ): Effect.Effect<Option.Option<{ readonly sessionId: string; readonly agentId: string; readonly turnRunning: boolean }>>
  }
>()('@charrette/runtime/Sessions') {
  static readonly layer: Layer.Layer<Sessions, never, Store> = Layer.effect(
    Sessions,
    Effect.gen(function* () {
      const context = yield* Effect.context<Store>()
      const instance = yield* Instance
      const live = yield* Live
      const permissions = yield* Permissions
      // Sessions live in a scope of their own, closed only after the finalizer below has stopped each one and recorded it.
      const sessionsScope = yield* Scope.fork(yield* Effect.scope, 'sequential')
      const threads = new Map<string, Running>()
      const run = <A, E>(effect: Effect.Effect<A, E, Store>) => Effect.provideContext(effect, context)

      const loadThread = (threadId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [row] = yield* sql<ThreadContext>`
            SELECT t.id AS thread_id, t.project_id, t.task_id, k.title, k.description, w.path AS worktree, w.branch,
              w.base_ref, w.base_commit, coalesce(b.default_base_ref, w.base_ref) AS default_branch
            FROM threads t
            JOIN tasks k ON k.id = t.task_id
            JOIN workspaces w ON w.task_id = t.task_id AND w.device_id = ${instance.deviceId} AND w.state = 'ready'
            JOIN repository_bindings b ON b.id = w.binding_id
            WHERE t.id = ${threadId}`
          return row === undefined ? yield* new NotFound({ kind: 'task thread with a ready worktree', id: threadId }) : row
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

      /** Records a new session, still starting. */
      const createSession = (thread: ThreadContext, agentId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const sessionId = yield* newId(Ids.providerSession)
          yield* sql.withTransaction(
            Effect.gen(function* () {
              yield* sql`INSERT INTO provider_sessions ${sql.insert({
                id: sessionId,
                projectId: thread.projectId,
                threadId: thread.threadId,
                agentId,
                controllerGeneration: 1,
                state: 'starting',
                startedAt: yield* timestamp,
              })}`
              yield* sessionFact(thread, sessionId, 1, 'provider_session.starting', { agentId })
            }),
          )
          return sessionId
        })

      /** Delivers the queued input as one turn, and records it to its end. */
      const deliver = (running: Running) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const { thread } = running
          const inputs = yield* sql<{ id: string; body: string; disposition: string }>`
            SELECT id, body, disposition FROM user_inputs WHERE thread_id = ${thread.threadId} AND state = 'queued'
            ORDER BY disposition = 'interrupt_and_continue' DESC, sequence`
          if (inputs.length === 0 && running.brief === undefined) return false
          const brief = running.brief
          const prompt = promptFor(inputs, brief)
          const turnId = yield* newId(Ids.turnDelivery)
          const [session] = yield* sql<{
            model: string | null
            effort: string | null
          }>`SELECT model, effort FROM provider_sessions WHERE id = ${running.sessionId}`
          yield* sql.withTransaction(
            Effect.gen(function* () {
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
                state: 'pending',
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
            }),
          )
          // Recorded as delivered before the prompt goes out: after a crash, a delivered turn may have acted.
          yield* sql.withTransaction(
            Effect.gen(function* () {
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
            }),
          )
          running.brief = undefined
          running.turnRunning = true
          yield* live.publish({ _tag: 'TurnStarted', threadId: thread.threadId, turnId })

          const items = recorder({
            projectId: thread.projectId,
            threadId: thread.threadId,
            sessionId: running.sessionId,
            deliveryId: turnId,
          })
          let ended: Extract<SessionEvent, { _tag: 'TurnEnded' }> | undefined
          // A failure to record one event doesn't stop the runtime reading the rest of the turn.
          const record = (event: SessionEvent) =>
            items.record(event).pipe(Effect.catchCause((cause) => Effect.logWarning('Could not record an agent event', cause)))
          /*
           * The text being written goes to watching clients whole, at most every
           * STREAM_EVERY, and once more after the last piece, so a long message
           * doesn't cost the square of its length on the way.
           */
          const streaming = { sentAt: 0, trailing: false }
          const sendOpen = Effect.suspend(() => {
            streaming.sentAt = Date.now()
            const open = items.current()
            return open === undefined
              ? Effect.void
              : live.publish({ _tag: 'Streaming', threadId: thread.threadId, itemId: open.id, kind: open.kind, text: open.text })
          })
          const stream = Effect.suspend(() => {
            const wait = STREAM_EVERY - (Date.now() - streaming.sentAt)
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
          const streamed = yield* Stream.runForEach(running.agent.prompt(prompt), (event) =>
            Effect.gen(function* () {
              if (event._tag === 'TurnEnded') ended = event
              yield* record(event)
              yield* live.publish({ _tag: 'Agent', threadId: thread.threadId, event })
              if (event._tag === 'AgentMessage' || event._tag === 'AgentThought') yield* stream
            }),
          ).pipe(Effect.exit)
          yield* items.flush.pipe(Effect.catchCause((cause) => Effect.logWarning('Could not record the end of a message', cause)))
          running.turnRunning = false

          const failure = Exit.isFailure(streamed) ? Cause.findErrorOption(streamed.cause) : Option.none()
          const errorClass = errorClassOf(failure, Exit.isFailure(streamed)) ?? ended?.failure?.failure
          // The agent refused the prompt: nothing was delivered, so the input goes back in the queue.
          const refused = errorClass === 'turn_in_progress'
          const state = errorClass !== undefined ? 'failed' : ended?.stopReason === 'cancelled' ? 'interrupted' : 'completed'
          yield* sql.withTransaction(
            Effect.gen(function* () {
              const revision = yield* change('turn_deliveries', turnId, {
                state,
                stopReason: ended?.stopReason ?? null,
                usage: ended?.usage === undefined ? null : JSON.stringify(ended.usage),
                errorClass: errorClass ?? null,
                endedAt: yield* timestamp,
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
              if (!refused) return
              for (const input of inputs) {
                const inputRevision = yield* change('user_inputs', input.id, { state: 'queued' })
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
          if (refused) {
            running.brief = brief
            // Tried again shortly, rather than straight away.
            yield* Effect.forkIn(Effect.delay(Queue.offer(running.wake, undefined), Duration.seconds(1)), running.scope)
          }
          const resetsAt =
            Option.isSome(failure) && failure.value._tag === 'AgentRequestFailed' ? failure.value.resetsAt : ended?.failure?.resetsAt
          if (errorClass === 'usage_limit') yield* accountLimited(running, resetsAt)
          yield* live.publish({
            _tag: 'TurnEnded',
            threadId: thread.threadId,
            turnId,
            state,
            ...(errorClass === undefined ? {} : { errorClass }),
          })
          return !refused
        })

      /** A usage limit belongs to the account the agent is signed in with (docs/architecture/03). */
      const accountLimited = (running: Running, resetsAt: string | undefined) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const agentId = running.entry.definition.id
          yield* sql.withTransaction(
            Effect.gen(function* () {
              const [known] = yield* sql<{
                id: string
              }>`SELECT id FROM principals WHERE agent_id = ${agentId} AND device_id = ${instance.deviceId} ORDER BY observed_at DESC LIMIT 1`
              const principalId = known?.id ?? (yield* newId(Ids.principal))
              if (known === undefined) {
                yield* sql`INSERT INTO principals ${sql.insert({ id: principalId, agentId, deviceId: instance.deviceId, subjectHint: `${running.entry.definition.name} sign-in`, authMode: 'vendor_cli', observedAt: yield* timestamp })}`
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
                payload: { agentId, resetsAt },
                actorId: instance.systemId,
              })
            }),
          )
        })

      /** Delivers queued input, one turn at a time, until the session stops. */
      const deliveries = (running: Running) =>
        Effect.forever(
          Effect.gen(function* () {
            yield* Queue.take(running.wake)
            yield* running.delivering.withPermits(1)(
              Effect.gen(function* () {
                while (!running.stopping && (yield* deliver(running))) {
                  // Each turn may leave more input queued, such as what arrived while it ran.
                }
              }),
            )
          }),
        )

      /** Ends a session: closes it and its process, and records how both ended. */
      const supervise = (running: Running) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const outcome = yield* Effect.raceFirst(
            Effect.map(running.connection.closed, () => undefined),
            Deferred.await(running.stopRequest),
          )
          running.stopping = true
          threads.delete(running.thread.threadId)
          yield* permissions.withdrawAll(running.sessionId)
          yield* Scope.close(running.scope, Exit.void)
          const stop: StopReport | undefined =
            running.connection.process === undefined ? undefined : yield* running.connection.process.stopped
          const exit = yield* running.connection.closed.pipe(Effect.timeoutOption(Duration.seconds(3)))
          const state = outcome === undefined ? 'lost' : outcome.state
          yield* sql.withTransaction(
            Effect.gen(function* () {
              const at = yield* timestamp
              if (running.connection.process !== undefined) {
                const [process] = yield* sql<{
                  id: string
                }>`SELECT id FROM processes WHERE provider_session_id = ${running.sessionId} ORDER BY launched_at DESC LIMIT 1`
                if (process !== undefined) {
                  yield* change('processes', process.id, {
                    state: stop !== undefined && stop.signal !== 'none' ? 'killed' : 'exited',
                    exitCode: Option.isSome(exit) ? exit.value.code : null,
                    signal: stop !== undefined && stop.signal !== 'none' ? stop.signal : Option.isSome(exit) ? exit.value.signal : null,
                    endedAt: at,
                  })
                }
              }
              // A turn cut short by the agent going leaves no end of its own.
              const open = yield* sql<{
                id: string
              }>`SELECT id FROM turn_deliveries WHERE provider_session_id = ${running.sessionId} AND state IN ('pending', 'delivered')`
              for (const turn of open) {
                const revision = yield* change('turn_deliveries', turn.id, { state: 'failed', errorClass: 'agent_exited', endedAt: at })
                yield* fact({
                  projectId: running.thread.projectId,
                  aggregateType: 'turn_delivery',
                  aggregateId: turn.id,
                  revision,
                  type: 'turn_delivery.failed',
                  actorId: instance.systemId,
                })
              }
              const revision = yield* moveSession(running.sessionId, state, {
                endedAt: at,
                ...(outcome?.state === 'superseded' ? { supersededBySessionId: outcome.by } : {}),
              })
              yield* sessionFact(
                running.thread,
                running.sessionId,
                revision,
                `provider_session.${state}`,
                stop === undefined ? {} : { stop },
              )
            }),
          )
          // An agent that goes on its own leaves a line in the thread, so the person knows why nothing is happening.
          if (state === 'lost')
            yield* addItem(
              { projectId: running.thread.projectId, threadId: running.thread.threadId, sessionId: running.sessionId },
              'notice',
              {
                source: 'runtime',
                severity: 'warning',
                title: `${running.entry.definition.name} stopped on its own.`,
                description: 'Start the lead again to carry on; it picks up from the thread.',
              },
            )
          yield* live.publish({ _tag: 'SessionEnded', threadId: running.thread.threadId, sessionId: running.sessionId, state })
          yield* Deferred.succeed(running.ended, undefined)
        })

      /**
       * Starts the agent and its session, in the mode that asks, and records
       * its process. The session stays `starting`: it takes over the thread
       * only when `activate` runs, so a failed start leaves the thread as it was.
       */
      const connectSession = (thread: ThreadContext, sessionId: string, entry: AgentEntry, model: string | undefined) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const { definition } = entry
          const transport = entry.transport(thread.worktree)
          const processId = transport._tag === 'Process' ? yield* newId(Ids.process) : undefined
          if (transport._tag === 'Process' && processId !== undefined) {
            // Recorded before it is spawned, so a crash in between leaves a trace to reconcile.
            yield* sql`INSERT INTO processes ${sql.insert({
              id: processId,
              projectId: thread.projectId,
              deviceId: instance.deviceId,
              runtimeInstanceId: instance.id,
              providerSessionId: sessionId,
              purpose: 'agent',
              executable: transport.spec.command,
              argsRedacted: JSON.stringify(transport.spec.args),
              controllerGeneration: 1,
              state: 'launching',
              launchedAt: yield* timestamp,
            })}`
          }
          const requestContext: RequestContext = {
            projectId: thread.projectId,
            threadId: thread.threadId,
            taskId: thread.taskId,
            sessionId,
            meanings: definition.permissions,
            rules: { worktree: thread.worktree, defaultBranch: thread.defaultBranch, taskBranch: thread.branch },
          }
          const scope = yield* Scope.fork(sessionsScope, 'sequential')
          const started = yield* Effect.exit(
            Effect.gen(function* () {
              const connection = yield* connect({
                transport,
                onPermission: (request) => permissions.decide(requestContext, request),
                permissions: definition.permissions,
              })
              const agent = yield* connection.newSession({
                cwd: thread.worktree,
                mode: definition.modes.ask,
                modeOptionId: definition.options.mode,
                ...(definition.sessionMeta === undefined ? {} : { meta: definition.sessionMeta() }),
              })
              if (model !== undefined) yield* agent.setOption(definition.options.model, model)
              return { connection, agent }
            }).pipe(Scope.provide(scope)),
          )
          if (Exit.isFailure(started)) {
            yield* Scope.close(scope, Exit.void)
            const reason = Cause.pretty(started.cause)
            const summary = summarize(started.cause)
            yield* sql.withTransaction(
              Effect.gen(function* () {
                if (processId !== undefined) yield* change('processes', processId, { state: 'unknown', endedAt: yield* timestamp })
                const revision = yield* moveSession(sessionId, 'failed', { endedAt: yield* timestamp })
                yield* sessionFact(thread, sessionId, revision, 'provider_session.failed', { reason })
              }),
            )
            // The thread says why nothing happened, as well as the call that asked.
            yield* addItem({ projectId: thread.projectId, threadId: thread.threadId, sessionId }, 'notice', {
              source: 'runtime',
              severity: 'error',
              title: `${definition.name} couldn't start.`,
              ...(summary === '' ? {} : { description: summary }),
            })
            return yield* new SessionFailed({ agentId: definition.id, reason, summary })
          }
          const { connection, agent } = started.value
          if (processId !== undefined && connection.process !== undefined) {
            yield* change('processes', processId, {
              pid: connection.process.pid,
              processGroupId: connection.process.pid,
              osStartedAt: connection.process.osStartedAt ?? null,
              environmentDigest: connection.process.environmentDigest,
              state: 'running',
            })
          }
          return { sessionId, entry, thread, connection, agent, scope }
        })

      /** The session takes over the thread: it is recorded as active, and delivers the brief and any waiting input. */
      const activate = (
        connected: Effect.Success<ReturnType<typeof connectSession>>,
        brief: { readonly text: string; readonly closing: string },
      ) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const { sessionId, entry, thread, connection, agent, scope } = connected
          const { definition } = entry
          const options = yield* agent.options
          yield* sql.withTransaction(
            Effect.gen(function* () {
              const revision = yield* moveSession(sessionId, 'active', {
                externalSessionId: agent.sessionId,
                model: optionValue(options, definition.options.model),
                effort: optionValue(options, definition.options.effort),
                config: JSON.stringify({ mode: yield* agent.mode, agent: connection.info, options }),
              })
              yield* sessionFact(thread, sessionId, revision, 'provider_session.active', {
                externalSessionId: agent.sessionId,
                mode: yield* agent.mode,
              })
            }),
          )
          const running: Running = {
            sessionId,
            entry,
            thread,
            agent,
            connection,
            scope,
            wake: yield* Queue.sliding<void>(1),
            delivering: yield* Semaphore.make(1),
            stopRequest: yield* Deferred.make<StopRequest>(),
            ended: yield* Deferred.make<void>(),
            brief,
            turnRunning: false,
            stopping: false,
          }
          threads.set(thread.threadId, running)
          yield* Effect.forkIn(run(deliveries(running)), scope)
          // What the agent says between turns, such as leaving plan mode, goes to the thread too.
          const between = recorder({ projectId: thread.projectId, threadId: thread.threadId, sessionId })
          yield* Effect.forkIn(
            run(
              Stream.runForEach(agent.events, (event) =>
                Effect.andThen(
                  Effect.andThen(between.record(event), between.flush).pipe(
                    Effect.catchCause((cause) => Effect.logWarning('Could not record an agent event', cause)),
                  ),
                  live.publish({ _tag: 'Agent', threadId: thread.threadId, event }),
                ),
              ),
            ),
            scope,
          )
          yield* Effect.forkIn(run(supervise(running)), sessionsScope)
          const model = optionValue(options, definition.options.model)
          yield* live.publish({
            _tag: 'SessionStarted',
            threadId: thread.threadId,
            sessionId,
            agentId: definition.id,
            ...(model === null ? {} : { model }),
          })
          yield* Queue.offer(running.wake, undefined)
          return sessionId
        })

      /** Ends the turn running, then the session. */
      const stopRunning = (running: Running, request: StopRequest) =>
        Effect.gen(function* () {
          running.stopping = true
          yield* Effect.ignore(running.agent.interrupt)
          yield* running.delivering.withPermits(1)(Deferred.succeed(running.stopRequest, request))
          yield* Deferred.await(running.ended)
        })

      /** Start, switch and stop on one thread happen one at a time. */
      const locks = new Map<string, Semaphore.Semaphore>()
      const exclusive = <A, E, R>(threadId: string, effect: Effect.Effect<A, E, R>) =>
        Effect.suspend(() => {
          const lock = locks.get(threadId) ?? Semaphore.makeUnsafe(1)
          locks.set(threadId, lock)
          return lock.withPermits(1)(effect)
        })

      const start = (input: { readonly threadId: string; readonly agentId: string; readonly model?: string }) =>
        exclusive(
          input.threadId,
          Effect.gen(function* () {
            if (threads.has(input.threadId)) return yield* new SessionRunning({ threadId: input.threadId })
            const thread = yield* loadThread(input.threadId)
            const entry = yield* (yield* Agents).get(input.agentId)
            const sessionId = yield* createSession(thread, entry.definition.id)
            const connected = yield* connectSession(thread, sessionId, entry, input.model)
            // Every session starts from a brief (ADR-005), even the first on a task.
            return yield* activate(connected, { text: yield* briefFor(thread, { kind: 'start' }), closing: 'Start on the task.' })
          }),
        )

      const send = (input: {
        readonly envelope: CommandEnvelope
        readonly threadId: string
        readonly body: string
        readonly disposition?: Disposition
      }) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const commands = yield* Commands
          const disposition = input.disposition ?? 'after_current'
          const [thread] = yield* sql<{ projectId: ProjectId }>`SELECT project_id FROM threads WHERE id = ${input.threadId}`
          if (thread === undefined) return yield* new NotFound({ kind: 'thread', id: input.threadId })
          const accepted = yield* commands.execute({
            envelope: input.envelope,
            projectId: thread.projectId,
            result: AcceptedInput,
            handle: Effect.gen(function* () {
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
                body: input.body,
                authorActorId: input.envelope.actorId,
                state: 'queued',
                acceptedAt: yield* timestamp,
              })}`
              yield* addItem(
                { projectId: thread.projectId, threadId: input.threadId },
                'user_message',
                { text: input.body },
                { userInputId: inputId },
              )
              yield* fact({
                projectId: thread.projectId,
                aggregateType: 'user_input',
                aggregateId: inputId,
                revision: 1,
                type: disposition === 'interrupt_and_continue' ? 'user_input.interrupt_requested' : 'user_input.accepted',
                payload: { disposition, sequence },
                actorId: input.envelope.actorId,
                commandId: input.envelope.commandId,
              })
              return { inputId, sequence }
            }),
          })
          const running = threads.get(input.threadId)
          if (running !== undefined) {
            // The interruption is asked for after the input is safely queued; the queue puts it first.
            if (disposition === 'interrupt_and_continue' && running.turnRunning)
              yield* Effect.forkIn(Effect.ignore(running.agent.interrupt), sessionsScope)
            yield* Queue.offer(running.wake, undefined)
          }
          return accepted
        })

      const setModel = (input: { readonly threadId: string; readonly model: string }) =>
        Effect.gen(function* () {
          const running = threads.get(input.threadId)
          if (running === undefined) return yield* new NoSession({ threadId: input.threadId })
          const { definition } = running.entry
          const options = yield* running.agent
            .setOption(definition.options.model, input.model)
            .pipe(
              Effect.mapError(
                (error) => new ModelUnchanged({ agentId: definition.id, model: input.model, summary: agentSaid(error) ?? error.message }),
              ),
            )
          const sql = yield* SqlClient.SqlClient
          yield* sql.withTransaction(
            Effect.gen(function* () {
              const revision = yield* change('provider_sessions', running.sessionId, {
                model: optionValue(options, definition.options.model),
                effort: optionValue(options, definition.options.effort),
              })
              yield* sessionFact(running.thread, running.sessionId, revision, 'provider_session.model_changed', { model: input.model })
            }),
          )
          yield* addItem({ projectId: running.thread.projectId, threadId: input.threadId, sessionId: running.sessionId }, 'notice', {
            source: 'runtime',
            severity: 'info',
            title: `Model changed to ${input.model}.`,
          })
        })

      /**
       * The brief a session starts from (ADR-005): the task, where its
       * worktree stands (the plan, and the change so far), and the thread.
       */
      const briefFor = (
        thread: ThreadContext,
        why: { readonly kind: 'start' } | { readonly kind: 'takeover'; readonly from: string | undefined },
      ) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const record = yield* transcript(thread.threadId, PROMPT_BUDGET)
          const [plan] = yield* sql<{ content: string }>`
            SELECT content FROM thread_items WHERE thread_id = ${thread.threadId} AND kind = 'plan' ORDER BY sequence DESC LIMIT 1`
          const entries =
            plan === undefined
              ? []
              : ((JSON.parse(plan.content) as { entries?: ReadonlyArray<{ content: string; status: string }> }).entries ?? [])
          const quiet = (effect: Effect.Effect<string, unknown>) => effect.pipe(Effect.orElseSucceed(() => ''))
          const changed = thread.baseCommit === null ? '' : yield* quiet(git(thread.worktree, 'diff', '--stat', thread.baseCommit))
          const status = yield* quiet(git(thread.worktree, 'status', '--short'))
          const cap = (text: string) => (text.length > 4_000 ? `${text.slice(0, 4_000)}\n…` : text)
          return [
            why.kind === 'start'
              ? 'You are working on a task in a git worktree of its own. Charrette keeps its record and answers your permission requests.'
              : `You are taking over a task${why.from === undefined ? '' : ` from ${why.from}`}, in the same worktree. Its record so far is below.`,
            `Task: ${thread.title}${thread.description === '' ? '' : `\n\n${thread.description}`}`,
            `The worktree is ${thread.worktree}, on the branch ${thread.branch}, which started from ${thread.baseRef}${thread.baseCommit === null ? '' : ` at ${thread.baseCommit.slice(0, 12)}`}.`,
            ...(entries.length === 0 ? [] : [`The plan:\n${entries.map((entry) => `- [${entry.status}] ${entry.content}`).join('\n')}`]),
            ...(changed === '' ? [] : [`Changed since the start:\n${cap(changed)}`]),
            ...(status === '' ? [] : [`Not yet committed:\n${cap(status)}`]),
            ...(record.text === ''
              ? []
              : [
                  record.omitted > 0
                    ? `The thread so far, oldest first (the ${record.omitted} earliest items are left out):`
                    : 'The thread so far, oldest first:',
                  record.text,
                ]),
          ].join('\n\n')
        })

      /**
       * Hands the thread to another agent. The new agent is started first; only
       * once it is ready is the old one stopped, so a switch that fails leaves
       * the old agent working. The brief is written after the old one stops, so
       * it holds everything the old one did.
       */
      const switchAgent = (input: { readonly threadId: string; readonly agentId: string; readonly model?: string }) =>
        exclusive(
          input.threadId,
          Effect.gen(function* () {
            const thread = yield* loadThread(input.threadId)
            const entry = yield* (yield* Agents).get(input.agentId)
            const previous = threads.get(input.threadId)
            const from = previous?.entry.definition.name
            const sessionId = yield* createSession(thread, entry.definition.id)
            const connected = yield* connectSession(thread, sessionId, entry, input.model)
            if (previous !== undefined) yield* stopRunning(previous, { state: 'superseded', by: sessionId })
            yield* addItem({ projectId: thread.projectId, threadId: thread.threadId, sessionId }, 'notice', {
              source: 'runtime',
              severity: 'info',
              title: from === undefined ? `${entry.definition.name} takes over.` : `Switched from ${from} to ${entry.definition.name}.`,
            })
            const brief = yield* briefFor(thread, { kind: 'takeover', from })
            return yield* activate(connected, { text: brief, closing: 'Carry on with the task from where it stands.' })
          }),
        )

      // Quitting stops every session the way `stop` does: the turn ends, the process stops, and both are recorded.
      yield* Effect.addFinalizer(() =>
        Effect.forEach(
          [...threads.values()],
          (running) => Effect.ignore(stopRunning(running, { state: 'completed' }).pipe(Effect.timeout(Duration.seconds(15)))),
          {
            concurrency: 'unbounded',
            discard: true,
          },
        ),
      )

      return Sessions.of({
        start: (input) => run(start(input)),
        send: (input) => run(send(input)),
        setModel: (input) => run(setModel(input)),
        switchAgent: (input) => run(switchAgent(input)),
        interrupt: (threadId) =>
          Effect.suspend(() => {
            const running = threads.get(threadId)
            return running === undefined ? Effect.fail(new NoSession({ threadId })) : Effect.ignore(running.agent.interrupt)
          }),
        stop: (threadId) =>
          exclusive(
            threadId,
            Effect.suspend(() => {
              const running = threads.get(threadId)
              return running === undefined ? Effect.fail(new NoSession({ threadId })) : stopRunning(running, { state: 'completed' })
            }),
          ),
        running: (threadId) =>
          Effect.sync(() => {
            const running = threads.get(threadId)
            return running === undefined
              ? Option.none()
              : Option.some({ sessionId: running.sessionId, agentId: running.entry.definition.id, turnRunning: running.turnRunning })
          }),
      })
    }),
  )
}
