# @althar/persistence-sqlite — Architecture

The profile's SQLite store, as described in [docs/architecture/07](../../docs/architecture/07-persistence-security-and-cloud.md). The repository's [ARCHITECTURE.md](../../ARCHITECTURE.md) sets the general engineering target.

- **Owner:** Repository maintainers
- **Consumers:** the runtime, which is the database's only writer. The renderer, Electron main, agents and MCP servers never open it.
- **Dependency direction:** depends on `@althar/domain`, `effect` and `@effect/sql-sqlite-node`. Nothing depends on it except the runtime.

## The schema

- **[schema.sql](schema.sql)** is the readable copy of the whole schema, generated from the migrations by `tests/schema.test.ts`, with each vocabulary's words at the top. Review schema changes there.
- **Migrations are append-only.** Each one is a list of SQL statements. `src/migrations/checksums.ts` records every released migration's SHA-256, and a test fails if one changes. A change to the schema is a new migration.
- **Migrations run with foreign keys off,** then `PRAGMA foreign_key_check`, and only then are foreign keys turned on; the database refuses to open with rows pointing at nothing. This is SQLite's procedure for rebuilding a table others reference, which a test performs.
- **Every table is `STRICT`,** so SQLite enforces column types.
- **Vocabularies are lookup tables,** `vocab_<name> (word)`, and columns reference them. A new word is an `INSERT` in a later migration. A test compares every lookup table with `@althar/domain`'s lists, both ways.
- **Every project-scoped row carries `project_id`,** and references between project rows are composite, `(id, project_id)`, so no row can point into another project. The record, the feed and artifacts carry it too, for the cloud.
- **Device-only data stays in device-keyed tables,** such as `device_project_settings`, never in shared ones.
- **Ids are checked:** a primary key must be its kind's prefix, an underscore and 32 lowercase hex digits.
- **Timestamps** are text in UTC with milliseconds, checked by pattern, so they sort in time order.
- **JSON columns** are checked with `json_valid`. Every artifact a JSON column refers to also gets an `artifact_links` row.
- **Every row that changes state has a revision.** `revisionedTables` lists them, a test checks the list against the schema, and `bumpRevision` moves one on or fails with `RevisionConflict`.
- **"One active" rules are partial unique indexes:** one active attempt per run, one unfinished attempt per node, one active turn per thread, one thread per task and per step.
- **Distinct identities stay distinct,** as docs/architecture/01 requires. A task's workspace is shared by its runs and attempts on a device; `workspace_snapshots` records which code each attempt saw. A step's thread spans its review rounds.
- **Restarts can be reconciled:** each app launch is a `runtime_instances` row; run attempts name the instance holding their controller generation; processes are recorded as `launching` before they are spawned, with the OS start time; work-item claims name their holder and a lease.
- **Permission decisions** record Althar's outcome and scope apart from the option sent to the agent, which is never an "always" option.
- **Columns are snake_case** in SQL and camelCase in TypeScript; the client translates.

## Writes

- **One connection, one runtime.** The client serialises every statement through it, and transactions begin `IMMEDIATE`. A file is held in exclusive locking mode for the connection's life, so a second runtime on the same profile fails to open it with `DatabaseInUse`.
- **No I/O inside a transaction.** Effects outside the database go through `work_items` as intent first, and a worker performs them after commit (docs/architecture/07, the intent and receipt pattern).
- **`Commands.execute`** runs a command and stores its receipt in one transaction. Receipts are kept per actor. A retry of the same command by the same actor gets the first result back without running again; the same id with a different command fails with `CommandIdReused`; another actor's id reveals nothing. A command an agent issues for a person records both. A failed command leaves nothing behind.
- **`Ledger.record`** adds a fact to the operational record and a change to the client feed, inside the caller's transaction. `Ledger.notify` adds only the change, for what isn't a fact a person would look up, such as a thread item growing as an agent streams. `Ledger.changesSince` pages through the feed from a cursor, and `Ledger.listen` wakes a reader when the feed grows. A reader woken by a write inside a transaction reads after the commit, since the store's one connection is the transaction's until then.

## Checks

`bun run check` runs format, type-aware lint and type checks. `bun run test:coverage` runs Vitest with `@effect/vitest` against in-memory and temporary databases, gated at 90% of lines and branches.

## Gaps

- **Fencing by controller generation** is in the schema (the columns exist) but not yet enforced on writes.
- **The artifact store** for bytes, content-addressed on disk, is not built; only artifact metadata is.
- **WAL checkpoints, integrity checks, backup and restore,** which 07 requires, are not built.
- **Raw protocol capture** is not in this database. The agent adapter hands it over frame by frame; writing it to a separate bounded file (docs/architecture/07) is not built yet.

### Project memory storage

Migration `0017_project_memory` adds a rebuildable text projection and FTS5 index
of thread evidence, plus sampled source-revision history and deliberate
active/retired state. A composite foreign key binds each projection to its source
project. FTS virtual/shadow tables are SQLite-managed and cannot use STRICT;
all application tables remain STRICT. Insert/update triggers keep FTS synchronized
with projection transactions.

`memory_source_bases` is captured by a thread-item insertion trigger in the same
transaction as the durable evidence. This preserves the repository binding,
base ref/commit and branch even if indexing occurs after the workspace changes.
Pre-migration evidence has no invented historical snapshot. The runtime can
retry failed projection batches without changing the original thread items.

Migration `0018_memory_vectors` stores rebuildable per-source chunk vectors with
exact source revision, pinned model identity and truncation state. It does not
store generated claims. The runtime commits only against still-current sources
and filters stale/retired/withdrawn sources again when retrieving.
