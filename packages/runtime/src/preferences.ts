import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { timestamp } from './records'

/*
 * The person's preferences for the models agents offer, kept for the
 * profile (docs/architecture/03): the models they switched off, and a
 * model's default effort, which a session on it starts at unless the plan or
 * the person picks another.
 */

/** The models of an agent the person switched off (ADR-015), by the agent's ids for them. */
export const blockedModelsOf = (agentId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{ model: string }>`SELECT model FROM model_blocks WHERE agent_id = ${agentId} ORDER BY model`
    return rows.map((row) => row.model)
  })

/** Switches one of an agent's models off, or on again. */
export const setModelBlocked = (agentId: string, model: string, blocked: boolean) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    if (!blocked) return yield* sql`DELETE FROM model_blocks WHERE agent_id = ${agentId} AND model = ${model}`.pipe(Effect.asVoid)
    const at = yield* timestamp
    yield* sql`INSERT INTO model_blocks ${sql.insert({ agentId, model, updatedAt: at })} ON CONFLICT (agent_id, model) DO NOTHING`
  })

/** The person's default effort for an agent's model; null where they set none. */
export const defaultEffortOf = (agentId: string, model: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [row] = yield* sql<{ effort: string }>`SELECT effort FROM model_preferences WHERE agent_id = ${agentId} AND model = ${model}`
    return row?.effort ?? null
  })

/** Every default effort the person set for an agent's models. */
export const defaultEffortsOf = (agentId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<{ model: string; effort: string }>`
      SELECT model, effort FROM model_preferences WHERE agent_id = ${agentId} ORDER BY model`
  })

export const setDefaultEffort = (agentId: string, model: string, effort: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const at = yield* timestamp
    yield* sql`
      INSERT INTO model_preferences ${sql.insert({ agentId, model, effort, updatedAt: at })}
      ON CONFLICT (agent_id, model) DO UPDATE SET effort = excluded.effort, updated_at = excluded.updated_at`
  })
