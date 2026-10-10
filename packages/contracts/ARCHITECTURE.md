# @althar/contracts — Architecture

The versioned client and runtime schemas of [docs/architecture/02](../../docs/architecture/02-desktop-runtime.md). The repository's [ARCHITECTURE.md](../../ARCHITECTURE.md) sets the general engineering target.

- **Owner:** Repository maintainers
- **Consumers:** `@althar/runtime`, which serves the API; the desktop app's window, which calls it.
- **Dependency direction:** depends on `effect` alone. It imports nothing from the runtime, Electron or the DOM, so both sides can take it.

## What it holds

| Module | What it does |
| --- | --- |
| `Api.ts` | The calls, their payloads, results and error, and the projections they return |
| `memory.ts` | Attributed project evidence, bounded search results, source pages and indexed revision history; search/read RPCs are additive, and state changes carry an expected revision and a command receipt. |
| `transport.ts` | Effect RPC over a message port: the port shapes each side has, and a protocol for each |

## Principles

- **Projections, not tables.** A query returns what a screen shows (`ThreadSnapshot`, `ProjectSummary`), shaped by the runtime, never rows for the client to join. A tool call carries the command it runs and the files it touches, not its raw input and output.
- **What Althar posts is a thread item too.** A step's result (`StepResultItem`) and a task's card (`TaskItem`) come in the thread like what an agent says; a card's content is read from the task when it is asked for, so it is always current.
- **Checked on both sides.** Every payload, result and event is a schema, a thread item's content too (a union by kind); a client and a runtime that disagree fail at the boundary, not deep inside.
- **Versioned.** `API_VERSION` goes up when a change would break a client built against an older API; `Status` says which the runtime speaks.
- **Commands carry the client's id.** Every command takes a `commandId` the client makes; the same id again is a retry, answered with the first one's result.
- **Reads say where the feed stood, and `Watch` starts there.** Lists and threads return the cursor they read at; `Watch({ since })` sends every change after it, each with its cursor and its thread, so a client resumes where it left off.
- **Unbounded results are paged.** A thread comes with its newest items and says whether there are earlier ones; `GetThreadItem` reads one item.
- **One stream.** `Watch` says what changed and what is streaming; clients read again what they show. There are no per-screen subscriptions.
- **One error.** A call fails with `ApiError`: `reason` is the runtime's error tag, so a client can tell failures apart without the runtime's types, and `message` says it in words a window can show.
- **No paths from a client.** A folder is opened by a grant the app's main process got from the runtime (07).

## Checks

- `bun run check`: format, type-aware lint and type checks.
- `bun run test:coverage`: the schemas, and a server and a client over a real `MessageChannel`, closing and all.

## Gaps

- **Lists are not paged yet.** Projects and tasks come whole; a person has tens of them, not thousands.
