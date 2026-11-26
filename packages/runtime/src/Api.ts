import {
  apiVersionRefusal,
  BACKGROUND,
  BEHIND_CALLS,
  LANE_HEADER,
  ClientAuthority,
  SocketAllowed,
  type MessageSender,
  type ClientIdentity,
  Api,
  type ApiHandlers,
  apiLayer,
  ApiError,
  type PortLike,
  serverProtocol,
} from '@althar/contracts'
import { Database } from '@althar/persistence-sqlite'
import { Context, Effect, Layer, type Schema, Semaphore } from 'effect'
import { RpcServer, type RpcMiddleware } from 'effect/rpc'
import { SqlClient } from 'effect/sql'

import { failuresLayer } from './Failures'
import { Folders } from './Folders'
import { Instance } from './Instance'
import { Nudges } from './Nudges'
import { ApiCommands } from './ApiCommands'
import { ClientIdentities } from './ClientIdentities'
import { CurrentClient } from './ClientContext'
import { UsageData } from './UsageData'
import { Queries } from './Queries'
import { Foreground } from './spawner'
import * as Runtime from './Runtime'
import { apiKit, ConnectionSender } from './api/kit'
import { homeHandlers } from './api/home'
import { devicesHandlers } from './api/devices'
import { attentionHandlers } from './api/attention'
import { projectsHandlers } from './api/projects'
import { tasksHandlers } from './api/tasks'
import { threadsHandlers } from './api/threads'
import { searchHandlers } from './api/search'
import { canvasesHandlers } from './api/canvases'
import { plansHandlers } from './api/plans'
import { reviewsHandlers } from './api/reviews'
import { changesHandlers } from './api/changes'
import { sessionsHandlers } from './api/sessions'
import { modelsHandlers } from './api/models'
import { settingsHandlers } from './api/settings'
import { toolsHandlers } from './api/tools'
import { automationsHandlers } from './api/automations'
import { foldersHandlers } from './api/folders'
import { connectionsHandlers } from './api/connections'
import { accountsHandlers } from './api/accounts'
import { workersHandlers } from './api/workers'
import { launchesHandlers } from './api/launches'
import { skillsHandlers } from './api/skills'
import { coordinatorHandlers } from './api/coordinator'

/*
 * The runtime's side of the API (`@althar/contracts`): each call runs the
 * service that owns it. Commands from the window become the person's commands
 * here, with the window's own command ids, so a retry gets the first one's
 * receipt. Every failure reaches the window as an `ApiError`, in words; what
 * the person can't put right goes to the log whole.
 */

/** The calls two areas would both answer, by name. */
type AnsweredTwice<T> = { [A in keyof T]: keyof T[A] & { [B in Exclude<keyof T, A>]: keyof T[B] }[Exclude<keyof T, A>] }[keyof T]

/** Every area's handlers, as long as no call is answered by two of them: where one is, `'none'` doesn't compile, and the error names it. */
const answeredOnce = <T extends Readonly<Record<string, object>>>(
  areas: T,
  _twice: [AnsweredTwice<T>] extends [never] ? 'none' : AnsweredTwice<T>,
) => areas

/**
 * Every call's handler, built once a connection: the kit (`api/kit.ts`), then each area's handlers, from its module
 * (`api/<area>.ts`), in the contract's order. A new call's handler goes in its area's module, never here; what more than
 * one area uses goes in the kit. A command's retry is answered by the connection's middleware (`ApiCommands`), across
 * connections and restarts, so no handler does anything of its own for it.
 */
export const handlers = apiLayer(
  Effect.gen(function* () {
    const kit = yield* apiKit
    const areas = answeredOnce(
      {
        home: yield* homeHandlers(kit),
        devices: yield* devicesHandlers(kit),
        attention: yield* attentionHandlers,
        projects: yield* projectsHandlers(kit),
        tasks: yield* tasksHandlers(kit),
        threads: yield* threadsHandlers(kit),
        search: yield* searchHandlers(kit),
        canvases: yield* canvasesHandlers(kit),
        plans: yield* plansHandlers(kit),
        reviews: yield* reviewsHandlers(kit),
        changes: yield* changesHandlers(kit),
        sessions: yield* sessionsHandlers(kit),
        models: yield* modelsHandlers(kit),
        settings: yield* settingsHandlers(kit),
        tools: yield* toolsHandlers(kit),
        automations: yield* automationsHandlers(kit),
        folders: yield* foldersHandlers(kit),
        connections: yield* connectionsHandlers(kit),
        accounts: yield* accountsHandlers(kit),
        workers: yield* workersHandlers(kit),
        launches: yield* launchesHandlers(kit),
        skills: yield* skillsHandlers(kit),
        coordinator: yield* coordinatorHandlers(kit),
      },
      'none',
    )
    return {
      ...areas.home,
      ...areas.devices,
      ...areas.attention,
      ...areas.projects,
      ...areas.tasks,
      ...areas.threads,
      ...areas.search,
      ...areas.canvases,
      ...areas.plans,
      ...areas.reviews,
      ...areas.changes,
      ...areas.sessions,
      ...areas.models,
      ...areas.settings,
      ...areas.tools,
      ...areas.automations,
      ...areas.folders,
      ...areas.connections,
      ...areas.accounts,
      ...areas.workers,
      ...areas.launches,
      ...areas.skills,
      ...areas.coordinator,
    } satisfies ApiHandlers
  }),
)

/** How many reads nobody waits on run at once (`BACKGROUND`): a few, so a press always finds the thread all but free. */
export const BEHIND_AT_ONCE = 2

/**
 * The lane every connection's background reads share: the reads the window's
 * change feed starts to keep what a screen holds current. They run a few at a
 * time, in turn; a command, a read a screen waits on and a watch never queue
 * here, so however many changes an agent makes, a press is answered next.
 */
export class Behind extends Context.Service<Behind, Semaphore.Semaphore>()('@althar/runtime/Behind') {
  static readonly layer: Layer.Layer<Behind> = Layer.effect(Behind, Semaphore.make(BEHIND_AT_ONCE))
}

/** The runtime's services: the store, this launch, and everything the API calls. Built once per launch. */
export const services = (options: Runtime.RuntimeLayerOptions) =>
  Layer.mergeAll(Nudges.layer, UsageData.layer, Folders.layer, Behind.layer).pipe(
    Layer.provideMerge(Queries.layer),
    Layer.provideMerge(Runtime.layer(options)),
    // Below everything, so a failure kept anywhere is said through the one listener.
    Layer.provideMerge(failuresLayer),
  )

/** One client's connection: the API served over its port, until the port closes. Each window gets one. */
export const connection = (port: PortLike, sender: MessageSender, authenticated?: ClientIdentity) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const instance = yield* Instance
      const identities = yield* ClientIdentities
      const commands = yield* ApiCommands
      const sql = yield* SqlClient.SqlClient
      const behind = yield* Behind
      const identity: ClientIdentity = Object.freeze({
        ...(authenticated ?? {
          homeId: instance.homeId,
          actorId: instance.personId,
          deviceId: sender.kind === 'paired_device' ? sender.deviceId : instance.deviceId,
          role: sender.kind,
        }),
      })
      // Provenance follows the verified identity, even if an adapter supplied an inconsistent sender.
      const authority: MessageSender =
        identity.role === 'paired_device' ? { kind: 'paired_device', deviceId: identity.deviceId } : { kind: identity.role }
      let revoked = false
      const closing = new Set<() => void>()
      const guarded: PortLike = {
        post: (message) => {
          if (!revoked) port.post(message)
        },
        listen: (handler) =>
          port.listen((message) => {
            if (!revoked) handler(message)
          }),
        closed: (handler) => {
          closing.add(handler)
          const stop = port.closed?.(handler)
          return () => {
            closing.delete(handler)
            stop?.()
          }
        },
        close: () => port.close?.(),
      }
      const revoke = yield* identities.watchRevocation(identity.deviceId)
      yield* Effect.forkScoped(
        Effect.andThen(
          revoke,
          Effect.sync(() => {
            revoked = true
            port.close?.()
            for (const close of closing) close()
            closing.clear()
          }),
        ),
      )
      return RpcServer.layer(Api).pipe(
        Layer.provide(
          handlers.pipe(Layer.provide(Layer.merge(Layer.succeed(ConnectionSender, authority), Layer.succeed(CurrentClient, identity)))),
        ),
        Layer.provide(
          Layer.succeed(ClientAuthority, (effect, { rpc, headers, payload }) =>
            Effect.gen(function* () {
              const refusal = apiVersionRefusal(headers)
              if (refusal !== undefined) return yield* refusal
              yield* identities.check(identity)
              if (identity.role === 'socket' && !Context.get(rpc.annotations, SocketAllowed))
                return yield* new ApiError({
                  reason: 'PersonRequired',
                  message: 'This home doesn’t take that from this connection yet.',
                })
              const background = headers[LANE_HEADER] === BACKGROUND && BEHIND_CALLS.has(rpc._tag)
              const prioritized = effect.pipe(
                Effect.provideService(Foreground, !background),
                Effect.provideService(Database.ReadPriority, background ? 'background' : 'interactive'),
              )
              const positioned = Effect.flatMap(prioritized, (value) => {
                if (typeof value !== 'object' || value === null || !('cursor' in value) || typeof value.cursor !== 'number')
                  return Effect.succeed(value)
                const cursor = value.cursor
                return Effect.gen(function* () {
                  const [entry] = yield* sql<{ checkpoint: string }>`SELECT checkpoint FROM change_log WHERE cursor = ${cursor}`.pipe(
                    Effect.mapError(
                      () =>
                        new ApiError({ reason: 'SnapshotRequired', message: 'Althar could not confirm this snapshot’s history position.' }),
                    ),
                  )
                  if (cursor > 0 && entry === undefined)
                    return yield* new ApiError({
                      reason: 'SnapshotRequired',
                      message: 'The change history moved while this snapshot was read. Read it again.',
                    })
                  return { ...value, position: { homeId: instance.homeId, cursor, checkpoint: entry?.checkpoint ?? null } }
                })
              })
              if (typeof payload !== 'object' || payload === null || !('commandId' in payload) || typeof payload.commandId !== 'string')
                // A large read nobody waits on goes behind, a few at a time. Never a watch, which would keep its place for good.
                return yield* background ? behind.withPermits(1)(positioned) : positioned
              // Effect RPC erases the handler's success type in middleware. The schema and effect come from the same validated RPC definition.
              const result = rpc.successSchema as Schema.Codec<RpcMiddleware.SuccessValue, unknown>
              const handle = Effect.andThen(identities.check(identity), positioned).pipe(
                Effect.catch((error) =>
                  Effect.fail(
                    error instanceof ApiError
                      ? error
                      : new ApiError({ reason: 'RequestFailed', message: 'Althar could not complete this action.' }),
                  ),
                ),
              )
              return yield* commands.execute({ identity, commandId: payload.commandId, method: rpc._tag, payload, result, handle })
            }),
          ),
        ),
        Layer.provide(serverProtocol(guarded)),
      )
    }),
  )

/**
 * The runtime serving the API over one port. Closing the layer's scope stops
 * every session and ends the launch.
 */
export const serve = (port: PortLike, options: Runtime.RuntimeLayerOptions, sender: MessageSender) =>
  connection(port, sender).pipe(Layer.provideMerge(services(options)))
