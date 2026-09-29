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
import { NoSession, NotFound, SessionFailed, SessionRunning, type UnknownAgent } from './errors'
import { Instance } from './Instance'
import { Live } from './Live'
import { moveSession, Permissions, type RequestContext } from './Permissions'
import { change, fact, timestamp } from './records'
import { addItem, recorder, transcript } from './threads'

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
  /** The brief the session's first turn starts with, when it took over from another agent. */
  brief: string | undefined
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

/** What a turn says to the agent: the brief when taking over, then each input, an interrupting one first. */
export const promptFor = (inputs: ReadonlyArray<{ readonly body: string; readonly disposition: string }>, brief: string | undefined) => {
  const parts = inputs.map((input) =>
    input.disposition === 'interrupt_and_continue'
      ? `The person interrupted your last turn to say:\n\n${input.body}\n\nTake it into account, and carry on with the task.`
      : input.body,
  )
  if (brief === undefined) return parts.join('\n\n')
  return [brief, ...(parts.length === 0 ? ['Carry on with the task from where it stands.'] : parts)].join('\n\n')
}

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
    setModel(input: { readonly threadId: string; readonly model: string }): Effect.Effect<void, NoSession | SessionFailed | Failure>
    /** Hands the thread to another agent: a new session, briefed with the thread so far (ADR-005). */
    switchAgent(input: {
      readonly threadId: string
      readonly agentId: string
      readonly model?: string
    }): Effect.Effect<string, NotFound | UnknownAgent | SessionFailed | Failure>
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
              coalesce(b.default_base_ref, w.base_ref) AS default_branch
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
          const prompt = promptFor(inputs, running.brief)
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
                payload: { inputs: inputs.map((input) => input.id), briefed: running.brief !== undefined },
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
          const streamed = yield* Stream.runForEach(running.agent.prompt(prompt), (event) =>
            Effect.gen(function* () {
              if (event._tag === 'TurnEnded') ended = event
              yield* items.record(event)
              yield* live.publish({ _tag: 'Agent', threadId: thread.threadId, event })
            }),
          ).pipe(Effect.exit)
          yield* items.flush
          running.turnRunning = false

          const failure = Exit.isFailure(streamed) ? Cause.findErrorOption(streamed.cause) : Option.none()
          const errorClass = Option.isSome(failure)
            ? failure.value._tag === 'AgentRequestFailed'
              ? failure.value.failure
              : failure.value._tag === 'AgentExited'
                ? 'agent_exited'
                : 'turn_in_progress'
            : Exit.isFailure(streamed)
              ? 'unknown'
              : ended?.failure?.failure
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
            }),
          )
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
          return true
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
          yield* live.publish({ _tag: 'SessionEnded', threadId: running.thread.threadId, sessionId: running.sessionId, state })
          yield* Deferred.succeed(running.ended, undefined)
        })

      const launch = (
        thread: ThreadContext,
        sessionId: string,
        entry: AgentEntry,
        options: { readonly model?: string; readonly brief?: string },
      ) =>
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
            rules: { worktree: thread.worktree, defaultBranch: thread.defaultBranch },
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
              if (options.model !== undefined) yield* agent.setOption(definition.options.model, options.model)
              return { connection, agent }
            }).pipe(Scope.provide(scope)),
          )
          if (Exit.isFailure(started)) {
            yield* Scope.close(scope, Exit.void)
            const reason = Cause.pretty(started.cause)
            yield* sql.withTransaction(
              Effect.gen(function* () {
                if (processId !== undefined) yield* change('processes', processId, { state: 'unknown', endedAt: yield* timestamp })
                const revision = yield* moveSession(sessionId, 'failed', { endedAt: yield* timestamp })
                yield* sessionFact(thread, sessionId, revision, 'provider_session.failed', { reason })
              }),
            )
            return yield* new SessionFailed({ agentId: definition.id, reason })
          }
          const { connection, agent } = started.value
          const options_ = yield* agent.options
          yield* sql.withTransaction(
            Effect.gen(function* () {
              if (processId !== undefined && connection.process !== undefined) {
                yield* change('processes', processId, {
                  pid: connection.process.pid,
                  processGroupId: connection.process.pid,
                  osStartedAt: connection.process.osStartedAt ?? null,
                  environmentDigest: connection.process.environmentDigest,
                  state: 'running',
                })
              }
              const revision = yield* moveSession(sessionId, 'active', {
                externalSessionId: agent.sessionId,
                model: optionValue(options_, definition.options.model),
                effort: optionValue(options_, definition.options.effort),
                config: JSON.stringify({ mode: yield* agent.mode, agent: connection.info, options: options_ }),
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
            brief: options.brief,
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
                  Effect.andThen(between.record(event), between.flush),
                  live.publish({ _tag: 'Agent', threadId: thread.threadId, event }),
                ),
              ),
            ),
            scope,
          )
          yield* Effect.forkIn(run(supervise(running)), sessionsScope)
          const model = optionValue(options_, definition.options.model)
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

      const start = (input: { readonly threadId: string; readonly agentId: string; readonly model?: string }) =>
        Effect.gen(function* () {
          if (threads.has(input.threadId)) return yield* new SessionRunning({ threadId: input.threadId })
          const thread = yield* loadThread(input.threadId)
          const entry = yield* (yield* Agents).get(input.agentId)
          const sessionId = yield* createSession(thread, entry.definition.id)
          return yield* launch(thread, sessionId, entry, input.model === undefined ? {} : { model: input.model })
        })

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
            .pipe(Effect.mapError((error) => new SessionFailed({ agentId: definition.id, reason: error.message })))
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

      /** The brief a new agent starts from: the task, where it stands, and the thread so far. */
      const briefFor = (thread: ThreadContext, from: string | undefined) =>
        Effect.gen(function* () {
          const record = yield* transcript(thread.threadId, PROMPT_BUDGET)
          return [
            `You are taking over a task${from === undefined ? '' : ` from ${from}`}, in the same worktree. Its record so far is below.`,
            `Task: ${thread.title}${thread.description === '' ? '' : `\n\n${thread.description}`}`,
            `The worktree is ${thread.worktree}, on the branch ${thread.branch}. Check its state with git before you change anything.`,
            record.omitted > 0
              ? `The thread so far, oldest first (the ${record.omitted} earliest items are left out):`
              : 'The thread so far, oldest first:',
            record.text === '' ? '(nothing yet)' : record.text,
          ].join('\n\n')
        })

      const switchAgent = (input: { readonly threadId: string; readonly agentId: string; readonly model?: string }) =>
        Effect.gen(function* () {
          const thread = yield* loadThread(input.threadId)
          const entry = yield* (yield* Agents).get(input.agentId)
          const previous = threads.get(input.threadId)
          const from = previous?.entry.definition.name
          const sessionId = yield* createSession(thread, entry.definition.id)
          if (previous !== undefined) yield* stopRunning(previous, { state: 'superseded', by: sessionId })
          yield* addItem({ projectId: thread.projectId, threadId: thread.threadId, sessionId }, 'notice', {
            source: 'runtime',
            severity: 'info',
            title: from === undefined ? `${entry.definition.name} takes over.` : `Switched from ${from} to ${entry.definition.name}.`,
          })
          const brief = yield* briefFor(thread, from)
          return yield* launch(thread, sessionId, entry, { brief, ...(input.model === undefined ? {} : { model: input.model }) })
        })

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
        stop: (threadId) => {
          const running = threads.get(threadId)
          return running === undefined ? Effect.fail(new NoSession({ threadId })) : stopRunning(running, { state: 'completed' })
        },
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
