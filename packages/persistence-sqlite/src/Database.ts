import { SqliteClient, SqliteMigrator } from '@effect/sql-sqlite-node'
import { Cause, Effect, Layer, Schema } from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'
import { camelToSnake, snakeToCamel } from 'effect/String'

import { loaderFor, type Migration, migrations } from './migrations'

export interface DatabaseOptions {
  /** A file path, or `:memory:` for tests. */
  readonly filename: string
  /** The migrations to run. Tests pass extra ones; the runtime never does. */
  readonly migrations?: ReadonlyArray<Migration>
}

/** Another runtime has the database open. One runtime at a time writes a profile (docs/architecture/02). */
export class DatabaseInUse extends Schema.TaggedError<DatabaseInUse>()('DatabaseInUse', {
  filename: Schema.String,
}) {}

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
/*
 * A file is held in exclusive locking mode, so a second runtime can't open the
 * profile while one has it: it would take the first one's live sessions for
 * an earlier launch's and reconcile them. The lock is taken by the first
 * statement and held until the connection closes.
 */
const beforeMigrations = (filename: string) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      if (filename !== ':memory:') {
        yield* sql`PRAGMA locking_mode = EXCLUSIVE`
        yield* sql`BEGIN IMMEDIATE`.pipe(
          Effect.andThen(sql`COMMIT`),
          Effect.catchTag('SqlError', (error): Effect.Effect<never, SqlError.SqlError | DatabaseInUse> =>
            /locked|busy/i.test(String(error.cause)) ? Effect.fail(new DatabaseInUse({ filename })) : Effect.fail(error),
          ),
        )
      }
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
): Layer.Layer<
  SqlClient.SqlClient | SqliteClient.SqliteClient,
  SqliteMigrator.MigrationError | SqlError.SqlError | ForeignKeyViolations | DatabaseInUse
> =>
  afterMigrations.pipe(
    Layer.provideMerge(SqliteMigrator.layer({ loader: loaderFor(options.migrations ?? migrations), table: 'schema_migrations' })),
    Layer.provideMerge(beforeMigrations(options.filename)),
    Layer.provideMerge(
      SqliteClient.layer({
        filename: options.filename,
        transformQueryNames: camelToSnake,
        transformResultNames: snakeToCamel,
      }),
    ),
    // Opening a file another runtime holds fails as the client sets it up, before any statement of ours.
    Layer.catchCause((cause) =>
      /database is locked|SQLITE_BUSY/i.test(Cause.pretty(cause))
        ? Layer.effect(SqlClient.SqlClient, Effect.fail(new DatabaseInUse({ filename: options.filename }))).pipe(
            Layer.provideMerge(Layer.effect(SqliteClient.SqliteClient, Effect.fail(new DatabaseInUse({ filename: options.filename })))),
          )
        : Layer.effect(SqlClient.SqlClient, Effect.failCause(cause)).pipe(
            Layer.provideMerge(Layer.effect(SqliteClient.SqliteClient, Effect.failCause(cause))),
          ),
    ),
  )
