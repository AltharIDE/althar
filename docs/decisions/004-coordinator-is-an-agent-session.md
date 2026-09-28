# ADR-004: The coordinator is an agent session with Charrette's tools

- **Status:** Accepted
- **Date:** 2026-09-28
- **Owner:** Repository maintainers
- **Context:** Each project has a coordinator that plans and hands out work
  and never writes code. Its conversation is kept in full, its agent can be
  switched, and continuous compaction may come later.
- **Decision:**
  - The coordinator is an ordinary agent session, over ACP, on any agent.
  - It gets Charrette's tools as an MCP server: read tools for the project and
    its tasks, and commands to draft, plan, start, and order tasks and to
    message leads.
  - It is read-only by construction: the agent's read-only mode where there is
    one, a rule that denies writes, and working copies refreshed from the
    default branch.
  - Charrette keeps the thread. The provider session is disposable and is
    rebuilt from a brief. Summaries, when they arrive, are records that say
    which turns they cover.
  - Details: [04](../architecture/04-coordinator.md).
- **Alternatives considered:**
  - A coordinator on a Charrette-owned model loop: contradicts the harness
    boundary, and could not run on plans.
  - Read-only by prompt: not enforceable.
  - Letting the coordinator make small changes itself: rejected; a change is
    always a task with a lead.
- **Trade-off:** an always-on session costs usage on the user's plan. The
  coordinator sees code only through read-only worktrees and tools. It relies
  on agents' read-only modes, with the deny rule as the backstop.
- **Revisit when:** each developer gets a coordinator; continuous compaction
  is designed; an agent's read-only mode proves leaky.
