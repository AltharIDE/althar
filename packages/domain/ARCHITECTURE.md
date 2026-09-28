# @charrette/domain — Architecture

The shared vocabulary of the runtime side: what Charrette's identities, states and commands are, written once as Effect schemas and used at every boundary. The repository's [ARCHITECTURE.md](../../ARCHITECTURE.md) sets the general engineering target; the product architecture is in [docs/architecture](../../docs/architecture/README.md).

- **Owner:** Repository maintainers
- **Consumers:** `@charrette/persistence-sqlite`, and the runtime, adapters and app–runtime contract to come. Never `@charrette/ui`.
- **Dependency direction:** depends on `effect` alone. Nothing it imports reads files, starts processes or opens a database.

## What it holds

| Module | What it defines |
| --- | --- |
| `ids.ts` | One branded id per identity, and `newId` |
| `time.ts` | `Timestamp`, and `now` from the Effect clock |
| `vocabulary.ts` | Every state and kind the store records |
| `lifecycles.ts` | The node-attempt and provider-session lifecycles as data, and `transition` |
| `commands.ts` | `CommandEnvelope`, the shape of every request to change state |

## Principles

- **Schemas are the source of truth.** Types come from schemas (`typeof X.Type`), and the same schema validates untrusted data wherever it enters: from the app, from an agent, or from the database.
- **Every identity has its own kind of id.** An id is a prefix, an underscore and a UUIDv7 as 32 hex digits (`task_0192f0b3…`). Ids sort by creation time, say what they identify, and cannot be passed where another kind is expected. The store checks the prefix too.
- **The words are the architecture's.** `suspended`, `cancelled`, `attention_request`: the interface uses other words for some of them, listed in [the glossary](../../docs/glossary.md).
- **Every vocabulary has one list.** The store keeps each vocabulary in a lookup table with the same words, and a test in `@charrette/persistence-sqlite` fails if the two differ. Adding a word means a new migration that inserts it.
- **Lifecycles are data.** A state moves only along a listed edge; a state with no edges is terminal. Tests check that every state is reachable and that nothing leaves a terminal state. The diagrams in docs/architecture 03 and 05 draw the same edges.
- **Time and randomness are services.** `now` reads the Effect clock and `newId` uses the `Crypto` service, so tests can fix both.

## Checks

`bun run check` runs format, type-aware lint and type checks; lint and format settings are in the repository root's `vite.config.ts`. `bun run test:coverage` runs Vitest with `@effect/vitest`, gated at 90% of lines and branches.

## Gaps

- **Entities are not modelled yet.** Tasks, runs and nodes exist as tables and vocabularies, not as schema classes. They arrive with the runtime code that reads and writes them.
- **Command payloads** have no schemas yet. Each command's payload schema arrives with the command.
