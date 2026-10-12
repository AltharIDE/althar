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
import { statements as projectFolders } from './0010_project_folders'
import { statements as home } from './0011_home'
import { statements as withdrawnInput } from './0012_withdrawn_input'
import { statements as projectChanges } from './0013_project_changes'
import { statements as modelBlocks } from './0014_model_blocks'
import { statements as taskRequests } from './0015_task_requests'
import { statements as settings } from './0016_settings'
import { statements as artifactImages } from './0017_artifact_images'
import { statements as questions } from './0018_questions'
import { statements as runCommands } from './0019_run_commands'
import { statements as issueDrafts } from './0020_issue_drafts'
import { statements as inputImages } from './0021_input_images'
import { statements as connectionCli } from './0022_connection_cli'

export interface Migration {
  /** `<number>_<name>`, the order they run in. */
  readonly key: string
  readonly statements: ReadonlyArray<string>
}

/** Where the migrator records each migration it ran, by number. */
export const MIGRATIONS_TABLE = 'schema_migrations'

/** A migration's number, as the migrator records it: 18 for `0018_questions`. */
export const idOf = (migration: Migration) => Number.parseInt(migration.key, 10)

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
  { key: '0010_project_folders', statements: projectFolders },
  { key: '0011_home', statements: home },
  { key: '0012_withdrawn_input', statements: withdrawnInput },
  { key: '0013_project_changes', statements: projectChanges },
  { key: '0014_model_blocks', statements: modelBlocks },
  { key: '0015_task_requests', statements: taskRequests },
  { key: '0016_settings', statements: settings },
  { key: '0017_artifact_images', statements: artifactImages },
  { key: '0018_questions', statements: questions },
  { key: '0019_run_commands', statements: runCommands },
  { key: '0020_issue_drafts', statements: issueDrafts },
  { key: '0021_input_images', statements: inputImages },
  { key: '0022_connection_cli', statements: connectionCli },
]

const run = (statements: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    for (const statement of statements) yield* sql.unsafe(statement)
  })

export const loaderFor = (list: ReadonlyArray<Migration>) =>
  SqliteMigrator.fromRecord(Object.fromEntries(list.map((migration) => [migration.key, run(migration.statements)])))
