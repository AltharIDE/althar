import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { RevisionConflict, RowNotFound } from './errors'

/**
 * The tables whose rows carry a revision. The rule: every row that changes
 * state has one, and a change records its new revision with the change. A test
 * checks this list against the schema.
 */
export const revisionedTables = [
  'projects',
  'project_settings',
  'tasks',
  'task_repository_requirements',
  'task_plans',
  'runs',
  'run_attempts',
  'workspaces',
  'workflow_executions',
  'nodes',
  'node_attempts',
  'threads',
  'user_inputs',
  'turn_deliveries',
  'thread_items',
  'agent_accounts',
  'agent_installations',
  'provider_sessions',
  'processes',
  'permission_requests',
  'attention_requests',
  'findings',
  'change_sets',
  'repository_changes',
  'work_items',
  'mutation_receipts',
  'connections',
  'external_links',
] as const
export type RevisionedTable = (typeof revisionedTables)[number]

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
