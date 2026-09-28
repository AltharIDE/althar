# @charrette/persistence-sqlite — Architecture

The profile's SQLite store, as described in [docs/architecture/07](../../docs/architecture/07-persistence-security-and-cloud.md). The repository's [ARCHITECTURE.md](../../ARCHITECTURE.md) sets the general engineering target.

- **Owner:** Repository maintainers
- **Consumers:** the runtime, which is the database's only writer. The renderer, Electron main, agents and MCP servers never open it.
- **Dependency direction:** depends on `@charrette/domain`, `effect` and `@effect/sql-sqlite-node`. Nothing depends on it except the runtime.

## The schema

- **[schema.sql](schema.sql)** is the readable copy of the whole schema, generated from the migrations by `tests/schema.test.ts`. Review schema changes there.
- **Migrations are append-only.** Each one is a list of SQL statements. `src/migrations/checksums.ts` records every released migration's SHA-256, and a test fails if one changes. A change to the schema is a new migration.
- **Every table is `STRICT`,** so SQLite enforces column types.
- **Ids are checked:** a primary key must be its kind's prefix, an underscore and 32 lowercase hex digits.
- **Timestamps** are text in UTC with milliseconds, checked by pattern, so they sort in time order.
- **JSON columns** are checked with `json_valid`.
- **Vocabularies are checked** against the same lists as `@charrette/domain`. A test compares every `CHECK (… IN (…))` list with the domain's, and fails if a vocabulary column has no domain list.
- **Aggregates carry a revision** for optimistic concurrency; `bumpRevision` moves one on or fails with `RevisionConflict`.
- **Distinct identities stay distinct:** task, run, run attempt, workflow execution, node, node attempt, provider session, workspace and thread are separate tables, as docs/architecture/01 requires.
- **Columns are snake_case** in SQL and camelCase in TypeScript; the client translates.

## Writes

- **One connection.** The client serialises every statement through it, and transactions begin `IMMEDIATE`.
- **No I/O inside a transaction.** Effects outside the database go through `work_items` as intent first, and a worker performs them after commit (docs/architecture/07, the intent and receipt pattern).
- **`Commands.execute`** runs a command and stores its receipt in one transaction. A retry with the same id and the same command gets the first result back without running again; the same id with a different command fails with `CommandIdReused`. A failed command leaves nothing behind.
- **`Ledger.record`** adds a fact to the operational record and a change to the client feed, inside the caller's transaction. `Ledger.changesSince` pages through the feed from a cursor.

## Checks

`bun run check` runs format, type-aware lint and type checks. `bun run test:coverage` runs Vitest with `@effect/vitest` against in-memory and temporary databases, gated at 90% of lines and branches.

## Gaps

- **Repositories per aggregate** (tasks, runs, sessions…) arrive with the runtime code that uses them.
- **Fencing by controller generation** is in the schema (the columns exist) but not yet enforced on writes.
- **The artifact store** for bytes, content-addressed on disk, is not built; only artifact metadata is.
- **WAL checkpoints, integrity checks, backup and restore,** which 07 requires, are not built.
- **Retention for `provider_events`,** the raw protocol capture, is not built.
