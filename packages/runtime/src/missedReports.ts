import { Clock, Effect } from 'effect'
import { SqlClient } from 'effect/sql'

/*
 * How often each model ended a step twice without its report, once after it
 * was reminded, in the last week: a count per agent and model, the same
 * model through two agents (or two of OpenCode's providers' agents) apart, as
 * the cause may be the way to it rather than the model. Read from the record,
 * where Althar notes each such step as `node_attempt.no_report`, whether it
 * handed the step on or it needed the person. The coordinator reads it beside
 * each model (list_models), and the window beside each model in a plan's
 * picker, so a model that keeps doing it can be left out. Not a score.
 */

/** The record's type for a step whose agent ended twice without its report. */
export const NO_REPORT = 'node_attempt.no_report'

/** How far back the count reaches. */
export const MISSED_SPAN_DAYS = 7

export interface MissedReports {
  readonly agentId: string
  /** The model's id at the agent; null where the agent's own default ran. */
  readonly model: string | null
  readonly count: number
}

/** Each agent and model that missed a report in the last week, with how often. */
export const missedReports = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const since = new Date((yield* Clock.currentTimeMillis) - MISSED_SPAN_DAYS * 24 * 60 * 60_000).toISOString()
  const rows = yield* sql<{ agentId: string | null; model: string | null; count: number }>`
    SELECT json_extract(payload, '$.agentId') AS agent_id, json_extract(payload, '$.model') AS model, count(*) AS count
    FROM record_events WHERE type = ${NO_REPORT} AND occurred_at >= ${since}
    GROUP BY 1, 2 ORDER BY 3 DESC`
  return rows.flatMap((row): ReadonlyArray<MissedReports> =>
    row.agentId === null ? [] : [{ agentId: row.agentId, model: row.model, count: row.count }],
  )
})

/** How often one agent's model missed, of those read: 0 where it didn't. */
export const missedBy = (missed: ReadonlyArray<MissedReports>, agentId: string, model: string | null) =>
  missed.find((one) => one.agentId === agentId && one.model === model)?.count ?? 0

/** A count as a model's line says it: "ended 3 steps without a report this week". */
export const missedWords = (count: number) => `ended ${count === 1 ? 'a step' : `${count} steps`} without a report this week`
