import { Effect, Schema } from 'effect'
import { SqlClient } from 'effect/sql'

import type { PlanStep } from '@althar/contracts'

/*
 * The review a task is offered as its work turns real with none (a skipped review can be added back until merge). Never by a
 * rule: its lead or the coordinator offers it, with `offer_review`, where what the person said makes the work a real change
 * (they asked to harden a prototype, to open a pull request for a chat), and it shows as a line of the thread, by its
 * reviewer, with Add and No thanks. It adds nothing by itself. Turned down, it isn't offered again
 * (`task.review_offer_declined`); added, it is answered too (`task.review_offer_accepted`), so taking the review off again
 * doesn't bring the offer back.
 */

/** What an offer is read against. */
export interface OfferFacts {
  readonly taskId: string
  /** Its plan has begun and the task is open. */
  readonly open: boolean
  /** Its plan's steps. */
  readonly steps: ReadonlyArray<PlanStep>
  /**
   * Its plan reads its review only once it merged (the fast lane's): one offered reads it before it ships instead. Kept for
   * what reads the facts; it no longer keeps an offer back.
   */
  readonly reviewsAfterMerge: boolean
  /** A review of another's pull request: it has no work of its own to review. */
  readonly reads: boolean
  /** Its pull requests, open, merged or closed. */
  readonly pulls: ReadonlyArray<{ readonly state: string }>
}

/** Why a task can't be offered a review: it has one, it is merged or not open, it reviews another's pull request. */
export type NotOffered = 'reviewed' | 'merged' | 'closed' | 'no_review_of_its_own'

/** Whether a task could have a review offered at all, or why not. */
export const offerable = (facts: OfferFacts): NotOffered | undefined => {
  if (!facts.open) return 'closed'
  if (facts.reads) return 'no_review_of_its_own'
  if (facts.steps.some((step) => step.key === 'review' && !step.skipped)) return 'reviewed'
  // Its change in: the one it shows is the open one, else its latest.
  const shown = facts.pulls.find((one) => one.state === 'open') ?? facts.pulls.at(-1)
  if (shown?.state === 'merged') return 'merged'
  if (!facts.steps.some((step) => step.key === 'implement')) return 'closed'
  return undefined
}

const Offered = Schema.Struct({
  agentId: Schema.String,
  model: Schema.NullOr(Schema.String),
  effort: Schema.optional(Schema.NullOr(Schema.String)),
})

/** Whether the person turned a review offered to this task down, ever: then it isn't offered again. */
export const declinedOf = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [declined] = yield* sql<{ one: number }>`
      SELECT 1 AS one FROM record_events WHERE aggregate_type = 'task' AND aggregate_id = ${taskId}
        AND type = 'task.review_offer_declined' LIMIT 1`
    return declined !== undefined
  })

/** The review offered this task, while the offer stands: one was offered, it could still be added, and nobody turned it down. */
export const reviewOfferOf = (facts: OfferFacts) =>
  Effect.gen(function* () {
    if (offerable(facts) !== undefined) return undefined
    const sql = yield* SqlClient.SqlClient
    const [offered] = yield* sql<{ payload: string; sequence: number }>`
      SELECT payload, sequence FROM record_events WHERE aggregate_type = 'task' AND aggregate_id = ${facts.taskId}
        AND type = 'task.review_offered' ORDER BY sequence DESC LIMIT 1`
    if (offered === undefined || (yield* declinedOf(facts.taskId))) return undefined
    // Added since it was offered, it is answered, even where the review was taken off again after.
    const [accepted] = yield* sql<{ one: number }>`
      SELECT 1 AS one FROM record_events WHERE aggregate_type = 'task' AND aggregate_id = ${facts.taskId}
        AND type = 'task.review_offer_accepted' AND sequence > ${offered.sequence} LIMIT 1`
    if (accepted !== undefined) return undefined
    const step = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Offered))(offered.payload).pipe(
      Effect.orElseSucceed(() => undefined),
    )
    if (step === undefined) return undefined
    return {
      key: 'review' as const,
      agentId: step.agentId,
      model: step.model,
      ...(step.effort == null ? {} : { effort: step.effort }),
      skipped: false,
    }
  })
