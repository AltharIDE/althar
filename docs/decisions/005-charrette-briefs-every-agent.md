# ADR-005: Charrette briefs every agent, and a switch hands over everything

- **Status:** Accepted
- **Date:** 2026-09-28
- **Owner:** Repository maintainers
- **Context:** A session can't move between agents, yet switching agent
  mid-task is intended. Repositories carry different instruction files for
  different agents. Steps and the coordinator need starting context too.
- **Decision:**
  - Every session starts from a brief Charrette assembles and records: the
    lead, every step, the coordinator's rebuilt session, retries, and
    switches.
  - Charrette does not edit a repository's own instruction files.
  - Changing model within an agent keeps the session, through ACP's model
    config option.
  - Changing agent starts a new session on the new agent, in the same
    workspace, as a new attempt of the same node.
  - In the MVP the new agent takes over everything: the whole record goes into
    the first prompt as far as it fits, and the rest is readable through
    Charrette's tools. No model call is needed to switch.
  - Details: [03](../architecture/03-agent-runtime-and-auth.md).
- **Alternatives considered:**
  - Converting session files between agents' formats: private formats that
    change per release, and signed reasoning is lost anyway.
  - A generated handoff, as in Amp: needs a model call, and is lossy by
    design. It is a candidate for tuning.
  - A fresh start from the code alone, as in Conductor: loses the
    conversation.
  - Editing `CLAUDE.md` or `AGENTS.md`: changes the user's repository.
- **Trade-off:** a long record costs tokens. The new agent continues work it
  didn't do; research suggests that can hurt when moving to a stronger model.
- **Revisit when:** tuning switches (a fresh take, starting from base, a
  generated handoff); when memory arrives, since knowledge enters sessions
  through the brief.
