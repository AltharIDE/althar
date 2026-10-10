# @althar/provider-adapters — Architecture

The agent adapter of [docs/architecture/03](../../docs/architecture/03-agent-runtime-and-auth.md): one ACP implementation, the agent registry, and the contract every agent passes. The repository's [ARCHITECTURE.md](../../ARCHITECTURE.md) sets the general engineering target.

- **Owner:** Repository maintainers
- **Consumers:** the runtime, which owns sessions, records what happens, and answers permissions from the project's rules.
- **Dependency direction:** depends on `@althar/domain`, `effect`, the ACP TypeScript SDK, and the two bundled adapters (`claude-agent-acp`, `codex-acp`) at pinned versions. It records nothing itself; persistence is the runtime's.

## What it holds

| Module | What it does |
| --- | --- |
| `registry.ts` | One entry per agent: how to launch it, its asking and read-only modes, its option ids and what its permission options mean, what keeps it asking, its sign-in commands, its known gaps |
| `AgentConnection.ts` | Connects over a process or in this process; starts and closes sessions; runs turns one at a time; answers permissions and questions; sets options; cancels |
| `process.ts` | Starts an agent as a process Althar owns, in its own group, with an allowlisted environment; captures the raw protocol; stops it in stages and reports survivors |
| `events.ts` | Normalizes the agent's updates into Althar's events: words, what a message or a tool call hands back (pictures, links, resources), the files a call writes (a path, and whether it is new, never the text), and a command's output and exit from `_meta` |
| `failures.ts` | Classifies what went wrong, and reads when a usage limit resets |
| `signIn.ts` | Checks sign-in with each agent's documented status command |
| `testing/` | The scripted fake agent, in process and as a process |

## Principles

- **ACP is the transport; the domain never sees it.** Agent updates become normalized events, and SDK errors become tagged failures. A native side channel or a full native adapter can later replace ACP for one agent without the callers changing (ADR-002).
- **The registry is data, read from the agents.** Modes and option ids come from `scripts/probe.ts`, run against the real agents; each entry records when, and which versions. Probe again after an upgrade.
- **Sessions start in a mode Althar chose** (ADR-007). A session never runs in the agent's default mode: on some machines Claude Code defaults to `bypassPermissions`, which approves every tool call without asking. The mode is set before anything else and checked; an agent with no way to set one is refused.
- **Answers are the narrowest that carry the decision out.** Allow is for this action, or for the rest of the turn where the agent offers nothing narrower. Reject skips the action and lets the agent carry on; where the only rejection stops the turn, the adapter resumes it with the reason. Never an "always" option. What each option id means is the registry's, since agents give the same ACP kind to options that do different things.
- **Coordinator refusals carry their reason.** Because ACP has no portable denial-reason field, these are explained at the next turn boundary even when the agent's rejection carries on, with the coordinator named as the decider. A person's cancellation suppresses continuation; explanations retain the existing three-resume bound.
- **Judges require a separate tool-free capability.** `permissionJudge.sessionMeta` is present only where the pinned adapter can remove built-in tools, exclude own MCP servers and disable user hooks. Claude Code uses `tools: []`; Codex and OpenCode are not enabled. A read-only mode or an empty cwd alone cannot prevent a model from reading files elsewhere (ADR-019).
- **Every agent is made to ask, whatever its own settings say.** Claude gets ask rules, has bypass turned off, loads only the MCP servers Althar gives it, and runs its shell in its sandbox, per session; Codex runs in `workspace-write`, never its auto-review `agent` mode; OpenCode gets inline config (`OPENCODE_CONFIG_CONTENT`). `test:agents` checks each against a repository whose settings allow everything and whose hook approves every tool call.
- **One inbox per session.** Updates, permission answers and prompt endings go into it the moment they arrive, and one reader takes from it, so events keep the order the agent sent them in.
- **Althar asks for command output** (`terminal_output_delta` in its client capabilities, beside the AIR failure extension that makes both bundled adapters treat it as JetBrains AIR, which hears no output unless it asks): Codex streams it in chunks, Claude Code sends it whole when the command ends, each with its exit code; OpenCode says it as the tool's own text content (ADR-020).
- **Never fatal on the unknown.** An update type or field this version doesn't know is kept as `Other`, with its raw payload.
- **The agent's own tool owns sign-in.** Status comes from documented commands (`claude auth status`, `codex login status`, `opencode auth list`), never from reading a credential store. When signed out, Althar names the agent's own login command.
- **Processes are owned.** Each agent runs in its own process group, with only an allowlist of Althar's environment; provider API keys are not on it. Stopping always signals the group, even after the agent has exited: TERM, a grace period, then KILL, and survivors are reported. A process is never found by name; its OS start time is recorded to tell it from a later process with the same pid.

## Checks

- `bun run check`: format, type-aware lint and type checks.
- `bun run test:coverage`: the contract (`tests/contract.ts`) against the fake agent, plus scenario and unit tests, gated at 90% of lines and branches. `src/testing` is test tooling and not counted. The process tests run the fake agent with Bun.
- `bun run test:agents`: the same contract against the real agents. It never runs in CI, because it needs sign-in and costs usage.

## Gaps

- **Account status side channels** (ADR-002): Claude's `rate_limit_event` and Codex's app-server rate limits are not read yet. Usage limits are recognised only from errors.
- **Loading and resuming sessions** are advertised by all three agents but not used yet.
- **Steering a turn in progress,** which Claude Code and Codex advertise, is not used yet; interrupt-and-continue is a cancel followed by a new prompt.
- **Raw protocol capture** is handed to the caller frame by frame; writing it to its own bounded file (docs/architecture/07) is the runtime's.
- **Claude hooks** in the user's or repository's settings can decide a tool call; that path is not checked yet.
