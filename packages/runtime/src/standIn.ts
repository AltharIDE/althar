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

/** Who leads a task as last chosen: the plan's lead, or a pick of lead made on its thread since, whichever came last. */
const taskLeadOf = (sessionId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [plan] = yield* sql<{ agentId: string | null; model: string | null; effort: string | null; sequence: number | null }>`
      SELECT json_extract(s.value, '$.agentId') AS agent_id, json_extract(s.value, '$.model') AS model,
        json_extract(s.value, '$.effort') AS effort,
        (SELECT max(f.sequence) FROM record_events f WHERE f.aggregate_type = 'task_plan' AND f.aggregate_id = p.id
          AND (f.type = 'task_plan.proposed' OR (f.type = 'task_plan.changed' AND json_extract(f.payload, '$.leadChanged') IS NOT NULL)))
          AS sequence
      FROM provider_sessions ps JOIN threads t ON t.id = ps.thread_id AND t.kind = 'task'
      JOIN task_plans p ON p.task_id = t.task_id AND p.state IN ('proposed', 'accepted'), json_each(p.parameters, '$.steps') s
      WHERE ps.id = ${sessionId} AND json_extract(s.value, '$.key') = 'implement'
      ORDER BY p.proposed_at DESC LIMIT 1`
    const [pick] = yield* sql<{ choice: string; sequence: number }>`
      SELECT json_extract(f.payload, '$.choice') AS choice, f.sequence FROM record_events f
      JOIN provider_sessions s ON s.id = f.aggregate_id
      WHERE s.thread_id = (SELECT thread_id FROM provider_sessions WHERE id = ${sessionId})
        AND f.aggregate_type = 'provider_session' AND f.type = 'provider_session.lead_choice_changed'
        AND json_extract(f.payload, '$.choice') IS NOT NULL
      ORDER BY f.sequence DESC LIMIT 1`
    const picked =
      pick === undefined ? undefined : (JSON.parse(pick.choice) as { agentId: string; model?: string | null; effort?: string | null })
    if (picked !== undefined && (plan?.agentId == null || (pick?.sequence ?? 0) > (plan.sequence ?? 0)))
      return { agentId: picked.agentId, model: picked.model ?? null, effort: picked.effort ?? null }
    return plan?.agentId == null ? undefined : { agentId: plan.agentId, model: plan.model, effort: plan.effort }
  })

/** Whether two choices run the same model, whichever agents offer it (Limits' `sameModel`). */
export type SameModel = (
  a: { readonly agentId: string; readonly model: string | null },
  b: { readonly agentId: string; readonly model: string | null },
) => boolean

/**
 * Who a stand-in stands in for, read against the task's lead as it is now: none where it is on the task's own model, as
 * it then is the lead, through another agent; and the task's lead where it stood in for another model (one the task no
 * longer has, or a stand-in before it), so the thread goes back to the lead the task has. That lead is back once its
 * agent has usage: what kept the other model away (its reset, the step it failed) isn't its.
 */
export const forTask = (
  standsIn: StandIn,
  on: { readonly agentId: string; readonly model: string | null },
  lead: { readonly agentId: string; readonly model: string | null; readonly effort: string | null } | undefined,
  same: SameModel,
): StandIn | undefined => {
  if (lead?.model == null) return standsIn
  if (on.model !== null && same(on, lead)) return undefined
  if (standsIn.model !== null && same(standsIn, lead)) return standsIn
  return { agentId: lead.agentId, model: lead.model, effort: lead.effort, accountId: null, until: null, why: 'limit' }
}

/**
 * Who the session stands in for, while it still does; none where it was started as chosen, or chosen for since, or is on
 * the task's own model (`forTask`), as `same` reads models (Limits' `sameModel`).
 */
export const standInOf = <E>(sessionId: string, same: Effect.Effect<SameModel, E>) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const kept = yield* keptStandInOf(sessionId)
    if (Option.isNone(kept)) return kept
    const [session] = yield* sql<{ agentId: string; model: string | null }>`
      SELECT agent_id, model FROM provider_sessions WHERE id = ${sessionId}`
    const lead = yield* taskLeadOf(sessionId)
    // The agents' models are read only where there is a stand-in to read against a lead.
    if (session === undefined || lead?.model == null) return kept
    return Option.fromNullishOr(forTask(kept.value, session, lead, yield* same))
  })

/** Who the session was started standing in for, while that holds: as kept, before it is read against the task's lead. */
const keptStandInOf = (sessionId: string) =>
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
