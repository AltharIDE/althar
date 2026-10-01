import { Ids, newId, type ProjectId } from '@charrette/domain'
import { ConnectorFailed } from '@charrette/connectors'
import { Effect, Exit, Option, Cause } from 'effect'
import { SqlClient } from 'effect/sql'

import { OutwardUncertain } from './errors'
import { Instance } from './Instance'
import { change, fact, timestamp } from './records'

/*
 * Doing something outside Charrette, such as opening a pull request
 * (docs/architecture/06, "Outbound path"; the store's intent and receipt
 * pattern). The intent is committed first, as a work item this launch holds
 * and a receipt marked intended; then the call is made, outside any
 * transaction; then the receipt is confirmed with what came back, or marked
 * failed, or uncertain when the answer was lost. The same action asked for
 * again, by its key, gets the confirmed answer without calling again. One
 * whose earlier answer was lost is called again only if calling again can't
 * do it twice (`retryable`), such as opening a change, which adopts one
 * already open; anything else stays uncertain for the person.
 */

/** How long a launch holds an action it is doing. */
const LEASE_MILLIS = 5 * 60_000

export interface Outward<A, E, R> {
  readonly projectId: ProjectId
  /** What it is done for: a repository change, an external link. */
  readonly subject: { readonly type: string; readonly id: string }
  /** Where it goes: `github:meridian/api`. */
  readonly target: string
  readonly operation: string
  /** The same key is the same action. */
  readonly key: string
  /** What is asked, for the record: never a secret. */
  readonly request: unknown
  readonly retryable: boolean
  readonly perform: Effect.Effect<A, E, R>
  /** What the record keeps of the answer, and reads back. */
  readonly encode: (answer: A) => unknown
  readonly decode: (kept: unknown) => A | undefined
}

/** Whether a failure leaves it unknown if the service did it: the answer, not the request, was lost. */
const lost = (error: unknown) => error instanceof ConnectorFailed && error.reason === 'unreachable'

export const outward = <A, E, R>(action: Outward<A, E, R>) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const instance = yield* Instance
    const begun = yield* sql.withTransaction(
      Effect.gen(function* () {
        const [earlier] = yield* sql<{ id: string; workItemId: string; state: string; response: string | null }>`
          SELECT id, work_item_id, state, response FROM mutation_receipts
          WHERE idempotency_key = ${action.key} AND project_id = ${action.projectId} ORDER BY created_at DESC LIMIT 1`
        if (earlier?.state === 'confirmed') return { _tag: 'Done', answer: action.decode(JSON.parse(earlier.response ?? 'null')) } as const
        if (earlier !== undefined && earlier.state !== 'failed' && !action.retryable) return { _tag: 'Uncertain' } as const
        const at = yield* timestamp
        const lease = new Date(Date.parse(at) + LEASE_MILLIS).toISOString()
        const workItemId = yield* newId(Ids.workItem)
        yield* sql`INSERT INTO work_items ${sql.insert({
          id: workItemId,
          projectId: action.projectId,
          kind: action.operation,
          subjectType: action.subject.type,
          subjectId: action.subject.id,
          payload: JSON.stringify(action.request),
          state: 'claimed',
          claimedByInstanceId: instance.id,
          leaseExpiresAt: lease,
          attempts: 1,
          availableAt: at,
          createdAt: at,
          updatedAt: at,
        })}`
        const receiptId = yield* newId(Ids.mutationReceipt)
        yield* sql`INSERT INTO mutation_receipts ${sql.insert({
          id: receiptId,
          projectId: action.projectId,
          workItemId,
          target: action.target,
          operation: action.operation,
          idempotencyKey: action.key,
          state: 'intended',
          request: JSON.stringify(action.request),
          createdAt: at,
        })}`
        yield* fact({
          projectId: action.projectId,
          aggregateType: 'mutation_receipt',
          aggregateId: receiptId,
          revision: 1,
          type: 'mutation_receipt.intended',
          payload: { operation: action.operation, target: action.target },
          actorId: instance.systemId,
        })
        return { _tag: 'Begun', receiptId, workItemId } as const
      }),
    )
    if (begun._tag === 'Done' && begun.answer !== undefined) return begun.answer
    if (begun._tag !== 'Begun') return yield* Effect.fail(new OutwardUncertain({ operation: action.operation }))
    const exit = yield* Effect.exit(action.perform)
    yield* sql.withTransaction(
      Effect.gen(function* () {
        const at = yield* timestamp
        const failure = exit._tag === 'Failure' ? Option.getOrUndefined(Cause.findErrorOption(exit.cause)) : undefined
        const state = Exit.isSuccess(exit) ? 'confirmed' : lost(failure) ? 'uncertain' : 'failed'
        const revision = yield* change('mutation_receipts', begun.receiptId, {
          state,
          response: Exit.isSuccess(exit) ? JSON.stringify(action.encode(exit.value)) : null,
          confirmedAt: Exit.isSuccess(exit) ? at : null,
        })
        yield* change('work_items', begun.workItemId, {
          state: Exit.isSuccess(exit) ? 'done' : state,
          claimedByInstanceId: null,
          leaseExpiresAt: null,
          lastError: failure === undefined ? null : String(failure instanceof Error ? failure.message : failure).slice(0, 500),
          updatedAt: at,
        })
        yield* fact({
          projectId: action.projectId,
          aggregateType: 'mutation_receipt',
          aggregateId: begun.receiptId,
          revision,
          type: `mutation_receipt.${state}`,
          payload: { operation: action.operation },
          actorId: instance.systemId,
        })
      }),
    )
    return yield* exit
  })

/**
 * At launch, an action an earlier launch was doing when it stopped is
 * uncertain: whether the service did it is unknown until something reads it
 * back, or the action is asked for again.
 */
export const reconcileOutward = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const instance = yield* Instance
  const left = yield* sql<{ workItemId: string; receiptId: string; projectId: ProjectId | null }>`
    SELECT w.id AS work_item_id, m.id AS receipt_id, w.project_id FROM work_items w JOIN mutation_receipts m ON m.work_item_id = w.id
    WHERE w.state = 'claimed' AND w.claimed_by_instance_id <> ${instance.id} AND m.state = 'intended'`
  for (const action of left)
    yield* sql.withTransaction(
      Effect.gen(function* () {
        const at = yield* timestamp
        yield* change('work_items', action.workItemId, {
          state: 'uncertain',
          claimedByInstanceId: null,
          leaseExpiresAt: null,
          updatedAt: at,
        })
        const revision = yield* change('mutation_receipts', action.receiptId, { state: 'uncertain' })
        yield* fact({
          projectId: action.projectId,
          aggregateType: 'mutation_receipt',
          aggregateId: action.receiptId,
          revision,
          type: 'mutation_receipt.uncertain',
          actorId: instance.systemId,
        })
      }),
    )
})
