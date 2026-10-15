# ADR-039: The person can have an agent compact its context, at once, with the agent's own command

- **Status:** Accepted
- **Date:** 2026-10-15
- **Owner:** Repository maintainers
- **Context:** A long conversation makes every turn read everything it
  holds again. Althar starts a lead afresh on its own at large sizes and at
  breaks ([ADR-038](038-a-lead-starts-afresh-at-a-break.md)), and the
  coordinator near its window's end
  ([ADR-031](031-coordinator-handed-over-before-it-fills.md)), but the
  person sometimes knows sooner: a tangent is over, or the next work starts
  somewhere else. They had no way to say so. And on a busy machine, anything
  that asks for a place can wait a long time, while a compaction that waits
  stops being cheap: its agent's cache goes cold meanwhile.
- **Decision:**
  - **Compact sits beside the context ring in the composer,** for a task's
    agent and the coordinator alike, once the context holds 80,000 tokens
    or more (where a fresh start pays, as in ADR-038). It is a quiet text
    action, not a button that draws the eye. Asked for, it says
    "Compacting…" and stays off until the agent says how full its context
    is again, or for two minutes at most.
  - **It sends the agent its own command, `/compact`,** which Claude Code,
    Codex and OpenCode all take over ACP, bare, as a turn of its own after
    what the agent was told before (`CompactContext`, `Sessions.compact`).
    It isn't the person's message in the thread. When it is done, the thread
    says how far it took the context: "Compacted Codex's context: 412k → 38k
    tokens."
  - **It never waits for a place among the agents at work:** it is one call
    of the agent's, which loads nothing on this machine. A lead's handover
    that would be due waits for it, since it may leave nothing to hand over.
- **Alternatives considered:**
  - **Hand over to a fresh session instead,** as ADR-038 does on its own.
    The person keeps the agent they were talking to, with its own summary of
    what it was doing, rather than a brief from the record; Althar's own
    handovers carry on as they are.
  - **Compact from the ring's card.** The card is for reading and holds no
    actions; a second click target inside it would be hard to find.
  - **Always show Compact.** Compacting a small context gains nothing, and a
    control that is always there is one more thing to read.
- **Trade-off:** the summary is the agent's own, made by its own rules, and
  what it keeps differs by agent. OpenCode runs a project's own command
  named `compact` before its built-in one. Two minutes is a guess at how
  long an agent takes to say how full it is after compacting.
- **Revisit when:** agents report compaction as its own event, so the thread
  can show it as a divider rather than a line; or people want Compact to
  hand over instead.
