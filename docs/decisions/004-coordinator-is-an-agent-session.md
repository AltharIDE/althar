# ADR-004: The coordinator is an agent session with Charrette's tools

- **Status:** Accepted
- **Date:** 2026-09-28
- **Amended:** 2026-09-30, on what read-only rests on. Agents' plan modes
  refuse MCP tools (Claude Code's plan mode, OpenCode's plan agent), so a
  coordinator in them can't plan anything.
- **Owner:** Repository maintainers
- **Context:** Each project has a coordinator that plans and hands out work
  and never writes code. Its conversation is kept in full, its agent can be
  switched, and continuous compaction may come later.
- **Decision:**
  - The coordinator is an ordinary agent session, over ACP, on any agent.
  - It gets Charrette's tools as an MCP server: read tools for the project and
    its tasks, and commands to draft, plan, start, and order tasks and to
    message leads.
  - It is read-only by construction, as every role that only reads is (a
    reviewer too):
    - It reads throwaway copies: the coordinator, worktrees refreshed from
      the default branch each turn; a reviewer, a snapshot of the lead's
      work taken when its round begins.
    - The agent's own sandbox is read-only where it has one that still lets
      it call Charrette's tools: Codex's read-only sandbox, and Claude Code
      with its edits denied and every command asking.
    - Charrette's reader rules are the backstop: they allow only commands,
      and flags, that look, refuse the rest, and never ask you.
    - OpenCode has no sandbox yet, so for it the copy is the boundary.
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
  on throwaway copies and agents' sandboxes, with the reader rules as the
  backstop: a command the rules miss costs a copy, not the lead's work.
- **Revisit when:** each developer gets a coordinator; continuous compaction
  is designed; an agent's sandbox proves leaky; agents' plan modes allow MCP
  tools, which would make them the simpler read-only mode (re-probe with
  `scripts/probe-tools.ts` in the runtime).
