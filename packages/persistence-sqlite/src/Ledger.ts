import { ActorId, AggregateType, CommandId, Ids, newId, now, ProjectId, RecordEventId, Timestamp } from '@charrette/domain'
import { Context, Crypto, Effect, Layer, PubSub, Schema, type Scope } from 'effect'
import { SqlClient, type SqlError, SqlSchema } from 'effect/sql'

/** A fact to add to the operational record. */
export const RecordEventInput = Schema.Struct({
  /** The project the fact belongs to; absent only for facts about a device, such as an agent installation. */
  projectId: Schema.optional(ProjectId),
  aggregateType: AggregateType,
  aggregateId: Schema.String,
  aggregateRevision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  type: Schema.String.check(Schema.isPattern(/^[a-z][a-z_]*(\.[a-z_]+)+$/)),
  /** The version of the payload's shape. Events are kept for good, so a reader can tell old shapes from new. */
  schemaVersion: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))),
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

/** A change to put on the client feed. */
export const ChangeInput = Schema.Struct({
  projectId: Schema.optional(ProjectId),
  aggregateType: AggregateType,
  aggregateId: Schema.String,
  aggregateRevision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
})
export type ChangeInput = typeof ChangeInput.Type

/** One entry of the client change feed: which aggregate changed, and its revision since. */
export const Change = Schema.Struct({
  cursor: Schema.Int,
  projectId: Schema.NullOr(ProjectId),
  aggregateType: AggregateType,
  aggregateId: Schema.String,
  aggregateRevision: Schema.Int,
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
    /**
     * Tells clients an aggregate changed without adding a fact to the record,
     * for changes that are not facts a person would look up, such as a thread
     * item growing as an agent streams its message (docs/architecture/02).
     */
    notify(change: ChangeInput): Effect.Effect<void, SqlError.SqlError | Schema.SchemaError>
    /** Changes after `cursor`, oldest first, at most `limit` of them. A client resumes from the last cursor it saw. */
    changesSince(cursor: number, limit: number): Effect.Effect<ReadonlyArray<Change>, SqlError.SqlError | Schema.SchemaError>
    /**
     * Listens for the feed to grow, from now until the scope closes: the
     * effect it gives waits until something is added, or returns at once if
     * something was since it last returned. A reader woken by a write inside a
     * transaction reads after the commit, since the store's one connection is
     * held by the transaction until then.
     */
    readonly listen: Effect.Effect<Effect.Effect<void>, never, Scope.Scope>
  }
>()('@charrette/persistence-sqlite/Ledger') {
  static readonly layer: Layer.Layer<Ledger, never, SqlClient.SqlClient | Crypto.Crypto> = Layer.effect(
    Ledger,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const crypto = yield* Crypto.Crypto
      // Each listener needs only to know something was added since it last looked.
      const grew = yield* PubSub.sliding<void>(1)
      const signal = PubSub.publish(grew, undefined)

      const record = Effect.fn('Ledger.record')(function* (input: RecordEventInput) {
        const event = yield* Schema.decodeUnknownEffect(RecordEventInput)(input)
        const id = yield* Effect.provideService(newId(Ids.recordEvent), Crypto.Crypto, crypto)
        const occurredAt = yield* now
        const [row] = yield* sql<{ sequence: number }>`
          INSERT INTO record_events ${sql.insert({
            id,
            projectId: event.projectId ?? null,
            aggregateType: event.aggregateType,
            aggregateId: event.aggregateId,
            aggregateRevision: event.aggregateRevision,
            type: event.type,
            schemaVersion: event.schemaVersion ?? 1,
            payload: JSON.stringify(event.payload ?? {}),
            actorId: event.actorId,
            commandId: event.commandId ?? null,
            occurredAt,
          })}
          RETURNING sequence`
        yield* sql`INSERT INTO change_log ${sql.insert({
          projectId: event.projectId ?? null,
          aggregateType: event.aggregateType,
          aggregateId: event.aggregateId,
          aggregateRevision: event.aggregateRevision,
          changedAt: occurredAt,
        })}`
        yield* signal
        return yield* Schema.decodeUnknownEffect(RecordedEvent)({ sequence: row?.sequence, id, occurredAt })
      }, sql.withTransaction)

      const notify = Effect.fn('Ledger.notify')(function* (input: ChangeInput) {
        const change = yield* Schema.decodeUnknownEffect(ChangeInput)(input)
        yield* sql`INSERT INTO change_log ${sql.insert({
          projectId: change.projectId ?? null,
          aggregateType: change.aggregateType,
          aggregateId: change.aggregateId,
          aggregateRevision: change.aggregateRevision,
          changedAt: yield* now,
        })}`
        yield* signal
      })

      const findChanges = SqlSchema.findAll({
        Request: Schema.Struct({ cursor: Schema.Int, limit: Schema.Int }),
        Result: Change,
        execute: ({ cursor, limit }) => sql`SELECT * FROM change_log WHERE cursor > ${cursor} ORDER BY cursor LIMIT ${limit}`,
      })

      const changesSince = Effect.fn('Ledger.changesSince')(function* (cursor: number, limit: number) {
        return yield* findChanges({ cursor, limit: Math.max(1, Math.min(limit, 1000)) })
      })

      const listen = Effect.map(PubSub.subscribe(grew), (subscription) => Effect.asVoid(PubSub.take(subscription)))

      return Ledger.of({ record, notify, changesSince, listen })
    }),
  )
}
