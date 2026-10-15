# Plan usage plan

> **Temporary.** Research and the plan for showing plan usage (use per window
> and reset times) from every agent, not architecture: that is
> [03, Usage limits](../architecture/03-agent-runtime-and-auth.md#usage-limits).
> Delete this file when the last step ships, and move anything that lasted
> into the architecture docs.

Researched on 15 October 2026 against upstream `main` (`af3023a`). Sources
are linked and dated; "acc." is the day a page without a date was read.
Where it matters, a claim is checked against the current default branch of
the project named, and the commit is given.

## The questions

1. Can plan usage come over ACP?
2. Which harnesses support it?
3. What is ACP v2, and who supports it?
4. If only some do, should Althar read the providers' API endpoints until
   every harness does?

Where the numbers then go (a notification, the coordinators, the settings
tray) is a product question this plan only prepares for: see
[Where the person sees it](#where-the-person-sees-it).

## Answers in short

1. **Not in the protocol yet.** ACP's stable `usage_update` carries context
   `used`/`size` and `cost`, and its RFD says "Rate limits and quotas are
   separate concerns that could be addressed in a future RFD". That RFD is
   open as a pull request, not accepted. Adapters can already send plan
   windows as extensions (`_meta` or a `_`-prefixed method).
2. **Claude Code, partly; Codex holds the data but does not send it;
   OpenCode and Gemini CLI have none to send.** Claude's adapter puts the
   SDK's rate-limit info in `_meta` on `usage_update`, with a bug that drops
   it. Codex's adapter has the numbers and prints them as `/status` text.
3. **v2 is a Draft** (announced 20 July 2026). It changes the turn lifecycle,
   not usage: `usage_update` is "Unchanged". Claude's adapter serves it behind
   an env var; Codex's adapter on `main` serves it, its latest release does
   not; OpenCode and Gemini CLI are v1. **v2 is not what brings plan usage.**
4. **No raw endpoints for now.** Both agents Althar ships with have a
   documented native channel that returns the same numbers. The raw HTTP
   endpoints are undocumented, have changed shape, and Anthropic's terms
   forbid using Claude OAuth tokens outside its own apps. Use native channels
   per agent behind one Althar interface, and move each agent to ACP when its
   adapter ships the accepted extension.

## Matrix

| | Claude Code | Codex | OpenCode | Gemini CLI (not shipped) |
|---|---|---|---|---|
| Adapter | `claude-agent-acp` 0.90.0 (Althar pins 0.88.0) | `agentclientprotocol/codex-acp` 2.2.2 (Althar pins 2.1.1) | OpenCode's own ACP, `packages/cli/src/acp/` | `gemini --acp` |
| Plan windows over ACP today | Partly: `_meta["_claude/rateLimit"]` on `usage_update`, one window per event; dropped if it arrives before the turn's first usage figure ([#1127](https://github.com/agentclientprotocol/claude-agent-acp/issues/1127), open 14 Sep; fix [#1191](https://github.com/agentclientprotocol/claude-agent-acp/pull/1191) closed unmerged 4 Oct). Full windows only as `/usage` markdown | No. The adapter merges `account/rateLimits/updated` into state and sends nothing; `/status` renders text ([`CodexEventHandler.ts`](https://github.com/agentclientprotocol/codex-acp/blob/aa02d43/src/CodexEventHandler.ts#L613-L614), [`CodexCommands.ts`](https://github.com/agentclientprotocol/codex-acp/blob/aa02d43/src/CodexCommands.ts#L572-L615), `aa02d43`, 15 Oct). Open: [#227](https://github.com/agentclientprotocol/codex-acp/issues/227), PRs [#334](https://github.com/agentclientprotocol/codex-acp/pull/334), [#426](https://github.com/agentclientprotocol/codex-acp/pull/426), [#524](https://github.com/agentclientprotocol/codex-acp/pull/524) | No. Request [#49693](https://github.com/anomalyco/opencode/issues/49693) (18 Sep) open, unanswered | No: a 429 becomes ACP error 429 |
| Context/cost `usage_update` | `used`, `size`, `cost` | `used`, `size`; no cost | `used`, `size`, `cost` | `used`, `size`; no cost |
| ACP version | v1; v2 with `CLAUDE_AGENT_ACP_EXPERIMENTAL_V2=1` (0.90.0, 13 Oct) | v1 and v2 from the client's `initialize` on `main` ([#620](https://github.com/agentclientprotocol/codex-acp/pull/620), 13 Oct); 2.2.2 (10 Oct) has none | v1 | v1 |
| Native channel | Agent SDK `rate_limit_event` / `SDKRateLimitInfo` ({`status`, `rateLimitType` five_hour, seven_day, …, `utilization`, `resetsAt`}), and `usage_EXPERIMENTAL_…()` with `rate_limits.limits[]` (all windows; `null` on API keys); statusline `rate_limits` ([docs](https://code.claude.com/docs/en/statusline), acc.) | App-server `account/rateLimits/read` and `account/rateLimits/updated`: `primary`/`secondary` {`usedPercent`, `windowDurationMins`, `resetsAt`}, `planType`, `credits` ([docs](https://learn.chatgpt.com/docs/app-server), acc.) | None for the upstream plans; only provider errors | Code Assist `retrieveUserQuota`, used by `/stats`, not in ACP |
| API endpoint option | `GET api.anthropic.com/api/oauth/usage` (undocumented, scope `user:profile`, heavy 429s); `anthropic-ratelimit-unified-*` headers (undocumented); API keys: per-minute headers only | `GET chatgpt.com/backend-api/wham/usage` (undocumented); `x-codex-*` headers; API keys: per-minute `x-ratelimit-*` | Depends on the provider behind it | `retrieveUserQuota`; individual OAuth ended June 2026 |

Sources behind the rows:

- Claude adapter: [`acp-agent.ts` at `0c8de13`](https://github.com/agentclientprotocol/claude-agent-acp/blob/0c8de13/src/acp-agent.ts#L7923-L7935) (14 Oct); issue [#625](https://github.com/agentclientprotocol/claude-agent-acp/issues/625), where a maintainer said on 2 Jul they would wait on the gated `usage_EXPERIMENTAL` API; an `_claude/usage` extension method (#915) was withdrawn on 25 Jul. SDK types: [`sdk.d.ts` 0.3.296](https://unpkg.com/@anthropic-ai/claude-agent-sdk@0.3.296/sdk.d.ts).
- Codex native: `account/rateLimits/*` in `codex-rs/app-server-protocol/src/protocol/common.rs` of openai/codex at `e89b7c4` (15 Oct).
- OpenCode: [`turn.ts` at `4397ee4`](https://github.com/anomalyco/opencode/blob/4397ee4/packages/cli/src/acp/turn.ts#L328-L345), [`service.ts`](https://github.com/anomalyco/opencode/blob/dev/packages/cli/src/acp/service.ts) (`protocolVersion: 1`).
- Gemini CLI: [`acpSession.ts` at `06d3298`](https://github.com/google-gemini/gemini-cli/blob/06d3298/packages/cli/src/acp/acpSession.ts#L526-L531) (14 Oct).
- Endpoints: [CodexBar docs for Claude](https://raw.githubusercontent.com/steipete/CodexBar/main/docs/claude.md) and [Codex](https://raw.githubusercontent.com/steipete/CodexBar/main/docs/codex.md) (acc.); [Claude Code legal and compliance](https://code.claude.com/docs/en/legal-and-compliance) (acc.); the 429 behaviour of the Claude endpoint, [claude-code #31637](https://claudeissues.com/issue/31637-bug-api-oauth-usage-endpoint-aggressively-rate-limits-making-usage-monitoring-un) (mirror; closed "not planned" 1 Jun); header names are from user reports ([claude-code #12829](https://github.com/anthropics/claude-code/issues/12829), [#55333](https://github.com/anthropics/claude-code/issues/55333)), and none are documented; the Codex headers, [multi-ai-router #184](https://github.com/developerz-ai/multi-ai-router/issues/184) (10 Oct); API-key limits, [Anthropic](https://platform.claude.com/docs/en/api/rate-limits) and [OpenAI](https://developers.openai.com/api/docs/guides/rate-limits) (acc.).

## ACP, in detail

### Revisions

- **v1 is the only stable protocol version.**
- **v2 is a Draft**, announced 20 July 2026: "various pieces can, and will,
  change before stabilization… gate your implementation behind the version
  negotiation AND feature flags"
  ([announcement](https://agentclientprotocol.com/announcements/acp-v2-draft.md)).
  Nothing since stabilizes it (latest posts 17 Sep and 12 Oct). Its tracking
  RFD ([v2 proposal](https://agentclientprotocol.com/rfds/v2/overview.md)) is
  Active since 2 July: a turn ends with `state_update` instead of the
  `session/prompt` response, session updates become upserts, client fs and
  terminal and session modes go, capabilities merge into one `capabilities`
  object.
- **Negotiation**: the client sends the highest `protocolVersion` it
  supports; the agent echoes it or answers with its own latest. A client that
  sends 2 to a v1 agent is answered 1
  ([migration guide](https://agentclientprotocol.com/protocol/v2/migration.md),
  undated). The migration guide lists `usage_update` as "Unchanged".
- **Releases**: schema `v1.25.0` is stable; `v2.0.0-alpha.8` (9 Oct) is a
  prerelease
  ([releases](https://github.com/agentclientprotocol/agent-client-protocol/releases)).
  The npm SDK ships v2 as `@agentclientprotocol/sdk/experimental/v2`
  (`PROTOCOL_VERSION = 2`, from 1.3.0 on 21 Jul; root export still 1)
  ([registry](https://registry.npmjs.org/@agentclientprotocol/sdk)). Althar
  pins SDK 1.5.1 and speaks v1.

### Usage in the protocol

- `usage_update` is **stable in v1** since 5 June
  ([announcement](https://agentclientprotocol.com/announcements/session-usage-stabilized.md),
  [RFD](https://agentclientprotocol.com/rfds/session-usage)): `used`, `size`,
  optional `cost` `{amount, currency}`. Althar normalizes it to
  `ContextUsage` (`packages/provider-adapters/src/events.ts`).
- `PromptResponse.usage` (per-turn tokens) is a separate **Draft**
  ([End-Turn Token Usage](https://agentclientprotocol.com/rfds/end-turn-token-usage.md));
  implementations disagree on whether it is per turn or cumulative
  ([#1860](https://github.com/agentclientprotocol/agent-client-protocol/issues/1860),
  open). `events.ts` already reads it as `TokenUsage`; it is context and token
  accounting, not plan windows.
- **Plan windows**, three open items:
  - [PR #2316 "quotas & limits"](https://github.com/agentclientprotocol/agent-client-protocol/pull/2316)
    (opened 6 Oct, updated 8 Oct, no comments, not in the RFD index): a
    `quota_update` session update carrying a full snapshot, a `quota/read`
    request, a structured `quotaExceeded` error, advertised by an agent
    capability `quota: {}` (and `session.quota: {}` from the client in v1).
    A snapshot holds pools of meters with `usedPercent`, `used`, `limit`,
    `remaining`, `window`, `resetsAt`. It surveys 11 agents.
  - [Discussion #2235](https://github.com/agentclientprotocol/agent-client-protocol/discussions/2235)
    (26 Sep): a `limits[]` field on `usage_update`.
  - [Issue #890](https://github.com/agentclientprotocol/agent-client-protocol/issues/890)
    shows the risk of waiting: Gemini and Codex put token counts under
    `_meta.quota`, which is not plan quota.

### Extending without waiting

([v1](https://agentclientprotocol.com/protocol/v1/extensibility.md) and
[v2](https://agentclientprotocol.com/protocol/v2/extensibility.md)
extensibility, undated.) `_meta` is allowed on every message, including
capabilities. Method names starting with `_` are extension methods, and a
receiver "SHOULD ignore unrecognized notifications". Support is advertised
under a namespaced key of `agentCapabilities._meta` (v1) or
`capabilities._meta` (v2). So a vendor notification is legal now, and
Althar already relies on one extension (the JetBrains AIR `sessionFailure`).

## What is possible today

| Agent | Today, with no upstream change | Needs upstream or a patch |
|---|---|---|
| Claude Code | Read `_meta["_claude/rateLimit"]` from `usage_update`: works, unreliable (first-window drop, one window per event). Or run the Agent SDK's `usage_EXPERIMENTAL…()` in a side process: full windows, gated API | Fix of #1127 (or Althar's patch); structured forwarding of all windows |
| Codex | A second `codex app-server` connection for `account/rateLimits/read` plus the `updated` notification; account is the user's own `~/.codex` login | PR #524 (`_account/rate_limits_update`) or the accepted ACP extension |
| OpenCode | Nothing for the upstream plan; show provider errors as now | #49693; there is nothing to forward until OpenCode reads a plan |
| API keys (all) | Per-minute headers only; no plan windows exist | Nothing |

Two claims in the repo are stale or imprecise and should be corrected with
the first follow-up:

- `registry.ts` (Claude note) and architecture 03 (Claude row, and "ACP does
  not report limits") say the adapter doesn't forward limits. Since the
  adapter's `398f763` (5 Jun) it forwards one window per event in `_meta`;
  check that against the pinned 0.88.0 before rewording.
- Architecture 03 plans a Claude adapter patch that sends an ACP extension
  notification, and a Codex app-server side connection. The research confirms
  both are still needed; the patch can be much smaller than first thought,
  because the `_meta` path exists and its drop condition is a one-line fix.

## Recommendation

**Where plan usage comes from now:** per-agent native channels behind one
Althar interface, not raw endpoints.

1. Define `AccountStatus` (already in architecture 03) as Althar's own
   model and fill it from a **source** per agent: `acp-meta` (Claude, the
   `_meta` path, patched), `app-server` (Codex), `none` (OpenCode, API keys).
   The UI and the coordinator read only `AccountStatus`, never a source.
2. **Do not read the raw provider endpoints by default.**
   - Claude: Anthropic's terms say OAuth is "intended exclusively" for Claude
     Code and native Anthropic apps and forbid intermediating Claude.ai
     credentials; the endpoint also rate-limits hard (users see 429 at one
     call a minute) and its shape already changed (`limits[]` replaced flat
     `seven_day_*` keys, per the `ccusage` 0.3.1 package of 11 Oct).
   - Codex: undocumented, a second path is in use, and `primary` is not
     always the five-hour window. Reading it would add nothing over
     app-server, which Codex documents.
   - Keep an endpoint as a documented, off-by-default fallback only if a
     native channel breaks; classify windows by duration, not slot.
3. **Migration**: when the ACP quota RFD is accepted and an adapter
   advertises it, switch that agent's source to `acp` and delete its side
   channel. Until then each source is replaceable because only `AccountStatus`
   leaves the adapter package.
4. Keep error-based detection (`failures.ts`) as the floor for every agent:
   it needs no channel and already yields `usage_limit` and a `resetsAt`.

Why not wait for ACP: no adapter ships the extension, #2316 has no review,
and v2 does not change usage, so v2 support is no signal for it. Why not use
endpoints: the terms, the instability and the 429s above; the native channels
carry the same numbers.

## Staged follow-ups

One pull request each, in order. The first three are Althar's; 4 to 6 are
upstream and can run in parallel.

1. **Model and Codex source.** `AccountStatus` and its windows in
   `packages/provider-adapters`; a Codex source from app-server (`read` on
   connect, `updated` notifications); correct the registry notes and
   architecture 03 where they are stale. Tests with a fake app-server.
2. **Claude source.** Read `_meta["_claude/rateLimit"]` in `events.ts` (a new
   event beside `ContextUsage`); carry Althar's small adapter patch for the
   #1127 drop; accumulate one window per `rateLimitType`. Bump the pinned
   adapter after checking 0.88.0 against 0.90.0.
3. **Surface.** Runtime keeps `AccountStatus` per `ProviderPrincipal` and
   emits changes; a threshold (warning at the SDK's `allowed_warning`, or a
   chosen percent; `limited` on `rejected` or a classified `usage_limit`).
   Wiring to the pause and move-on logic in architecture 05 comes here.
4. **Upstream: Claude.** Offer the #1127 fix again, and a structured
   forwarding of all windows.
5. **Upstream: Codex.** Review PR #524 (or its successor) with the
   `AccountStatus` shape in mind; say what Althar needs: window duration,
   `planType`, per-`limitId` data.
6. **Upstream: ACP.** Comment on PR #2316 with the matrix above and the
   `AccountStatus` fields we need; propose nothing new unless it is
   rejected. Reconsider an Althar-authored RFD only then. Close the
   open-questions item when #2316 is accepted or declined.
7. **Switch to ACP** per agent, as adapters advertise `quota` (and v1 or v2,
   whichever the adapter negotiates: the capability does not depend on the
   version).

## Where the person sees it

Not decided; this plan produces the data only. The brainstorm to hold with
the person before step 3:

- **The coordinator.** One message per coordinator would repeat on every
  project at once, since a limit belongs to an account. If it speaks, one
  place should: the home, not each project's coordinator.
- **An app notification** (operating-system) when a window crosses a
  threshold or an account is limited, once per account and window.
- **A readout** in the settings tray or accounts panel, always there and
  calm, next to the accounts it belongs to
  ([Connections panel](integrations.md) is the nearest existing shape; the
  [usage readout prototypes](https://github.com/AltharIDE/althar/pull/111)
  are the starting designs).
- The deciding facts: the data is per account, arrives only after a turn
  (Claude) or on demand (Codex), and is missing for OpenCode and API keys.
  The surface must show "no data" without alarm.

## Risks

- All adapter claims are of main at 15 October; ACP and the adapters move
  weekly. Re-check before each step.
- The Claude `_meta` key is a private convention (`_claude/rateLimit`); it
  may change when #2316 lands.
- Codex's second app-server connection reads the user's own login; it must not
  refresh or write tokens.
- Windows are not fixed slots; classify by duration and type.
