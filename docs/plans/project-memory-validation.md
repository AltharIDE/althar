# Project memory validation

Recorded on 10 October 2026. Implementation commit `192ac2a` includes the
current main branch and the unified window-bar integration. All ten GitHub
checks passed on that commit. Current head status is available on
[PR #85](https://github.com/AltharIDE/althar/pull/85).

## Verification evidence

| Check | Result | What it establishes |
|---|---|---|
| Runtime | 500 passed; coverage gate passed | Interrupted cross-task/provider delivery after restart, later corrections, scoped tools, source lifecycle, recovery and normal task behavior. |
| Desktop | 381 passed; coverage gate passed | RPC/client/cache, routing, project isolation, source inspection and revision-safe retirement. |
| Electron E2E | 14 passed; 2 opt-in checks skipped | Built renderer, real RPC and SQLite; memory capture, inspection, retirement/restoration and source navigation. |
| Shared UI | 1,032 passed; 4 skipped; coverage and Storybook build passed | Existing component behavior and the merged project-menu integration. |
| Persistence / provider adapters | 41 / 133 passed; coverage gates passed | Migration/storage and provider adapter compatibility. |
| Contracts / domain / connectors / CLI | 12 / 66 / 237 / 29 passed | Contract compatibility and unaffected runtime boundaries. |
| Repository static checks | Passed | Formatting, lint and types; existing warnings remain. |
| Site workflow | Passed | Shared UI changes build and test with the site. |
| Pitch E2E | 36 passed; 2 skipped locally | Existing browser checks, after installing the required Chromium binary. |
| Live Codex recipient | 1 passed, 45.61 seconds | A real ACP Codex session read retained synthetic prior evidence and distinguished an observed failure from a suspected cause. |

GitHub evidence: [harness](https://github.com/AltharIDE/althar/actions/runs/38073929081),
[desktop](https://github.com/AltharIDE/althar/actions/runs/38073929092),
[UI](https://github.com/AltharIDE/althar/actions/runs/38073929114),
[site](https://github.com/AltharIDE/althar/actions/runs/38073929152).
Runtime coverage was 98.15% lines and 90.06% branches in CI; desktop was
97.19% lines and 90.10% branches. Thresholds were not weakened.

Local broad tests were serialized with `--maxWorkers=2` after parallel
runs caused wall-clock timeouts under machine load. The final fresh local
runtime run also passed all 500 tests and its coverage gate. Tests caught
and fixed current queued inputs being retrieved as history and stale
projections being served during a correction backlog. The backlog fixture
exceeds 2,048 sources; older same-thread evidence is also tested after a
72,000-character item evicts it from the bounded transcript.

## Live check and its limits

The opt-in fixture is
[`packages/runtime/tests/agents/memory.test.ts`](../../packages/runtime/tests/agents/memory.test.ts).
It inserted an attributed report into one task, then started a real Codex
coordinator session in the same project. The question explicitly requested
`read_memory` for that source and asked about the attempted approach, outcome,
cause and next check. The test asserted that a `read_memory` tool call was
recorded.

The observed answer identified a shared checkout retry cache, a failed
isolation experiment with no completed fix, an unverified cause, and a next
check comparing cache keys for two accounts. It kept missing account identity
as a hypothesis. The run log was `/tmp/althar-memory-live.log`; this is a local
run artifact, not a repository fixture.

This verifies a real recipient's source access and interpretation of this
example. The prior report was synthetic, not work performed by a live Claude
session. The prompt supplied the source ID and requested the phrase “cause
unverified”; this is not a blind retrieval benchmark or a general measure of
model reasoning quality. No specific Codex model is claimed. Scripted provider
fixtures separately exercise automatic briefing across tasks/providers and
runtime restart.

## Scope and limitations

Capture and delivery are automatic; the UI is for inspection and lifecycle
control. Retrieval is lexical and consolidation is extractive. Paraphrases
without shared terms may be missed; contradictory reports stay attributed.
Indexed history samples observed revisions, and the initial catch-up budget
can leave pending sources. Known outdated projections are withheld until
refreshed. Raw tool output and file bodies remain outside the retention
policy. The implementation does not claim semantic root-cause inference.
