import { ApiError, CommandId, decodeWire, encodeWire, type ClientIdentity } from '@althar/contracts'
import { canonicalJson, sha256Hex } from '@althar/persistence-sqlite'
import { now } from '@althar/domain'
import { Cause, Context, Deferred, Effect, Exit, Layer, Option, Schema, Scope, Semaphore } from 'effect'
import { SqlClient } from 'effect/sql'

import { Instance } from './Instance'

const MAX_IN_FLIGHT = 128
const MAX_PER_DEVICE = 16
const unknownOutcome = () =>
  new ApiError({
    reason: 'CommandOutcomeUnknown',
    message: 'Althar stopped before it could confirm this action. Check what happened before starting it again with a new command.',
  })
const unavailable = () =>
  new ApiError({ reason: 'CommandUnavailable', message: 'Althar could not record this action. Its outcome is not confirmed.' })

interface Request<A, I, R> {
  readonly identity: ClientIdentity
  readonly commandId: string
  readonly method: string
  readonly payload: unknown
  readonly result: Schema.Codec<A, I>
  readonly handle: Effect.Effect<A, ApiError, R>
}
interface Stored {
  readonly requestDigest: string
  readonly runtimeInstanceId: string
  readonly state: 'pending' | 'succeeded' | 'failed' | 'uncertain'
  readonly result: string | null
  readonly error: string | null
}

/**
 * Admission and receipts for API commands carrying commandId, shared by all connections.
 * Database transactions cover admission and completion only, never external I/O.
 * The admitted effect belongs to the runtime scope, not the requesting socket.
 * A process loss leaves an explicit uncertain outcome; it never replays an external action.
 */
export class ApiCommands extends Context.Service<
  ApiCommands,
  {
    execute<A, I, R>(request: Request<A, I, R>): Effect.Effect<A, ApiError, R>
  }
>()('@althar/runtime/ApiCommands') {
  static readonly layer = Layer.effect(
    ApiCommands,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const instance = yield* Instance
      const scope = yield* Effect.scope
      const admission = yield* Semaphore.make(1)
      const pending = new Map<string, Deferred.Deferred<unknown, ApiError>>()
      const byDevice = new Map<string, number>()
      const encodeError = (error: ApiError) => JSON.stringify(Schema.encodeSync(ApiError)(error))

      yield* sql`UPDATE api_commands SET state = 'uncertain', error = ${encodeError(unknownOutcome())}, completed_at = ${yield* now}
      WHERE state = 'pending' AND runtime_instance_id <> ${instance.id}`

      const execute = <A, I, R>(request: Request<A, I, R>): Effect.Effect<A, ApiError, R> =>
        Effect.gen(function* () {
          yield* Schema.decodeUnknownEffect(CommandId)(request.commandId).pipe(
            Effect.mapError(() => new ApiError({ reason: 'InvalidCommand', message: 'This action has an invalid command id.' })),
          )
          const key = `${request.identity.actorId}:${request.commandId}`
          const digest = yield* Effect.try({
            try: () => sha256Hex(canonicalJson({ method: request.method, identity: request.identity, payload: request.payload })),
            catch: () => new ApiError({ reason: 'InvalidCommand', message: 'This action could not be encoded.' }),
          })
          // A command must not inherit the RPC request's resource scope after admission.
          const context = (yield* Effect.context<R>()).pipe(Context.omit(Scope.Scope))
          const admitted = yield* admission.withPermit(
            Effect.gen(function* () {
              const [stored] = yield* sql<Stored>`SELECT request_digest, runtime_instance_id, state, result, error FROM api_commands
          WHERE actor_id = ${request.identity.actorId} AND command_id = ${request.commandId}`
              if (stored !== undefined) {
                if (stored.requestDigest !== digest)
                  return yield* new ApiError({
                    reason: 'CommandIdReused',
                    message: 'This command id was already used for a different action or device.',
                  })
                if (stored.state === 'succeeded') return { kind: 'stored' as const, value: stored.result }
                if (stored.state === 'failed' || stored.state === 'uncertain') {
                  return yield* Schema.decodeUnknownEffect(ApiError)(JSON.parse(stored.error ?? '{}')).pipe(Effect.flatMap(Effect.fail))
                }
                const running = pending.get(key)
                if (running !== undefined && stored.runtimeInstanceId === instance.id) return { kind: 'waiting' as const, running }
                return yield* unknownOutcome()
              }
              if (pending.size >= MAX_IN_FLIGHT || (byDevice.get(request.identity.deviceId) ?? 0) >= MAX_PER_DEVICE) {
                return yield* new ApiError({
                  reason: 'CommandCapacity',
                  message: 'Althar is handling too many actions from this device. Try again once they finish.',
                })
              }
              const running = yield* Deferred.make<unknown, ApiError>()
              yield* sql`INSERT INTO api_commands ${sql.insert({
                actorId: request.identity.actorId,
                commandId: request.commandId,
                homeId: request.identity.homeId,
                deviceId: request.identity.deviceId,
                role: request.identity.role,
                method: request.method,
                requestDigest: digest,
                runtimeInstanceId: instance.id,
                state: 'pending',
                receivedAt: yield* now,
              })}`
              pending.set(key, running)
              byDevice.set(request.identity.deviceId, (byDevice.get(request.identity.deviceId) ?? 0) + 1)
              const perform = Effect.uninterruptibleMask((restore) =>
                Effect.gen(function* () {
                  const exit = yield* Effect.exit(
                    restore(
                      Effect.scoped(
                        request.handle.pipe(
                          Effect.provideContext(context),
                          Effect.flatMap(Schema.encodeEffect(request.result)),
                          Effect.flatMap((value) => Effect.try(() => encodeWire(value))),
                        ),
                      ),
                    ),
                  )
                  const completedAt = yield* now
                  if (Exit.isSuccess(exit)) {
                    const encoded = exit.value
                    yield* sql`UPDATE api_commands SET state = 'succeeded', result = ${encoded}, completed_at = ${completedAt}
              WHERE actor_id = ${request.identity.actorId} AND command_id = ${request.commandId} AND state = 'pending'`
                    yield* Deferred.succeed(running, decodeWire(encoded))
                  } else {
                    const failure = Cause.findErrorOption(exit.cause)
                    const error = Option.isSome(failure) && failure.value instanceof ApiError ? failure.value : unknownOutcome()
                    const uncertain = error.reason === 'CommandOutcomeUnknown'
                    yield* sql`UPDATE api_commands SET state = ${uncertain ? 'uncertain' : 'failed'}, error = ${encodeError(error)}, completed_at = ${completedAt}
              WHERE actor_id = ${request.identity.actorId} AND command_id = ${request.commandId} AND state = 'pending'`
                    yield* Deferred.fail(running, error)
                  }
                }),
              ).pipe(
                Effect.catchCause((cause) =>
                  Effect.andThen(
                    Effect.logError('Could not finish an API command receipt', cause),
                    Deferred.fail(running, unknownOutcome()),
                  ),
                ),
                Effect.ensuring(
                  Effect.sync(() => {
                    pending.delete(key)
                    const remaining = (byDevice.get(request.identity.deviceId) ?? 1) - 1
                    if (remaining === 0) byDevice.delete(request.identity.deviceId)
                    else byDevice.set(request.identity.deviceId, remaining)
                  }),
                ),
              )
              // Admission and launch are one uninterruptible step: a disappearing client cannot strand a new intent.
              yield* Effect.forkIn(Effect.interruptible(perform), scope)
              return { kind: 'waiting' as const, running }
            }).pipe(
              Effect.uninterruptible,
              Effect.mapError((error) => (error instanceof ApiError ? error : unavailable())),
            ),
          )
          const value =
            admitted.kind === 'stored'
              ? yield* Effect.try({ try: () => decodeWire(admitted.value ?? ''), catch: unavailable })
              : yield* Deferred.await(admitted.running)
          return yield* Schema.decodeUnknownEffect(request.result)(value).pipe(Effect.mapError(unavailable))
        })
      return ApiCommands.of({ execute })
    }),
  )
}
