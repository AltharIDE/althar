# @charrette/provider-adapters — Architecture

The agent adapter of [docs/architecture/03](../../docs/architecture/03-agent-runtime-and-auth.md): one ACP implementation, the agent registry, and the contract every agent passes. The repository's [ARCHITECTURE.md](../../ARCHITECTURE.md) sets the general engineering target.

- **Owner:** Repository maintainers
- **Consumers:** the runtime, which owns sessions, records what happens, and answers permissions from the project's rules.
- **Dependency direction:** depends on `@charrette/domain`, `effect`, the ACP TypeScript SDK, and the two bundled adapters (`claude-agent-acp`, `codex-acp`) at pinned versions. It records nothing itself; persistence is the runtime's.

## What it holds

| Module | What it does |
| --- | --- |
| `registry.ts` | One entry per agent: how to launch it, its asking and read-only modes, its option ids, its sign-in commands, its known gaps |
| `AgentConnection.ts` | Connects over a process or in this process; starts sessions; streams turns; answers permissions; sets options; cancels |
| `process.ts` | Starts an agent as a process Charrette owns, in its own group, and stops it in stages |
| `events.ts` | Normalizes the agent's updates into Charrette's events |
| `failures.ts` | Classifies what went wrong, and reads when a usage limit resets |
| `signIn.ts` | Checks sign-in with each agent's documented status command |
| `testing/` | The scripted fake agent, in process and as a process |

## Principles

- **ACP is the transport; the domain never sees it.** Agent updates become normalized events, and SDK errors become tagged failures. A native side channel or a full native adapter can later replace ACP for one agent without the callers changing (ADR-002).
- **The registry is data, read from the agents.** Modes and option ids come from `scripts/probe.ts`, run against the real agents; each entry records when, and which versions. Probe again after an upgrade.
- **Sessions start in a mode Charrette chose** (ADR-007). A session never runs in the agent's default mode: on some machines Claude Code defaults to `bypassPermissions`, which approves every tool call without asking. The mode is set before anything else and checked; an agent with no way to set one is refused.
- **Answers are one-time.** A permission decision goes back as `allow_once` or `reject_once`. With no one-time option on offer, the request is cancelled rather than allowed always.
- **OpenCode is made to ask.** It allows most actions unless its config says otherwise, so it is launched with inline config (`OPENCODE_CONFIG_CONTENT`) that sets edits, commands and fetches to ask, overriding the project's own.
- **Never fatal on the unknown.** An update type or field this version doesn't know is kept as `Other`, with its raw payload.
- **The agent's own tool owns sign-in.** Status comes from documented commands (`claude auth status`, `codex login status`, `opencode auth list`), never from reading a credential store. When signed out, Charrette names the agent's own login command.
- **Processes are owned.** Each agent runs in its own process group. Stopping is TERM to the group, a grace period, then KILL. A process is never found by name.

## Checks

- `bun run check`: format, type-aware lint and type checks.
- `bun run test:coverage`: the contract (`tests/contract.ts`) against the fake agent, plus scenario and unit tests, gated at 90% of lines and branches. `src/testing` is test tooling and not counted. The process tests run the fake agent with Bun.
- `bun run test:agents`: the same contract against the real agents. It never runs in CI, because it needs sign-in and costs usage.

## Gaps

- **Account status side channels** (ADR-002): Claude's `rate_limit_event` and Codex's app-server rate limits are not read yet. Usage limits are recognised only from errors.
- **Loading and resuming sessions** are advertised by all three agents but not used yet.
- **Steering a turn in progress,** which Claude Code and Codex advertise, is not used yet; interrupt-and-continue is a cancel followed by a new prompt.
- **Raw protocol capture** to its own bounded file (docs/architecture/07) is not written yet.
- **Permission round trips with the real agents** are covered only by the fake agent so far; the runtime's tests will cover them end to end.
