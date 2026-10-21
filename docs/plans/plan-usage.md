# Plan usage plan

> **Temporary.** Research and the plan for warning about plan usage (use per
> window and reset times) from every agent, and for a view of all accounts.
> Not architecture: that is
> [03, Usage limits](../architecture/03-agent-runtime-and-auth.md#usage-limits).
> Delete this file when the last step ships, and move anything that lasted
> into the architecture docs.

Researched on 15 October 2026 against upstream `main` (`af3023a`), and again
on 21 October for the agents #266 added. Built (see Stages): every source in
the table below, the usage read and its exception to rule 3
([ADR-055](../decisions/055-a-usage-read-may-use-an-account-s-own-sign-in-once.md)),
the warnings, the notices and the usage view, the limits recognised in each
agent's own words, and new work steered by the windows. Which design the
window shows them in is being chosen on a prototype
(`apps/desktop/prototypes/plan-usage`).

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

**Usage data is wanted for every agent and every subscription account that
is added** (the person, 15 October 2026). Where an agent gives it to no other
app, it says why, calmly, and its limits are still recognised when they hit
(the person, 21 October 2026). So the rule below ends in a provider endpoint,
not in errors, and ACP stays the preferred source.

> An account's usage comes from the first of these that works for its
> (agent, provider) pair: (1) the ACP quota feature, once the adapter
> advertises it; (2) an extension the adapter ships in ACP (today Claude's
> `_meta`, and Codex's `_account/rate_limits_update` once merged); (3) the
> agent's own documented control channel, which Althar starts with the
> account's home (Codex's app-server; Claude's Agent SDK); (4) **the
> provider's usage endpoint**, read-only, called by Althar with the account's
> sign-in under the narrow exception below (ADR-055). Errors (`failures.ts`) are the
> floor under all four: they say a limit was *reached*, never how much is
> left, so they are never a substitute for a source.

Per agent and provider, today:

| Agent / provider | Source today | Gives | Moves up when |
|---|---|---|---|
| Claude Code, plan | (2) `_meta["_claude/rateLimit"]` from sessions Althar runs (patched); (4) `api.anthropic.com/api/oauth/usage` with Claude Code's sign-in (its keychain item for the folder on a Mac, else `.credentials.json`), for any account, at most every 5 minutes | 5 hours, 1 week, a model's week, extra usage | `claude-agent-acp` advertises ACP `quota` |
| Codex, plan | (3) `codex app-server` with the account's `CODEX_HOME`: `account/rateLimits/read` and `…/updated`. (4) `chatgpt.com/backend-api/wham/usage` only if (3) fails | 5 hours, 1 week, a model's bucket, a spend limit | `codex-acp` ships #524 or `quota` |
| Kimi Code, plan | (4) `api.kimi.com/coding/v1/usages` with `credentials/kimi-code.json` | 1 week, 5 hours | Kimi reports it over ACP |
| Grok Build, plan | (4) `cli-chat-proxy.grok.com/v1/billing?format=credits` with xAI's entry in `auth.json` | a week of credits, a month of spend | Grok reports it over ACP |
| Copilot | none: its sign-in is a keychain item another app reading would ask about; its SDK's `account.getQuota` (`copilot --headless --stdio`) wasn't confirmed | premium requests, monthly | `account.getQuota` is tried for real |
| Junie | none: its credits only in its own `/stats` | AI credits | an endpoint is confirmed |
| Mistral Vibe | none: usage only in Mistral's console, behind a browser session | % of the month | Mistral gives keys a usage read |
| Qwen Code | none: its quota said only when it runs out (Qwen OAuth's free tier ended 15 April 2026) | n/a | Qwen gives a usage read |
| Antigravity | none: Althar runs its ACP server, not the `agy` CLI whose `/usage` Orca reads | 5 hours, 1 week | the server reports it |
| OpenCode, any plan sign-in | none: OpenCode keeps them in its own database | as the provider | OpenCode reports plan usage over ACP (#49693) |
| Any agent, API key | No plan window exists: it says it is a key | n/a | n/a |

### The exception to rule 3

Decided in [ADR-055](../decisions/055-a-usage-read-may-use-an-account-s-own-sign-in-once.md)
(21 October 2026), from ninemate's draft in #218 (`59955fe`), with Anthropic's
endpoint on the allowlist, as the person decided: Orca reads it the same way.
The reader is `packages/provider-adapters/src/usageRead.ts`; the one module
that opens a credential store is `credentialStore.ts`; the sources and the
allowlist are in `usageSources.ts`, with their contract test.

### The Claude risk

Anthropic's terms say OAuth is "intended exclusively" for Claude Code and
native Anthropic apps ([legal and compliance](https://code.claude.com/docs/en/legal-and-compliance),
acc. 15 Oct). The person weighed that and decided on 21 October 2026 that
Althar reads Anthropic's usage endpoint with Claude Code's own sign-in, as
Orca does: read-only, at most every five minutes, waiting as long as a 429
asks (ADR-055).

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
- **The coordinator agent** reads each model's room in `list_models`, and
  new steps steer by it (below).
- **Left for later**: an operating-system notification when the window is
  not focused.

## Steering new work

Built in `Limits.ts`, `usableModels.ts` and `Runs.ts` (architecture 05,
Usage limits). An account's room is its tightest window left, as last read;
under 5% it is nearly out. Work starts on the account with the most room
where the project rotates, for the model it runs where that model has a
window of its own; a new step on an agent nearly out on every account goes
by the project's rule as if out (moved to an agent with room, or started on
what is left; held until the reset; or asked, with the agent itself a way
on), and the thread says why. The lead's fixes after a review are a new
step, and so is a review that waited for a place. A running step is never
stopped.

## Limits when they hit

Each agent's own words, as `failures.ts` reads them (its tests hold them):

| Agent | Says | Reset |
|---|---|---|
| Claude Code | "You've hit your session limit · resets 3pm (Europe/Budapest)", "… weekly / Opus limit", "You're out of usage credits" | a clock time in a named zone, or a day and time |
| Codex | "You’ve hit your usage limit. … try again at 3:05 PM.", "… out of credits", "… spend cap" | this computer's clock, or a date |
| Copilot | "Error: You've hit your rate limit. Please wait for your limit to reset in 3 hours 20 minutes …" as a message, the turn ending as if done; "You've run out of your included AI credits"; a session's spend limit starts a new session | a length, "under a minute", or a date |
| Junie | -32010, "Insufficient account balance." | none |
| Grok Build | "You hit your weekly limit.", "You’ve hit the credit limit for your plan.", "spending cap" | none |
| Kimi Code | "You've reached your 5-hour / weekly (7-day) / monthly usage limit"; its concurrent-request limit is a short retry | none |
| Mistral Vibe | -31001 (after its own retries), 402 Payment Required | none |
| Qwen Code | "Your token-plan 1-week quota has been exhausted. The quota will reset at 07-27 09:25:00 UTC."; its ended free tier asks for another sign-in | a UTC date and time |
| Antigravity, Gemini's | RESOURCE_EXHAUSTED, "You have exhausted your capacity on this model. Your quota will reset after 19h14m47s.", "Access resets at 3:05 PM PDT" | a length, or a clock time in US zones |
| OpenCode | `provider.quota` / `provider.free-limit` in the error's data, "… usage limit reached. It will reset in 3 hours 20 minutes." | a length |

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
| Adapter now / latest | `claude-agent-acp` 0.94.0 (Althar pins it, patched) / 0.94.0 | `codex-acp` 2.2.2 / 2.2.2 | OpenCode's own |
| Plan windows over ACP today | Partly: `_meta` on `usage_update`, one window per event, dropped before a turn's first usage | No: held, not sent | No |
| Context and cost `usage_update` | `used`, `size`, `cost` | `used`, `size` | `used`, `size`, `cost` |
| ACP version | v1 (v2 opt-in) | v1 and v2 on `main` | v1 |
| Native channel | Agent SDK `rate_limit_event`; `usage_EXPERIMENTAL…()`; statusline `rate_limits` ([docs](https://code.claude.com/docs/en/statusline), acc.) | App-server `account/rateLimits/read` and `…/updated` ([docs](https://learn.chatgpt.com/docs/app-server), acc.) | None |
| Provider endpoint (step 4) | `api/oauth/usage`, for any account (ADR-055) | `wham/usage`, undocumented; fallback only | Not read: its sign-ins are in its own database |
| Windows | 5 hours, 1 week, per model | 5 hours, 1 week | as the provider returns |

## Stages

**Built so far (21 October):**

- `packages/provider-adapters`: the usage model, warning rule and Codex
  reader (`usage.ts`); Claude Code's window from the usage update's `_meta`
  (`ContextUsage.planWindow`); the per-(agent, provider) registry with its
  classification and allowlist, OpenCode's sign-in listing (`usageSources.ts`);
  with the contract test (`tests/usageSources.test.ts`) that every
  subscription has a source and a way to be told from a key.
- `packages/persistence-sqlite`: migration 0038, `plan_usage_readings` and
  `plan_usage_warnings`.
- `packages/runtime`: `PlanUsage.ts` keeps each account's windows (Codex read
  through its app-server, Claude heard from its sessions, OpenCode by its own
  listing), raises the 50/25/10/5 warnings once
  per reset, and tells the window; the API has `GetPlanUsage`,
  `AcknowledgeUsageWarnings` and a `PlanUsage` watch event.
- **The usage read** (ADR-055): Claude Code's idle accounts, Codex's
  fallback, Kimi Code and Grok Build, through `usageRead.ts`.
- **No reading**, said calmly with why: OpenCode's plan sign-ins, Copilot,
  Junie, Mistral Vibe, Qwen Code and Antigravity (the table above).
- **Limits in each agent's own words**, with their reset times (above).
- **Steering new work** by the windows, and `list_models` saying each
  model's room (above).
- **Claude Code's adapter drops a window that arrives before a turn's first
  usage figure** (#1127): Althar carries a patch for it (`patches/`, applied
  by bun to the pinned 0.94.0; a test fails if it is not applied, and a bump
  of the adapter needs the patch made again). The patched event carries the
  context as last known (`session.contextUsedTokens`, set by 0.94.0 on each
  usage figure and after a compaction), or 0 where the session has none yet;
  `events.ts` makes such a 0 a `PlanWindow` alone, so the context meter and
  the handover check keep theirs. Accounts with no session show a fault.

The app side (usage overlay on Cmd/Ctrl+U, the bar badge, the Talk-room
notice) is built in `apps/desktop` and `packages/ui`.

One pull request each. Stages 0 to 5 are Althar's; 6 to 8 are upstream and
run in parallel.

0. **Amend rule 3**: the narrow usage read, ADR-055. Done.
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
   behind the usage-read rules of stage 0; faults visible; accounts with no source
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
- Anthropic's endpoint 429s under frequent polling and may answer "wait an
  hour": Althar asks it at most every five minutes, not while a session has
  just said its windows, and waits as long as it asks.
- The usage read (ADR-055) reads agents' tokens. It is the largest security
  change in this plan: it is kept in one module, with tests that nothing is
  written, logged or sent elsewhere.
- None of the endpoint reads was tried against a real account here: each
  follows Orca's working code (stablyai/orca `ef950401`), and the tests run
  them against fakes of the same shapes. Unconfirmed until someone signed in
  opens the usage view (Cmd/Ctrl+U) on this build: Claude Code idle (its
  token from the Keychain or `~/.claude/.credentials.json`), a second Claude
  account in its own home (its Keychain entry named for that home), Codex's
  `account/rateLimits/read`, Kimi Code and Grok Build.
- OpenCode's stored token for a provider may differ from the agent-native
  one (scope, expiry); each provider source needs its own spike.
- A Codex app-server started for a read must not refresh or write tokens
  beyond what Codex itself does.
- Windows are not fixed slots: classify by duration and type, not by
  `primary` or `secondary`.
