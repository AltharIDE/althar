# ADR-007: Every permission request reaches Althar

- **Status:** Accepted
- **Date:** 2026-09-28
- **Owner:** Repository maintainers
- **Context:** Althar's defaults are permissive, but the always-ask list
  (production, pushes to main, spending) must hold. Each agent has its own
  permission system.
- **Decision:**
  - No session starts in a bypass mode. Sessions start in a mode where the
    agent asks, and requests arrive as ACP `session/request_permission`.
  - Each session is also given settings that keep the agent asking whatever
    its own or the repository's settings allow, through the agent's launch
    options, never by writing its settings files.
  - Althar answers with the narrowest option that carries out its
    decision, never an "always" option, so the agent keeps no rule of its
    own.
  - Althar answers from the project rules. Allowed requests are recorded
    and shown as one quiet line. Only what the rules keep for the user becomes
    an attention request.
  - Read-only roles start in the agent's read-only mode where it has one, and
    the rules deny them writes.
  - In the MVP the rules and a fixed always-ask list answer. The lead
    answering comes later.
  - Details: [03](../architecture/03-agent-runtime-and-auth.md).
- **Alternatives considered:**
  - Bypass modes, relying on each agent's sandbox: Althar would see
    nothing, and the always-ask list couldn't be enforced.
  - Althar writing each agent's settings files: changes the user's
    configuration, and drifts.
- **Trade-off:** every request is a round trip through Althar. What the
  per-session settings don't reach, such as Claude Code hooks, can still
  approve actions Althar never sees.
- **Revisit when:** the lead or a judge model answers; Althar enforces
  write and network reach; organisation-level rules arrive.
