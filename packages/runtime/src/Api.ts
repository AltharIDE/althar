import { API_VERSION, Api, ApiError, type AgentStatus, type PortLike, serverProtocol, type WatchEvent } from '@charrette/contracts'
import { signInStatus, type SignInStatus } from '@charrette/provider-adapters'
import { Cause, Crypto, Deferred, Duration, Effect, Exit, Layer, Option, Stream } from 'effect'
import { RpcServer } from 'effect/rpc'

import { type AgentEntry, Agents, RuntimeConfig } from './Config'
import { Folders } from './Folders'
import { Instance } from './Instance'
import { Live } from './Live'
import { Permissions } from './Permissions'
import { Projects } from './Projects'
import { Queries } from './Queries'
import * as Runtime from './Runtime'
import { Sessions } from './Sessions'
import { expected, words } from './words'

/*
 * The runtime's side of the API (`@charrette/contracts`): each call runs the
 * service that owns it. Commands from the window become the person's commands
 * here, with the window's own command ids, so a retry gets the first one's
 * receipt. Every failure reaches the window as an `ApiError`, in words; what
 * the person can't put right goes to the log whole.
 */

/** How often the change feed is read for what a client should read again. */
const FEED_INTERVAL = '150 millis'

/** How long an agent's sign-in is taken as it was last checked. */
const SIGN_IN_TTL = Duration.minutes(1)

/** How many session commands' results are kept for retries, per launch. */
const RECENT_COMMANDS = 1_000

export const handlers = Api.toLayer(
  Effect.gen(function* () {
    const context = yield* Effect.context<Instance | Crypto.Crypto>()
    const projects = yield* Projects
    const sessions = yield* Sessions
    const permissions = yield* Permissions
    const queries = yield* Queries
    const folders = yield* Folders
    const live = yield* Live
    const agents = yield* Agents
    const config = yield* RuntimeConfig
    const envelope = (type: string, payload: unknown, commandId: string) =>
      Effect.provideContext(Runtime.envelope(type, payload, commandId), context)
    const agentName = (agentId: string) => agents.list.find((entry) => entry.definition.id === agentId)?.definition.name ?? agentId

    /** A call's failure as the window gets it: in words, and in the log when it isn't the person's to put right. */
    const api = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, ApiError, R> =>
      Effect.catchCause(effect, (cause) => {
        if (Cause.hasInterruptsOnly(cause)) return Effect.interrupt
        const error = Cause.findErrorOption(cause)
        const said = words(Option.getOrUndefined(error), agentName)
        const log =
          Option.isSome(error) && expected.has(said.reason)
            ? Effect.void
            : Effect.logWarning('A call from the window did not succeed', cause)
        return Effect.andThen(log, Effect.fail(new ApiError(said)))
      })

    /*
     * Session commands have no receipts in the store yet (they start and stop
     * processes, outside any transaction), so a retry within the launch gets
     * the first one's result from here. One interrupted before it finished
     * may run again.
     */
    const recent = new Map<string, Deferred.Deferred<unknown, ApiError>>()
    const once = <A>(commandId: string, effect: Effect.Effect<A, ApiError>): Effect.Effect<A, ApiError> =>
      Effect.suspend(() => {
        const seen = recent.get(commandId)
        if (seen !== undefined) return Deferred.await(seen as Deferred.Deferred<A, ApiError>)
        const result = Deferred.makeUnsafe<A, ApiError>()
        recent.set(commandId, result as Deferred.Deferred<unknown, ApiError>)
        const oldest = recent.keys().next().value
        if (recent.size > RECENT_COMMANDS && oldest !== undefined) recent.delete(oldest)
        return Effect.onExit(effect, (exit) =>
          Exit.hasInterrupts(exit) ? Effect.sync(() => recent.delete(commandId)) : Deferred.done(result, exit),
        )
      })

    /* Sign-in, checked at most once a minute: each check starts the agent's own status command. */
    const signIns = new Map<string, { readonly status: SignInStatus; readonly at: number }>()
    const signIn = (entry: AgentEntry, recheck: boolean): Effect.Effect<AgentStatus> =>
      Effect.gen(function* () {
        const known = signIns.get(entry.definition.id)
        const fresh = known !== undefined && Date.now() - known.at < Duration.toMillis(SIGN_IN_TTL)
        const status = !recheck && fresh ? known.status : yield* signInStatus(entry.definition)
        if (recheck || !fresh) signIns.set(entry.definition.id, { status, at: Date.now() })
        return { id: entry.definition.id, name: entry.definition.name, signIn: status, login: entry.definition.signIn.login }
      })

    /* Changes from the store's feed after `since`, or from now: the window reads again what shows them. */
    const changes = (since: number | undefined): Stream.Stream<WatchEvent, ApiError> =>
      Stream.unwrap(
        api(
          Effect.map(since === undefined ? queries.cursor : Effect.succeed(since), (start) =>
            Stream.paginate(start, (cursor) =>
              api(
                Effect.gen(function* () {
                  const batch = yield* queries.changesSince(cursor, 500)
                  if (batch.length === 0) yield* Effect.sleep(FEED_INTERVAL)
                  const events: ReadonlyArray<WatchEvent> = batch.map((change) => ({ _tag: 'Changed', ...change }))
                  return [events, Option.some(batch.at(-1)?.cursor ?? cursor)] as const
                }),
              ),
            ),
          ),
        ),
      )

    /* An agent's message or thought as far as it has streamed, before the store has all of it. */
    const streaming = Stream.unwrap(
      Effect.map(live.subscribe, (events) =>
        events.pipe(
          Stream.flatMap((event): Stream.Stream<WatchEvent> =>
            event._tag === 'Streaming'
              ? Stream.make({ _tag: 'Streaming', threadId: event.threadId, itemId: event.itemId, text: event.text })
              : Stream.empty,
          ),
        ),
      ),
    )

    return Api.of({
      Status: ({ recheck }) =>
        Effect.map(
          Effect.forEach(agents.list, (entry) => signIn(entry, recheck === true), { concurrency: 'unbounded' }),
          (statuses) => ({
            apiVersion: API_VERSION,
            appVersion: config.appVersion,
            agents: statuses,
          }),
        ),
      ListProjects: () => api(queries.projects),
      OpenProject: ({ commandId, grant }) =>
        api(
          Effect.gen(function* () {
            const path = yield* folders.path(grant)
            const opened = yield* projects.open({ envelope: yield* envelope('project.open', { path }, commandId), path })
            const { projects: all } = yield* queries.projects
            const found = all.find((project) => project.id === opened.projectId)
            return (
              found ?? {
                id: opened.projectId,
                name: opened.name,
                slug: opened.slug,
                repository: opened.repository,
                tasks: 0,
                running: 0,
                waiting: 0,
              }
            )
          }),
        ),
      ListTasks: ({ projectId }) => api(queries.tasks(projectId)),
      CreateTask: ({ commandId, projectId, title, description }) =>
        api(
          Effect.gen(function* () {
            const created = yield* projects.createTask({
              envelope: yield* envelope('task.create', { projectId, title, description }, commandId),
              projectId,
              title,
              ...(description === undefined ? {} : { description }),
            })
            return yield* queries.task(created.taskId)
          }),
        ),
      GetThread: ({ threadId, before, limit }) =>
        api(queries.thread(threadId, { ...(before === undefined ? {} : { before }), ...(limit === undefined ? {} : { limit }) })),
      GetThreadItem: ({ threadId, itemId }) => api(queries.item(threadId, itemId)),
      StartSession: ({ commandId, threadId, agentId, model }) =>
        once(commandId, api(sessions.start({ threadId, agentId, ...(model === undefined ? {} : { model }) }))),
      SwitchAgent: ({ commandId, threadId, agentId, model }) =>
        once(commandId, api(sessions.switchAgent({ threadId, agentId, ...(model === undefined ? {} : { model }) }))),
      SetModel: ({ commandId, threadId, model }) => once(commandId, api(sessions.setModel({ threadId, model }))),
      Interrupt: ({ commandId, threadId }) => once(commandId, api(sessions.interrupt(threadId))),
      StopSession: ({ commandId, threadId }) => once(commandId, api(sessions.stop(threadId))),
      Send: ({ commandId, threadId, body, disposition }) =>
        api(
          Effect.gen(function* () {
            yield* sessions.send({
              envelope: yield* envelope('thread.send', { threadId, body, disposition }, commandId),
              threadId,
              body,
              disposition,
            })
          }),
        ),
      Answer: ({ commandId, attentionId, decision, reason }) =>
        api(
          Effect.gen(function* () {
            yield* permissions.answer({
              envelope: yield* envelope('attention.answer', { attentionId, decision, reason }, commandId),
              attentionId,
              decision,
              ...(reason === undefined ? {} : { reason }),
            })
          }),
        ),
      Watch: ({ since }) => Stream.merge(changes(since), streaming),
    })
  }),
)

/** The runtime's services: the store, this launch, and everything the API calls. Built once per launch. */
export const services = (options: Runtime.RuntimeLayerOptions) =>
  Layer.mergeAll(Queries.layer, Folders.layer).pipe(Layer.provideMerge(Runtime.layer(options)))

/** One client's connection: the API served over its port, until the port closes. Each window gets one. */
export const connection = (port: PortLike) => RpcServer.layer(Api).pipe(Layer.provide(handlers), Layer.provide(serverProtocol(port)))

/**
 * The runtime serving the API over one port. Closing the layer's scope stops
 * every session and ends the launch.
 */
export const serve = (port: PortLike, options: Runtime.RuntimeLayerOptions) => connection(port).pipe(Layer.provideMerge(services(options)))
