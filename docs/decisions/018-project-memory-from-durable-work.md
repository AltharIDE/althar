# ADR-018: Project memory comes from durable work, across tasks and agents

- **Status:** Accepted
- **Date:** 2026-10-10
- **Owner:** Repository maintainers
- **Context:** A second agent, even on a different task, needs to know what
  the project already tried, what failed, and what remains uncertain. A
  successful closing summary cannot be the only checkpoint: the first agent
  may stop abruptly. Repository instructions and remembered work have
  different authority.
- **Decision:**
  - The project is the memory boundary. Althar's persistent store holds
    learned context; repository files hold deliberate instructions. Memory
    grants no permissions and does not override instructions.
  - Durable thread items are the evidence. Derive memory automatically from
    checkpointed messages, plans, tool status and step results, without an
    approval gate or a successful `finish_step`. Keep source item, thread,
    task, session/provider and time. Capture workspace bases atomically when
    the source item is inserted; legacy evidence has unknown bases rather
    than borrowing the current checkout.
  - Consolidation is initially extractive: preserve attributed reports and
    structure recorded attempts and outcomes. A tool's failed status proves
    that it reported failure, not why. Agent explanations remain reports,
    including their uncertainty, questions and suggested next steps. This
    does not claim semantic understanding or automatic root-cause analysis.
  - Retain the existing exclusion of raw tool output and file bodies. A
    source lookup returns retained evidence, not a promise to recover an
    omitted diagnostic log. Agents must re-check code and diagnostics when
    the recorded evidence is insufficient.
  - Process source revisions incrementally and idempotently. Changed
    sources revise their projection; keep indexed revision history and
    retirement inspectable. History samples revisions seen during indexing,
    not every streaming checkpoint. Retirement/restoration uses optimistic revision checks.
    Conflicting reports remain attributable instead of becoming one
    silently chosen fact; historical bases expose possible staleness.
  - Retrieve with SQLite full-text search across project evidence, combining
    lexical matches with recent context. Derive projections lazily at
    retrieval, processing at most 2,048 pending sources per query, newest
    changes first. Report the remaining count in the brief and UI; repeated
    queries continue catch-up. Initial results may omit older unindexed work.
    Projections with pending source corrections are excluded until refreshed.
    Reading or retiring one source refreshes only that source. Bound excerpts
    and total prompt context; keep older indexed matches discoverable.
    Bundle neighboring thread sequence items to preserve surrounding work,
    without claiming their proximity establishes causality. Give every role relevant
    context on each delivered turn, including existing sessions and provider
    switches. Reserve a small allowance for older same-thread matches that
    may have fallen out of the bounded transcript; omit pending current inputs. Provide
    project-scoped search and source-reading tools for details.
  - A processing failure keeps the original work, is logged, and produces an
    unavailable notice rather than aborting ordinary task execution. The
    next retrieval retries. The project UI exposes search, provenance,
    source navigation and retirement without becoming the capture mechanism.
- **Alternatives considered:**
  - Manual notes or completion-only summaries: omit interrupted work and
    require the person to reconstruct context.
  - A generated summary of the whole project, repeatedly rewritten: loses
    source detail and makes revisions and contradictions hard to inspect.
  - A mandatory model call for extraction: adds account, latency and failure
    dependencies. It may improve semantic consolidation later, evaluated
    against the retained evidence rather than replacing it.
  - Embeddings or a knowledge graph first: additional infrastructure before
    retrieval examples establish the need. Lexical retrieval has predictable
    local behavior but can miss paraphrases without shared terms.
  - Git-backed learned notes: portable and diffable, but Althar already owns
    durable project records and brief delivery. The coordinator's disposable
    checkout cannot own memory.
- **Trade-off:** Extractive records preserve what was reported, including
  noise and mistaken explanations. They do not resolve semantic conflicts,
  infer lessons, or recover diagnostics the recorder never retained. Search
  and source access make these limits inspectable; they do not eliminate
  them. Context on a delivered turn does not alter a turn already running.
- **Evaluation:** The acceptance plan covers interrupted work reaching a
  different task/provider after restart, distractors and old matching
  failures, project isolation, changed and retired sources, contradictory
  reports, concurrent/idempotent processing, retry after failure and bounded
  delivery. Fake providers establish harness behavior, not model reasoning
  quality. See [the implementation plan](../plans/project-memory.md); this
  decision is not a claim that those checks have passed.
- **Revisit when:** real retrieval examples miss relevant paraphrases,
  extractive records overwhelm useful context, or evaluated model-assisted
  consolidation improves continuity without erasing evidence or authority
  boundaries.

## Research behind the decision

Primary sources reviewed on 10 October 2026:

- [Cognition's Agent Memory Repo](https://cognition.com/agent-memory-repo)
  and its [open specification](https://github.com/AgentMemoryRepo/agentmemoryrepo)
  describe a short index, searchable linked entries with session sources,
  automatic updates, and periodic consolidation of duplicates, outdated
  entries and contradictions. The published local trial explicitly excludes
  automatic startup and scheduled Dreaming. Adopt source links and bounded
  entrypoints; Althar must supply the capture and delivery loop itself.
- [Claude Code memory](https://code.claude.com/docs/en/memory) separates
  authored instructions from learned memory, shares memory across repository
  worktrees, and loads a bounded index with details on demand. Adopt those
  boundaries, with Althar owning context across providers.
- [Anthropic's context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
  motivates high-signal context and progressive disclosure through references
  and tools. Adopt bounded retrieval rather than transcript dumping.
- [LangChain's memory loop](https://www.langchain.com/blog/how-to-give-your-agent-memory)
  distinguishes traces from derived memory and stresses refreshing what the
  runtime reads. Adopt durable evidence first and test delivered context,
  including later turns of an existing session.
- [Sleep-time Compute](https://arxiv.org/abs/2504.13171) and
  [Letta's implementation discussion](https://www.letta.com/blog/sleep-time-compute/)
  explore background refinement. Adopt separation from foreground completion;
  defer a continuously running model-based consolidator.
- [LongMemEval](https://arxiv.org/abs/2410.10813) evaluates extraction,
  multi-session and temporal reasoning, knowledge updates and abstention,
  distinguishing indexing, retrieval and reading. Use those dimensions for
  fixtures, without treating conversational benchmark results as proof of
  coding-task performance.
- [Agentic Context Engineering (ACE)](https://arxiv.org/abs/2510.04618)
  describes detail loss from repeated summary rewriting and structured
  incremental updates. Adopt independently revisable records rather than
  replacing one growing project summary.
