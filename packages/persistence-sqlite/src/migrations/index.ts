import { SqliteMigrator } from '@effect/sql-sqlite-node'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { statements as initial } from './0001_initial'
import { statements as permissionScopeTurn } from './0002_permission_scope_turn'
import { statements as threadItems } from './0003_thread_items'
import { statements as coordinator } from './0004_coordinator'

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
]

const run = (statements: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    for (const statement of statements) yield* sql.unsafe(statement)
  })

export const loaderFor = (list: ReadonlyArray<Migration>) =>
  SqliteMigrator.fromRecord(Object.fromEntries(list.map((migration) => [migration.key, run(migration.statements)])))
