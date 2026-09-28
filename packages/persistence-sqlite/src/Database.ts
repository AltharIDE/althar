import { SqliteClient, SqliteMigrator } from '@effect/sql-sqlite-node'
import { Effect, Layer, Schema } from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'
import { camelToSnake, snakeToCamel } from 'effect/String'

import { loaderFor, type Migration, migrations } from './migrations'

export interface DatabaseOptions {
  /** A file path, or `:memory:` for tests. */
  readonly filename: string
  /** The migrations to run. Tests pass extra ones; the runtime never does. */
  readonly migrations?: ReadonlyArray<Migration>
}

/** Migrations left rows pointing at nothing. The database is not opened. */
export class ForeignKeyViolations extends Schema.TaggedError<ForeignKeyViolations>()('ForeignKeyViolations', {
  tables: Schema.Array(Schema.String),
}) {}

/*
 * Foreign keys are off while migrations run, because rebuilding a table that
 * others reference is impossible otherwise, and SQLite ignores the pragma
 * inside the migrator's transaction. So it is set before the migrator starts.
 * Afterwards every foreign key is checked, and only then are they turned on
 * for the rest of the connection's life (SQLite's documented procedure for
 * schema changes).
 */
const beforeMigrations = Layer.effectDiscard(
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`PRAGMA foreign_keys = OFF`
  }),
)

const afterMigrations = Layer.effectDiscard(
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const violations = yield* sql<{ table: string }>`PRAGMA foreign_key_check`
    if (violations.length > 0) {
      return yield* new ForeignKeyViolations({ tables: [...new Set(violations.map((violation) => violation.table))].toSorted() })
    }
    yield* sql`PRAGMA foreign_keys = ON`
  }),
)

/**
 * The profile's database: one connection, which the runtime alone writes
 * through (docs/architecture/07). WAL and the busy timeout are set by the
 * client. Columns are snake_case in SQL and camelCase in TypeScript. The layer
 * is ready only once every migration has run and foreign keys are on.
 */
export const layer = (
  options: DatabaseOptions,
): Layer.Layer<SqlClient.SqlClient | SqliteClient.SqliteClient, SqliteMigrator.MigrationError | SqlError.SqlError | ForeignKeyViolations> =>
  afterMigrations.pipe(
    Layer.provideMerge(SqliteMigrator.layer({ loader: loaderFor(options.migrations ?? migrations), table: 'schema_migrations' })),
    Layer.provideMerge(beforeMigrations),
    Layer.provideMerge(
      SqliteClient.layer({
        filename: options.filename,
        transformQueryNames: camelToSnake,
        transformResultNames: snakeToCamel,
      }),
    ),
  )
