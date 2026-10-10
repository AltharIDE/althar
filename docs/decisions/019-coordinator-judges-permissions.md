# ADR-019 — The coordinator judges permission requests

- **Date:** 2026-10-10
- **Status:** Accepted
- **Owner:** Repository maintainers
- **Context:** Long tasks stop for requests a person would readily approve. The task's lead is blocked awaiting the permission response. The project's coordinator already represents the project across tasks, and is the chosen agent for this judgment (DEV-22).

## Decision

Add an opt-in **The coordinator decides** permission mode (`coordinator`). Existing projects keep their current mode. The runtime's immutable restrictions, reader restrictions, never rules and always-ask rules still decide first. Commands whose meaning cannot be resolved by the rules still ask the person. Routine reads, searches and changes to the task's own files go through immediately, just as they do under “Ask me”. Only the remaining requests go to the coordinator. When DEV-21 lands, its explicit allow rules also precede the judge.

Each judgment uses a fresh session on the same agent and model the project's coordinator would use, with an account selected under the existing project account rules. It does not enqueue a turn in the coordinator's conversation, interrupt it, or reuse the blocked lead's session. The coordinator can therefore decide while its conversation is busy. No cheaper model is chosen implicitly.

Only agents with a verified `permissionJudge` capability in the registry can judge. Claude Code's pinned ACP adapter forwards `tools: []` to the SDK, removing its built-in tools, including Read, Grep and Glob. The session also excludes the agent's own MCP servers, gets no Althar servers, loads no settings sources into the SDK, and disables user hooks. Every permission request is refused as an additional boundary. It starts in read-only mode in a disposable empty directory, but neither of those confines filesystem reads: the enforced boundary is the removed tool set. This is not an OS sandbox around the agent process, which still reads its sign-in and configuration to start. Codex and OpenCode do not yet have a verified tool-free configuration here, so their requests fall back to the person before a judge session starts. Normal coordinator and reviewer sessions keep their existing read-only rules.

At most two judgments run at once in a runtime, across all projects and accounts. The one-minute deadline includes the wait for a slot and process startup. Cancelling a queued request never starts its judge. Each request is judged afresh: the same command digest can refer to changed scripts or other state without a policy change, so it is not a reusable authorization. Explicit remembered allow rules belong to DEV-21.

The prompt contains the exact permission request, the project rules, bounded excerpts of the task's request and description, and the most recent task messages and step results. These are explicitly untrusted evidence. A request too large to send intact goes to the person. The judge returns a validated JSON allow, deny or ask with a nonempty, bounded reason, requested as one short sentence. A code fence or surrounding prose is accepted, but malformed or multiple JSON objects are rejected. A missing account, provider failure, invalid response, uncertain answer or one-minute deadline falls back to the existing human permission flow. Timeout and invalid-response reasons are distinguished. Cancelling the requesting session cancels the judgment and closes the fresh session; it never creates a late approval or attention request.

The current branch and the request’s rule classification are checked again after judgment, so a changed push destination or path cannot reuse an obsolete approval. The rules are read again in the transaction that records the answer. If they changed during the judgment, an applicable automatic rule decides, or the person is asked. An approval under the previous rules is never applied.

The permission request and its action digest are recorded before evaluation. The `permission_request.judged` ledger fact records the coordinator's agent, actual model, account and provider session, policy revision, reason, outcome, whether the answer was applied, elapsed milliseconds, provider token usage and reported monetary cost. A provider that does not report cost leaves `cost: null`, not a misleading zero. The decision is committed under the coordinator actor before the adapter receives it, using the existing narrow permission option selection. The task puts the action first (“Allowed Run npm test”), followed by “By the coordinator: reason”, bounded to 200 characters; the ledger retains the full reason. Home counts only permission decisions and distinguishes coordinator answers from rule answers without inferring the number of coordinators.

ACP's permission response has no portable denial-reason field. The adapter sends coordinator refusals back to the lead as a continuation at the next turn boundary, naming the coordinator, even if the provider's rejection carries on. Parallel refusal messages are gathered, bounded to 8,000 characters and the existing three-continuation limit. A person's cancellation suppresses that continuation. A provider may retry before its current turn ends; this does not grant the refused request.

## Alternatives and trade-offs

- Reusing the coordinator conversation saves startup cost but may block behind a long turn and mixes machine judgments with the person's conversation.
- Asking the task's lead through another session loses the project-level ownership chosen here; asking through its current session deadlocks on its pending request.
- A cheaper dedicated model could reduce cost but adds another model choice and quality trade-off. The recorded cost and latency give evidence for revisiting it.

Fresh sessions add startup latency and usage for each non-routine judged request. The concurrency cap bounds active processes and the deadline bounds waiting. The removed tool set limits the judge to supplied context; missing context should lead to an ask. Remembered allow rules (DEV-21), path and network policy, and automatic replay after a runtime restart remain outside this change. Restart reconciliation cancels unfinished permission requests as before.

**Revisit when:** measured latency or cost makes per-request startup impractical, or judgment evaluations show a need for a different model or additional context.
