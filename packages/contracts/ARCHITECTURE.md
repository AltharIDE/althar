# @charrette/contracts — Architecture

The versioned client and runtime schemas of [docs/architecture/02](../../docs/architecture/02-desktop-runtime.md). The repository's [ARCHITECTURE.md](../../ARCHITECTURE.md) sets the general engineering target.

- **Owner:** Repository maintainers
- **Consumers:** `@charrette/runtime`, which serves the API; the desktop app's window, which calls it.
- **Dependency direction:** depends on `effect` alone. It imports nothing from the runtime, Electron or the DOM, so both sides can take it.

## What it holds

| Module | What it does |
| --- | --- |
| `Api.ts` | The calls, their payloads, results and error, and the projections they return |
| `transport.ts` | Effect RPC over a message port: the port shapes each side has, and a protocol for each |

## Principles

- **Projections, not tables.** A query returns what a screen shows (`ThreadSnapshot`, `ProjectSummary`), shaped by the runtime, never rows for the client to join.
- **Checked on both sides.** Every payload, result and event is a schema; a client and a runtime that disagree fail at the boundary, not deep inside.
- **Versioned.** `API_VERSION` goes up when a change would break a client built against an older API; `Status` says which the runtime speaks.
- **One stream.** `Watch` says what changed and what is streaming; clients read again what they show. There are no per-screen subscriptions.
- **One error.** A call fails with `ApiError`, whose `reason` is the runtime's error tag, so a client can tell failures apart without the runtime's types.

## Checks

- `bun run check`: format, type-aware lint and type checks.
- `bun run test:coverage`: a server and a client over a real `MessageChannel`.

## Gaps

- **Commands carry no receipts yet.** The runtime makes each command's envelope itself, so a client that retries a call can't be told it already ran.
- **Thread items' content is untyped** (`Unknown`) until the item kinds settle.
