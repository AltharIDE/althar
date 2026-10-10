# Project memory validation

Recorded on 10 October 2026 for the follow-up to
[PR #85](https://github.com/AltharIDE/althar/pull/85). This supersedes the earlier
lexical-only validation. GitHub checks must be read against the latest PR head.

## Verification evidence

| Check | Result | What it establishes |
|---|---|---|
| Focused continuity, retrieval and vectors | 35 passed | Durable failure capture, correction candidates, revision-safe retrieval, restart/provider handoff, cancellation and retry. |
| Actual local embedding model | 8/8 relevant threads ranked first; 2/2 unrelated requests abstained | Different wording retrieves evidence that the lexical baseline misses. Pinned MiniLM weights, not a stub encoder. |
| Live Codex recipient | 1 passed, 24.72 seconds | A differently worded request automatically receives prior evidence without a supplied source ID or required answer phrase. |
| Desktop unit coverage | 382 passed; coverage gate passed | Source inspection, possible updates, lifecycle controls and existing renderer behavior. |
| Electron E2E | 14 passed; 2 opt-in checks skipped | Built renderer, RPC and SQLite capture, inspection, retirement and source navigation. |
| Persistence / provider adapters | 41 / 136 passed; coverage gates passed | Migration/schema consistency and actual ACP text diagnostic normalization. |
| Contracts | 12 passed; coverage gate passed | Expanded source context contract compatibility. |
| Packaged native inference smoke | Passed under Electron 44.5.0 | Isolated staged dependency tree loads ONNX and runs the actual cached encoder; packaging also has a native identity-graph smoke. |

The embedding model's public download is approximately 23 MB. A warm local
fixture completed indexing and queries in approximately 0.4 seconds; this is a
small evaluation, not a production performance guarantee. Desktop coverage was
97.19% lines and 90.03% branches. Coverage thresholds were not weakened.

## Failure and retrieval checks

The scripted provider emits an attempted approach and a failed execution result,
then hangs before any final narration. The test waits for the durable checkpoint,
kills that owned process, restarts the runtime and checks that another task and
provider receive the actual assertion diagnostic with its uncertain cause.

Retrieval tests cover a correction separated from the original hypothesis by
unrelated messages, buried execution failures, source passages beyond the first
excerpt, queued/withdrawn input exclusion, retirement and concurrent revision
changes. A failed encoder falls back to lexical context; the next turn retries
and retrieves different-wording evidence. Interrupted inference cannot commit
stale vectors after cancellation. A separate adapter regression verifies immediate
cancellation after prompt startup and reuse of the same session; the original
coordinator budget-retry test passed four consecutive targeted runs.

The actual-model fixture lives in `packages/runtime/tests/model/memory.test.ts`
and runs in the runtime CI matrix. It uses synthetic source records and real
pinned weights. Its eight examples and two negative controls are a regression
set, not a general retrieval-quality benchmark.

## Live check and its limits

`packages/runtime/tests/agents/memory.test.ts` inserts an attempted approach, an
observed account-identity assertion failure and a later correction. It asks a real
Codex coordinator about purchase freezes using different wording. The answer
correctly distinguished the account mismatch from a proven deadlock, attributed
the later fixture-reuse report, kept the root cause unresolved, and proposed
isolating fixture identities before inspecting write ordering.

The prior records are synthetic, not a live agent's coding experiment. The test
establishes automatic recipient delivery and interpretation on this example;
the separate abrupt-exit fixture establishes capture before narration. No
specific Codex model is claimed.

## Scope and limitations

Capture and delivery are automatic. Local semantic retrieval supplements lexical
search; no evidence is uploaded to an embedding service and no paid or
native-tool-capable helper agent runs. First use needs access to public model
files. Download/inference failure or the 15-second retrieval deadline falls back
to lexical context with a notice. In-flight native work can finish after timeout,
but its interrupted Effect cannot write vectors afterward.

Index catch-up is bounded to 128 sources per request, each sampled into at most
16 chunks. Backlog and source truncation are disclosed. Correction detection
reserves explicit revision-language candidates from across the source thread;
it does not establish which claim is true or guarantee recognition of implicit
or multilingual corrections. Source-linked chronological paging remains
available for deeper reading. Observed execution text is bounded and best-effort
redacted; file/resource bodies and ordinary read/edit tools are excluded.

The packaged native dependency path was tested in an isolated staged tree under
Electron; a complete distributable application was not assembled in this run.
