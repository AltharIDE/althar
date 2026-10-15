import { SqliteClient, SqliteMigrator } from '@effect/sql-sqlite-node'
import { Cause, type Duration, Effect, Layer, Schema } from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'
import { camelToSnake, snakeToCamel } from 'effect/String'

import { BackupFailed, backUpBeforeMigrating, latestBackup, reasonOf } from './backups'
import { loaderFor, type Migration, MIGRATIONS_TABLE, migrations } from './migrations'

export { BackupFailed }

export interface DatabaseOptions {
  /** A file path, or `:memory:` for tests. */
  readonly filename: string
  /** The migrations to run. Tests pass extra ones; the runtime never does. */
  readonly migrations?: ReadonlyArray<Migration>
  /** Where the store copies itself before it migrates (the profile's `backups`); without it, no copy is made. */
  readonly backups?: string
  /** How long a statement waits for a lock another connection holds before it gives up: the client's five seconds unless a test asks for less. */
  readonly busyTimeout?: Duration.Duration
}

/** Another runtime has the database open. One runtime at a time writes a profile (docs/architecture/02). */
export class DatabaseInUse extends Schema.TaggedError<DatabaseInUse>()('DatabaseInUse', {
  filename: Schema.String,
}) {}

/** Migrations left rows pointing at nothing. The database is not opened. */
export class ForeignKeyViolations extends Schema.TaggedError<ForeignKeyViolations>()('ForeignKeyViolations', {
  tables: Schema.Array(Schema.String),
  /** The newest copy from before migrations ran, where there is one. */
  backup: Schema.NullOr(Schema.String),
}) {}

/**
 * A migration didn't finish. The migrator runs every pending migration in one
 * transaction, so none of them took effect, and the database is not opened.
 */
export class MigrationFailed extends Schema.TaggedError<MigrationFailed>()('MigrationFailed', {
  filename: Schema.String,
  /** The copy made before migrating; null where none was made, as for a new store. */
  backup: Schema.NullOr(Schema.String),
  /** What went wrong, as the migrator and SQLite said it. */
  reason: Schema.String,
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

/*
 * Before any pending migration runs, the store is copied into the profile's
 * backups (backups.ts); a copy that can't be made stops it there, unmigrated.
 * A migration that fails, or migrations that leave rows pointing at nothing,
 * keep the database closed and say where the copy is, so whoever opened it
 * never goes on with a store that isn't up to date.
 */
const migrate = (options: DatabaseOptions) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const list = options.migrations ?? migrations
      const backups = options.filename === ':memory:' ? undefined : options.backups
      const copy = backups === undefined ? null : yield* backUpBeforeMigrating(backups, list)
      yield* SqliteMigrator.run({ loader: loaderFor(list), table: MIGRATIONS_TABLE }).pipe(
        Effect.catchCause((cause): Effect.Effect<never, MigrationFailed> =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.interrupt
            : Effect.fail(new MigrationFailed({ filename: options.filename, backup: copy, reason: reasonOf(Cause.squash(cause)) })),
        ),
      )
      const violations = yield* sql<{ table: string }>`PRAGMA foreign_key_check`
      if (violations.length > 0) {
        return yield* new ForeignKeyViolations({
          tables: [...new Set(violations.map((violation) => violation.table))].toSorted(),
          // On a later launch nothing is pending, so nothing is copied: the copy from before is the newest one.
          backup: copy ?? (backups === undefined ? null : latestBackup(backups)),
        })
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
  MigrationFailed | BackupFailed | SqlError.SqlError | ForeignKeyViolations | DatabaseInUse
> =>
  migrate(options).pipe(
    Layer.provideMerge(beforeMigrations(options.filename)),
    Layer.provideMerge(
      SqliteClient.layer({
        filename: options.filename,
        transformQueryNames: camelToSnake,
        transformResultNames: snakeToCamel,
        ...(options.busyTimeout === undefined ? {} : { busyTimeout: options.busyTimeout }),
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
