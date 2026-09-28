# ADR-007: Every permission request reaches Charrette

- **Status:** Accepted
- **Date:** 2026-09-28
- **Owner:** Repository maintainers
- **Context:** Charrette's defaults are permissive, but the always-ask list
  (production, pushes to main, spending) must hold. Each agent has its own
  permission system.
- **Decision:**
  - No session starts in a bypass mode. Sessions start in a mode where the
    agent asks, and requests arrive as ACP `session/request_permission`.
  - Charrette answers from the project rules. Allowed requests are recorded
    and shown as one quiet line. Only what the rules keep for the user becomes
    an attention request.
  - Read-only roles start in the agent's read-only mode where it has one, and
    the rules deny them writes.
  - In the MVP the rules and a fixed always-ask list answer. The lead
    answering comes later.
  - Details: [03](../architecture/03-agent-runtime-and-auth.md).
- **Alternatives considered:**
  - Bypass modes, relying on each agent's sandbox: Charrette would see
    nothing, and the always-ask list couldn't be enforced.
  - Charrette writing each agent's settings files: changes the user's
    configuration, and drifts.
- **Trade-off:** every request is a round trip through Charrette. An agent's
  own user-level allow rules can still approve actions Charrette never sees.
- **Revisit when:** the lead or a judge model answers; Charrette enforces
  write and network reach; organisation-level rules arrive.
