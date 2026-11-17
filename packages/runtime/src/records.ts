import { type ActorId, type AggregateType, type CommandId, now, type ProjectId } from '@althar/domain'
import { Ledger, type RevisionConflict, type RevisionedTable, RowNotFound } from '@althar/persistence-sqlite'
import { Effect } from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'

/*
 * The small write helpers every module shares. A changed row gets its next
 * revision; a fact goes to the record with that revision.
 */

/**
 * Changes a row and moves its revision on, in one statement: what changed
 * and its next revision are written together, so nothing can come between
 * them, and an agent's every edit costs the store one write, not three.
 * Returns the new revision. Its failures still name a revision conflict, as
 * its callers were written against the read and move it replaces; one
 * statement never meets one.
 */
export const change: (
  table: RevisionedTable,
  id: string,
  set: Readonly<Record<string, unknown>>,
) => Effect.Effect<number, SqlError.SqlError | RowNotFound | RevisionConflict, SqlClient.SqlClient> = Effect.fn('change')(function* (
  table: RevisionedTable,
  id: string,
  set: Readonly<Record<string, unknown>>,
) {
  const sql = yield* SqlClient.SqlClient
  const moved = Object.keys(set).length === 0 ? sql`revision = revision + 1` : sql`${sql.update(set)}, revision = revision + 1`
  const [row] = yield* sql<{ revision: number }>`UPDATE ${sql(table)} SET ${moved} WHERE id = ${id} RETURNING revision`
  if (row === undefined) return yield* new RowNotFound({ table, id })
  return row.revision
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
