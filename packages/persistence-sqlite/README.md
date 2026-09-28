# @charrette/persistence-sqlite

Charrette's local store: one SQLite database per profile, written only by the runtime. It holds the schema and its migrations, the operational record and the client change feed, command receipts that make retries safe, and revision checks. It is built on Effect's SQL client, on Node's built-in `node:sqlite`.

**[schema.sql](schema.sql)** is the whole schema as plain SQL, generated from the migrations by a test. Read that rather than the migration code.

## Use it

```ts
import { Commands, Database, Ledger } from '@charrette/persistence-sqlite'

const Store = Layer.mergeAll(Ledger.layer, Commands.layer).pipe(Layer.provideMerge(Database.layer({ filename })))
```

`Database.layer` opens the file with foreign keys on and WAL, and runs every migration before anything else can use it. `Ledger.layer` needs Effect's `Crypto` service for event ids.

## Work on it

From `packages/persistence-sqlite`:

| Command | What it does |
| --- | --- |
| `bun run check` | Format, type-aware lint and type checks |
| `bun run test` | The tests, against in-memory and temporary databases |
| `bun run test:coverage` | The tests with the coverage gate: 90% of lines and branches |
| `bun run verify` | Check and coverage, as CI runs them |

To change the schema, add a migration in `src/migrations`, add its checksum to `src/migrations/checksums.ts` (the test prints the value it expects), and let the tests regenerate `schema.sql` (`bunx vitest run -u`). Never edit a released migration.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the rules this package follows.
