# Refactor

> **Temporary.** Where Althar's code hurts as it has grown, and the order in
> which the refactors pay for each other. Delete this file when the last phase
> ships, and keep the rules that lasted in ARCHITECTURE.md, AGENTS.md and the
> decisions they amend.

Proposed on 25 November 2026, from a read of main at 7d65412: the import graph
of every package, 912 commits of history (churn, what changes together, what
the fixes touched), the last week of CI through the Actions API, and the
decisions in `docs/decisions`. An independent review then tried to prove it
wrong, and its findings that held are folded in.

## Where it hurts

Six causes explain most of the pain. Each is measured below, and each measure
is a baseline that may only fall (`.github/measures.json`).

1. **Every feature goes through the same few files.** The contract
   (`packages/contracts/src/Api.ts`, 6,901 lines) is in 27% of all commits, and
   the runtime's `Api.ts` and `Queries.ts` sit beside it. One new call needed
   seven edits across the seam, five of them mechanical: a stub line in two
   test files, a `vi.fn` in the desktop's fake client, a copied member in the
   desktop's client. Any two migrations in flight conflicted, on the tail of
   `migrations/index.ts`, `checksums.ts` and one line of `schema.sql`: 36
   migration pull requests since 1 November.
2. **State has no owner.** The lifecycles are written down in `@althar/domain`
   and nothing holds the code to them: 7 of the 13 `transition()` calls pass a
   literal starting state, so the check can't fail. A node attempt's state is
   written from 24 places, an attention request's from 20 and a task's from 12.
   `records.change()` is a blind UPDATE with 242 callers. SQL sits in 145 of the
   runtime's 318 modules, and 372 `json_extract` calls read state kept in JSON.
3. **Work reacts through an in-memory bus, and nothing can wait for it.** A
   follow-up to a change rides on `Live`, so a crash between the change and the
   reaction loses it, and a test can only poll for it. 17 of the 18 commits that
   fixed flaky tests also fixed product code: most flakes are real races. 2,647
   runtime tests run on real time, against 469 on the test clock.
4. **Files were split by size, not by responsibility.** The 21 November split
   of Runs, Changes and Sessions, done to pass the size gate, left re-export
   stubs that built a 32-module import cycle. Counting value imports, the
   runtime had cycles of 28, 8, 6 and 3 modules, and nothing checked cycles or
   the direction of imports.
5. **Knowledge sits in the wrong layer, and is copied.** The runtime compares
   code-host names 58 times and agent ids 53 times, and builds each host's REST
   and GraphQL by hand. The fake agent matches the runtime's brief wording. A
   race fix (`cb1d6b08`) reached the task's composer and not `ProjectView`'s
   copy of it.
6. **What ships isn't checked before it ships.** Releases that don't match
   connect, and decoding breaks both ways: on 20 November a thread item's
   `role` went from four values to six, which every older client fails to read,
   while `API_VERSION` has never moved. 16 of 17 post-merge failures were one
   gate that ran only after merge, the contract's branch coverage, which kept
   main red for about 45 hours from 22 to 24 November. Quarantine had no owner
   and no end.

## Phases

Sizes are effort, not dates: S is days, M a week or two, L several weeks. Every
item leaves no re-export stub and no bag of dependencies behind; says in
AGENTS.md or its area's ARCHITECTURE.md how to do it the new way, so the agents
writing most of the code don't rebuild the old shape; moves its measure and
lowers the baseline; and amends the decision it changes, with a dated entry.

### Phase 0: guard the wire and stop paying the tax

Guard the wire and remove the busywork that made every later step expensive.

- **0.1 Every gate before merge (S).** Each package a ready pull request reaches
  that gates on coverage measures it there; since #1243 the queue runs only what
  its entries could break together, and post-merge measures every package. The
  guards that read one file at a time are lint rules (`althar/test-time`,
  `althar/spec-time`, `althar/system-keys`, `althar/no-future-dates`), and test
  durations come from the newest post-merge run instead of a hand-kept file.
- **0.2 Quarantine with an owner and an end (S).** A quarantine lasts seven
  days from its issue, or until the test fails both attempts twice in a day;
  then it is `broken`, skipped on pull requests and in the queue, run every
  night and listed on every summary, with the owner written on its issue. Only
  an issue CI filed quarantines. Stress also runs the tests nearest the changed
  source.
- **0.3 A snapshot of the wire (M).** `packages/contracts/api.schema.json`
  holds every call's payload, success and error, its lane and whether a socket
  may call it, and a test fails on a diff nobody regenerated. Clients read a
  newer home's unknown members (an open role, open watch and attention events,
  unknown thread items left out) where they failed before. The phone's own
  repository checks itself against althar's main every night.
- **0.4 Counts that only fall (S).** `.github/measures.json`, checked against
  main's on every pull request and group (`measures`).
- **0.5 Migrations that don't collide (S).** Found by their file names, with
  main's held to main's byte for byte by `numbers`, and `schema.sql` sorted by
  table, one column a line.
- **0.6 Stubs that don't list every call (S).** The contract's and the desktop
  client's test handlers, and the desktop's fake client, answer any call they
  aren't given.
- **0.7 Untie the runtime's cycles (S).** Imports from the file that makes each
  name, type imports marked, and the helpers that kept imports pointing up moved
  down; `import/no-cycle` and `althar/exported-where-made` keep it so.
- **0.8 Layers as a table (M).** `packages/runtime/layers.js` places every
  module in one of eight layers, and `althar/layers` refuses an import up them
  and a module it doesn't place.
- **0.9 A size gate that doesn't force bad splits (S).** `Queries.ts` is left
  out until 1.4, and the gate's message points at the layers.
- **0.10 What the review found (S).** The lead-switch fix in `ProjectView`, the
  two calls the socket list named that don't exist, the `once()` that did
  nothing, and one word, Needs you, for a task that needs the person.

### Phase 1: break the hubs up by area

- **1.1 The contract by area, mechanically (M).** Each area's schemas and group in `packages/contracts/src/api/<area>.ts`,
  what two areas share in `shared.ts`, and the barrel as before. The snapshot
  is byte for byte the same before and after.
- **1.2 Rules declared on the RPC (M, medium risk).** Who may call each RPC, and
  on which lane, is declared on it, replacing the allowlist, `BEHIND_CALLS`, the
  payload sniffing and the checks inside handlers. Its own pull request,
  because it changes authority.
- **1.3 Handlers by area (M).** Each area's handlers in `packages/runtime/src/api/<area>.ts`,
  taking only the services they use, on a small kit of what several share;
  `Api.ts` composes them and checks the whole with `satisfies ApiHandlers`.
- **1.4 Queries by screen (M, medium risk).** Items, thread, board, home,
  standing and feed, behind the same service, with one watcher that writes
  cards.
- **1.5 Screen reads off the main thread (M, high risk).** To the read workers,
  with an eye on their 32-job queue. Its own item, because it changes timing.
- **1.6 A desktop client derived from the RPC groups (M).** Hand-written code
  stays for the half-dozen calls that combine others; one feature at a time.
- **1.7 Config by area, and a Host port (M).** The desktop's runtime host gets a
  small facade instead of reading internal services, and the CLI moves onto the
  API.
- **1.8 One conversation model in the window (M).** The task, the coordinator
  and the artifact room share one view model, so a fix lands once.
- **1.9 One way to show a press at once (S).** `useTask.act` as one primitive;
  one hook for the 14 setting hooks; `althar/press-at-once` over `.ts` hooks.
- **1.10 Boundaries in the window and the kit (S).** A boundary lint for
  features and the kit's layers, the kit's subpath exports, and unused kit code
  removed.

### Phase 2: give state an owner

Its first slices start beside Phase 1.

- **2.1 Background work with a handle (L).** Every loop and fork registers by
  name and runs on Clock-driven schedules, starting as a thin registry that
  changes no behaviour. Tests get `settle()` and `tick(name)`, then a runtime
  test kit replaces module-level recorders, `process.env` writes and
  synchronous git. This takes over Phase 4 of [Tests that hold](tests-that-hold.md).
- **2.2 Durable reactions (L).** Follow-ups written in the same transaction as
  the change, as an outbox on `work_items` or cursors over `record_events`;
  `Live` goes back to streaming the window. First: the reaction to a turn's end.
- **2.3 One writer per aggregate (L).** One helper, extracted from the guarded
  transitions already in Plans, Reviews, IssueDrafts and IssueChanges and the
  worker ledger's fenced compare-and-set. Each aggregate's module alone writes
  its status, from the domain lifecycles, with the fact in the same statement
  and rows decoded with schemas. Illegal edges are logged for a release before
  they are refused. In order: node attempts, tasks, runs, attention requests.
- **2.4 Typed JSON and real columns (M).** A schema per thread-item kind, the
  task and thread on the change feed, join keys out of JSON.

For every item: a reconcile pass for rows already in states the lifecycle
forbids, tests that start from a store the last release made, and migrations
batched per release. Where the code takes edges the lifecycle forbids (held to
admitted, cancelled without cancelling, a handover ending as failed), either the
lifecycle and doc 05 change, or the code does: a decision for each.

### Phase 3: shape it for where Althar is going

Parallel streams, each once its area has an owner: `defineTool` for the 115
tools (3.1); code hosts behind their adapters, with product names linted out of
the runtime (3.2); agents as strategies (3.3); the fake agent split, with no
fake reading the briefs (3.4); compatibility beyond the snapshot, with
`API_VERSION` as a major version and every client told what its home supports
(3.5); codes across the wire and words at home (3.6); typed IPC and a split main
process (3.7).

Deferred on purpose: steps as a registry (3.8), until the next step type is
planned; one port for where work runs (3.9), as a short design note the worker
work in flight follows, rather than a refactor under it.

## Measures

| Measure | 25 Nov | Where |
| --- | --- | --- |
| Share of commits touching the contract | 27% | by hand |
| Edits to add one RPC | 7, five of them mechanical | by hand |
| Runtime modules on a value import cycle | 45 (cycles of 28, 8, 6 and 3) | `measures.json`, and lint |
| `json_extract` calls in the runtime | 372 | `measures.json` |
| Code-host and agent name comparisons in the runtime | 62 and 58 | `measures.json` |
| Runtime tests that sleep on the real clock | 166 (2,646 `it.live` against 467 `it.effect`) | `measures.json` |
| Places that write a status | 26 node attempts, 21 attention requests, 12 tasks | `measures.json` |
| Quarantined tests | 12 | each run's summary |
| Post-merge incidents | 3 in 21–25 Nov, the longest about 45 hours red | by hand |
| Lines with no coverage gate | about 43k | by hand |

## Where it stands

- **The first pull request** does all of Phase 0, with 1.1 and 1.3, done by
  scripts that can be run again on a newer main. After it, no runtime module
  is on a value import cycle, one new call adds no line to a test stub, and
  adding a migration is one file.
- **Left from Phase 0:**
  - Still closed to unknown members: products outside `ListConnections`, nudge
    kinds, a notice's step kind, a task's phase and tool-call kinds. Clients
    already released stay intolerant; only clients from this release on read
    what they don't know.
  - `packages/runtime/tests/settingsTools.test.ts` reads the desktop's files by
    path, which the selection can't follow, so it still runs only after merge.
  - Windows' smoke test doesn't skip a lapsed quarantine.
  - `shared.ts` in the contract is 2,721 lines: what two or more areas use,
    which 1.2 and 2.4 should thin.
- **Next:** 1.2 on its own, then 1.4, and 2.1's thin registry beside them.
