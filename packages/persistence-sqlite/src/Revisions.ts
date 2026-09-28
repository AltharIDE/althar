import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { RevisionConflict, RowNotFound } from './errors'

/** The tables whose rows carry a revision for optimistic concurrency. */
export type RevisionedTable =
  | 'projects'
  | 'project_settings'
  | 'tasks'
  | 'task_plans'
  | 'runs'
  | 'workflow_executions'
  | 'nodes'
  | 'node_attempts'
  | 'threads'
  | 'provider_sessions'
  | 'attention_requests'
  | 'change_sets'

/**
 * Moves a row from the revision the caller read to the next one, or fails if
 * someone else got there first. Call it inside the transaction that makes the
 * change, and record the new revision with the change.
 */
export const bumpRevision = Effect.fn('bumpRevision')(function* (table: RevisionedTable, id: string, expected: number) {
  const sql = yield* SqlClient.SqlClient
  const key = table === 'project_settings' ? 'project_id' : 'id'
  const [updated] = yield* sql<{ revision: number }>`
    UPDATE ${sql(table)} SET revision = revision + 1
    WHERE ${sql(key)} = ${id} AND revision = ${expected}
    RETURNING revision`
  if (updated !== undefined) return updated.revision
  const [current] = yield* sql<{ revision: number }>`SELECT revision FROM ${sql(table)} WHERE ${sql(key)} = ${id}`
  if (current === undefined) return yield* new RowNotFound({ table, id })
  return yield* new RevisionConflict({ table, id, expected, actual: current.revision })
})
