import { ActorId, AggregateType, CommandId, Ids, newId, now, RecordEventId, Timestamp } from '@charrette/domain'
import { Context, Crypto, Effect, Layer, Schema } from 'effect'
import { SqlClient, type SqlError, SqlSchema } from 'effect/sql'

/** A fact to add to the operational record. */
export const RecordEventInput = Schema.Struct({
  aggregateType: AggregateType,
  aggregateId: Schema.String,
  aggregateRevision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  type: Schema.String.check(Schema.isPattern(/^[a-z]+(\.[a-z_]+)+$/)),
  payload: Schema.Unknown,
  actorId: ActorId,
  commandId: Schema.optional(CommandId),
})
export type RecordEventInput = typeof RecordEventInput.Type

export const RecordedEvent = Schema.Struct({
  sequence: Schema.Int,
  id: RecordEventId,
  occurredAt: Timestamp,
})
export type RecordedEvent = typeof RecordedEvent.Type

/** One entry of the client change feed: which aggregate changed, and its revision since. */
export const Change = Schema.Struct({
  cursor: Schema.Int,
  aggregateType: AggregateType,
  aggregateId: Schema.String,
  revision: Schema.Int,
  changedAt: Timestamp,
})
export type Change = typeof Change.Type

/**
 * The operational record and the client change feed (docs/architecture/07).
 * Recording a fact also tells clients the aggregate changed, in the same
 * transaction as the caller's write.
 */
export class Ledger extends Context.Service<
  Ledger,
  {
    record(input: RecordEventInput): Effect.Effect<RecordedEvent, SqlError.SqlError | Schema.SchemaError>
    /** Changes after `cursor`, oldest first, at most `limit` of them. A client resumes from the last cursor it saw. */
    changesSince(cursor: number, limit: number): Effect.Effect<ReadonlyArray<Change>, SqlError.SqlError | Schema.SchemaError>
  }
>()('@charrette/persistence-sqlite/Ledger') {
  static readonly layer: Layer.Layer<Ledger, never, SqlClient.SqlClient | Crypto.Crypto> = Layer.effect(
    Ledger,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const crypto = yield* Crypto.Crypto

      const record = Effect.fn('Ledger.record')(function* (input: RecordEventInput) {
        const event = yield* Schema.decodeUnknownEffect(RecordEventInput)(input)
        const id = yield* Effect.provideService(newId(Ids.recordEvent), Crypto.Crypto, crypto)
        const occurredAt = yield* now
        const [row] = yield* sql<{ sequence: number }>`
          INSERT INTO record_events ${sql.insert({
            id,
            aggregateType: event.aggregateType,
            aggregateId: event.aggregateId,
            aggregateRevision: event.aggregateRevision,
            type: event.type,
            payload: JSON.stringify(event.payload ?? {}),
            actorId: event.actorId,
            commandId: event.commandId ?? null,
            occurredAt,
          })}
          RETURNING sequence`
        yield* sql`INSERT INTO change_log ${sql.insert({
          aggregateType: event.aggregateType,
          aggregateId: event.aggregateId,
          revision: event.aggregateRevision,
          changedAt: occurredAt,
        })}`
        return yield* Schema.decodeUnknownEffect(RecordedEvent)({ sequence: row?.sequence, id, occurredAt })
      }, sql.withTransaction)

      const findChanges = SqlSchema.findAll({
        Request: Schema.Struct({ cursor: Schema.Int, limit: Schema.Int }),
        Result: Change,
        execute: ({ cursor, limit }) => sql`SELECT * FROM change_log WHERE cursor > ${cursor} ORDER BY cursor LIMIT ${limit}`,
      })

      const changesSince = Effect.fn('Ledger.changesSince')(function* (cursor: number, limit: number) {
        return yield* findChanges({ cursor, limit: Math.max(1, Math.min(limit, 1000)) })
      })

      return Ledger.of({ record, changesSince })
    }),
  )
}
