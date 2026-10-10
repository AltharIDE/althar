# Project memory implementation

## Contract

A project's durable work supplies context across tasks and providers, including interrupted sessions. Capture is automatic and needs neither a successful `finish_step` nor approval of each observation. Repository instructions remain the deliberate source of instructions; memory is attributed evidence, never permission or policy.

## Design

1. Keep thread items as the durable primary evidence. Derive project memory incrementally from their revisions. Each memory record links its source item, thread, task, session/provider and time. Workspace bases are captured atomically at source insertion; legacy sources have unknown bases. Checkpointed messages, plans, tool status and step results supply automatic capture. Bounded filtered execution diagnostics checkpoint with status; file/read/edit bodies remain excluded. A failed status alone proves no cause; diagnostic excerpts retain observed assertions and redaction/truncation markers.
2. Use conservative extractive consolidation initially: preserve attributed agent reports and plans, and structure tool attempts/status. Do not invent facts or classify uncertain prose as proven causes. Reprocessing a source revision is idempotent; changed sources replace the projection while indexed revision history and explicit retirement remain inspectable. History samples revisions seen during indexing, not every streaming checkpoint. Avoid an additional model/account dependency for correctness.
3. Derive eligible project evidence lazily at retrieval into SQLite full-text search, combining lexical relevance with persistent local MiniLM source-chunk embeddings. Model inference stays local and adds no provider turn. Vector catch-up is bounded to 128 sources per call, exact source revisions are checked on commit/read, and a 15-second timeout falls back visibly to lexical retrieval. Each query processes at most 2,048 pending sources, newest changes first. Briefs and the UI expose a pending count: initial results can omit older unindexed evidence, and repeated queries continue catch-up. Direct source reads and state changes refresh only their target. Return bounded excerpts with provenance and source IDs, plus explicit project-scoped search/read tools for deeper evidence. Keep older indexed matching failures rather than searching only a recent window. Bundle matched sources, recent reports, failed diagnostics and source-linked explicit revision candidates, with a paged chronological timeline for omitted context; contradictory reports remain visible as reports rather than silently selecting truth.
4. Add memory to each delivered turn (all roles) using current task and input, reserving a small allowance for older same-thread evidence that may have fallen out of the transcript and excluding pending current inputs. This includes starts, provider switches and existing sessions' next turns. Bound injected context separately and label historical base revisions and uncertainty. Processing failures are logged and produce an explicit unavailable notice, without aborting normal execution or losing source evidence; next retrieval retries.
5. Expose searchable project memory through the existing desktop project UI. Show provenance, status and source navigation. Permit retirement/restoration with optimistic revision checks, retaining original evidence. No manual approval gate or notes-only workflow.

## Verification

Test actual durable recorder -> derived store -> retrieval -> delivered prompt across tasks/providers, including unpolished interrupted sessions, restart, project isolation, source updates, retirement/restoration, stale workspace provenance, conflicting reports, duplicate/concurrent processing, failure/retry, long evidence/budgets and old matching evidence. Verify extraction against realistic failed-attempt narratives with speculation and unresolved next steps. Exercise tool authorization and schema validation. Test UI states and rendered integration, then required package checks, coverage, builds, and GitHub CI. Fake providers prove harness delivery, not a model's reasoning quality. Document live-provider checks only if actually performed.

## Research

Research notes and accepted tradeoffs are recorded in the ADR before final review. The implementation deliberately avoids embeddings, graph storage and ungrounded generated summaries until retrieval examples show a need.

## Validation record

Observed checks and remaining verification are recorded in [project-memory-validation.md](project-memory-validation.md).
