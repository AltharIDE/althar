# External ACP connections

Settings → Agents now has a catalog and a custom executable/argument editor. The
catalog reads the public ACP registry on request, retains its last successful
response offline, and starts with twelve setup profiles: Cursor, Gemini CLI,
Goose, Pi, Oh My Pi, Kiro, Muse Code, Cline, Kilo, Mastra Code, Hermes, and Letta.
Browsing does not install or start a process. Registry npm and Python launches
name their exact published version. Binary entries use an existing installation;
this change does not download or unpack registry archives.

These profiles are starting configurations, not twelve newly qualified built-in
adapters. A saved command remains unavailable for work until the person starts
its live compatibility check. That check uses a disposable folder and the
agent's own account, so it may spend model tokens. It requires a reported version,
actual HTTP MCP calls in both lead and reader sessions, permission requests for
both a harmless command and a writing command, obedience to their refusals, a
reader that can read but cannot perform a refused edit, and confirmed
cancellation. Unknown modes fail with the available identifiers so the person can
correct the configuration. It times out and stops the process on failure or
cancellation. This is a bounded behavioral check, not proof of every tool path or
of changes to the agent's configuration after the check.

Only a successful connection enters the runtime's existing agent, account and
model lists. Its process is recorded before launch. Its reported version must
match on every later connection; an update requires checking again. Editing a
connection clears its qualification. Running conversations prevent editing,
rechecking and removal. Cancel-and-remove detaches immediately and stops the
check in the background; a late result cannot recreate it. The device-local
settings record survives restarts, but an interrupted check returns unchecked.
Monotonic revisions and optimistic overlays prevent older reads from restoring
removed or edited connections. The change feed tells other windows to refresh.

Generic connections use one existing agent sign-in. They do not claim credential
isolation, selected skills, a permission judge, helper suppression, or hardened
untrusted-repository review support. Untrusted reviews refuse these connections.
Arguments go directly to the executable, never through a shell. Explicit session
modes and held options use the existing ACP enforcement. A mode named for bypass
or automatic approval cannot be saved. These checks do not waive the agent
qualification requirements in [agents](../decisions/agents.md): a built-in adapter
still needs version-specific evidence for all its command paths, repository
allow rules, reader tools and native helpers.

## Upstream evidence and remaining qualification

The profile set comes from the requested first and second integration groups.
The current [ACP registry](https://github.com/agentclientprotocol/registry)
provides launch metadata for the entries it carries. Environment metadata is
preserved, including Muse's `MUSE_EXPERIMENTAL_ACP=on`. Kiro's current launch uses
`acp --agent-engine=v3`. The [Letta adapter](https://github.com/letta-ai/letta-acp)
exposes `standard` via its `permissions` mode option. [Oh My Pi](https://github.com/can1357/oh-my-pi)
exposes `default` and optional `plan`; using `default` for the reader retains its
tools while Althar refuses edits. [Hermes](https://hermes-agent.nousresearch.com/docs/user-guide/features/acp)
and [Mastra Code](https://mastra.ai/reference/code-sdk/acp-server) document their
ACP entry points outside the registry.

The current [Pi adapter](https://github.com/svkozak/pi-acp/blob/main/src/acp/agent.ts)
advertises `mcpCapabilities: { http: false, sse: false }` and accepts but does not
use session MCP servers. It therefore cannot pass Althar's tools requirement;
listing it is discovery, not enabled Pi support. Agents that approve harmless
commands themselves, including configurations that only ask for dangerous
commands, must also remain unavailable until their launch can force all commands
through Althar. The exact installed versions of the twelve profiles have not
been exercised with signed-in vendor accounts in this development environment.

The automated protocol peer verifies both a passing contract and failures for
refused writes that still run, missing permission requests, missing MCP calls,
missing version, and ignored cancellation. Runtime tests cover persistence,
version gates, dynamic model discovery, unavailable commands and cached registry
failures. UI tests cover draft preservation, validation, optimistic changes and
stale reads. Storybook evidence covers light, dark and narrow layouts.
