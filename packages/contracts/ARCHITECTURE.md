# @althar/contracts — Architecture

The versioned client and runtime schemas of [docs/architecture/02](../../docs/architecture/02-desktop-runtime.md). The repository's [ARCHITECTURE.md](../../ARCHITECTURE.md) sets the general engineering target.

- **Owner:** Repository maintainers
- **Consumers:** `@althar/runtime`, which serves the API; the desktop app's window, which calls it.
- **Dependency direction:** depends on `effect` alone. It imports nothing from the runtime, Electron or the DOM, so both sides can take it.

## What it holds

| Module | What it does |
| --- | --- |
| `Api.ts` | The API merged from its areas (`Api`, `apiLayer`, `SOCKET_CALLS`, `ApiHandlers`), and what is about it as a whole: its version, its lanes, who a call comes from |
| `api/<area>.ts` | One area's calls, as its RPC group, and the payloads, results and projections only they use. The areas are the runtime's handlers' too; each group's comment says what is in it |
| `api/shared.ts` | What the calls of more than one area use: `ApiError`, `CommandId`, thread items, tasks' cards and the like |
| `api/rpc.ts` | What every group is made with: `call` and `command`, `limit`, who may make a call (`SocketAllowed`, `socketCanCall`) and `ClientAuthority` |
| `api/internal.ts` | Pieces more than one module uses that the package doesn't export |
| `open.ts` | Unions a newer home may add to, as an older client reads them (`OpenLiterals`, `OpenUnion`, `KnownArray`, `KnownOrNull`) |
| `api.schema.json` | The wire, as JSON Schema: every call, command and stream, written by `bun run snapshot` and checked against the contract by a test |
| `transport.ts` | Effect RPC over a message port: the port shapes each side has, and a protocol for each |
| `pictures.ts` | What a picture's bytes say it is (PNG, JPEG, GIF or WebP) and how big it is, and what a message's images may be (`MESSAGE_IMAGES`): pure, so the runtime and the window check images alike |

## Principles

- **Projections, not tables.** A query returns what a screen shows (`ThreadSnapshot`, `ProjectSummary`), shaped by the runtime, never rows for the client to join. A tool call carries the command it runs and the files it touches, not its raw input and output.
- **What Althar posts is a thread item too.** A step's result (`StepResultItem`) and a task's card (`TaskItem`) come in the thread like what an agent says; a card's content is read from the task when it is asked for, so it is always current.
- **Checked on both sides.** Every payload, result and event is a schema, a thread item's content too (a union by kind); a client and a runtime that disagree fail at the boundary, not deep inside.
- **Versioned.** `API_VERSION` goes up when a change would break a client built against an older API; `Status` says which the runtime speaks.
- **Read by clients of other releases.** A home, a desktop and a phone ship apart and connect all the same ([foundations](../../docs/decisions/foundations.md#clients-of-another-version)). An answer's union that grows is open on decode: a member the client doesn't know takes the union's fallback, or is left out of a list where nothing could show it. Encoding stays strict, so a runtime sends only what the contract lists, and a payload is never open: a home refuses what it can't do.
- **The wire is reviewed.** `api.schema.json` is what crosses, and a change to it is in the diff of the pull request that makes it.
- **A client says which version it speaks, and an exact match is served.** Every request carries `API_VERSION_HEADER` (`clientProtocol` adds it, so the window does; the command line embeds the runtime and has no connection to state it on). The runtime refuses a request whose version isn't its own, or that names none, with `ApiError` of reason `ApiVersionMismatch` and `clientVersion` and `runtimeVersion` set (`apiVersionRefusal`). There is no range or negotiation yet: `API_VERSION` is bumped for any change a client built against the last would not survive, and the window, which can't half-work against such a runtime, shows a recovery page naming both versions.
- **Commands carry the client's id.** Every command takes a `commandId` the client makes; the same id again is a retry, answered with the first one's result.
- **Reads say where the feed stood, and `Watch` starts there.** Lists and threads return the cursor they read at; `Watch({ since })` sends every change after it, each with its cursor and its thread, so a client resumes where it left off.
- **Unbounded results are paged.** A thread comes with its newest items and says whether there are earlier ones; `GetThreadItem` reads one item.
- **One stream.** `Watch` says what changed and what is streaming; clients read again what they show. There are no per-screen subscriptions.
- **One error.** A call fails with `ApiError`: `reason` is the runtime's error tag, so a client can tell failures apart without the runtime's types, and `message` says it in words a window can show.
- **No paths from a client.** A folder is opened by a grant the app's main process got from the runtime (07).

## Adding a call

1. **Its area.** Put the call in the group of the area it belongs to, in `src/api/<area>.ts`, with the schemas only it uses above the group. The group's comment says what is in the area; the runtime's handlers are split the same way, so the call's handler goes in that area's module there. A schema another area's calls use too goes in `src/api/shared.ts`. A call that belongs to no area is a new area: a module here, its group merged into `Api` and installed by `apiLayer`, and a handler module in the runtime.
2. **`call` or `command`.** A command takes the client's `commandId`; a call that changes nothing doesn't. A socket can't make it until `socketCalls` names it (`src/api/rpc.ts`), and nothing that gives the person's word is named there.
3. **A union in its answer that will grow** (a kind, a role, a state, an event's type) is open on decode before it grows: `OpenLiterals` for literals, with a fallback the window draws as it draws nothing special; `OpenUnion` for structs told apart by a tag; `KnownArray` or `KnownOrNull` where a member the client doesn't know can't be shown, as an item of a thread. Adding a member to an open union is compatible. Adding one to a union that isn't open breaks every older client: open it first, in its own release. A payload stays closed.
4. **The snapshot.** Run `bun run snapshot` and commit `api.schema.json`: its diff is the change to the wire, for review. `tests/apiSchema.test.ts` fails while the file and the contract differ.
5. **Tests stub only the calls they make.** `handling` in `tests/api.test.ts` answers every other call with one that dies.

## Checks

- `bun run check`: format, type-aware lint and type checks.
- `bun run test:coverage`: the schemas, and a server and a client over a real `MessageChannel`, closing and all; an older client reading a newer home (`tests/open.test.ts`); and the wire as `api.schema.json` has it (`tests/apiSchema.test.ts`).

## Gaps

- **Lists are not paged yet.** Projects and tasks come whole; a person has tens of them, not thousands.
- **Not every growing union is open yet.** A notice's role, thread items' kinds, calls' kinds, watch and attention events, and the products of `ListConnections` are. A product elsewhere in an answer (a repository's host, a thread's), a nudge's kind, a notice's step, a task's phase and a tool call's kinds aren't: a new one still fails an older client.
- **`shared.ts` is large.** The split is by which calls use a schema, and thread and task projections are used across areas; splitting them by theme is for a change of its own.
