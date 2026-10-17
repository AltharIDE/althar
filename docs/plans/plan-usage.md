# Plan usage plan

> **Temporary.** Research and the plan for warning about plan usage (use per
> window and reset times) from every agent, and for a view of all accounts.
> Not architecture: that is
> [03, Usage limits](../architecture/03-agent-runtime-and-auth.md#usage-limits).
> Delete this file when the last step ships, and move anything that lasted
> into the architecture docs.

Researched on 15 October 2026 against upstream `main` (`af3023a`). Decided
(ADR-046) and partly built: the Codex source, the usage-source registry, the
allowlisted reader and its contract test are in `provider-adapters` (see
Stages). Not built: the Claude source, the notices and the usage tab.

## Goal

From the person (15 October 2026):

- **Warnings like the harnesses give**, when 50%, 25%, 10% and 5% of a plan
  window remains.
- **Windows**: Claude Code 5 hours and 1 week; Codex and OpenCode 5 hours,
  1 week and 1 month, where the provider has them.
- **Reaching the person while they work**, through the coordinator that is
  open, not every project's coordinator at once.
- **A view of every signed-in account**: a usage tab, opened with Ctrl/Cmd+U
  or a side-menu entry, listing each subscription and account.

## Decision

**Usage data is required for every agent and every subscription account that
is added** (the person, 15 October 2026). "No usage data" is a defect to fix,
not a state to show calmly. So the rule below ends in a provider endpoint,
not in errors, and ACP stays the preferred source.

> An account's usage comes from the first of these that works for its
> (agent, provider) pair: (1) the ACP quota feature, once the adapter
> advertises it; (2) an extension the adapter ships in ACP (today Claude's
> `_meta`, and Codex's `_account/rate_limits_update` once merged); (3) the
> agent's own documented control channel, which Althar starts with the
> account's home (Codex's app-server; Claude's Agent SDK); (4) **the
> provider's usage endpoint**, read-only, called by Althar with the account's
> sign-in under the narrow exception below. Errors (`failures.ts`) are the
> floor under all four: they say a limit was *reached*, never how much is
> left, so they are never a substitute for a source.

Per agent and provider, today:

| Agent / provider | Source today | Gives | Moves up when |
|---|---|---|---|
| Claude Code, plan | (2) `_meta["_claude/rateLimit"]` from sessions Althar runs (patched); (3) Agent SDK `usage_EXPERIMENTAL…()`, or a probe session, for an account with no session. **Not (4): see the Claude risk below** | 5 hours, 1 week, per model | `claude-agent-acp` advertises ACP `quota` |
| Codex, plan | (3) `codex app-server` with the account's `CODEX_HOME`: `account/rateLimits/read` and `…/updated`. (4) `wham/usage` only if (3) fails | 5 hours, 1 week, credits | `codex-acp` ships #524 or `quota` |
| OpenCode, ChatGPT plan | (4) `chatgpt.com/backend-api/wham/usage` with the token OpenCode holds for that provider (unverified that the token has the same form as Codex's) | 5 hours, 1 week (as Codex) | OpenCode reports plan usage over ACP (#49693) |
| OpenCode, Go or Zen | (4) OpenCode's console API (claim: issue text) | Whatever it returns, possibly the 1-month window | the same |
| OpenCode, GitHub Copilot or Gemini sign-in | (4) the provider's own endpoint (each to be confirmed by a spike) | to be confirmed | the same |
| Any agent, API key | No plan window exists. Show what the provider documents about the key (credit left, per-minute headers) and say it is a key | credit or per-minute | n/a |

### The exception to rule 3

Decided: [ADR-046](../decisions/046-a-usage-read-may-use-an-accounts-token-once.md).
An OpenCode 2.x account has no endpoint source (its credentials moved into
`opencode.db`, and `auth list` says "can't tell"), so it shows a fault, not
quiet "no data".

Architecture 03 rule 3 says Althar never reads an agent's credential cache,
and the provider endpoints need that token. Required coverage cannot be met
without it, so the plan amends the rule (an architecture change, stage 0,
for the person's word) with a narrow **usage read**:

- Althar may read the access token of an account from the agent's own store,
  **in memory, for one call to that provider's usage URL, and for nothing
  else**.
- It never writes, refreshes, copies, persists, logs or sends the token
  anywhere but that URL, and never off the device. An expired token is not
  refreshed by Althar, and a status command is not assumed to refresh it
  (OpenCode's `auth list` only lists saved credentials). The source shows a
  fault, "sign in again", with the agent's own login flow
  (`signIn.login`) as the action. Where the agent refreshes by itself while
  it runs (a Codex app-server or a Claude session), the next read picks the
  new token up.
- One call per account at most every 60 seconds or the provider's stated
  interval, cached and shared across sessions, with backoff on a 429.
- Each (agent, provider) source is its own adapter, enabled only after a
  spike confirms the response and a read of that provider's current terms.
  The response is parsed defensively (windows classified by duration, unknown
  shapes become a visible "usage source changed" fault, not zeros).

### The Claude risk

Anthropic's terms say OAuth is "intended exclusively" for Claude Code and
native Anthropic apps and forbid intermediating Claude.ai credentials
([legal and compliance](https://code.claude.com/docs/en/legal-and-compliance),
acc. 15 Oct), so step (4) is **not** used for Claude. Coverage for Claude
then rests on step (3): the SDK's `usage_EXPERIMENTAL…()` run in a process
with the account's `CLAUDE_CONFIG_DIR`, or failing that a small probe
session through the adapter (which is Claude Code, so within its terms, but
costs a little plan usage). Both are unverified. If neither works, Claude
accounts with no session cannot be covered until Anthropic clears the
endpoint in writing or adds an official read. This is the one place the
requirement may not be met today, and the first Claude spike settles it.

### What counts as a subscription

Coverage is owed to subscription accounts, so the classification must be
right. Today `registry.ts:492` makes every OpenCode sign-in `paidBy: 'key'`
("paid per use, as far as Althar can tell"), which would put a ChatGPT, Go or
Zen sign-in under the API-key row and skip its source. So:

- The classification for OpenCode moves from the account to the **provider
  credential**: an OpenCode account holds one entry per provider
  (`auth.json`), and each is a plan (an OAuth sign-in to ChatGPT, Go, Zen,
  Copilot) or a key. An account is a subscription account if any of its
  credentials is a plan, and each plan credential has its own source and row.
- Classification uses only what `opencode auth list` prints, as the sign-in
  check does today. Whether that output tells a plan credential from a key
  is unverified; the OpenCode spike settles it. Althar does not inspect
  `auth.json` to classify: that is a read of the credential cache outside the
  usage-read exception, which covers an access token for one usage call
  only. If the output cannot tell, the credential is a fault ("can't tell
  plan from key"), not a key. Reading entry types from `auth.json` would
  need the exception widened to metadata, with the stage-0 ADR and the
  person's word.
- The contract test covers the classification as well: for each registry
  (agent, provider) pair that can be a plan, `paidBy` must say `plan` for a
  plan sign-in, and the pair must declare a usage source.

### Coverage is enforced

- The registry declares a usage source per (agent, provider) pair, and a
  contract test fails for a subscription pair with none.
- Adding an account whose pair has no source is refused with the reason, and
  an account whose source fails shows a fault on the usage tab and in the
  badge, not an empty row.

**The 1-month window.** No source found offers one for Claude or Codex:
Codex's snapshot has `primary`, `secondary` and `credits`. OpenCode's Go and
Zen plans may (claim). The `windows` list carries any window a source
returns, so it shows when a source reports it; nothing else is built for it.

## Warnings

- **Thresholds**: on the share *remaining*: 50, 25, 10 and 5%. Per account
  and window, each fires once per reset period.
- **Crossing several at once** (50 → 8%): fire only the lowest crossed.
- **Re-arming**: only when the window's `resetsAt` changes. Use that dips
  back above a threshold and falls again in the same period does not fire
  it twice.
- **Every source gives a percentage**, so every subscription account can
  warn. An account whose source is failing shows a fault instead, and warns
  from nothing until it is fixed.
- **Reached**: a classified `usage_limit` (`failures.ts`) stays the signal
  that the limit is hit, and keeps pausing and moving work as in
  architecture 03 and 05.
- **Own thresholds, not the vendor's.** Claude's SDK has `status:
  'allowed_warning'` and `surpassedThreshold`, but their cut-offs are
  Anthropic's. Althar computes its own from the reported use.
- **Unit unchecked**: whether Claude's `utilization` is 0 to 1 or 0 to 100
  is not in its type (`sdk.d.ts` 0.3.296), and Codex's `usedPercent` is a
  whole percent (`account.rs`, `i32`). The first Claude spike settles it.

## Where the person is told

- **One notice per account, window and threshold**, never per coordinator. A
  limit belongs to an account, so a warning is a fact about the account.
- **Shown in the open coordinator's Talk room**, the one for the project the
  person is looking at, as a notice Althar posts itself. It is not a model
  turn: it costs no usage and the coordinator did not "say" it. Which
  project is open comes from the window; the notice records which it was
  shown in.
- **Nothing open** (the home, the usage tab, another screen): the warning
  waits and shows as a badge on the usage entry, and goes into the next
  coordinator the person opens, unless the window has reset by then.
- **Always findable**: the usage tab shows the same state, so a missed notice
  is not lost.
- **Left for later**: telling the coordinator *agent* (so it plans around a
  nearly empty account), and an operating-system notification when the
  window is not focused. Both are additions on the same notice.

## The usage tab

- **Entry**: a button in the window's bar (the app has no side menu), with the count of warnings not yet seen, and Ctrl/Cmd+U. No existing binding for it
  was found in `apps/` or `packages/`. Check against the shortcut list when
  building.
- **Content**: every `AgentAccount` ([03, Several accounts](../architecture/03-agent-runtime-and-auth.md#several-accounts))
  across Claude Code, Codex and OpenCode, with its name, the plan it is on
  (`paidBy`), each window's use and reset time, and the source: "reported by
  Codex", "from Claude's last turn, 10 minutes ago", "no usage data".
- **An account with no session**: read on demand by its source: Codex by
  starting its app-server with the account's `CODEX_HOME`, OpenCode by its
  provider's endpoint, Claude by the SDK or a probe (see the Claude risk).
  A row shows the age of what it shows. API-key accounts say "API key, no
  plan window" with the credit left where the provider documents it.
- **Where it lives**: next to the existing accounts feature
  (`apps/desktop/src/renderer/features/accounts`). The system-load readout
  designs in [#111](https://github.com/AltharIDE/althar/pull/111) are about
  the Mac's CPU and memory, not plan usage; they inform the look, not the
  content.

## What is verified and what is claimed

**Verified** here, by reading the code (this repository, or an installed or
cloned copy at the named commit):

| Fact | Evidence |
|---|---|
| Althar's rule against reading agents' credentials | `docs/architecture/03-agent-runtime-and-auth.md`, rule 3 |
| Althar normalizes only context usage and token counts, not plan windows | `packages/provider-adapters/src/events.ts` (`ContextUsage`, `normalizeUsage`) |
| Limits are recognized from errors, with reset times | `packages/provider-adapters/src/failures.ts` |
| The pinned Claude adapter 0.88.0 already forwards `rate_limit_info` in `usage_update` `_meta["_claude/rateLimit"]`, only when `lastAssistantTotalUsage !== null` | installed `claude-agent-acp@0.88.0` `dist/acp-agent.js`; same code on `main` at `0c8de13` (14 Oct) `src/acp-agent.ts:7923` |
| So `registry.ts` and architecture 03 are out of date on Claude ("not forwarded") | the same code |
| Pinned Codex adapter (2.1.1 when first checked, 2.2.2 now) merges `account/rateLimits/updated` into session state and sends it nowhere; same on `main` at `aa02d43` (15 Oct) | installed `codex-acp` `dist/index.js` (`handleRateLimitsUpdated`, same in 2.2.2); `src/CodexEventHandler.ts:1241` |
| OpenCode's ACP code has no rate-limit or quota handling | grep of `packages/cli/src/acp` at `4397ee4` (15 Oct): no match |
| The Agent SDK type for a window: `SDKRateLimitInfo` with `rateLimitType` five_hour / seven_day / seven_day_opus / seven_day_sonnet, `utilization`, `resetsAt`, `status`; `usage_EXPERIMENTAL…()` returns plan windows, null for API-key, Bedrock and Vertex | `sdk.d.ts` of `@anthropic-ai/claude-agent-sdk@0.3.296` (L5704, L3058) |
| Codex's window type: `used_percent` (whole number), `window_duration_mins`, `resets_at` | `codex-rs/app-server-protocol/src/protocol/v2/account.rs` at openai/codex `e89b7c4` (15 Oct) |
| ACP SDK 1.7.0 ships a v2 schema at `PROTOCOL_VERSION = 2`, pointing at `protocol/v2/draft` | a sibling worktree's installed SDK |
| Accounts are separate homes (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `XDG_DATA_HOME`) | architecture 03, Several accounts |

**Read from the ACP documentation** (dated; the page itself is the source):

- v1 is stable; v2 is a Draft announced 20 July 2026 and `usage_update` is
  "Unchanged" in it
  ([announcement](https://agentclientprotocol.com/announcements/acp-v2-draft.md),
  [migration](https://agentclientprotocol.com/protocol/v2/migration.md)).
- `usage_update` (`used`, `size`, `cost`) is stable in v1 since 5 June
  ([announcement](https://agentclientprotocol.com/announcements/session-usage-stabilized.md)).
  Its RFD says "Rate limits and quotas are separate concerns that could be
  addressed in a future RFD"
  ([RFD](https://agentclientprotocol.com/rfds/session-usage)).
- Extensions: `_meta` everywhere, `_`-prefixed methods, support advertised
  under a namespaced `agentCapabilities._meta` key
  ([v1](https://agentclientprotocol.com/protocol/v1/extensibility.md),
  [v2](https://agentclientprotocol.com/protocol/v2/extensibility.md)).

**Reported by research on upstream repositories, not re-checked by hand** (a
named commit or issue date each; treat as probably right, and re-check
before building on it):

- Quotas RFD: [PR #2316](https://github.com/agentclientprotocol/agent-client-protocol/pull/2316),
  opened 6 Oct, no review: a `quota_update`, `quota/read` and `quotaExceeded`
  error, advertised by a `quota` capability. Also
  [discussion #2235](https://github.com/agentclientprotocol/agent-client-protocol/discussions/2235)
  (26 Sep).
- Who negotiates v2: `claude-agent-acp` 0.90.0 (13 Oct) behind
  `CLAUDE_AGENT_ACP_EXPERIMENTAL_V2=1`; `codex-acp` on `main` (re-landed
  13 Oct in [#620](https://github.com/agentclientprotocol/codex-acp/pull/620)),
  not in 2.2.2 (10 Oct); OpenCode `service.ts` and Gemini CLI: v1.
  **v2 does not bring plan usage**, so v2 support is not a signal for it.
- Claude adapter: [#1127](https://github.com/agentclientprotocol/claude-agent-acp/issues/1127)
  (14 Sep, open), the fix [#1191](https://github.com/agentclientprotocol/claude-agent-acp/pull/1191)
  closed unmerged 4 Oct; [#625](https://github.com/agentclientprotocol/claude-agent-acp/issues/625):
  on 2 July a maintainer said they would wait on the gated
  `usage_EXPERIMENTAL` API. It also renders `/usage` as markdown.
- Codex adapter: [#227](https://github.com/agentclientprotocol/codex-acp/issues/227)
  (23 Jun, open), PRs [#334](https://github.com/agentclientprotocol/codex-acp/pull/334),
  [#426](https://github.com/agentclientprotocol/codex-acp/pull/426),
  [#524](https://github.com/agentclientprotocol/codex-acp/pull/524) (18 Sep),
  none merged. The moved repo is `agentclientprotocol/codex-acp`; Althar
  pins 2.2.2, the latest.
- OpenCode: [#49693](https://github.com/anomalyco/opencode/issues/49693)
  (18 Sep), open, unanswered. Gemini CLI reports no plan usage over ACP
  (not shipped by Althar).
- Raw endpoints: Claude `GET api.anthropic.com/api/oauth/usage`
  (`anthropic-beta: oauth-2025-04-20`, scope `user:profile`), its shape
  change and 429s ([CodexBar notes](https://raw.githubusercontent.com/steipete/CodexBar/main/docs/claude.md),
  [claude-code #31637](https://claudeissues.com/issue/31637-bug-api-oauth-usage-endpoint-aggressively-rate-limits-making-usage-monitoring-un),
  closed "not planned" 1 Jun); Codex `GET chatgpt.com/backend-api/wham/usage`
  ([CodexBar notes](https://raw.githubusercontent.com/steipete/CodexBar/main/docs/codex.md)).
  Header names (`anthropic-ratelimit-unified-*`, `x-codex-*`) come from user
  reports and none are documented. API-key limits are per-minute only
  ([Anthropic](https://platform.claude.com/docs/en/api/rate-limits),
  [OpenAI](https://developers.openai.com/api/docs/guides/rate-limits)).

**Only claimed, unverified anywhere:**

- That Claude's `usage_EXPERIMENTAL…()` can run in a side process for an
  account that has no session without cost to the plan or a visible session.
- That Codex's app-server can be started per account for a read alone and
  quit, and how often it may be asked.
- That OpenCode's Go and Zen plan limits are reachable and wanted.
- Any 1-month window for Claude or Codex.

## Matrix

| | Claude Code | Codex | OpenCode |
|---|---|---|---|
| Adapter now / latest | `claude-agent-acp` 0.93.0 (Althar pins it, patched) / 0.93.0 | `codex-acp` 2.2.2 / 2.2.2 | OpenCode's own |
| Plan windows over ACP today | Partly: `_meta` on `usage_update`, one window per event, dropped before a turn's first usage | No: held, not sent | No |
| Context and cost `usage_update` | `used`, `size`, `cost` | `used`, `size` | `used`, `size`, `cost` |
| ACP version | v1 (v2 opt-in) | v1 and v2 on `main` | v1 |
| Native channel | Agent SDK `rate_limit_event`; `usage_EXPERIMENTAL…()`; statusline `rate_limits` ([docs](https://code.claude.com/docs/en/statusline), acc.) | App-server `account/rateLimits/read` and `…/updated` ([docs](https://learn.chatgpt.com/docs/app-server), acc.) | None |
| Provider endpoint (step 4) | Not used: Anthropic's terms | `wham/usage`, undocumented; fallback only | Needed: `wham/usage` for a ChatGPT sign-in, the console API for Go or Zen, others by spike |
| Windows | 5 hours, 1 week, per model | 5 hours, 1 week | as the provider returns |

## Stages

**Built so far (15 October):**

- `packages/provider-adapters`: the usage model, warning rule and Codex
  reader (`usage.ts`); Claude Code's window from the usage update's `_meta`
  (`ContextUsage.planWindow`); the per-(agent, provider) registry with its
  classification and allowlist, OpenCode's sign-in listing (`usageSources.ts`);
  the allowlisted usage reader (`usageRead.ts`) and the only credential-store
  module (`credentialStore.ts`), with the contract test
  (`tests/usageSources.test.ts`) that enforces ADR-046.
- `packages/persistence-sqlite`: migration 0034, `plan_usage_readings` and
  `plan_usage_warnings`.
- `packages/runtime`: `PlanUsage.ts` keeps each account's windows (Codex read
  through its app-server, Claude heard from its sessions, OpenCode by its own
  listing then the provider's endpoint), raises the 50/25/10/5 warnings once
  per reset, and tells the window; the API has `GetPlanUsage`,
  `AcknowledgeUsageWarnings` and a `PlanUsage` watch event.
- **No endpoint source is confirmed**, so the reader refuses all of them: each
  is enabled by its own spike and a read of the provider's terms. Until then
  an OpenCode account on a plan shows a fault, not a number.
- **Claude Code's adapter drops a window that arrives before a turn's first
  usage figure** (#1127): Althar carries a patch for it (`patches/`, applied
  by bun to the pinned 0.93.0; a test fails if it is not applied, and a bump
  of the adapter needs the patch made again). Accounts with no session show a
  fault.

The app side (usage overlay on Cmd/Ctrl+U, the bar badge, the Talk-room
notice) is built in `apps/desktop` and `packages/ui`.

One pull request each. Stages 0 to 5 are Althar's; 6 to 8 are upstream and
run in parallel.

0. **Amend rule 3** (done, docs only, 15 October): the narrow usage read is
   in architecture 03 and
   [ADR-046](../decisions/046-a-usage-read-may-use-an-accounts-token-once.md),
   approved by the person. Its reader, allowlist and contract test are still
   to build, in the stages below.
1. **Model and Codex source.** `AccountStatus` with its `windows`
   (`provider-adapters`), a Codex source (app-server with the account's
   home), the threshold rule above as a pure function with tests (each
   threshold once, skipping, re-arming at reset), and a fake app-server.
   Correct the stale notes in `registry.ts` and architecture 03. The
   registry gets a usage source per (agent, provider) and its contract test.
2. **Claude source.** Read `_meta["_claude/rateLimit"]` in `events.ts` as a
   new event beside `ContextUsage`; keep a window per `rateLimitType`;
   carry a patch for #1127 until upstream fixes it. Settle the `utilization`
   unit. Spike `usage_EXPERIMENTAL…()` for accounts with no session.
3. **Notices.** The runtime holds `AccountStatus` per account and posts one
   notice per account, window and threshold into the open coordinator's
   Talk room; a badge when none is open.
4. **The usage tab.** Ctrl/Cmd+U and the bar's button; every account, its
   windows, its source and age.
5. **OpenCode sources.** First, per-provider plan-or-key detection replacing
   `paidBy: () => 'key'`, with its contract test. Then one spike, then one
   source per provider the person
   can sign in with (ChatGPT first, then Go or Zen, Copilot, Gemini), each
   behind the usage-read rules; faults visible; accounts with no source
   refused.
6. **Upstream: Claude adapter.** Offer the #1127 fix again; ask for all
   windows to be forwarded.
7. **Upstream: Codex adapter.** Review PR #524 with `AccountStatus`'s needs
   (window length, plan, per limit id).
8. **Upstream: ACP and OpenCode.** Comment on PR #2316 with this matrix and
   `AccountStatus`; ask OpenCode on #49693 for the same. Write our own
   proposal only if #2316 is declined.
9. **Move to ACP**, agent by agent, as adapters advertise `quota`. Drop that
   agent's side channel. Because only `AccountStatus` leaves `provider-adapters`,
   nothing above it changes.

## Risks

- Everything upstream moves weekly; re-check a claim before building on it.
- `_claude/rateLimit` is a private key and may change when #2316 lands.
- The Claude side query (stage 2) may be refused or cost usage, and the
  endpoint is barred by Anthropic's terms: idle Claude accounts may stay
  uncovered until Anthropic clears a read. The requirement is not met for
  them until then.
- The endpoint exception reads agents' tokens. It is the largest security
  change in this plan: keep it in one module, with tests that nothing is
  written, logged or sent elsewhere.
- OpenCode's stored token for a provider may differ from the agent-native
  one (scope, expiry); each provider source needs its own spike.
- A Codex app-server started for a read must not refresh or write tokens
  beyond what Codex itself does.
- Windows are not fixed slots: classify by duration and type, not by
  `primary` or `secondary`.
