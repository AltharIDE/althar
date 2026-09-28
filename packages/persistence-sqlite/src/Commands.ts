import { CommandEnvelope, now, type ProjectId } from '@charrette/domain'
import { Context, Effect, Layer, Schema } from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'

import { canonicalJson, sha256Hex } from './canonicalJson'
import { CommandIdReused } from './errors'

interface Receipt {
  readonly commandType: string
  readonly payloadDigest: string
  readonly result: string
}

/**
 * Runs commands exactly once (docs/architecture/02). A command runs in one
 * transaction with its receipt. Receipts are kept per actor: a retry of the
 * same command by the same actor returns the first result without running
 * again; the same id with a different command fails; another actor's id
 * reveals nothing. A command that fails leaves no receipt and no writes, so a
 * retry evaluates it afresh.
 */
export class Commands extends Context.Service<
  Commands,
  {
    execute<A, I, E, R>(options: {
      readonly envelope: CommandEnvelope
      /** The project the command acts in, if any. */
      readonly projectId?: ProjectId
      /** How the result is stored in the receipt and read back on a retry. */
      readonly result: Schema.Codec<A, I>
      readonly handle: Effect.Effect<A, E, R>
    }): Effect.Effect<A, E | CommandIdReused | SqlError.SqlError | Schema.SchemaError, R>
  }
>()('@charrette/persistence-sqlite/Commands') {
  static readonly layer: Layer.Layer<Commands, never, SqlClient.SqlClient> = Layer.effect(
    Commands,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      const execute = <A, I, E, R>(options: {
        readonly envelope: CommandEnvelope
        readonly projectId?: ProjectId
        readonly result: Schema.Codec<A, I>
        readonly handle: Effect.Effect<A, E, R>
      }) =>
        Effect.gen(function* () {
          const { envelope } = options
          const payloadDigest = sha256Hex(
            canonicalJson({ commandType: envelope.commandType, onBehalfOf: envelope.onBehalfOfActorId ?? null, payload: envelope.payload }),
          )
          const [previous] = yield* sql<Receipt>`
            SELECT command_type, payload_digest, result FROM command_receipts
            WHERE actor_id = ${envelope.actorId} AND command_id = ${envelope.commandId}`
          if (previous !== undefined) {
            if (previous.commandType !== envelope.commandType || previous.payloadDigest !== payloadDigest) {
              return yield* new CommandIdReused({ commandId: envelope.commandId })
            }
            return yield* Schema.decodeUnknownEffect(options.result)(JSON.parse(previous.result))
          }
          const receivedAt = yield* now
          const value = yield* options.handle
          const encoded = yield* Schema.encodeEffect(options.result)(value)
          const completedAt = yield* now
          yield* sql`INSERT INTO command_receipts ${sql.insert({
            actorId: envelope.actorId,
            commandId: envelope.commandId,
            onBehalfOfActorId: envelope.onBehalfOfActorId ?? null,
            commandType: envelope.commandType,
            schemaVersion: envelope.schemaVersion,
            payloadDigest,
            deviceId: envelope.deviceId,
            projectId: options.projectId ?? null,
            aggregateId: envelope.aggregateId ?? null,
            result: JSON.stringify(encoded ?? null),
            receivedAt,
            completedAt,
          })}`
          return value
        }).pipe(sql.withTransaction, Effect.withSpan('Commands.execute', { attributes: { commandType: options.envelope.commandType } }))

      return Commands.of({ execute })
    }),
  )
}
