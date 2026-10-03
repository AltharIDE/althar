import { SqliteMigrator } from '@effect/sql-sqlite-node'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { statements as initial } from './0001_initial'
import { statements as permissionScopeTurn } from './0002_permission_scope_turn'
import { statements as threadItems } from './0003_thread_items'
import { statements as coordinator } from './0004_coordinator'
import { statements as runPerPlan } from './0005_run_per_plan'
import { statements as connectors } from './0006_connectors'
import { statements as models } from './0007_models'
import { statements as usageLimits } from './0008_usage_limits'
import { statements as accounts } from './0009_accounts'

export interface Migration {
  /** `<number>_<name>`, the order they run in. */
  readonly key: string
  readonly statements: ReadonlyArray<string>
}

/**
 * Every migration, in order. Migrations are append-only: once released, a
 * migration never changes. `checksums.ts` records each one, and a test fails
 * if a released migration is edited.
 */
export const migrations: ReadonlyArray<Migration> = [
  { key: '0001_initial', statements: initial },
  { key: '0002_permission_scope_turn', statements: permissionScopeTurn },
  { key: '0003_thread_items', statements: threadItems },
  { key: '0004_coordinator', statements: coordinator },
  { key: '0005_run_per_plan', statements: runPerPlan },
  { key: '0006_connectors', statements: connectors },
  { key: '0007_models', statements: models },
  { key: '0008_usage_limits', statements: usageLimits },
  { key: '0009_accounts', statements: accounts },
]

const run = (statements: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    for (const statement of statements) yield* sql.unsafe(statement)
  })

export const loaderFor = (list: ReadonlyArray<Migration>) =>
  SqliteMigrator.fromRecord(Object.fromEntries(list.map((migration) => [migration.key, run(migration.statements)])))
