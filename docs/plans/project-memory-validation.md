# Project memory validation

Recorded on 10 October 2026. This is an evidence log, not a declaration that
all repository checks or GitHub checks have passed. Final broad verification
is still in progress.

## Checks observed

| Check | Result | What it establishes |
|---|---|---|
| Runtime integration suites | 27 tests passed | Includes scripted cross-task, cross-provider delivery after restart and interruption, source tools, later corrections and failure/retry behavior. |
| Core memory and coordinator suites | 41 tests passed; 2 final focused regressions passed | Extraction, retrieval, source lifecycle, isolation, bounded output and provenance behavior covered by the focused suite. |
| SQLite persistence suite | 41 tests passed | Storage and migration checks passed in the implementation run. |
| Live Codex recipient check | 1 test passed, 45.61 seconds | A real ACP Codex session read retained synthetic prior evidence and distinguished an observed failure from a suspected cause. |

The first three counts record completed focused runs reported during the
implementation. Subsequent changes require their affected checks to be rerun;
these counts do not stand in for final whole-repository verification.

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

## Remaining final verification

- Whole-repository tests, coverage, type checks, formatting and builds:
  pending final results and resolution of failures.
- Rendered desktop memory flow: passed against the built Electron app, real RPC and SQLite with scripted providers; source inspection, retirement/restoration and navigation verified.
- Post-push GitHub checks: pending PR creation and completion.
- Same-thread historical retrieval, queued-input exclusion and bounded initial-backlog behavior: focused regressions passed, including withholding known stale projections until corrections are indexed.
