# @althar/persistence-sqlite

Althar's local store: one SQLite database per profile, written only by the runtime. It holds the schema and its migrations, the operational record and the client change feed, command receipts that make retries safe, and revision checks. It is built on Effect's SQL client, on Node's built-in `node:sqlite`.

**[schema.sql](schema.sql)** is the whole schema as plain SQL, generated from the migrations by a test. Read that rather than the migration code.

## Use it

```ts
import { Commands, Database, Ledger } from '@althar/persistence-sqlite'

const Store = Layer.mergeAll(Ledger.layer, Commands.layer).pipe(Layer.provideMerge(Database.layer({ filename })))
```

`Database.layer` opens the file with foreign keys on and WAL, holds it so no second runtime can open it, and runs every migration before anything else can use it. Given a `backups` folder, it copies the store there first whenever a migration is pending, keeping the newest three; a migration that fails leaves the store as it was and fails the layer with `MigrationFailed`, naming the copy. `Ledger.layer` needs Effect's `Crypto` service for event ids.

## Work on it

From `packages/persistence-sqlite`:

| Command | What it does |
| --- | --- |
| `bun run check` | Format, type-aware lint and type checks |
| `bun run test` | The tests, against in-memory and temporary databases |
| `bun run test:coverage` | The tests with the coverage gate: 90% of lines and branches |
| `bun run verify` | Check and coverage, as CI runs them |

To change the schema, add one file to `src/migrations`, numbered one past main's last, such as `0105_task_labels.ts`, that exports its `statements`, and regenerate `schema.sql` (`bunx vitest run tests/schema.test.ts -u`). That is all: nothing lists the migrations, the store finds each `NNNN_name.ts` there and runs them in the order of their numbers, and no checksum is kept by hand. A migration imports only from `src/migrations`, as the ones that use `0001_initial/columns.ts` do. Once main has a migration it is frozen, shipped or not: never renumber, edit or remove one, and fix it with a new migration (see [ARCHITECTURE.md](ARCHITECTURE.md#the-schema)). CI's `numbers` check refuses a change to one of main's, and where another pull request took the same number first, refuses yours and says which number to take: rename the file.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the rules this package follows.
