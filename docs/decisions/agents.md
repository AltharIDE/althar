# Agents

How Althar runs coding agents: the protocol it speaks to them, which agents join, the accounts they run on, how a session is briefed, how a model is picked, how context is kept small, and how plan usage and a task's cost are read.

**Replaces:** ADR-002, ADR-005, ADR-012, ADR-015, ADR-033, ADR-038, ADR-039, ADR-050, ADR-062, ADR-084

## ACP for every agent

Althar connects to every agent through the Agent Client Protocol (ACP), behind its own adapter interface (`AgentConnection`, in `@althar/provider-adapters`). This makes agents interchangeable, and makes another agent a registry entry plus the contract suite rather than an integration of its own. Althar runs no model loop of its own, which is also what lets it run on the person's Claude and ChatGPT plans.

- **How each agent runs:** Claude Code through `claude-agent-acp` and Codex through `codex-acp`, both bundled at pinned versions; OpenCode through `opencode acp`; the others through their own ACP servers.
- **Where ACP falls short,** an agent gets a side channel, such as Codex's app-server, or a patch to its adapter. The domain stays the same either way.
- **Usage limits** are recognised from errors on every agent, and from account status where the agent gives it. Claude Code gives it through the Agent SDK's `rate_limit_event`, which Althar's patch to `claude-agent-acp` forwards (`patches/`). Codex gives it through its app-server.
- **ACP doesn't carry** plan windows, steering in the middle of a turn, or history moving between agents. The adapters for Claude Code and Codex are maintained outside their vendors.

How sessions, processes and sign-in work is in [architecture 03](../architecture/03-agent-runtime-and-auth.md).

## Which agents join

An agent joins where Althar sees every command before it runs and can stop it. That is what keeps the irreversible list asking and the person's Never rules holding ([what-agents-may-do.md](what-agents-may-do.md)). In practice that means:

1. **It asks before it runs a command.** A mode or a session's `_meta` that Althar sets and checks keeps it asking. Edits inside the workspace may go unasked, as Codex's do in its sandbox.
2. **It has a reading mode,** for a review: a mode keeps Althar's tools and takes the agent's edits away, or its edits ask, so the rules refuse them. One whose sandbox runs commands without asking, as Codex's does, still leads reviews: what it runs stays in its OS sandbox ([reviews.md](reviews.md)).
3. **It was read at the version the ACP registry lists,** with permission options of known kinds.
4. **Its vendor lets a third-party app use its sign-in,** or publishes it for any ACP client. Where the two disagree, the person is told before they sign in.

Eleven connections join: Claude Code, Codex, OpenCode, GitHub Copilot, GitHub Copilot CLI, Junie, Grok Build, Kimi Code, Mistral Vibe, Qwen Code and Google Antigravity. The person's own install normally runs where present; native Copilot uses a managed OpenCode engine. Althar can download engines whose licenses allow it. Each entry's `knownGaps` says what it does differently.

Settings also offers [external ACP connections](../plans/acp-catalog.md): registry discovery and custom commands, including twelve setup profiles. These are unavailable until a person runs a version-bound compatibility check. A profile's presence does not qualify its agent as a built-in adapter or waive the requirements above. Generic connections have one existing sign-in, no selected skills or permission-judge role, and cannot lead untrusted repository reviews.

- **Google Antigravity** runs Google's own ACP server (`agy_acp_server.par`), as Orca runs it. Althar downloads it from Google only when the person asks, pinned by sha256, and there is no Windows build. Google's terms may count signing in from a third-party app as a breach, while Google lists the server for other editors. The sign-in says so before the person picks it.
- **What holds an agent is data in its registry entry,** not code of its own. For example:
  - `options.held` keeps an option at a value for the session's life, such as Copilot's `allow_all` or Junie's `brave_mode`.
  - `modes` may be null for an agent that asks by `_meta` (Grok).
  - `home.accounts: 'one'` keeps an agent whose sign-in every folder shares to its usual account.
  - `permissions.questions` marks tool calls on which a permission request is the model asking the person.
  - `cli.download` pins a download from its maker.
  - `ownHelpers` says how its launch switches off its own helpers that would work in the background, and what it keeps within a turn, or why they stay on ([tasks § Helpers](tasks.md#helpers)).
- **Four agents wait,** each for a reason that can change:
  - Cursor: its current build hasn't been probed signed in.
  - Devin: no mode asks before an edit.
  - Factory Droid: its `Script` tool never asks over ACP.
  - Auggie: nothing asks unless each tool is named at launch, and its license forbids building it in without permission.

  `scripts/probe.ts` probes them.

Not built yet: a `/` command the person types goes to the agent as typed. Copilot's and Grok's entries still send such messages as plain words (`commands: 'althar'`), which keeps the person from typing `/yolo` or `/always-approve`. Althar's own `/compact` goes through as a command.

None of the six newer agents has run a signed-in contract run against its vendor's models yet (`bun run test:agents`).

## The Node the adapters run on

The packaged app ships the official Node build, at Electron's own Node version. It sits at `Contents/Resources/node/bin/node` (`resources/node/bin/node` on Linux, `node.exe` on Windows), and the bundled adapters run on it. `scripts/node.ts` pins it by SHA-256, and packaging refuses an archive that doesn't match.

- **Electron's `runAsNode` fuse is off,** so no process can run Althar's signed binary as Node, under Althar's identity and with the permissions the person gave Althar, such as the microphone.
- **Adapters still start as Althar's own processes:** detached in a process group of their own, so the staged stop, the survivors report and clean-up after a crash all work. Electron's utility processes can't lead a process group or take a piped stdin, which is why they aren't used here.
- **What the adapters start runs on the same Node.** Codex's sign-in, status and version run Codex's native binary where the person has no Codex of their own.
- **Each executable is signed with only the entitlements it needs** (`scripts/entitlements.ts`). The shipped Node gets only JIT, plus unsigned executable memory on Intel.
- **In dev and tests** the adapters run on Electron's binary as Node, with the fuse on there.

The cost is about 120 MB unpacked (about 40 MB to download), and one more runtime to patch. A Node security release means raising `NODE_VERSION` and its digests, and raising Electron means raising Node with it.

## Copilot without Copilot CLI

**Decision, 13 November 2026. Owner: repository maintainers.** GitHub Copilot is a native connection in Althar, backed by a managed OpenCode engine. GitHub supplies the models; OpenCode supplies OAuth and the agent loop, over Althar's existing ACP boundary. It does not run GitHub Copilot CLI. The existing `copilot` connection stays as **GitHub Copilot CLI**, so existing accounts and work keep their identity. The new connection is `copilot-direct`.

- **Sign in inside Althar.** Continue with GitHub uses github.com for personal and work accounts alike. A separate enterprise-address field accepts a hostname or HTTPS origin only. OpenCode's own non-interactive `auth login github-copilot --standalone --method device --answer …` owns the device flow and credentials. The code is shown and copyable while the browser opens. The screen says GitHub will ask to authorize OpenCode.
- **Prepare it at the person's asking.** Continuing downloads a verified OpenCode 2.x engine where needed, through the existing installer. A personal OpenCode install never stands in for this engine. Cancelling during preparation prevents OAuth from starting afterwards; a failed preparation stays in the sign-in with a way to try again.
- **Keep accounts apart.** Its usual account is under Althar's accounts root, and additional accounts each have their own home. No OpenCode credential or configuration file is copied into them. Both OAuth and work use private engine processes. The engine's cache and ordinary global configuration still follow OpenCode's normal locations.
- **Offer only Copilot.** Inline `enabled_providers: ['github-copilot']` is preserved when adding skills, web permissions or review hardening. OpenCode turns this into provider-use policies, discovers the account's endpoint and allowed models, and applies GitHub's access decisions. Every command and edit still reaches Althar's normal permission handling.
- **Confirm completion.** A successful login process is followed by a fresh account status read before the screen says it is signed in. An unrelated provider's credential does not establish Copilot access.

This avoids a dependency on the enterprise's **Copilot CLI** permission. It does not override enterprise restrictions on OAuth applications, Copilot Chat, models, SSO or network access. Each organization may need to approve OpenCode's application. A live login and prompt on a CLI-disabled enterprise account remain a release validation step where no such account is available in development.

**Alternatives:** owning a model loop would duplicate OpenCode's tools and approval integration; using the Copilot SDK would retain its runtime and an unverified policy dependency. Revisit the managed engine when GitHub publishes a suitable standalone model integration or maintaining the engine costs more than a native runtime.

Reference: [OpenCode's Copilot provider](https://github.com/anomalyco/opencode/blob/f91b88efac039856f284979984ac43cd93bce8f5/packages/core/src/plugin/provider/github-copilot.ts), read against OpenCode 2.3.0's CLI and configuration. OpenCode is [MIT licensed](https://github.com/anomalyco/opencode/blob/f91b88efac039856f284979984ac43cd93bce8f5/LICENSE).

## Accounts

An **account** is one sign-in of an agent, in its own folder: its **home**. The agent's usual folder is its first account, so someone with one sign-in sees no change. Each session starts with its account's home in the agent's environment (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `XDG_DATA_HOME` for OpenCode), and records which account it ran on. Many people have a work and a personal plan, or a plan per client, and this lets several run at once without swapping one sign-in.

- **Adding an account** makes a home and runs the agent's own sign-in in it. Where the agent lets it, Althar runs the login and shows its steps in the window. Elsewhere, and always as a choice, it opens in a terminal. Either way the agent keeps the credential: a pasted code only passes through Althar, and Althar never reads the agent's credential store, with the one exception for usage reads ([below](#reading-plan-usage)).
- **What isn't the account's own is linked into its home** as each session starts: the person's settings, instructions and skills, and for OpenCode the rest of the data folder every program uses. That way every account works the same.
- **A home stays where it was made**, because Claude Code ties its Keychain item to the folder's path.
- **Removing an account** Althar made signs it out with the agent's own tool and deletes the folder. A home another tool made is adopted as it is, and left alone when removed.
- **Switchers that swap one live sign-in** are the person's to run. Whatever they made active is the first account, and the sign-in check records a swap. Switchers that rotate inside the agent or in front of it work unchanged, as one account.
- **Every account the person adds can run work. A project may narrow that** to some accounts per agent, such as a client's repository to the client's plan.
- **Automatic account switching starts with least depleted first.** The project's account rules can choose another strategy or stay on the first account explicitly. With it on, work moves to the same agent's next allowed account when one runs out, on the same model, in a new session from a brief. Then, or without rotation, it moves to the next agent. Failing over between someone's personal plans is something providers' terms tend to restrict, so Althar doesn't do it unasked.
- **Picking an account:** Settings → Tasks offers five strategies for new projects, with an action to apply a choice to existing projects: stay on the first account, least depleted first, most depleted first, random, or account order. Each project can choose its own strategy. Projects without an explicit account rule use least depleted first; an explicit first-account rule stays fixed. The other strategies skip accounts that are signed out or out of usage. Before automatically lowering a requested model at 10% remaining, Althar tries an allowed account with more room, respecting the selected strategy. Usage is measured by the model's tightest live window. Unread accounts remain usable. Settings order breaks quota ties. Random chooses once for a new conversation, not per message. A running conversation stays on its account while it has room.
- **Another agent takes work over unasked only on an account a plan pays for.** The same agent's other accounts take it over whatever pays for them, since the person added each one. The thread names the account on both sides of a move.

## Briefs, and switching agent or model

Every session starts from a brief Althar assembles and records. That covers the lead, every step, the coordinator's rebuilt session, retries and switches. Knowledge enters a session through the brief, and Althar never edits a repository's own instruction files (`CLAUDE.md`, `AGENTS.md`).

- **Changing model within an agent keeps the session,** through ACP's model option.
- **Changing agent starts a new session** on the new agent, in the same workspace, as a new attempt of the same step. A task's lead and team can be changed at any time ([tasks.md](tasks.md)).
- **The new agent takes over everything.** The whole record goes into its first prompt as far as it fits, and the rest is readable through Althar's tools. No model call is needed to switch. A generated handoff summary is a candidate for later tuning.

## How models are picked

People choose who does work by model, not by the tool that runs it. The coordinator picks a model for each step, and an agent is only a route to it.

- **The person's preferences come first.** They are kept in the project's notes, and the coordinator reads them there:
  - Design and UI work is led by a Claude model.
  - Prototypes run on Claude Opus 5.5, at xhigh effort for anything medium-sized or larger and at medium only for a simple one.
  - Reviews go to GPT-6.1 Sol or Terra, with Sol at medium for large or risky changes.
  - DeepSeek V4.1 Flash on OpenCode Go is the backup for reviews and for design, UI and prototype work, for when Claude or GPT usage is tight or out. OpenCode Zen is only the backup for Go.
  - GPT Luna is never used.
- **Within those, the coordinator picks by what the step needs.** It uses the strongest models for large, risky or open-ended work and a quicker one for small, well-scoped work. It prefers a plan over a key where both would do, and a reviewer from a different maker than the lead where there is one.
- **`list_models` gives every model Althar can use now,** once each, grouped by maker: every model of every agent that is signed in and not out of usage, apart from the ones the person switched off. An agent's own default stands for the model it is. `propose_plan` names each step's model and effort.
- **What is known of models comes from OpenRouter's public list:** Artificial Analysis's indices, price and context size, matched by id or name. It is read at start and fetched again in the background, and nothing waits for it. The scores are for the coordinator, and the window doesn't show them.
- **Agents are routes.** Althar reaches a named model the best way there is: on an agent whose account a plan pays for before one on a key, then in the agents' order.
- **When a step's agent runs out,** the step goes to the strongest free model on a plan. A different maker wins within five points of the strongest. Althar never spends on a key unasked ([scheduling.md](scheduling.md)).
- **The person can switch models off,** per agent, in Settings and from the model browser. A model switched off is never planned, and no picker offers it. Work that names no model, only its agent, never starts on one: where the agent's own default is a model switched off, its session starts on the agent's model a takeover would pick, or, before Althar has read the agent's models, the first other one it lists. With none left on, it doesn't start, and says why.
- **The window names who works by model,** as people know it, such as "Claude Sonnet 5.5", with its maker's mark. The agent and account show on hover. Agent names appear only where the agent is what's meant, such as signing in.

## Keeping context small

Every call reads the whole context again, so long sessions cost most of the usage. A lead is started afresh only once its context is full, and the person can compact any agent at once. The coordinator's own handover is in [coordinator.md](coordinator.md).

- **A lead is handed to a fresh session between turns, never during one.** It keeps the same agent, account, model and effort, and is briefed from the task as any agent taking it over is. The thread shows a quiet line ("Started Claude Code afresh.").
- **When:** only once its context is full: before a turn, once it's past 200,000 tokens or 80% of its window, whichever comes first (`packages/runtime/src/handover.ts`). A break hands nothing over at any size, whether its last turn finished a step or round, made its task a change, or it sat idle past its prompt cache's life. Coming back to a task after a pause carries the conversation on, with all the lead knows of the work.
- **The cost:** after a pause longer than its prompt cache's life, the next message reads the whole context at full price. The context ring shows the size, and Compact is one press away.
- **It happens lazily,** only when the lead has a turn to take, so a finished task costs nothing.
- **Some leads are left as they are,** and their agent compacts on its own:
  - one whose left-running processes are still going, since closing its session would stop them;
  - one where the brief would save little.

  A reviewer is never handed over, because its session spans the review's rounds.
- **Compact is in the context ring's detail,** for a task's agent and the coordinator alike. It sends the agent's own `/compact` as a turn of its own, never waits for a place among the agents at work, and the thread says how far it took the context ("412k → 38k tokens"). A handover that falls due waits for it.

## Reading plan usage

Althar shows how much of each plan's windows is left, and steers new work away from an account that is nearly out. ACP doesn't carry plan windows, so Althar reads them from the agent first: Claude's live `_meta`, Codex's app-server, and OpenCode's own server for OpenCode Go. Where the agent says nothing, Althar may make one **usage read**. That is the single exception to the rule that Althar never reads an agent's credentials.

- **What a usage read may do:** read one account's access token into memory, from where its agent keeps it, and make one `GET` to that provider's usage URL with it. It then parses the answer into windows and drops the token.
- **What it may never do:**
  - write, refresh, copy, cache, log or show the token, or send it anywhere else;
  - follow a redirect;
  - read another field, apart from an account id the provider asks for;
  - change anything in the agent's home or keychain.
- **The URLs are fixed in the registry** (`usageSources.ts`), and a source off the list is refused. The list is Claude Code's `api.anthropic.com/api/oauth/usage` with Claude Code's own sign-in, Codex's `chatgpt.com/backend-api/wham/usage` (only where its app-server can't answer), Kimi Code's, and Grok Build's. The person decided Anthropic's endpoint may be read this way, as Orca reads it.
- **Rate:**
  - at most one call per account a minute, and one every five minutes for Anthropic's;
  - none for Claude Code while a session has reported its windows in the last five minutes;
  - a 429 waits as long as its `Retry-After` says.
- **Failures show as what they are:** "sign-in expired" (the agent renews it, never Althar), "the usage source changed", or "can't reach it". They never show as zeros or "no limits".
- **One module opens a credential store** (`credentialStore.ts`), imported only by the reader. A contract test (`usageSources.test.ts`) holds all of the above. Tests and the end-to-end app read no real sign-in.
- **Not read:** Copilot, Junie, Mistral Vibe, Qwen Code, Antigravity, and OpenCode's other plan sign-ins. Each says why in the registry, and their limits are still recognised when they hit.

## What a task used

People asked what a task cost. What they want to know is how much of each subscription it took and how much of each top-up it spent, so Althar shows that and no total. Adding a share of a week to dollars means nothing.

- **One line per account the task's agents ran on,** named as the plan gauge names it, with the models and their tokens under it (each model's own tokens where several ran, as a lead's helpers do), and its figure at the end. On a plan the figure is its share of the week ("~8% of week"). Paid per use, it is dollars. Nothing is shown per step or per round.
- **An agent that reaches several providers has a line for each** (OpenCode Zen, OpenCode Go), since each is paid its own way. ChatGPT through OpenCode shares Codex's week and is never counted twice.
- **A dash says why on hover** where a figure can't be known.
- **A task's line covers every thread of the task,** its reviews included, across handovers. The coordinator's covers its conversation since this computer's midnight.
- **It shows in the context ring** ("This task so far" or "Today") and as a Usage card in a task's Outputs. The card is closed by default, and remembers being opened or closed for every task.
- **The share of a week is an estimate.** Each time an account's week moves, the reading is kept (`plan_usage_weeks`). The rise between two readings is shared among the turns that ran between them, by their tokens. Only time the turns ran counts, where readings are far apart, and only a rise past the week's highest reading yet counts.
- **Dollars are what the agent reported** (`reported_cost`). Where it reported nothing, Althar prices the tokens at the model's list prices, shown as an estimate ("~$1.24").

## Changes

- 8 Nov 2026: written from the ADRs under Replaces.
- 9 Nov 2026: a lead starts afresh only once its context is full, never at a break (a task is a conversation plus parts, [tasks](tasks.md#changing-parts)).
- 10 Nov 2026: a lead's helpers, on any model it picks with `list_models`, each handed one of its task's changes ([tasks](tasks.md#helpers)).
- 10 Nov 2026: each agent's own helpers that would work in the background are switched off at its launch, and a task's usage says each model's tokens (ADR-087, [tasks § Helpers](tasks.md#helpers)).

- 13 Nov 2026: account selection is a choice of strategies in Settings and project rules. Model pickers show models and effort; account quota stays in Plan usage. Keep model records its next-turn choice immediately; a work headline excludes queue and startup time and never joins separate model turns across an idle gap.
