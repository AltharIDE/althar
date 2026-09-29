import { API_VERSION, Api, ApiError, type PortLike, serverProtocol, type WatchEvent } from '@charrette/contracts'
import { Ledger } from '@charrette/persistence-sqlite'
import { signInStatus } from '@charrette/provider-adapters'
import { Crypto, Effect, Layer, Option, Stream } from 'effect'
import { RpcServer } from 'effect/rpc'
import { SqlClient } from 'effect/sql'

import { Agents, RuntimeConfig } from './Config'
import { Instance } from './Instance'
import { Live } from './Live'
import { Permissions } from './Permissions'
import { Projects } from './Projects'
import { Queries } from './Queries'
import * as Runtime from './Runtime'
import { Sessions } from './Sessions'

/*
 * The runtime's side of the API (`@charrette/contracts`): each call runs the
 * service that owns it. Commands from the window become the person's commands
 * here, with their envelope. Every failure reaches the client as an
 * `ApiError` naming what went wrong; the runtime's own types stay inside.
 */

const toApiError = (error: unknown): ApiError => {
  const tag = typeof error === 'object' && error !== null && '_tag' in error ? String(error._tag) : 'Unknown'
  const message =
    typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string' && error.message !== ''
      ? error.message
      : JSON.stringify(error)
  return new ApiError({ reason: tag, message })
}

const api = <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.mapError(effect, toApiError)

/** How often the change feed is read for what a client should refetch. */
const FEED_INTERVAL = '150 millis'

export const handlers = Api.toLayer(
  Effect.gen(function* () {
    const context = yield* Effect.context<Instance | Crypto.Crypto>()
    const projects = yield* Projects
    const sessions = yield* Sessions
    const permissions = yield* Permissions
    const queries = yield* Queries
    const live = yield* Live
    const ledger = yield* Ledger
    const agents = yield* Agents
    const config = yield* RuntimeConfig
    const sql = yield* SqlClient.SqlClient
    const envelope = (type: string, payload: unknown) => Effect.provideContext(Runtime.envelope(type, payload), context)

    /* Changes from the store's feed, from the moment the client asks: the client refetches what shows them. */
    const changes = Stream.unwrap(
      Effect.gen(function* () {
        const [latest] = yield* sql<{ cursor: number }>`SELECT coalesce(max(cursor), 0) AS cursor FROM change_log`
        return Stream.paginate(latest?.cursor ?? 0, (cursor) =>
          Effect.gen(function* () {
            const batch = yield* ledger.changesSince(cursor, 500)
            if (batch.length === 0) yield* Effect.sleep(FEED_INTERVAL)
            const events: ReadonlyArray<WatchEvent> = batch.map((change) => ({
              _tag: 'Changed',
              aggregateType: change.aggregateType,
              aggregateId: change.aggregateId,
              projectId: change.projectId,
            }))
            return [events, Option.some(batch.at(-1)?.cursor ?? cursor)] as const
          }),
        )
      }),
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
      Status: () =>
        api(
          Effect.map(
            Effect.forEach(
              agents.list,
              (entry) =>
                Effect.map(signInStatus(entry.definition), (signIn) => ({
                  id: entry.definition.id,
                  name: entry.definition.name,
                  signIn,
                  login: entry.definition.signIn.login,
                })),
              { concurrency: 'unbounded' },
            ),
            (statuses) => ({ apiVersion: API_VERSION, appVersion: config.appVersion, agents: statuses }),
          ),
        ),
      ListProjects: () => api(queries.projects),
      OpenProject: ({ path }) =>
        api(
          Effect.gen(function* () {
            const opened = yield* projects.open({ envelope: yield* envelope('project.open', { path }), path })
            const all = yield* queries.projects
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
      CreateTask: ({ projectId, title, description }) =>
        api(
          Effect.gen(function* () {
            const created = yield* projects.createTask({
              envelope: yield* envelope('task.create', { projectId, title, description }),
              projectId,
              title,
              ...(description === undefined ? {} : { description }),
            })
            return yield* queries.task(created.taskId)
          }),
        ),
      GetThread: ({ threadId }) => api(queries.thread(threadId)),
      StartSession: ({ threadId, agentId, model }) => api(sessions.start({ threadId, agentId, ...(model === undefined ? {} : { model }) })),
      SwitchAgent: ({ threadId, agentId, model }) =>
        api(sessions.switchAgent({ threadId, agentId, ...(model === undefined ? {} : { model }) })),
      SetModel: ({ threadId, model }) => api(sessions.setModel({ threadId, model })),
      Interrupt: ({ threadId }) => api(sessions.interrupt(threadId)),
      StopSession: ({ threadId }) => api(sessions.stop(threadId)),
      Send: ({ threadId, body, disposition }) =>
        api(
          Effect.gen(function* () {
            yield* sessions.send({ envelope: yield* envelope('thread.send', { threadId, body, disposition }), threadId, body, disposition })
          }),
        ),
      Answer: ({ attentionId, decision, reason }) =>
        api(
          Effect.gen(function* () {
            yield* permissions.answer({
              envelope: yield* envelope('attention.answer', { attentionId, decision, reason }),
              attentionId,
              decision,
              ...(reason === undefined ? {} : { reason }),
            })
          }),
        ),
      Watch: () => Stream.merge(Stream.mapError(changes, toApiError), streaming),
    })
  }),
)

/** The runtime's services: the store, this launch, and everything the API calls. Built once per launch. */
export const services = (options: Runtime.RuntimeLayerOptions) => Queries.layer.pipe(Layer.provideMerge(Runtime.layer(options)))

/** One client's connection: the API served over its port, until the port closes. Each window gets one. */
export const connection = (port: PortLike) => RpcServer.layer(Api).pipe(Layer.provide(handlers), Layer.provide(serverProtocol(port)))

/**
 * The runtime serving the API over one port. Closing the layer's scope stops
 * every session and ends the launch.
 */
export const serve = (port: PortLike, options: Runtime.RuntimeLayerOptions) => connection(port).pipe(Layer.provideMerge(services(options)))
