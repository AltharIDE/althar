# Agent Runtime and Authentication

## Architectural decision

Charrette is an agent harness in the same sense that a workflow scheduler is a
job harness: it supplies durable intent, policy, lifecycle, recovery, and
evidence around execution. It is not a new foundation-model runtime.

The boundary is:

| Charrette owns | Provider runtime owns |
|---|---|
| Project, task, run, graph, attempts | Model request loop |
| Scheduling and host placement | Context window and provider compaction |
| Workspace preparation and repository grants | Provider-native tools and subagents |
| Policy, approvals, budgets, attention | Native conversation representation |
| Skill resolution and instruction bundle | Provider prompt/session mechanics |
| Normalized observations and retained evidence | Token refresh and provider account protocol |
| Restart reconciliation and repair | Provider-specific retry within one call/session |
| Cross-provider and cross-run record | Provider-native usage/accounting detail |

If Charrette implements both columns, it inherits the hardest and fastest-moving
parts of Codex, Claude Code, and every future provider while weakening the
durable project layer that differentiates it.

Charrette reaches every agent through one protocol, the Agent Client Protocol
(ACP), and adds native channels per agent only where ACP falls short
([ADR-002](../decisions/002-acp-for-every-agent.md)).

## Agents in the MVP

Claude Code, Codex and OpenCode are interchangeable from the first version. A
task's lead, any step and the coordinator can run on any of them, and a task
can move between them.

| Agent | How Charrette runs it | Sign-in, held by the agent | Notes |
|---|---|---|---|
| Claude Code | `claude-agent-acp`, the ACP project's adapter on the Claude Agent SDK. Claude Code has no native ACP | Claude plan or Anthropic API key; status from `claude auth status` | Starts in the user's own default mode, which can be `bypassPermissions`. The Agent SDK reports usage limits, but the adapter doesn't forward them |
| Codex | `codex-acp`, the ACP project's adapter, driving its own bundled Codex | ChatGPT plan or OpenAI API key; status from `codex login status` | Usage limits reach the adapter but are only rendered as `/status` text |
| OpenCode | `opencode acp`, native | API keys for any provider; local model servers; status from `opencode auth list` | The bring-your-own-key route. It cannot use a Claude plan. It allows most actions without asking unless configured, so Charrette starts it with inline config that makes it ask |

What each agent reports was read from the agents themselves on 28 September
2026, with `scripts/probe.ts` in `@charrette/provider-adapters`: claude-agent-acp
0.84.0, codex-acp 2.0.0 and OpenCode 1.18.31. All three expose their mode and
model as session config options and can change both within a session; all
three can load and resume sessions. Claude Code and Codex also advertise
steering a turn in progress, as an extension in `_meta`. Probe again after
upgrading any of them.

Charrette checks sign-in with each agent's documented status command, never by
reading a credential store, and tells the user the agent's own login command
when it is signed out. The Claude Code desktop app and the `claude` command
line sign in separately; the adapter uses the command line's sign-in.

Another ACP agent, such as Gemini CLI, is added by a registry entry and the
contract suite, not new code.

## Adapter contract

The domain depends on an internal `ProviderRuntimeAdapter`, not directly on a
vendor SDK, CLI schema, or ACP revision.

```ts
interface ProviderRuntimeAdapter {
  probe(request: ProbeRequest): Promise<ProviderInstallation>
  authenticate(request: AuthRequest): Promise<AuthResult>
  capabilities(request: CapabilityRequest): Promise<CapabilityReport>
  start(request: StartSessionRequest): AsyncIterable<ProviderEvent>
  resume(request: ResumeSessionRequest): AsyncIterable<ProviderEvent>
  respond(request: RespondRequest): Promise<void>
  configure(request: ConfigureSessionRequest): Promise<SessionConfiguration>
  cancel(request: CancelSessionRequest): Promise<CancelResult>
  inspect(request: InspectSessionRequest): Promise<ProviderSessionObservation>
  accountStatus(request: AccountStatusRequest): AsyncIterable<AccountStatus>
}
```

`configure` changes session settings such as the model and reasoning effort.
`accountStatus` reports usage limits for the signed-in account (see Usage
limits).

The adapter reports, rather than fakes, capabilities:

- structured events and their schema version;
- session/conversation resumption;
- streaming;
- tool-approval hooks;
- file and image attachments;
- model and reasoning selection, and whether it can change within a session;
- usage/cost reporting;
- account usage limits and reset times;
- cancellation and hard termination;
- live steering, queued input, and interruption acknowledgement;
- native subagents or handoffs;
- MCP configuration;
- skill/instruction injection;
- read-only and ask-first session modes;
- sandbox or execution-location claims;
- supported authentication modes.

Unsupported capabilities are explicit. Provider independence means capability
negotiation plus isolated translation, not erasing differences into an
unreliable lowest common denominator.

## Transports

ACP is the default transport. An adapter is one ACP session transport plus
zero or more native side channels for what ACP doesn't carry. The domain sees
the adapter's capability report, never which channel supplied a fact, so a
native adapter can replace ACP for one agent without the domain changing.

| Tier | Mechanism | Policy |
|---|---|---|
| A | ACP, spoken natively or through a maintained adapter | The default for every agent. Pin agent and adapter versions |
| B | A native structured protocol or SDK, such as Codex app-server or OpenCode's server | A side channel for what ACP lacks, or a full adapter for one agent when ACP falls short |
| C | Documented headless CLI with structured JSON/events | Supported with stricter lifecycle and compatibility tests |
| D | PTY/TUI scraping, undocumented local protocols, or another agent's private session files | Experimental only; never the default correctness path |

Charrette must never parse ANSI terminal presentation as its canonical event
stream. A terminal may be exposed as a user surface, but execution truth comes
from a documented structured channel or remains explicitly uncertain.

## ACP

ACP is the default because one implementation reaches every agent in the MVP,
and each later agent costs a registry entry rather than an integration. As of
September 2026 it covers:

- initialisation, protocol version and capability negotiation;
- authentication methods;
- creating and cancelling sessions, and loading them where the agent supports
  it;
- prompts and streamed updates: messages, tool calls, plans;
- permission requests, which Charrette answers (see Permission routing);
- session modes and config options, including the model selector
  (`session/set_config_option`);
- the MCP servers a session may use, given at `session/new`;
- context-window use and cost (`usage_update`).

It does not cover:

- usage limits and quotas, which the protocol leaves to a future proposal;
- steering a turn in progress, so interrupt-and-continue is a cancel followed
  by a new prompt ([01](01-concepts-and-project-model.md));
- moving history between agents: a session can only be loaded by the agent
  that created it.

ACP is still not Charrette's domain model:

- ACP is a client-agent transport, not a project, workflow, integration, or
  persistence model.
- Protocol drafts and capability growth must be quarantined inside an adapter.
  The protocol moves quickly; the model selector, for example, moved from an
  unstable method to session config options during 2026.
- Charrette needs durable graph and authority semantics even if every provider
  eventually speaks ACP.

The adapter converts ACP sessions and notifications into Charrette
`ProviderSession` and `Observation` records while retaining the raw protocol
version for diagnostics. ACP session identifiers are never promoted into
`Task` or `Run` IDs.

## The contract suite

Every agent adapter passes the same suite, against the oldest and newest
supported versions of the agent and its adapter:

1. initialisation and capability/version negotiation;
2. login-required and account-switch behaviour;
3. starting and, where supported, loading a session;
4. streaming update ordering;
5. permission request/response round trips;
6. changing the model within a session, or reporting that it can't;
7. cancellation versus process termination;
8. input queued during output and interrupt-and-continue behaviour;
9. crash behaviour during a tool action;
10. usage-limit recognition from errors, and account status where the agent
    has it;
11. unknown or added protocol fields;
12. bounded log retention and redaction.

## Agent registry

Each agent is a registry entry, not a code path:

```ts
type AgentRegistryEntry = {
  id: string // "claude-code", "codex", "opencode"
  launch: {
    source: "bundled" | "user_installed"
    command: string
    args: string[]
    pinnedVersion?: string
  }
  probe: ProbeSpec // installed, version, signed in
  sessionModes: { ask: string; readOnly?: string }
  sideChannels: SideChannelSpec[] // for example account status
  knownGaps: string[]
}
```

- Adapters Charrette ships, `claude-agent-acp` and `codex-acp`, are bundled at
  pinned versions. Nothing is fetched with `npx` or a similar tool at run
  time. Adapters written for Node run on Electron's own Node
  ([02](02-desktop-runtime.md)).
- Agents the user installs, such as OpenCode, are found by probe, and their
  version is checked against the support matrix.
- Adding an ACP agent means adding an entry and passing the contract suite.

## Where agent frameworks fit

The OpenAI Agents SDK, LangGraph, or another agent framework may later execute a
Charrette-authored agent node when Charrette itself owns that node's model/tool
loop.

They do not replace:

- Codex or Claude Code as full coding-agent runtimes;
- the project/repository/workspace model;
- external-system synchronization;
- the durable cross-run record;
- workflow authority and policy.

Use specialists or handoffs only when prompts, tools, or policies genuinely
differ. Spawning agents is not a substitute for decomposing a graph into
durable, observable nodes.

## Briefing agents

Charrette assembles every session's starting context. A new session learns
about the task only from its brief. No session depends on what another agent
remembered ([ADR-005](../decisions/005-charrette-briefs-every-agent.md)).

A brief contains, as the role needs:

- project rules and Charrette's instructions for the role: lead, step, or
  coordinator;
- the task, its plan, and where the graph stands;
- the workspace: base, branch, and the diff so far;
- the conversation record: the user's messages verbatim, earlier agents'
  turns, decisions, what was tried and failed, and open items;
- step results and artifacts the role needs;
- for a later review round, the earlier rounds' findings and how each was
  settled, with the lead's response and any person's decision
  ([05](05-workflow-engine.md));
- per-project instructions for a step type, such as `.charrette/review.md`.

The same brief starts:

- a lead on a new task;
- every step;
- the coordinator's session when it is rebuilt ([04](04-coordinator.md));
- a new attempt after a crash or retry;
- the new agent after a switch.

Rules:

- Charrette does not edit a repository's own instruction files (`CLAUDE.md`,
  `AGENTS.md`). Each agent still reads its own. The brief makes sure every
  agent also starts with the same project context. Since September 2026 Claude
  Code falls back to `AGENTS.md` only when no `CLAUDE.md` exists, so a
  repository with both still gives different agents different instructions.
- What fits goes in the first prompt. The rest stays readable through
  Charrette's tools (an MCP server given to every session at `session/new`), so
  the agent reads it when it needs it.
- The brief sent is recorded as an artifact on the attempt, so what an agent
  was told is always inspectable.
- Project knowledge, when memory is built, enters sessions through the brief.

## Switching model or agent

These are two different operations.

**Model, within one agent.** Changing Sonnet to Opus in Claude Code, or between
Codex models, keeps the session. The adapter sets the model config option
through ACP and the context carries over. The prompt cache is per model, so the
first turn after a switch costs more. An agent whose ACP can't change model per
session restarts with a different configuration and loads its session again
where it can, or the change is handled as an agent switch. None of the MVP's
agents needs this today.

**Agent.** A session can't move between agents. A switch starts a new session
on the new agent, in the same workspace, from a brief. The new session belongs
to a new attempt of the same node; the old session ends as `superseded`, and
its controller is fenced.

In the MVP the new agent takes over everything: the whole conversation record,
the plan, the open items, and the code as it stands. The record goes into the
first prompt as far as it fits, most recent first, and the rest is readable
through Charrette's tools. No model is needed to switch, so a switch is
immediate and works when the outgoing agent is out of usage.

This will be tuned. Candidates include a fresh take that leaves out the
previous agent's reasoning (research in 2026 suggests a stronger model does
better without a weaker model's trajectory), starting again from base rather
than the current code, and a generated handoff in the style of Amp's. Each is a
brief policy; the mechanism stays the same.

Rejected: converting one agent's session files into another agent's format so
its own resume picks them up. Those formats are private and change with each
release (Tier D), and provider-signed reasoning is lost either way.

## Usage limits

A usage limit belongs to an account (`ProviderPrincipal`), so it pauses every
session on that account at once ([05](05-workflow-engine.md)). ACP does not
report limits. Charrette detects them in two layers:

1. **From errors, on every agent.** Each adapter classifies a failed turn as
   `usage_limit`, with the reset time when the error carries one.
2. **From account status, where the agent exposes it.** A native side channel
   reports use per window and reset times before the limit is reached:
   - Claude Code: the Agent SDK's `rate_limit_event` gives status, use per
     window (five-hour, seven-day, per model) and reset times.
     `claude-agent-acp` doesn't forward it, so Charrette ships the adapter
     with a patch that forwards it as an ACP extension notification, and
     offers the patch upstream.
   - Codex: app-server's `account/rateLimits/read` and
     `account/rateLimits/updated`, through a small app-server connection used
     only for this.
   - OpenCode: the provider's rate-limit errors and retry hints. API keys have
     no plan windows.

```ts
type AccountStatus = {
  principalId: string
  state: "ok" | "warning" | "limited"
  windows: Array<{ kind: string; usedFraction?: number; resetsAt?: string }>
  source: "error" | "side_channel"
  observedAt: string
}
```

With account status, the scheduler can hold or move work before the limit is
reached rather than after.

## Provider session lifecycle

```mermaid
stateDiagram-v2
    [*] --> probing
    probing --> auth_required
    probing --> ready
    probing --> failed
    auth_required --> ready
    auth_required --> failed
    ready --> starting
    starting --> active
    starting --> failed
    active --> waiting_approval
    waiting_approval --> active
    active --> completed
    active --> cancelling
    waiting_approval --> cancelling
    cancelling --> cancelled
    cancelling --> uncertain: stop not confirmed
    active --> superseded: switched to another agent
    waiting_approval --> superseded
    active --> lost
    lost --> reconciling
    reconciling --> active: resumable and safe
    reconciling --> uncertain: external effect unknown
    reconciling --> failed: not resumable
    completed --> [*]
    cancelled --> [*]
    superseded --> [*]
    uncertain --> [*]
    failed --> [*]
```

The same lifecycle is data in `@charrette/domain` (`lifecycles.ts`), whose tests
keep it whole: every state reachable, and none left after a terminal one.

A provider session state does not directly set the run outcome. The workflow
node interprets normalized observations under its retry, verification, and
external-effect policy.

Every provider controller writes with the run attempt's
`controllerGeneration`. A stale controller may contribute attributable
diagnostic observations, but it cannot advance canonical state.

## Process ownership

For every child process, persist:

- executable identity and resolved version;
- adapter and protocol version;
- parent/child ownership identity;
- process-group/job-object strategy;
- start time and host identity;
- provider session ID if obtained;
- last observed event sequence;
- redacted launch arguments and environment allowlist digest;
- controller generation.

Cancellation is layered:

1. send provider-native cancellation;
2. wait a bounded grace period;
3. terminate the owned process group/job object;
4. verify liveness;
5. mark survivors and unknown effects explicitly.

Never kill by executable name or an unverified reused PID.

## Authentication model

Authentication is modeled with three concepts:

```ts
type ProviderPrincipal = {
  id: string
  provider: string
  subjectHint: string
  authMode: "vendor_cli" | "api_key" | "oauth" | "enterprise" | "workload"
  hostScope: string
  observedAt: string
}

type CredentialRef = {
  id: string
  owner: "vendor_cli" | "os_keychain" | "cloud_secret_store"
  locator: string
  exportable: false
}

type ExecutionGrant = {
  id: string
  principalId: string
  provider: string
  allowedHostId: string
  allowedProjectIds: string[]
  allowedOperations: string[]
  expiresAt?: string
  policyRevision: number
}
```

`ProviderPrincipal` records who Charrette believes the provider session
represents. `CredentialRef` points to the supported custodian; it is not a copy
of the credential. `ExecutionGrant` is Charrette policy authorizing use of that
principal for a bounded purpose.

### Vendor CLI and subscription login policy

Some providers offer a useful local CLI authenticated through a consumer or
team subscription but no supported API equivalent. Presence of that CLI is a
capability, not permission to extract or relay its session.

Rules:

1. The official CLI owns login, refresh, logout, and credential storage.
2. Charrette may invoke documented status/login commands or react to a
   structured `auth_required` response.
3. Charrette never reads, scrapes, copies, decrypts, exports, uploads, or
   synchronizes the CLI's credential cache.
4. It never asks for a provider password or browser session cookie.
5. Subscription-backed execution runs on the user's device and only where the
   provider's current documentation and terms permit that use.
6. Charrette cloud stores the fact that a device reports a capability, not the
   underlying subscription token.
7. Remote or hosted execution requires a provider-approved API key, OAuth
   grant, workload identity, service credential, or enterprise access token.
8. If no supported remote credential exists, the correct architecture is a
   local runner—not credential emulation.
9. Account switching is explicit and recorded. A run snapshots the observed
   principal and aborts or seeks approval if it changes.
10. Logging redacts tokens, authorization headers, cookies, device codes, and
    provider-defined secret fields before persistence.

This is both safer and more durable than coupling Charrette to the current shape
of a vendor's private auth cache.

### Claude plans in third-party apps

Anthropic's rules for using a Claude plan through other apps changed three
times in 2026. Third-party use was blocked on 4 April. A separate, smaller
credit was then announced for 15 June, and paused on 15 June. As of 28
September 2026, Agent SDK and third-party app usage draws on the plan's normal
limits, and Anthropic says it will give notice before changing that.

Charrette running Claude Code through `claude-agent-acp` counts as third-party
use. Check the policy again before relying on a Claude plan beyond the proof of
concept; an Anthropic API key, through Claude Code or OpenCode, is the fallback.
Plan sign-in works only in Claude Code and claude.ai, so OpenCode cannot use a
Claude plan.

### API keys and OAuth

When a provider supports programmatic credentials:

- use the OS keychain locally;
- store only a keychain locator in SQLite;
- scope environment injection to the single owned child;
- never forward the entire parent environment;
- redact command lines and diagnostics;
- support revocation and key rotation;
- require cloud-side secret storage for cloud runners;
- show which principal, billing context, and host will be used before execution.

Keys the user gives Charrette for OpenCode follow these rules: they are kept in
the Keychain and injected only into that OpenCode child's environment. Keys
OpenCode already holds stay with OpenCode.

Device authorization and OAuth callbacks must use the provider's documented
native-app flow. A local loopback callback or claimed HTTPS scheme requires
state/PKCE validation and exact redirect handling.

## Capability and support matrix

Each released adapter declares:

- minimum/maximum tested runtime versions;
- protocol/schema versions;
- operating systems and architectures;
- authentication modes;
- supported and degraded features;
- known unsafe or blocked versions;
- last compatibility-test date.

At launch:

1. resolve the executable without trusting repository-local PATH shadowing;
2. inspect version and signature/provenance where practical;
3. perform a cheap capability handshake;
4. compare against the matrix;
5. choose supported, degraded, or blocked behavior;
6. persist the actual result with the run.

Automatic provider upgrades must not silently change an in-flight run's
adapter semantics. An app update can add support, but active sessions stay tied
to the adapter/protocol version with which they began.

## Permission routing

Charrette must see every permission request to apply the project's rules,
including the always-ask list
([ADR-007](../decisions/007-permission-requests-reach-charrette.md)).

- Every session starts in a mode where the agent asks rather than acts. No
  session starts in a bypass mode. Requests arrive as ACP
  `session/request_permission`. The session records how it was started: the
  mode, and the MCP servers and tools its role was given.
- Charrette answers with a one-time option only. If it offered an agent
  "allow always", the agent could remember the rule itself, and later requests
  would stop reaching Charrette. A standing allow is Charrette's own rule,
  recorded with the decision, and applied by Charrette.
- Charrette answers from the project rules. Nearly everything is allowed
  without the user; only what the rules keep for the user becomes an attention
  request. Every answer is recorded on the task, and the thread shows allowed
  requests as one quiet line.
- A session with a read-only role, such as the coordinator or a review step,
  starts in the agent's read-only mode where it has one (for example Claude
  Code's plan mode, Codex's read-only sandbox, or OpenCode's plan agent), and
  the rules deny it writes as well.
- Known gap: an agent's own user-level settings, such as allow rules in the
  user's Claude Code settings, can approve an action before Charrette sees it.
  The always-ask list cannot be enforced against those.

## Approval boundary

Provider-native permission prompts are inputs to Charrette policy, not a
replacement for it.

An `ApprovalRequest` records:

- normalized action and parameters;
- action digest;
- affected repositories, paths, tools, external systems, and credentials;
- relevant diff/artifact/input hashes;
- provider session and workflow node;
- policy revision and reason;
- expiry and one-time/multi-use behavior.

The `Decision` records actor, outcome, reasoning, time, and consumption. If an
input or action changes, the digest changes and the decision no longer applies.

Examples requiring Charrette-level handling include:

- destructive Git operations;
- external messages, issue transitions, deployments, or merges;
- using a new repository binding or MCP server;
- introducing a skill script;
- increasing budget or loop bounds;
- graph patches that expand authority.

## Repository and prompt trust

Repositories, issue bodies, tool output, MCP responses, provider messages, and
skills are all untrusted input.

Controls:

- do not place provider credentials in a repository workspace;
- do not let repository content alter the runtime's adapter configuration
  without a reviewed project policy path;
- delimit source-derived instructions and record their origin;
- constrain Charrette-owned filesystem operations to registered roots;
- allowlist child environment variables;
- require explicit grants for MCP tools and external mutations;
- record the exact brief, skills, and instructions sent to the agent;
- treat provider claims about completed actions as observations until verified.

Host-native execution uses the current user's OS authority and must be labeled
**trusted-host execution**, not “sandboxed”. Container or remote sandbox support
is a separate `ExecutionHostAdapter` with its own capabilities.

## Failure semantics

The adapter classifies failures without collapsing them:

| Class | Example | Default response |
|---|---|---|
| `auth_required` | Logged out or expired grant | Pause and request authentication |
| `unsupported_version` | CLI schema outside support matrix | Block or degraded mode; never guess |
| `transient_provider` | Short rate limit or temporary network failure | Bounded retry with jitter and provider hint |
| `usage_limit` | The account's allowance is used up until a reset | Pause every session on that account; move or hold work under the project rule |
| `invalid_request` | Unsupported model/tool option | Fail node with actionable detail |
| `provider_refusal` | Policy refusal | Record terminal provider outcome |
| `process_lost` | Child vanished | Reconcile session and external effects |
| `cancel_uncertain` | Kill issued but effect unknown | Attention/verification before retry |
| `protocol_violation` | Malformed or impossible event sequence | Quarantine adapter/session and retain redacted diagnostics |

The UI displays the consequence and recovery options, not raw stack traces or a
single generic “agent failed” label.

## Verification gates

- No test obtains a provider token by reading a vendor credential cache.
- Logging and diagnostic export contain no seeded secret canary.
- Supported CLI versions pass the same contract suite.
- Unknown event fields do not crash the adapter; impossible transitions do.
- Provider restart and Charrette restart are tested at every lifecycle boundary.
- Provider-native steering, where present, preserves Charrette's durable input
  order; where absent, cancellation plus resume/new turn preserves the same
  interrupt-and-continue semantics.
- A stale controller cannot advance state after replacement.
- Cancellation kills the complete owned process tree on every target OS.
- An account switch invalidates the prior execution grant.
- A provider without resume support cannot be presented as resumed.
- Host-native execution is never labeled sandboxed.
- Claude Code, Codex, and OpenCode pass the same contract suite.
- No session starts in a bypass mode; every permission request reaches
  Charrette.
- Switching to another agent keeps the workspace and hands over the whole
  record, and the superseded session cannot write afterwards.
- A usage limit is recognised on every agent from its error, and before it is
  reached on agents with account status.
- Every session's brief is recorded.

## References

- [Agent Client Protocol](https://agentclientprotocol.com/)
- [ACP session config options](https://agentclientprotocol.com/protocol/session-config-options)
- [ACP session usage RFD](https://agentclientprotocol.com/rfds/session-usage)
- [claude-agent-acp](https://github.com/agentclientprotocol/claude-agent-acp)
- [codex-acp](https://github.com/agentclientprotocol/codex-acp)
- [OpenCode ACP support](https://opencode.ai/docs/acp/)
- [Codex app-server](https://learn.chatgpt.com/docs/app-server)
- [Codex authentication](https://learn.chatgpt.com/docs/auth)
- [Use the Claude Agent SDK with your Claude plan](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)
- [Amp: Handoff](https://ampcode.com/news/handoff)
- [The Handoff Tax (arXiv 2608.24358)](https://arxiv.org/abs/2608.24358)
- [OpenAI Agents SDK orchestration](https://developers.openai.com/api/docs/guides/agents/orchestration)
- [OAuth 2.0 for native apps, RFC 8252](https://www.rfc-editor.org/rfc/rfc8252.html)
