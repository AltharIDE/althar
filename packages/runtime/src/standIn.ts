import { Effect, Option, Schema } from 'effect'
import { SqlClient } from 'effect/sql'

/*
 * A lead Althar handed to another agent because its own ran out of usage
 * stands in for it: the task's lead stays the one it was given, and takes the
 * thread back once its usage is back (Runs' `holds`, and `startLast` after a
 * stop or a restart). It is kept with the session that stands in, in its
 * `provider_session.starting` fact, so it holds across a restart and a fresh
 * session of the same agent (`handOver`) carries it on. A choice of lead made
 * on that session since (the person's pick, the coordinator's or a lead's
 * change_lead, a model or effort set on it) ends it: who leads is theirs from
 * then on.
 */

/** Who a stand-in stands in for, and until when that one is out. */
export const StandIn = Schema.Struct({
  agentId: Schema.String,
  model: Schema.NullOr(Schema.String),
  effort: Schema.NullOr(Schema.String),
  /** The account it ran out on, whose reset brings it back; null where the agent has none of its own. */
  accountId: Schema.NullOr(Schema.String),
  /** When it is tried again, as the limit said. */
  until: Schema.String,
})
export type StandIn = typeof StandIn.Type

const decode = Schema.decodeUnknownOption(Schema.fromJsonString(StandIn))

/** Who the session stands in for, while it still does; none where it was started as chosen, or chosen for since. */
export const standInOf = (sessionId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [row] = yield* sql<{ standsIn: string | null }>`
      SELECT json_extract(f.payload, '$.standsIn') AS stands_in FROM record_events f
      WHERE f.aggregate_type = 'provider_session' AND f.aggregate_id = ${sessionId} AND f.type = 'provider_session.starting'
        AND NOT EXISTS (SELECT 1 FROM record_events later
          WHERE later.aggregate_type = 'provider_session' AND later.aggregate_id = f.aggregate_id AND later.sequence > f.sequence
            AND (later.type IN ('provider_session.model_changed', 'provider_session.effort_changed')
              OR (later.type = 'provider_session.lead_choice_changed' AND json_extract(later.payload, '$.choice') IS NOT NULL)))
      LIMIT 1`
    return row?.standsIn == null ? Option.none<StandIn>() : decode(row.standsIn)
  })
