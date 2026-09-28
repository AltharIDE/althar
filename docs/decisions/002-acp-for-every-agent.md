# ADR-002: ACP for every agent

- **Status:** Accepted
- **Date:** 2026-09-28
- **Owner:** Repository maintainers
- **Context:** The MVP must make Claude Code, Codex, and OpenCode
  interchangeable, and adding another agent must be cheap. The earlier plan
  preferred Codex app-server first, with ACP as a secondary tier.
- **Decision:**
  - Charrette connects to every agent through the Agent Client Protocol,
    behind its own `ProviderRuntimeAdapter` port.
  - Claude Code runs through `claude-agent-acp` and Codex through `codex-acp`,
    both bundled at pinned versions. OpenCode runs through `opencode acp`.
  - Where ACP falls short, an agent gets a native side channel, or if needed a
    full native adapter. The domain does not change either way.
  - Usage limits are recognised from errors on every agent, and from account
    status where the agent has it: the Claude Agent SDK's `rate_limit_event`
    and Codex app-server's rate limits. Charrette ships `claude-agent-acp`
    with a patch that forwards the event, and offers it upstream.
  - Details: [03](../architecture/03-agent-runtime-and-auth.md).
- **Alternatives considered:**
  - Codex app-server first, then one agent at a time: the agents would not be
    interchangeable in the MVP, and each agent would be its own integration.
  - Native adapters for all three: three integrations to build and maintain,
    and later agents would still want ACP.
  - Charrette's own model loop: contradicts the harness boundary in 03, and
    could not run on Claude or ChatGPT plans.
- **Trade-off:** ACP has no usage limits, no mid-turn steering, and no way to
  move history between agents. As of June 2026 OpenCode's ACP could not change
  model per session. Claude Code and Codex depend on adapters maintained
  outside their vendors. Plan-backed Claude use from third-party apps depends
  on Anthropic's policy, which changed three times in 2026.
- **Revisit when:** an adapter lags its agent for long; ACP cannot express
  something the product needs; Anthropic's policy changes; a vendor ships
  native ACP.
