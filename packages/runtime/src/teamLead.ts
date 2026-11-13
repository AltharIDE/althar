import type { PlanStep } from '@althar/contracts'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

/** The runtime-owned session, rather than a replacement whose database row is still starting. */
export interface HeldTeamLead {
  readonly sessionId: string
  readonly nextLead?: { readonly agentId: string; readonly model?: string; readonly effort?: string } | undefined
}

/**
 * Who leads from the next turn: the live choice, an explicit newer change to the team, or the last lead that actually
 * started. A plan's stored steps describe what was chosen then; switching its session need not rewrite that history.
 */
export const teamLeadsOf = (threadId: string, planned: PlanStep, changedAt?: string | null, held?: HeldTeamLead) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{
      id: string
      agentId: string
      model: string | null
      effort: string | null
      chosenAt: string
      chosenSequence: number | null
    }>`
      SELECT s.id, s.agent_id, s.model, s.effort,
        max(s.started_at, coalesce((SELECT max(f.occurred_at) FROM record_events f
          WHERE f.aggregate_type = 'provider_session' AND f.aggregate_id = s.id
            AND (f.type IN ('provider_session.model_changed', 'provider_session.effort_changed')
              OR (f.type = 'provider_session.lead_choice_changed' AND json_extract(f.payload, '$.resolved') = 1))),
          s.started_at)) AS chosen_at,
        (SELECT max(f.sequence) FROM record_events f
          WHERE f.aggregate_type = 'provider_session' AND f.aggregate_id = s.id
            AND (f.type IN ('provider_session.starting', 'provider_session.model_changed', 'provider_session.effort_changed')
              OR (f.type = 'provider_session.lead_choice_changed' AND json_extract(f.payload, '$.resolved') = 1))) AS chosen_sequence
      FROM provider_sessions s WHERE s.thread_id = ${threadId}
        AND (s.id = ${held?.sessionId ?? ''} OR EXISTS (SELECT 1 FROM record_events f
          WHERE f.aggregate_type = 'provider_session' AND f.aggregate_id = s.id AND f.type = 'provider_session.active'))
      ORDER BY (SELECT max(f.sequence) FROM record_events f WHERE f.aggregate_type = 'provider_session'
        AND f.aggregate_id = s.id AND f.type = 'provider_session.starting') DESC, s.started_at DESC, s.rowid DESC`
    // A replacement's row is kept before it connects. Until it takes over, the runtime's held session is the actual lead.
    const actual = rows.find((row) => row.id === held?.sessionId) ?? rows[0]
    if (actual === undefined) return { current: null, next: planned }
    const [choice] = yield* sql<{
      sequence: number
      occurredAt: string
      resolved: number | null
      explicitChoice: number
      pending: string | null
      chosen: string | null
      choiceSequence: number | null
      choiceAt: string | null
    }>`
      SELECT f.sequence, f.occurred_at, json_extract(f.payload, '$.resolved') AS resolved,
        (json_extract(f.payload, '$.choice') IS NOT NULL) AS explicit_choice,
        json_extract(f.payload, '$.nextLead') AS pending,
        coalesce(json_extract(f.payload, '$.choice'),
          (SELECT json_extract(prior.payload, '$.choice') FROM record_events prior
            WHERE prior.aggregate_type = 'provider_session' AND prior.aggregate_id = ${actual.id}
              AND prior.type = 'provider_session.lead_choice_changed' AND json_extract(prior.payload, '$.choice') IS NOT NULL
            ORDER BY prior.sequence DESC LIMIT 1)) AS chosen,
        (SELECT max(prior.sequence) FROM record_events prior WHERE prior.aggregate_type = 'provider_session'
          AND prior.aggregate_id = ${actual.id} AND prior.type = 'provider_session.lead_choice_changed'
          AND json_extract(prior.payload, '$.choice') IS NOT NULL) AS choice_sequence,
        (SELECT prior.occurred_at FROM record_events prior WHERE prior.aggregate_type = 'provider_session'
          AND prior.aggregate_id = ${actual.id} AND prior.type = 'provider_session.lead_choice_changed'
          AND json_extract(prior.payload, '$.choice') IS NOT NULL ORDER BY prior.sequence DESC LIMIT 1) AS choice_at
      FROM record_events f WHERE f.aggregate_type = 'provider_session' AND f.aggregate_id = ${actual.id}
        AND f.type = 'provider_session.lead_choice_changed' ORDER BY f.sequence DESC LIMIT 1`
    const [planChoice] = yield* sql<{ sequence: number | null }>`
      SELECT max(f.sequence) AS sequence FROM record_events f JOIN task_plans p ON p.id = f.aggregate_id
      JOIN threads t ON t.task_id = p.task_id
      WHERE t.id = ${threadId} AND f.aggregate_type = 'task_plan'
        AND p.id = (SELECT id FROM task_plans WHERE task_id = t.task_id AND state IN ('proposed', 'accepted')
          ORDER BY proposed_at DESC, rowid DESC LIMIT 1)
        AND ((f.type = 'task_plan.changed' AND json_extract(f.payload, '$.leadChanged') = ${changedAt ?? ''})
          OR (f.type = 'task_plan.proposed' AND p.proposed_at = ${changedAt ?? ''}))`
    type Choice = { readonly agentId: string; readonly model?: string | null; readonly effort?: string | null }
    const kept = choice?.resolved === 1 ? null : (choice?.pending ?? choice?.chosen)
    const pending: Choice | undefined =
      choice?.resolved === 1 ? undefined : (held?.nextLead ?? (kept == null ? undefined : (JSON.parse(kept) as Choice)))
    const pendingSequence = choice?.pending == null ? choice?.choiceSequence : choice.sequence
    // An acknowledgement can belong to an earlier pick. An unresolved choice survives it, including after Stop removes
    // the live session; only that choice's resolved clear, or a new successfully started session, takes it out of the team.
    const unresolved = choice === undefined || (choice.resolved !== 1 && (choice.pending !== null || choice.explicitChoice === 0))
    const usePending = pending !== undefined && (unresolved || (pendingSequence ?? 0) >= (actual.chosenSequence ?? 0))
    const sessionChoice = usePending
      ? {
          agentId: pending.agentId,
          model: pending.model ?? (pending.agentId === actual.agentId ? actual.model : null),
          effort: pending.effort ?? (pending.agentId === actual.agentId ? actual.effort : null),
        }
      : actual
    const sessionSequence = usePending ? pendingSequence : actual.chosenSequence
    const sessionChoiceAt = usePending ? (choice?.pending == null ? choice?.choiceAt : choice.occurredAt) : actual.chosenAt
    // New choices are ordered by the record, even on one clock tick. Older plans without that marker retain their saved time.
    const newerPlan =
      planChoice?.sequence != null && sessionSequence != null
        ? planChoice.sequence > sessionSequence
        : changedAt != null && changedAt > (sessionChoiceAt ?? actual.chosenAt)
    const next = newerPlan ? planned : sessionChoice
    const asStep = (choice: {
      readonly agentId: string
      readonly model: string | null
      readonly effort?: string | null | undefined
    }): PlanStep => ({
      key: 'implement' as const,
      agentId: choice.agentId,
      model: choice.model,
      ...(choice.effort == null ? {} : { effort: choice.effort }),
      skipped: false,
    })
    return { current: asStep(actual), next: asStep(next) }
  })

export const teamLeadOf = (threadId: string, planned: PlanStep, changedAt?: string | null, held?: HeldTeamLead) =>
  Effect.map(teamLeadsOf(threadId, planned, changedAt, held), (team) => team.next)
