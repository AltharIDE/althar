# ADR-018 — The coordinator judges permission requests

- **Date:** 2026-10-10
- **Status:** Accepted
- **Owner:** Repository maintainers
- **Context:** Long tasks stop for requests a person would readily approve. The task's lead is blocked awaiting the permission response. The project's coordinator already represents the project across tasks, and is the chosen agent for this judgment (DEV-22).

## Decision

Add an opt-in **The coordinator decides** permission mode (`coordinator`). Existing projects keep their current mode. The runtime's immutable restrictions, reader restrictions, never rules and always-ask rules still decide first. Commands whose meaning cannot be resolved by the rules still ask the person. Other requests go to the coordinator.

Each judgment uses a fresh session on the same agent and model the project's coordinator would use, with an account selected under the existing project account rules. It does not enqueue a turn in the coordinator's conversation, interrupt it, or reuse the blocked lead's session. The coordinator can therefore decide while its conversation is busy. No cheaper model is chosen implicitly.

The session starts in the agent's read-only mode, in a disposable empty directory, without Althar tools. Every permission request from this session is refused, so there is no recursive judgment or opportunity to approve its own writes. Normal coordinator and reviewer sessions retain their existing read-only rules.

The prompt contains the exact permission request, the project rules, bounded excerpts of the task's request and description, and the most recent task messages and step results. These are explicitly untrusted evidence. A request too large to send intact goes to the person. The judge returns a validated JSON allow, deny or ask with a nonempty, bounded reason. A missing account, provider failure, invalid response, uncertain answer or one-minute deadline falls back to the existing human permission flow. Cancelling the requesting session cancels the judgment and closes the fresh session; it never creates a late approval or attention request.

The current branch and the request’s rule classification are checked again after judgment, so a changed push destination or path cannot reuse an obsolete approval. The rules are read again in the transaction that records the answer. If they changed during the judgment, an applicable automatic rule decides, or the person is asked. An approval under the previous rules is never applied.

The permission request and its action digest are recorded before evaluation. The `permission_request.judged` ledger fact records the coordinator's agent, actual model, account and provider session, policy revision, reason, outcome, whether the answer was applied, elapsed milliseconds, provider token usage and reported monetary cost. A provider that does not report cost leaves `cost: null`, not a misleading zero. The decision is committed under the coordinator actor before the adapter receives it, using the existing narrow permission option selection. The task shows “Allowed by the coordinator: reason” or “Denied by the coordinator: reason”; the home counts coordinator answers separately from rule answers.

## Alternatives and trade-offs

- Reusing the coordinator conversation saves startup cost but may block behind a long turn and mixes machine judgments with the person's conversation.
- Asking the task's lead through another session loses the project-level ownership chosen here; asking through its current session deadlocks on its pending request.
- A cheaper dedicated model could reduce cost but adds another model choice and quality trade-off. The recorded cost and latency give evidence for revisiting it.

Fresh sessions add startup latency and usage for each judged request. The deadline bounds waiting; the empty directory and supplied context limit what the judge can investigate. Missing context should lead to an ask. Remembered allow rules (DEV-21), path and network policy, and automatic replay after a runtime restart remain outside this change. Restart reconciliation cancels unfinished permission requests as before.

**Revisit when:** measured latency or cost makes per-request startup impractical, or judgment evaluations show a need for a different model or additional context.
