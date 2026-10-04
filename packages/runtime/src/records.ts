import { type ActorId, type AggregateType, type CommandId, now, type ProjectId } from '@althar/domain'
import { bumpRevision, Ledger, type RevisionedTable, RowNotFound } from '@althar/persistence-sqlite'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

/*
 * The small write helpers every module shares. A changed row gets its next
 * revision; a fact goes to the record with that revision.
 */

/** Changes a row and moves its revision on. Returns the new revision. */
export const change = Effect.fn('change')(function* (table: RevisionedTable, id: string, set: Readonly<Record<string, unknown>>) {
  const sql = yield* SqlClient.SqlClient
  const [row] = yield* sql<{ revision: number }>`SELECT revision FROM ${sql(table)} WHERE id = ${id}`
  if (row === undefined) return yield* new RowNotFound({ table, id })
  const revision = yield* bumpRevision(table, id, row.revision)
  yield* sql`UPDATE ${sql(table)} SET ${sql.update(set)} WHERE id = ${id}`
  return revision
})

export interface Fact {
  readonly projectId?: ProjectId | null
  readonly aggregateType: AggregateType
  readonly aggregateId: string
  readonly revision: number
  readonly type: string
  readonly payload?: unknown
  readonly actorId: ActorId
  readonly commandId?: CommandId
}

/** Adds a fact to the record, which also tells clients the aggregate changed. */
export const fact = (input: Fact) =>
  Effect.gen(function* () {
    const ledger = yield* Ledger
    return yield* ledger.record({
      ...(input.projectId === undefined || input.projectId === null ? {} : { projectId: input.projectId }),
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      aggregateRevision: input.revision,
      type: input.type,
      payload: input.payload ?? {},
      actorId: input.actorId,
      ...(input.commandId === undefined ? {} : { commandId: input.commandId }),
    })
  })

/** The current time, for a column. */
export const timestamp = now
