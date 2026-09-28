import { SqliteClient, SqliteMigrator } from '@effect/sql-sqlite-node'
import { Effect, Layer } from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'
import { camelToSnake, snakeToCamel } from 'effect/String'

import { loader } from './migrations'

export interface DatabaseOptions {
  /** A file path, or `:memory:` for tests. */
  readonly filename: string
}

/** Settings that SQLite keeps per connection, applied before anything else runs. WAL and the busy timeout are set by the client. */
const connectionSettings = Layer.effectDiscard(
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`PRAGMA foreign_keys = ON`
  }),
)

/**
 * The profile's database: one connection, which the runtime alone writes
 * through (docs/architecture/07). Columns are snake_case in SQL and camelCase
 * in TypeScript. The layer is ready only once every migration has run.
 */
export const layer = (
  options: DatabaseOptions,
): Layer.Layer<SqlClient.SqlClient | SqliteClient.SqliteClient, SqliteMigrator.MigrationError | SqlError.SqlError> =>
  SqliteMigrator.layer({ loader, table: 'schema_migrations' }).pipe(
    Layer.provideMerge(connectionSettings),
    Layer.provideMerge(
      SqliteClient.layer({
        filename: options.filename,
        transformQueryNames: camelToSnake,
        transformResultNames: snakeToCamel,
      }),
    ),
  )
