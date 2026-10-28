# ADR-038: A task's lead starts afresh before its context grows large, and at a break in its work

- **Status:** Accepted
- **Date:** 2026-10-15
- **Owner:** Repository maintainers
- **Context:** Only the coordinator was handed to a fresh session, once its
  context was 80% full ([ADR-031](031-coordinator-handed-over-before-it-fills.md)).
  A task's lead ran in one session until it finished. On models with a
  million-token window, 80% is never reached, and every call reads the whole
  context again. On 14 October no session compacted at all: leads averaged
  200,000 to 440,000 tokens a call and ended near 750,000. About 77% of the
  day's usage was reading context again. The worst of it came at breaks: the
  person picked a prototype's direction and said "now build it" to a lead
  400,000 tokens deep, or a lead woke 25 minutes later to fix a failed check,
  with its cache long gone, and wrote all of it to the cache again.
- **Decision:**
  - **A lead is handed to a fresh session between turns,** never in one:
    the same agent, account, model and effort, briefed from the task as an
    agent taking it over is (the task, its worktree, its plan, the change so
    far, and the thread so far, within the brief's budget). The person sees
    a quiet line: "Started Codex afresh, briefed from the task, to keep its
    context small." The whole thread is still there.
  - **When:** before a turn, once the context is past 200,000 tokens or 80% of
    its window, whichever comes first (`LEAD_HANDOVER_TOKENS`); or past
    80,000 at a break in its work (`LEAD_BREAK_TOKENS`). A break is when its
    last turn finished a step or a round of work (`finish_step`, taken), when
    it made its task a change (`make_it_a_change`), or when it has sat idle
    past its prompt cache's life (`CACHE_LIFE`, five minutes). Being idle
    covers waiting on the person and waiting on CI: the next turn would read
    the whole context afresh anyway.
  - **It happens lazily:** only when the lead has a turn to take. A lead
    that finished and is never spoken to again costs nothing.
  - **Not while something it left running still runs.** Closing a session
    stops what it left running
    ([ADR-022](022-what-agents-leave-running.md)), so the person's preview
    server or a test run would stop with it. Such a lead carries on as it is
    until that ends.
  - **Not where it saves little:** a brief more than half the context it
    replaces (`shrinks`), or one that would fill a fresh session as far
    (`roomFor`). Then it is left as it is, as the coordinator is, and its
    agent compacts by itself.
  - **A reviewer is not handed over:** its session spans the review's
    rounds and stays small.
- **Alternatives considered:**
  - **Ask the agent to compact (`/compact`).** Its summary is the agent's,
    made at its own moment; the coordinator's handover was chosen over it
    for the same reason (ADR-031). The person will still be able to ask for
    one themselves.
  - **One mark for every model (80% of the window).** Never reached on a
    million-token window, which is where the cost is.
  - **Hand over at every break, whatever the size.** A small context is
    cheap to keep, and a fresh session loses the lead's train of thought; it
    pays only past a size.
  - **Hand over at once when a break comes.** The next turn may never come;
    lazily, a finished task costs nothing.
- **Trade-off:** a fresh lead knows the task from the record and the thread
  so far, not from what it read and tried along the way, so it may read
  files again. That costs far less than carrying hundreds of thousands of
  tokens through every call. Five minutes is a guess at the cache's life;
  some agents keep it an hour.
- **Revisit when:** agents report how big their cached prefix is, so a
  break can be told by the cache rather than by the clock; or the person
  can compact or hand over from the task themselves, which may change where
  the marks sit.
