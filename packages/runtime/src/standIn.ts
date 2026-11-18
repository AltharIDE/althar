import { Clock, Effect, Option, Schema } from 'effect'
import { SqlClient } from 'effect/sql'

import type { Out } from './Limits'

/*
 * A lead Althar handed to another agent, because its own ran out of usage,
 * was nearly out as a step began, or ended a step twice without its report,
 * stands in for it: the task's lead stays the one it was given, and takes the
 * thread back once it is back (`whenBack`: its usage again, or the step it
 * failed over), from the next turn (Runs' `holds`, Sessions' `giveBack`), and
 * after a stop or a restart (`startLast`). It is kept with the session that
 * stands in, in its `provider_session.starting` fact, so it holds across a
 * restart, and a fresh session of the stand-in (`handOver`, a restart of one
 * gone quiet, its next account) carries it on. It lasts until the given lead
 * has actually started again: one queued back that can't start leaves it, so
 * a later turn or restart tries again. A choice of lead made on that session
 * since (the person's pick, the coordinator's or a lead's change_lead, a model
 * or effort set on it) ends it: who leads is theirs from then on.
 */

/** Who a stand-in stands in for, and until when that one is out. */
export const StandIn = Schema.Struct({
  agentId: Schema.String,
  model: Schema.NullOr(Schema.String),
  effort: Schema.NullOr(Schema.String),
  /** The account it ran out on, whose reset brings it back; null where the agent has none of its own. */
  accountId: Schema.NullOr(Schema.String),
  /** When it is tried again, as the limit said, or its window resets; null where it stands in for a step. */
  until: Schema.NullOr(Schema.String),
  /**
   * Why it stands in: its usage ran out (absent, as before this was kept), it was nearly out as a step began, or it ended
   * a step twice without its report.
   */
  why: Schema.optional(Schema.Literals(['limit', 'low', 'stall'])),
  /** The step attempt it took over, for `stall`: once that has ended, the given lead leads again. */
  attemptId: Schema.optional(Schema.String),
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

/** The attempts of a step still under way. */
const UNDER_WAY = ['admitted', 'running', 'waiting_attention', 'held']

/**
 * When the lead a session stands in for is back, in milliseconds (0: now): once its account isn't out, and, nearly out
 * as a step began, its window has reset; once the step it failed is over. None while that step is still under way.
 */
export const whenBack = <E, R>(standsIn: StandIn, out: (standsIn: StandIn) => Effect.Effect<Option.Option<Out>, E, R>) =>
  Effect.gen(function* () {
    if (standsIn.why === 'stall') {
      if (standsIn.attemptId === undefined) return Option.some(0)
      const sql = yield* SqlClient.SqlClient
      const [attempt] = yield* sql<{ state: string }>`SELECT state FROM node_attempts WHERE id = ${standsIn.attemptId}`
      return attempt !== undefined && UNDER_WAY.includes(attempt.state) ? Option.none<number>() : Option.some(0)
    }
    const spent = yield* out(standsIn)
    const reset = standsIn.why === 'low' && standsIn.until !== null ? Date.parse(standsIn.until) : 0
    return Option.some(Math.max(Option.isSome(spent) ? Date.parse(spent.value.until) : 0, reset))
  })

/** Whether the lead a session stands in for is back now. */
export const isBack = <E, R>(standsIn: StandIn, out: (standsIn: StandIn) => Effect.Effect<Option.Option<Out>, E, R>) =>
  Effect.gen(function* () {
    const at = yield* whenBack(standsIn, out)
    return Option.isSome(at) && at.value <= (yield* Clock.currentTimeMillis)
  })
