# Project memory continuity follow-up

## Acceptance spec

A failed execution must checkpoint a bounded, filtered diagnostic before an agent
can stop. The next agent must receive that observation separately from any
reported interpretation, without a final handover, on another task/provider and
after restart. Read/edit/file bodies remain excluded; retention is explicit about
redaction and truncation and does not claim perfect secret detection.

Retrieval combines lexical evidence with local MiniLM sentence embeddings. Pinned
public model weights run locally without a provider account, tool-capable helper,
or additional paid turns. Public weight downloads are cached beside the database;
no project text is uploaded. Exact source revision/model keys invalidate persistent
vectors; indexing budgets and degraded retrieval are visible. Validate real model
relevance independently of deterministic transport fixtures and package native
ONNX resources with the desktop.

Task bundles retain the latest substantive account along with the matched old
attempt, deduplicate repeated evidence and explicitly mark omitted context. A
correction separated by routine tool events must not disappear merely because it
uses different words. Query construction reserves task context and samples long
requests instead of dropping all words after the first 32.

## Implementation and verification sequence

1. Independently implement recorder diagnostics and coherent task retrieval;
   implement local semantic retrieval and integrate with turn delivery/tools.
2. Regression tests: diagnostic checkpoint before abrupt failure, redaction/file
   exclusion, lexical paraphrase miss recovered by selection, correction after
   intervening events, duplicate claims, long request, retirement, isolation,
   restart, concurrent revisions, semantic timeout/invalid vector fallback.
3. Real provider check: no source ID or required answer phrase; retrieve differently
   worded work and distinguish diagnostic observation from unproven cause. Record
   what is synthetic versus actual model behavior.
4. Run affected checks and complete runtime/provider/persistence/desktop tests;
   independent review; update architecture/validation and existing PR; verify CI
   at the pushed head before judging readiness. Do not merge.
