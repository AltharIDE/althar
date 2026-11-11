import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import type { PlanStep } from '@althar/contracts'

import { Agents } from './Config'
import { Limits } from './Limits'

/*
 * The review a change is offered, once, as its work turns real (a skipped review can be added back until merge): a prototype
 * or chat its lead made a change, or a pull request opened on a task whose plan has no review. A quiet "Add a review?" on its
 * card, with the reviewer the project's rules would pick: the strongest free model, another maker's than the lead's. It adds
 * nothing by itself. The person adds it or turns it down, and once turned down, or once they took a review off, it doesn't
 * come back (`task.review_offer_declined`). Read from what the task has, never stored but for that.
 */

/** What the offer is read from. */
export interface OfferFacts {
  readonly taskId: string
  readonly projectId: string
  /** Its plan has begun and the task is open. */
  readonly open: boolean
  /** What it makes: a change, as its card says. */
  readonly kind: string
  /** Its plan's steps. */
  readonly steps: ReadonlyArray<PlanStep>
  /** Its plan reads nothing of a review's own: the fast lane's reads after the merge, and a review of another's pull request. */
  readonly reviewsAfterMerge: boolean
  readonly reads: boolean
  /** Its pull requests, open, merged or closed. */
  readonly pulls: ReadonlyArray<{ readonly state: string }>
  /** The agents its plan allows, where it names them. */
  readonly agents: ReadonlyArray<string> | undefined
}

/** The review a task is offered, or undefined: it has one, is merged, turned the offer down, or its work isn't a real change yet. */
export const reviewOfferOf = (facts: OfferFacts) =>
  Effect.gen(function* () {
    if (!facts.open || facts.kind !== 'change' || facts.reviewsAfterMerge || facts.reads) return undefined
    const lead = facts.steps.find((step) => step.key === 'implement')
    if (lead === undefined || facts.steps.some((step) => step.key === 'review' && !step.skipped)) return undefined
    // Its change in: the one it shows is the open one, else its latest.
    const shown = facts.pulls.find((one) => one.state === 'open') ?? facts.pulls.at(-1)
    if (shown?.state === 'merged') return undefined
    const sql = yield* SqlClient.SqlClient
    // Real: a pull request opened on it, or its lead made it a change with no review.
    const [made] = yield* sql<{ none: number }>`
      SELECT json_extract(payload, '$.review') IS NULL AS none FROM record_events
      WHERE aggregate_type = 'task' AND aggregate_id = ${facts.taskId} AND type = 'task.made_change' ORDER BY sequence DESC LIMIT 1`
    if (shown === undefined && made?.none !== 1) return undefined
    const [declined] = yield* sql<{ one: number }>`
      SELECT 1 AS one FROM record_events WHERE aggregate_type = 'task' AND aggregate_id = ${facts.taskId}
        AND type = 'task.review_offer_declined' LIMIT 1`
    if (declined !== undefined) return undefined
    const agents = yield* Agents
    const limits = yield* Limits
    const besides =
      facts.agents === undefined ? [] : agents.list.map((entry) => entry.definition.id).filter((id) => !facts.agents?.includes(id))
    const picked = yield* limits
      .free({ besides, projectId: facts.projectId, other: { agentId: lead.agentId, model: lead.model } })
      .pipe(Effect.orElseSucceed(() => undefined))
    if (picked === undefined) return undefined
    return { key: 'review' as const, agentId: picked.agentId, model: picked.model, skipped: false }
  })
