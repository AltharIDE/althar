# Background helpers: how others let an agent start helpers and keep talking

Research for [DEV-181](https://linear.app/althar/issue/DEV-181/leads-start-helpers-in-the-background-on-any-agent-and-keep-talking):
a task's lead starts a helper on any agent and model, its turn ends so the
person keeps talking to it, and the helper's result reaches it as a new turn.
The design it led to is
[ADR-087](../decisions/tasks.md#helpers).

Read on 2 November 2026, from primary sources: each product's docs and
changelog, its source where it is open (cited at a commit or tag), protocol
specs and their proposals, and the issues and threads where people say what
went wrong. Versions and dates are given where a feature appeared or changed;
"not documented" means the sources don't say, and an inference is marked as
one. For each, the same questions:

1. **Start:** how a helper is started (tool, API, syntax).
2. **The parent's turn:** whether it ends, or blocks while the helper runs.
3. **The result:** how it comes back: a new turn, an injected message,
   polling, a file.
4. **Writes:** whether helpers can write, and how they keep off the
   parent's work: their own folder or worktree, read-only, locks.
5. **Model:** the same agent only, or any model, and who picks.
6. **Limits:** concurrency, cost, depth, time.
7. **See and stop:** how the person sees helpers and stops them.
8. **Permissions:** what a helper inherits of the parent's permissions and
   sandbox.
9. **Failure:** errors and timeouts.
10. **Context:** what goes in (a brief, or the whole history) and what comes
    back (a summary, or the transcript).

## At a glance

The coding agents. [Orchestrators](#orchestrators-like-althar) and
[frameworks](#frameworks) have tables in their own sections.

| | Start | The parent's turn | The result | Writes | Model | Limits | See and stop |
|---|---|---|---|---|---|---|---|
| **Claude Code** | `Agent` tool; `.claude/agents/*.md` | ends: background by default since 2.1.198 | `<task-notification>` as a later turn, or between tool calls | in the parent's checkout; `isolation: worktree` opt-in | Claude only; the call's, the agent's, else the parent's | 20 at once, 3 deep, a 10-minute stall | panel below the prompt, `x`; `/tasks` |
| **Claude Code over ACP** | the same | **held open** until background subagents end, unless the client declares `backgroundSubagents` | inside the held turn | as above | as above | as above | child sessions, with the `subagents` capability |
| **Codex CLI** | `spawn_agent`; `.codex/agents` | ends, or blocks in `wait_agent` | injected into a running turn, or **only recorded: an idle parent isn't woken** | in the parent's folder | Codex only; the call's, else the parent's | v1: 6 open, 1 deep; v2: 3 children | `/subagents`; the parent's Stop doesn't stop them |
| **Codex app and cloud** | chats, Local, Worktree or Cloud | separate chats; subagents block | `codex apply` brings a cloud diff back | a worktree or machine per chat | per chat | 1–4 cloud attempts | the Activity view |
| **OpenCode** | `subagent` (V2), `task` (V1); `@agent` | blocks, or ends with `background: true` | a `<subagent>` message that wakes an idle parent; **not streamed over ACP after the prompt** | in the parent's folder | the call's, the agent's, else the parent's | 1 deep | child sessions; Ctrl+D |
| **Gemini CLI** | `invoke_agent`; `.gemini/agents` | **blocks**; background is a roadmap item | the tool's result | in the parent's folder | Gemini, or any A2A agent | no nesting; 30 turns, 10 minutes | the TUI; cancel the parent |
| **Copilot CLI** | `task`; `read_agent`, `write_agent` | blocks, or background | a notification; `read_agent` can wait | in the parent's folder | per call; Copilot's models | 2–32 at once by plan, 4 deep | `/tasks` tree, `X` |
| **Copilot cloud agent** | assign an issue, `/delegate`, `&` | separate | a draft pull request | its own machine, one branch | a picker | 59 minutes | its session log; Stop |
| **VS Code `runSubagent`** | the tool; `.github/agents` | **blocks** by design | the tool's result | the same workspace | per call, never costlier than the parent's | no nesting by default | a collapsed call |
| **Cursor** | `Task`; `.cursor/agents` | blocks, or ends (`run_in_background`); **held open over ACP** | a notification and a follow-up turn | shared by default; a worktree or cloud machine on request | per call; Cursor only | 1 deep | a task card; the CLI's jobs pager |
| **Amp** | `Task`; the Oracle; threads | not documented; threads go on | a summary; `send_to_thread` steers the parent | Task shares; a thread has "its own … working copy" | the thread's; plugins name one | not documented | steps in the thread; child threads |
| **Factory** | `Task` with droids; `droid exec -w` | blocks, or ends since v0.226.0 | notified, or `TaskOutput` | shared; worktrees for `droid exec` | droid, tier, else the parent's | 1 deep | the Task panel, Stop |
| **Devin, managed** | ask; `devin_session_create` | goes on, can sleep | **woken on done or needs input**; `gather` | its own machine and pull requests | Devin's modes | a spend limit per child | the session tree |
| **Devin CLI** | `run_subagent` with a profile | blocks, or background; **turn kept active** since September | notified | shared | by profile | 1 deep | a panel, `x` |
| **Cline** | `spawn_agent`; teams | blocks; a team's coordinator is restarted by the host | the tool's result; a new coordinator turn | shared; Kanban for worktrees | the parent's, or the agent's | 5 minutes; 2 runs at once | in place; abort stops children since September |
| **Roo Code** (archived) | `new_task` in Orchestrator mode | the parent is put away | **the deferred result of `new_task`** | one task at a time | by mode | none | the task tree |
| **Aider** | architect mode | synchronous | the editor's edits | the same files | any, two models | one pass | – |


## Agents

### Claude Code

Read 2 November 2026: the docs at code.claude.com, which describe 2.1.316;
the [changelog](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)
("CL" below), dated by each version's npm publish date. "SA" is
[Create custom subagents](https://code.claude.com/docs/en/sub-agents).

| Version (date) | What changed |
|---|---|
| 1.0.60 (2025-07-24) | Custom subagents in `.claude/agents/*.md` |
| 2.0.60 (2025-12-05) | Background agents: "Agents run in the background while you work" |
| 2.1.0 (2026-01-07) | One Ctrl+B backgrounds shells and agents; completions shown "proactively" |
| 2.1.20 (2026-01-27) | Background agents ask for their permissions before launching |
| 2.1.32 (2026-02-05) | Agent teams, a research preview behind a flag |
| 2.1.49–50 (2026-02-19/20) | `background: true` and `isolation: worktree` on agents |
| 2.1.63 (2026-02-28) | The Task tool is renamed Agent |
| 2.1.77 (2026-03-16) | `SendMessage({to: agentId})` continues an agent; Agent loses `resume` |
| 2.1.154 (2026-05-28) | Dynamic workflows (the `Workflow` tool) |
| 2.1.186 (2026-06-22) | Background subagents' permission prompts show in the main session; before, they were denied |
| 2.1.198 (2026-07-01) | Subagents run in the background by default |
| 2.1.217 (2026-07-21) | At most 20 subagents at once by default |
| 2.1.219 (2026-07-24) | Nesting depth default raised from 1 to 3 |
| 2.1.234 (2026-08-17) | Notifications between turns wrapped in `<system-reminder>`, as mid-turn |
| 2.1.302 (2026-10-16) | Fork mode on by default everywhere, `-p` and the SDK included |

- **Start.** The model calls the `Agent` tool: `description`, `prompt`,
  `subagent_type?`, `model?` (an alias), `effort?`, `run_in_background?`,
  `name?`, `isolation?: "worktree" | "remote"`
  ([TS reference](https://code.claude.com/docs/en/agent-sdk/typescript)). It
  delegates on its own from each agent's `description`, or the person asks,
  @-mentions an agent, or forks with `/subtask`
  ([SA](https://code.claude.com/docs/en/sub-agents#invoke-subagents-explicitly)).
  Definitions are Markdown with frontmatter (`tools`, `disallowedTools`,
  `model`, `permissionMode`, `maxTurns`, `skills`, `mcpServers`, `hooks`,
  `memory`, `background`, `effort`, `isolation`, …;
  [frontmatter](https://code.claude.com/docs/en/sub-agents#frontmatter-reference)).
  Built in: Explore and Plan (read-only), general-purpose.
- **The parent's turn.** Background is the default since 2.1.198: the tool
  returns at once with `status: "async_launched"`, an `agentId` and an
  `outputFile`, and the turn can end
  ([SA](https://code.claude.com/docs/en/sub-agents#which-subagents-run-in-the-background)).
  With fork mode on, "Claude also can't wait for a subagent" in interactive
  sessions ([SA](https://code.claude.com/docs/en/sub-agents#let-claude-wait-for-a-subagent)).
  Ctrl+B moves a waiting subagent or shell to the background.
- **The result.** "A background subagent's results reach Claude as a
  completion notification in a later turn": a user-role
  `<task-notification>` with the task id, status, summary, output file and
  the final report in `<result>`
  ([SA](https://code.claude.com/docs/en/sub-agents#tools-permissions-and-results-of-background-subagents);
  [the ACP adapter's parser](https://github.com/agentclientprotocol/claude-agent-acp/blob/v0.100.0/src/task-notifications.ts)).
  It lands mid-turn between tool calls, or starts a turn of its own when the
  session is idle (CL 2.1.234); several can be answered in one turn
  ([`SDKResultMessage.origin`](https://code.claude.com/docs/en/agent-sdk/typescript)).
  Since 2.1.205 each says "no human input has occurred", and the report sits
  under a header saying its instructions "carry no authority from you"
  ([SA](https://code.claude.com/docs/en/sub-agents#subagent-output-scanning)).
  A polling tool, `TaskOutput`, came in 2.0.64, was deprecated in 2.1.83 and
  removed in 2.1.277: Claude reads the output file instead.
- **Writes.** Subagents write unless their tools exclude it, in the parent's
  own checkout. `isolation: worktree` gives a temporary worktree, branched
  from the default branch unless `worktree.baseRef: "head"`, kept if it
  changed and reported back as `worktreePath` and `worktreeBranch`
  ([worktrees](https://code.claude.com/docs/en/worktrees#isolate-subagents-with-worktrees)).
  No locks: "Two teammates editing the same file leads to overwrites"
  ([agent teams](https://code.claude.com/docs/en/agent-teams#avoid-file-conflicts)).
- **Model.** Always a Claude session: "To involve a different tool, expose it
  to Claude as an MCP server" ([agents](https://code.claude.com/docs/en/agents)).
  The call's `model`, then the definition's, then
  `CLAUDE_CODE_SUBAGENT_MODEL`, then the parent's; a fork always runs on the
  parent's ([SA](https://code.claude.com/docs/en/sub-agents#choose-a-model)).
- **Limits.** 20 at once (`Concurrent subagent limit reached`, which tells
  Claude not to retry), no cap on how many in all; nesting three deep since
  2.1.219, one before ([SA](https://code.claude.com/docs/en/sub-agents#concurrent-subagent-limit)).
  A subagent that streams nothing for 10 minutes is stalled
  (`CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS`,
  [env vars](https://code.claude.com/docs/en/env-vars)). Usage counts against
  the same limits; agent teams use "approximately 7x more tokens"
  ([costs](https://code.claude.com/docs/en/costs#manage-agent-team-costs)).
- **See and stop.** A panel below the prompt, one row per running subagent,
  as a tree when nested: Enter opens its transcript, which the person can
  type into, and `x` stops it; a finished row leaves at once
  ([SA](https://code.claude.com/docs/en/sub-agents#observe-and-steer-running-forks)).
  `/tasks` lists them with model and effort. Esc on the main thread no longer
  stops background agents (CL 2.1.47); Ctrl+X Ctrl+K stops them all; the
  model stops one with `TaskStop`.
- **Permissions.** Each call is checked against the session's rules, under
  the session's sandbox. A parent in `bypassPermissions`, `acceptEdits` or
  `auto` forces its mode on the subagent; otherwise the subagent's own
  `permissionMode` applies but can't escalate to bypass
  ([SA](https://code.claude.com/docs/en/sub-agents#permission-modes)).
  Background agents' asks were denied outright, then asked before launch
  (2.1.20), and since 2.1.186 show in the main session naming the agent.
  `AskUserQuestion` is removed from every subagent
  ([SA](https://code.claude.com/docs/en/sub-agents#available-tools)).
- **Failure.** In the background an API error marks the agent failed, and
  the notification "names the API error and includes the subagent's last
  output" ([SA](https://code.claude.com/docs/en/sub-agents#api-errors-in-subagents));
  a killed agent's partial result is kept (CL 2.1.76). `--resume` reports
  background agents that were running when the process died (CL 2.1.157).
- **Context.** A fresh context: "It doesn't see your conversation history";
  the only thing passed is the prompt string, with CLAUDE.md and a git
  status ([SA](https://code.claude.com/docs/en/sub-agents#what-loads-at-startup)).
  A fork inherits the whole history and shares the prompt cache. Only the
  final message comes back; "The parent doesn't see the subagent's
  intermediate tool calls"
  ([tools reference](https://code.claude.com/docs/en/tools-reference#agent-tool-behavior));
  the transcript stays on disk for 30 days.
- **Next to it.** Agent teams (a lead, teammates, a shared task list and
  mailboxes; "when a teammate finishes and stops, it automatically notifies
  the lead"), dynamic workflows (a script of agents run in the background
  that returns one result), and background sessions in the agent view, each
  in its own worktree, whose results go to the person, not a parent
  ([agent view](https://code.claude.com/docs/en/agent-view)). Headless
  `claude -p` stays open after its last turn for background subagents, at
  most 10 minutes, and each result can start another turn
  ([headless](https://code.claude.com/docs/en/headless#background-tasks-at-exit)).

### Claude Agent SDK

- The `agents` option of `query()` maps names to `AgentDefinition`s (the
  frontmatter's fields, without `isolation`); the model, not the host,
  starts them through the Agent tool
  ([subagents](https://code.claude.com/docs/en/agent-sdk/subagents)).
- Background is the default; the host learns of work from system messages
  (`task_started` with `spawn_depth` and `parent_task_id`, `task_progress`,
  `task_notification` with `completed | failed | stopped` and usage), and a
  finished task becomes a synthetic follow-up turn with
  `origin: {kind: "task-notification"}`
  ([TS reference](https://code.claude.com/docs/en/agent-sdk/typescript)).
  Messages from inside a subagent carry `parent_tool_use_id`.
- `maxBudgetUsd` refuses new spawns, stops running background subagents and
  ends the query; depth and concurrency are set through `env`
  ([caps](https://code.claude.com/docs/en/agent-sdk/subagents#cap-subagent-depth-concurrency-and-spend)).
  `Query.stopTask(taskId)` stops one. With the `claude_code` preset on Opus 5
  the system prompt tells Claude not to call Agent unless asked, because the
  model "delegates to subagents more readily".
- "The only content you pass from parent to subagent is the Agent tool's
  prompt string"; out comes the final report.

### Claude Code over ACP

Althar runs Claude Code through `@agentclientprotocol/claude-agent-acp`
(0.99.1 in this repository; the research read v0.100.0).

- A plain ACP v1 client sees Agent calls as ordinary tool calls, with the
  child's output on the parent session
  ([README](https://github.com/agentclientprotocol/claude-agent-acp/blob/v0.100.0/README.md)).
  A client that declares `clientCapabilities.subagents` (since v0.90.0,
  2026-10-13) gets the [subagents RFD](https://github.com/agentclientprotocol/agent-client-protocol/blob/main/docs/rfds/subagents.mdx)'s
  form: each subagent a child session with `subagent_update`s, and
  `session/cancel` on a child id stopping only it.
- **ACP has no turn the agent starts.** In July 2026 the adapter's users
  reported that updates after a turn's `stopReason` were lost, that the model
  promised "I'll send you the summary as soon as it's done", "a promise that
  can never be kept", and that a background agent's permission request after
  the turn deadlocked
  ([#864](https://github.com/agentclientprotocol/claude-agent-acp/issues/864),
  [#865](https://github.com/agentclientprotocol/claude-agent-acp/issues/865),
  [#866](https://github.com/agentclientprotocol/claude-agent-acp/issues/866)).
  The fix ([#870](https://github.com/agentclientprotocol/claude-agent-acp/pull/870),
  v0.59.0) **holds the turn open while its background subagents live**:
  `session/prompt` stays pending until they settle and the model's follow-up
  has streamed; a cancel or the next prompt settles it early.
- A JetBrains AIR client that declares `backgroundSubagents` gets no hold
  ([#1262](https://github.com/agentclientprotocol/claude-agent-acp/pull/1262),
  v0.95.0, 2026-10-23), because "the hold hides the end of the answer, and
  the next user message would steer into an old turn. One SendMessage-resumed
  subagent kept a turn open for about two hours". Its subagents' updates,
  asks and follow-up then go out after the prompt's response, as "an
  out-of-turn autonomous result"
  ([`acp-agent.ts`](https://github.com/agentclientprotocol/claude-agent-acp/blob/v0.100.0/src/acp-agent.ts#L1633-L1660)).
- A draft ACP v2 answers `session/prompt` at once and reports work by
  `state_update` with a `background` list
  ([#1510](https://github.com/agentclientprotocol/claude-agent-acp/issues/1510),
  [`src/v2/background.ts`](https://github.com/agentclientprotocol/claude-agent-acp/blob/v0.100.0/src/v2/background.ts)).
- **In Althar today** the adapter sees a plain client for subagents: Althar
  declares the AIR capabilities `sessionFailure` and `asyncTasks`
  (`provider-adapters/src/AgentConnection.ts:722`), not `backgroundSubagents`.
  So a Claude Code lead that starts background subagents, as it does by
  default, keeps its Althar turn open until they finish
  (`claude-agent-acp/dist/acp-agent.js:1225-1234`, `:5553-5563` at 0.99.1),
  and what the person says next waits behind it, unless they interrupt.

### Codex CLI

Read at `rust-v0.166.0` (29 October 2026); "SRC" is
`github.com/openai/codex/blob/rust-v0.166.0/codex-rs/`. Codex's docs moved to
learn.chatgpt.com ([subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents.md),
[changelog](https://learn.chatgpt.com/docs/changelog)).

| Version (date) | What changed |
|---|---|
| 0.90.0 (2026-01-25) | Collaboration tools in beta, a cap on agents |
| 0.102.0 (2026-02-17) | The `collab` flag renamed `multi_agent`; roles in config |
| 0.115.0 (2026-03-16) | Multi-agent stable; `wait` renamed `wait_agent`; subagents inherit sandbox rules "more reliably" |
| 0.145.0 (2026-07-21) | Multi-agent v2 stable; children's threads read-only; CSV fan-out removed |
| 0.162.0 (2026-10-08) | Partial-history forks removed |
| 0.164.0 (2026-10-23) | "Allow agent messages to wake idle root sessions behind a feature flag" ([#54961](https://github.com/openai/codex/pull/54961)) |

- **Start.** The model calls `spawn_agent` (v1: `message`, `agent_type`,
  `fork_context`, `model`, `reasoning_effort`; v2: `task_name` too), with
  `send_input` or `send_message`, `wait_agent`, `close_agent` and more
  ([`multi_agents_spec.rs`](https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/core/src/tools/handlers/multi_agents_spec.rs)).
  It is told "Do not spawn sub-agents unless the user or applicable
  AGENTS.md/skill instructions explicitly ask". Roles: `default`, `explorer`,
  `worker`; custom agents are TOML in `.codex/agents/`.
- **The parent's turn.** `spawn_agent` answers at once; the parent blocks only
  in `wait_agent` (30 seconds by default, an hour at most), which it is told
  to "call … very sparingly". Its turn can end while children run.
- **The result.** v1 injects a user-role `<subagent_notification>` with the
  final message into a running turn, or only records it in the history,
  for the next turn the person starts
  ([`agent/control.rs`](https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/core/src/agent/control.rs#L440-L563),
  [`session/inject.rs`](https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/core/src/session/inject.rs#L174-L201)).
  v2 sends the final answer as a mailbox message with `trigger_turn: false`.
  **A child that finishes while the parent is idle doesn't wake it**, unless
  the under-development `wake_on_agent_messages` is on. Delivery is "best
  effort" ([`completion.rs`](https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/core/src/agent/control/completion.rs#L1-L4)).
- **Writes.** Children get the parent's folder, approval policy and
  permission profile ([`child_config.rs`](https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/core/src/agent/child_config.rs#L179-L202));
  no worktree, no lock. The `worker` role says to "Explicitly assign
  ownership" of files and tell workers "they are not alone in the codebase";
  read-only "isn't a separate read-only sandbox". Isolation is asked for
  ([#37226](https://github.com/openai/codex/issues/37226): "chat isolation is
  not filesystem isolation").
- **Model.** Codex only, the parent's provider; a spawn may name one of at
  most five models, and is told not to unless the person asks. v2 hid the
  choice for a while, "forcing all subagents to also be Sol"
  ([#31814](https://github.com/openai/codex/issues/31814), 100 comments).
- **Limits.** v1: six open children, one level ("Agent depth limit reached.
  Solve the task yourself."); finished children count until closed. v2: four
  threads with the root, so three children, which may start their own. No
  time limit on a child.
- **See and stop.** `/subagents` switches threads; a child's approval shows
  its source; children's threads are read-only. Stopping one means asking
  the parent model; **the parent's Stop leaves children and their commands
  running** ([#55521](https://github.com/openai/codex/issues/55521)).
- **Permissions.** Children inherit "the parent turn's current sandbox and
  approval settings", and custom agents can't override them. An approval that
  can't be shown "fails and Codex surfaces the error back to the parent".
- **Context.** v1 starts from the brief unless `fork_context`; **v2 forks
  the whole history by default** (`fork_turns: all`), and people ask for
  `none` ([#51032](https://github.com/openai/codex/issues/51032)). Out comes
  the final message. v2's messages are encrypted, which "remove[s] readable
  task audit trail" ([#28058](https://github.com/openai/codex/issues/28058)).
- **Background terminals** are found out only by polling (`write_stdin` with
  nothing); nothing wakes the agent
  ([#15723](https://github.com/openai/codex/issues/15723)).
- **Codex as someone's helper.** `codex exec` runs headless (read-only by
  default, `--worktree` for a managed worktree, `resume`), and shuts down
  when its turn ends, children with it. `codex mcp-server` was removed in
  0.154.0. The app-server's `turn/start` with a tool's output starts a new
  turn from a result the client ran, queued if a turn is under way
  ([app-server](https://learn.chatgpt.com/docs/app-server.md)).

### The Codex app and Codex cloud

- Since July 2026 the Codex app is a mode of the ChatGPT desktop app. The
  person starts chats as Local, Worktree or Cloud
  ([modes](https://learn.chatgpt.com/docs/environments/modes.md)); worktree
  chats run in `$CODEX_HOME/worktrees` on a detached head, with
  `.worktreeinclude` copying ignored files, and the 15 latest kept
  ([worktrees](https://learn.chatgpt.com/docs/environments/git-worktrees.md)).
  A cloud task has a machine of its own; its diff comes back with
  `codex apply <TASK_ID>`, and `--attempts 1-4` runs it several times
  ([cloud](https://learn.chatgpt.com/docs/environments/cloud-environments.md)).
  Nothing flows back into the chat that sent it.
- Inside a chat, subagents work as in the CLI; agents can create and message
  other chats (`create_thread`, `send_message_to_thread`, `wait_threads`,
  0.150.0), whose results the caller polls.
- ChatGPT's "dots" (October 2026) come closest to DEV-181: "Your dot can
  divide work among background agents that run in parallel and report back
  to it. You can keep talking to your dot while they work"
  ([tasks and memory](https://learn.chatgpt.com/docs/dots/tasks-and-memory.md)).

### Codex over ACP

codex-acp ([`agentclientprotocol/codex-acp`](https://github.com/agentclientprotocol/codex-acp),
2.5.0 here) sends child sessions only after the `subagents` negotiation, else
"subagent lifecycle stays an ordinary ACP tool call", and "does not support
targeted child cancel or close"
([subagent sessions](https://github.com/agentclientprotocol/codex-acp/blob/v2.5.0/docs/subagent-sessions.md)).
Its `_session/steering` injects into a running turn and, with none running,
starts one ([steering](https://github.com/agentclientprotocol/codex-acp/blob/v2.5.0/docs/steering.md)).

### Aider

Architect mode (v0.58.0, [September 2024](https://aider.chat/2024/09/26/architect.html))
is two models in one synchronous pass: after each architect reply the harness
runs an editor with "only the architect's proposal" and the chat's files, no
history and no repository map
([`architect_coder.py`](https://github.com/Aider-AI/aider/blob/main/aider/coders/architect_coder.py)),
and the architect's history then says "I made those changes to the files."
Nothing runs in the background; it "uses two LLM requests, which can take
longer and increase costs" ([modes](https://aider.chat/docs/usage/modes.html)).
The proposal passes unprocessed, which
[#5058](https://github.com/Aider-AI/aider/issues/5058) flags as a way for a
README's words to reach committed code. The last release was February 2026.

### OpenCode

Two lines are kept side by side: V1 (`packages/opencode`, v1.19.5 of
2026-10-28) and V2 (`packages/core`, v2.2.5 of 2026-10-30)
([releases](https://github.com/anomalyco/opencode/releases)); source read at
`dev` commit `1bf08ae4` (2 November 2026). The repository moved from
`sst/opencode` to `anomalyco/opencode`.

- **Start.** V2's model calls a `subagent` tool: `agent`, a 3–5 word
  `description`, `prompt`, `model?`, `sessionID?` (to steer or continue a
  child) and `background?`
  ([`tool/plugin/subagent.ts`](https://github.com/anomalyco/opencode/blob/1bf08ae46a91f7793c756e4ee521e37b6b554064/packages/core/src/tool/plugin/subagent.ts),
  [#34320](https://github.com/anomalyco/opencode/pull/34320), June 2026);
  V1's is `task` ([`task.ts`](https://github.com/anomalyco/opencode/blob/v1.19.5/packages/opencode/src/tool/task.ts)).
  Agents are Markdown in `.opencode/agents/` with `mode: subagent`; built in,
  `general` and a read-only `explore`. The person starts one with an
  `@agent` mention, and a command can run as a background child
  ([#47081](https://github.com/anomalyco/opencode/pull/47081)).
- **The parent's turn.** A foreground child blocks the tool call;
  `background: true` returns at once with `status: "running"` and the
  child's session id, and the person can push a blocking one to the
  background with Ctrl+B. The tool result tells the model: "DO NOT sleep,
  poll for progress, ask the subagent for status, or duplicate this
  subagent's work … briefly tell the user what you launched and end your
  response" ([L19-28](https://github.com/anomalyco/opencode/blob/1bf08ae46a91f7793c756e4ee521e37b6b554064/packages/core/src/tool/plugin/subagent.ts#L19-L28)).
  V1 had a `task_status` polling tool with its background agents (May 2026,
  [#27084](https://github.com/anomalyco/opencode/pull/27084)); it is gone by
  v1.19.5.
- **The result.** When a background child ends, a synthetic message,
  `<subagent sessionID=… state="completed|error|cancelled">final text</subagent>`,
  goes into the parent and **wakes an idle parent for a new turn**
  ([`session/subagent-completion.ts`](https://github.com/anomalyco/opencode/blob/1bf08ae46a91f7793c756e4ee521e37b6b554064/packages/core/src/session/subagent-completion.ts)).
  It is persisted and delivered once; a bug lost the wake when the parent was
  unloaded after an idle hour
  ([the proof script](https://github.com/anomalyco/opencode/blob/1bf08ae46a91f7793c756e4ee521e37b6b554064/script/drive/subagent-eviction.md)).
- **Writes.** Children run in the parent's folder: no worktrees, no locks,
  only the prompt's "avoid working with the same files". A request for
  isolated workspaces ([#17994](https://github.com/anomalyco/opencode/issues/17994))
  was closed as not planned in September 2026; its people said agents "step
  on each other's changes constantly".
- **Model.** Any subagent-mode agent the caller's `subagent` permission
  allows; the call's model, else the agent's, else the parent's, and the
  model is told "NEVER set this unless the user explicitly asks". Always
  OpenCode as the harness.
- **Limits.** Depth 1 by default (`experimental.subagent_depth`); `steps`
  caps a child's model steps, after which it must summarize. No concurrency
  or cost cap in the code; stalled child streams got a timeout and retry in
  v1.18.27 ([#46890](https://github.com/anomalyco/opencode/pull/46890)).
- **See and stop.** Each helper is a child session: a picker, next and
  previous child, back to the parent, and Ctrl+D "Interrupt subagent" in the
  composer's subagent bar
  ([keybinds](https://github.com/anomalyco/opencode/blob/1bf08ae46a91f7793c756e4ee521e37b6b554064/services/www/src/docs/content/cli/keybinds.mdx)).
  Interrupting a foreground parent cancels its child.
- **Permissions.** Starting a child is a permission of its own. In V2 "a
  custom subagent uses its own permissions, not a subset of its parent's";
  V1 derived the child's from the parent's
  ([permissions](https://github.com/anomalyco/opencode/blob/1bf08ae46a91f7793c756e4ee521e37b6b554064/services/www/src/docs/content/permissions.mdx)).
  Children's asks gather in the root session's view; before v2.0.3 a
  grandchild's ask hung silently
  ([#13715](https://github.com/anomalyco/opencode/issues/13715)).
- **Failure.** A failure keeps the child's session id so the model can
  continue it; no wall-clock limit.
- **Context.** Only the brief, prefixed "You are a subagent spawned by
  another session"; out comes the final text, the transcript staying in the
  child session.
- **Over ACP.** During a prompt, a child's work streams on the parent with
  `_meta["opencode/child-session"]`, and an extension notification
  `opencode/session/child_update` reports its state to a client that asks.
  "After the prompt ends, OpenCode stops sending child session updates"
  ([ACP doc](https://github.com/anomalyco/opencode/blob/1bf08ae46a91f7793c756e4ee521e37b6b554064/services/www/src/docs/content/cli/acp.mdx),
  [`acp/turn.ts`](https://github.com/anomalyco/opencode/blob/1bf08ae46a91f7793c756e4ee521e37b6b554064/packages/cli/src/acp/turn.ts)):
  the turn a background child's result wakes isn't streamed to the ACP
  client, which sees it only on a later `session/load`. Over ACP, OpenCode's
  own background wake can't be relied on.

### Amp

Closed source: from its docs and its news posts. Amp dropped its editor
extensions in March 2026 ([The Coding Agent Is Dead](https://ampcode.com/news/the-coding-agent-is-dead)),
rebuilt its CLI ([Neo](https://ampcode.com/news/neo), May), moved threads to
remote machines ([Agents in Orbs](https://ampcode.com/news/agents-in-orbs),
June), and added threads that start threads
([From agent to agent](https://ampcode.com/news/from-agent-to-agent), July).
It delegates two ways: subagents inside a thread, and separate threads.

- **Start.** The `Task` tool hands work to a subagent with its own context,
  chosen by Amp or asked for by the person
  ([Modes & Models](https://ampcode.com/docs/models-and-subagents)). The
  Oracle, a second model consulted for advice that "never edits files"
  ([2025-07-04](https://ampcode.com/news/oracle), now GPT-5.4), the Librarian
  and Finder are now part of Task's instructions. Plugins add agents with
  `amp.createAgent({name, model, instructions, tools})`
  ([Custom Agents](https://ampcode.com/news/custom-agents)). A separate thread
  starts from prose ("Start an orb thread with what you know about this
  unrelated bug… then keep working here") or `amp -ox "<prompt>"`, which
  "prints the thread URL, and exits right away"
  ([Spawning Orbs](https://ampcode.com/docs/cli/spawning-orbs)).
- **The parent's turn.** Task's isn't documented; the main agent "receives
  their final summary rather than monitoring their step-by-step work". A
  plugin's `agent.run()` blocks, at most 10 minutes; `createThread()` makes a
  background thread that "keeps running independently of the caller"
  ([Plugin API](https://ampcode.com/manual/plugin-api)).
- **The result.** Task's final summary. In the background pattern the child
  calls `send_to_thread` with the parent's id, which appends a user-role
  message that steers a busy parent; whether it starts a turn on an idle one
  isn't documented. `wait_for_threads` and `waitForResponse()` poll or block.
- **Writes.** Task subagents edit and run commands in the same workspace,
  with no locking documented. A separate thread has "its own conversation,
  context window, working copy, and orb", and "A message does not transfer
  files or commits by itself": work comes back with `amp sync`
  ([Agent to Agent](https://ampcode.com/docs/orbs/agent-to-agent)). Amp's own
  advice: keep work in one thread when tasks "edit the same files".
- **Model.** Task runs on "the same model and reasoning effort as the thread
  that started them"; plugin agents name a model; threads pick a mode. Always
  Amp.
- **Limits.** No count or depth documented; "A timeout rejects the call but
  leaves the child running until its turn finishes".
- **See and stop.** Task subagents are steps in the thread; "You can't guide
  them directly". Separate threads are children in the sidebar, archived with
  their parent ([Threads](https://ampcode.com/docs/threads)).
- **Permissions.** Amp asks no approval by default since Neo; dialogs fail in
  subagents that "cannot wait for a person"; the sandbox is the orb machine.
- **Context.** Subagents "start with the instructions and context the main
  agent gives them rather than the full conversation"; out comes a summary.

### Factory (Droids)

Closed source; docs at docs.factory.com (docs.factory.ai redirects there),
CLI v1.0.0 of 2026-10-29 ([changelog](https://docs.factory.com/changelog/cli-updates)).
Three layers: the Task tool with custom droids, Missions (an orchestrator with
workers and validators), and Workstreams (a beta: an orchestrator and agents
each on a computer of its own).

- **Start.** `Task` with `subagent_type`, `description`, `prompt`, and
  optionally `complexity` (light, medium, heavy, which routes the model),
  `run_in_background` and `resume`. Droids are Markdown in
  `.factory/droids/`; built in, `worker` and `explorer`; Claude Code's
  `.claude/agents/` can be imported
  ([Custom Droids](https://docs.factory.com/cli/configuration/custom-droids)).
- **The parent's turn.** In the foreground "the parent waits"; in the
  background the call "returns a `task_id` immediately". Since v0.226.0
  (2026-09-23) "Droid now finishes its reply while background tasks keep
  running instead of waiting for their reports": before, the turn stayed
  open.
- **The result.** The docs say both "The parent is notified when it
  completes" and "The parent fetches the result itself with `TaskOutput`
  rather than assuming you will be notified later". The changelog shows
  reports lost and found: "A session now stays loaded until its background
  task work finishes, so reports arrive" (v0.228.0); "A Task that already
  finished now reports its result instead of a timeout" (v0.221.0).
- **Writes.** Task subagents share the parent's folder, with tools set per
  droid (`read-only`, `edit`, `execute`, `web`); in Spec Mode they are
  read-only, hardened so resumed ones "stay read-only instead of regaining
  editing tools" (v0.225.0). For parallel work Factory points to worktrees:
  `droid exec --worktree` runs "inside an isolated git worktree on its own
  branch … without file conflicts"
  ([Droid Exec](https://docs.factory.com/droid-exec/overview.md)). Workstream
  agents each get "its own fresh computer" and hand back pull requests.
- **Model.** The droid's pinned model, else the complexity tier the person
  mapped, else the parent's. Missions: "Pairing a strong orchestrator model
  with a faster worker model is a common cost-quality tradeoff". Always
  Droid.
- **Limits.** One level: "a subagent cannot spawn its own subagents". No
  concurrency cap or time limit documented.
- **See and stop.** A Task panel in the transcript, with Stop since v0.225.0;
  "an indicator … while your subagents keep running" (v0.227.0). Workstreams
  group agents as "Waiting on you / Working / Idle", and each can be opened,
  answered, messaged or stopped
  ([Steer a Workstream](https://docs.factory.com/workstreams/steer.md)).
- **Permissions.** Autonomy is the parent's by default, within the
  organisation's maximum; "Delegated subagents inherit the parent sandbox
  policy" ([Sandbox](https://docs.factory.com/autonomy-and-safety/sandbox.md)).
  Subagents can't ask the person; their permission requests "are now
  auto-rejected instead of crashing the session" (v0.105.1).
- **Failure.** Blocked subagents "report back instead of prompting"; Missions
  move "a stuck worker onto a fresh one" (v0.198.0).
- **Context.** The prompt, fresh; Workstreams: "Agents don't see your
  conversation with the orchestrator, so the orchestrator gives each one a
  brief". Out, one final message, "not shown to you unless the parent
  summarizes it".

### Cline

One repository ships the VS Code extension (v4.1.26), the CLI (cli-v3.0.74),
a desktop app and an SDK, all of 26 October 2026
([releases](https://github.com/cline/cline/releases)); source read at
`d19f176b`.

- **Start.** `new_task` hands the conversation over to a new task, replacing
  this one rather than running beside it
  ([`new_task.ts`](https://github.com/cline/cline/blob/v3.41.0/src/core/prompts/system-prompt/tools/new_task.ts)).
  Subagents went from running the `cline` CLI as a command (October 2025,
  [#6782](https://github.com/cline/cline/pull/6782)), to `use_subagents`
  with up to five research-only prompts, "Write/edit tools are not
  available" (February 2026, [#9208](https://github.com/cline/cline/pull/9208)),
  to `spawn_agent({systemPrompt, task})` in the CLI and desktop app, which
  "The VS Code and JetBrains extensions don't use"
  ([Subagents](https://docs.cline.bot/features/subagents)). Agent Teams
  give a coordinator `team_run_task`, `team_await_runs` and a mailbox
  ([Agent Teams](https://docs.cline.bot/cli/agent-teams)).
- **The parent's turn.** `spawn_agent` "Waits for the sub-agent to finish and
  returns its result before your next step", several at once since
  September. A team run can go in the background; when the coordinator's turn
  ends with runs pending, the host waits and **starts a new coordinator turn
  by itself** ("There are still N teammate run(s) in progress…",
  [`local-runtime-host.ts`](https://github.com/cline/cline/blob/d19f176b6e4eab8f8f44f5f4649b085479b47b94/sdk/packages/core/src/runtime/host/local-runtime-host.ts#L2042-L2050)).
- **Writes.** In Act mode a subagent "can read and edit files and run
  commands" in the parent's folder; in Plan mode some commands "can write
  files … neither stops every change". For isolation Cline points to Kanban,
  where "each card gets an isolated git worktree + terminal", for Cline,
  Claude Code, Codex and OpenCode alike ([Kanban](https://docs.cline.bot/usage/kanban)).
- **Model.** The parent's, or a configured agent's `modelId`. Always Cline.
- **Limits.** `spawn_agent` times out at five minutes; teams run two at once
  by default; "A subagent can start subagents of its own". "Their token use
  and cost are added to the session's total."
- **See and stop.** Stopping a task didn't stop its children until September
  2026: "Aborting a task now also cancels the delegated subagents and
  teammates it spawned, instead of leaving their work running"
  ([v4.1.17](https://github.com/cline/cline/releases/tag/v4.1.17)).
- **Permissions.** "Approving the `spawn_agent` call approves everything the
  subagent then does … Approval settings don't apply inside a subagent".
  Children prompting on one terminal meant "a single `y` could approve more
  than one pending operation", fixed in cli-v3.0.63.
- **Context.** A system prompt and a task, no history; out comes the final
  reply.

### Roo Code

**Archived (read-only) since 15 May 2026**, its team "going all-in on
Roomote" ([changelog](https://github.com/RooCodeInc/Roo-Code/blob/b867ec9145750d0ae1ff7f02d35406e9bf2a0b16/CHANGELOG.md));
read at its last commit.

- **Start.** `new_task({mode, message, todos})`, "MUST be called alone",
  mostly from Orchestrator mode, which was Boomerang
  ([`new_task.ts`](https://github.com/RooCodeInc/Roo-Code/blob/b867ec9145750d0ae1ff7f02d35406e9bf2a0b16/src/core/prompts/tools/native-tools/new_task.ts)).
- **The parent's turn.** Since v3.35.0 (December 2025) the parent is put
  away, "never >1 tasks open", and the child is the one task open; the person
  talks to the child ([`NewTaskTool.ts`](https://github.com/RooCodeInc/Roo-Code/blob/b867ec9145750d0ae1ff7f02d35406e9bf2a0b16/src/core/tools/NewTaskTool.ts#L112-L121)).
- **The result.** The child's `attempt_completion` result is written into
  the parent's history **as the deferred result of its `new_task` call**,
  and the parent resumes by itself
  ([`AttemptCompletionTool.ts`](https://github.com/RooCodeInc/Roo-Code/blob/b867ec9145750d0ae1ff7f02d35406e9bf2a0b16/src/core/tools/AttemptCompletionTool.ts#L82-L178)).
- **Writes.** One task at a time in one folder, so no writes at once.
- **Permissions.** The orchestrator "cannot read files, write files, call
  MCPs, or run commands by default", against "context poisoning"
  ([`mode.ts`](https://github.com/RooCodeInc/Roo-Code/blob/b867ec9145750d0ae1ff7f02d35406e9bf2a0b16/packages/types/src/mode.ts#L216-L226)).
- **Failure.** A reload broke the parent and child link before v3.35
  ([#8081](https://github.com/RooCodeInc/Roo-Code/issues/8081)); races that
  lost the parent's history were fixed in v3.48.0.
- **Context.** "Subtasks … do not inherit the parent's context", and "only
  this summary returns to the parent"
  ([Boomerang Tasks](https://roocodeinc.github.io/Roo-Code/features/boomerang-tasks)).
- **Kilo Code**, its fork, now follows OpenCode: a `task` tool whose
  background tasks "return immediately, and deliver their result to the
  parent when they finish", children that "cannot ask the end user a
  question directly", and Orchestrator mode deprecated
  ([Custom Subagents](https://kilo.ai/docs/customize/custom-subagents)).

### Cursor

Parallel agents in worktrees came with 2.0 (29 October 2025, "Run up to
eight agents in parallel on a single prompt"; Background Agents renamed Cloud
Agents, [2.0](https://cursor.com/changelog/2-0)); subagents with 2.4 (January
2026); async subagents with 2.5 (February: "Previously, all subagents ran
synchronously, blocking the parent", [2.5](https://cursor.com/changelog/2-5));
an Await tool with 3.0 (April, [3.0](https://cursor.com/changelog/3-0)).

- **Start.** The agent calls `Task`, several at once to run them in parallel;
  the person can force one with `/name`. Custom subagents are Markdown in
  `.cursor/agents/` (and `.claude/agents/`, `.codex/agents/`) with `model`,
  `readonly` and `is_background`; built in, `explore` and `browser`
  ([Subagents](https://cursor.com/docs/subagents)). `/in-cloud` sends the
  next task to a cloud subagent on its own machine and branch.
- **The parent's turn.** A foreground subagent "Blocks until the subagent
  completes"; a background one "Returns immediately", and the parent can end
  its turn. **Over ACP it can't:** for a client that declares `subagents`,
  "a prompt waits for its background subagents and includes their results in
  the same turn" ([CLI changelog, v2026.09.15](https://cursor.com/docs/cli/changelog)).
- **The result.** "A final message with its results" and an id to resume it;
  in the background, a completion notification that starts a follow-up turn,
  which regressed and came back ("Background task follow-ups are back",
  v2026.08.11). The `subagentStop` hook gets `status`, `summary`,
  `modified_files` and the transcript's path
  ([Hooks](https://cursor.com/docs/hooks)).
- **Writes.** "Subagents share the parent agent's checkout by default. When
  several subagents edit files at once, they can overwrite each other's
  changes." Asked to, each gets a worktree or a cloud machine on its own
  branch, and "Changes stay on each subagent's branch until the parent agent
  merges the results". `/best-of-n` runs one task on several models, each in
  a worktree, and "does not merge changes back"; `/apply-worktree` brings one
  back ([Worktrees](https://cursor.com/docs/configuration/worktrees)).
- **Model.** The parent "can name a model when it launches a subagent"; a
  blocked model now falls back to the parent's, noted in the result
  (v2026.10.22). Always Cursor's own agent.
- **Limits.** One level since 2.5. "Five subagents … roughly five times the
  tokens". No cap on local subagents documented; cloud agents, "as many …
  as you want".
- **See and stop.** A task card with its model; "N subagents still running"
  in the Agents Window; a jobs pager in the CLI. 2.5 said "Stopping the
  parent agent will always stop the child subagents"; by August 2026 staff
  said children "are not cancelled" when the parent finishes, and that
  "approving that prompt later will resume it"
  ([forum 169891](https://forum.cursor.com/t/parent-agent-reports-task-complete-while-subagents-still-have-pending-actions/169891)).
- **Permissions.** Subagents "inherit all tools from the parent"; in the CLI,
  "your credentials, rules, and approval policy". Background asks are easy
  to miss.
- **Context.** "Subagents start with a clean context. The parent agent
  includes relevant information in the prompt."

### GitHub Copilot

Three places, behaving differently.

- **The cloud agent** (May 2025) is asynchronous from the start: assign an
  issue, mention `@copilot`, or `/delegate` and `&` from the CLI; it works on
  its own machine, "can only push to a single branch", and hands back a
  draft pull request, adding you as a reviewer "when it has finished"
  ([use on GitHub](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/use-cloud-agent-on-github)).
  A session runs "a maximum execution time of 59 minutes"; steering applies
  "after it finishes its current tool call"; Stop "preserves any commits
  already pushed" ([manage](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/manage-and-track-agents)).
  Nothing comes back into the conversation that delegated.
- **The CLI** has `task` with sync and background modes, `read_agent`
  (which can wait), `write_agent` to message a running agent, and
  `list_agents`; "Automatic notifications when background shell commands and
  agents complete" since 0.0.422 (March 2026)
  ([reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference),
  [changelog](https://github.com/github/copilot-cli/blob/main/changelog.md)).
  Subagents share the working folder: "Avoid assigning overlapping files to
  different workers unless the parent agent will reconcile conflicts
  explicitly" ([fleet mode](https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/fleet-mode)).
  Concurrency is capped by plan (2 to 32 across the session's tree, "New
  subagent requests are rejected until an active agent completes"), added
  "to prevent runaway agent spawning" (1.0.22), and the default depth was
  cut from 6 to 4 "to curb runaway recursive sub-agent delegation" (1.0.71).
  "Subagent sessions keep parent tool restrictions" (1.0.67). Model per call,
  then the person's override, then the agent's, then the parent's;
  `rubber-duck` picks "a complementary model".
- **VS Code's** `runSubagent` blocks by design: "Agents do not run async or
  in the background, you will wait for the agent's result"
  ([`runSubagentTool.ts`](https://github.com/microsoft/vscode/blob/ccbfe2802f57d4bb69c478c7790c829ec486f75e/src/vs/workbench/contrib/chat/common/tools/builtinTools/runSubagentTool.ts)).
  A model costlier than the main model's tier "doesn't run". Background
  sessions the person starts run in a worktree and commit "at the end of each
  turn", with an action to apply the changes
  ([1.107](https://code.visualstudio.com/updates/v1_107),
  [1.109](https://code.visualstudio.com/updates/v1_109)).

### Gemini CLI

Read at v0.66.0. `codebase_investigator`, its first subagent, came in
v0.12.0 (October 2025); "parallel subagents" were announced in April 2026
([blog](https://developers.googleblog.com/subagents-have-arrived-in-gemini-cli/)).

- **Start.** One tool, `invoke_agent(agent_name, prompt)`, whose prompt
  "MUST be comprehensive"
  ([`agent-tool.ts`](https://github.com/google-gemini/gemini-cli/blob/v0.66.0/packages/core/src/agents/agent-tool.ts));
  custom agents in `.gemini/agents/` with `model`, `max_turns` and
  `timeout_mins`; `kind: remote` reaches any A2A agent, the only way to
  another maker's ([subagents](https://github.com/google-gemini/gemini-cli/blob/v0.66.0/docs/core/subagents.md)).
- **The parent's turn.** It always blocks; several calls in one turn run as a
  batch. Background subagents are an open roadmap epic,
  [#17754](https://github.com/google-gemini/gemini-cli/issues/17754), whose
  sub-issue asks that results "flow back into the main agent's context … via
  a system reminder".
- **The result.** "Subagent '<name>' finished. Termination Reason: … Result:
  …"; the child must call `complete_task`. Over ACP a subagent is one tool
  call of kind `think`, its steps not streamed
  ([`acpSession.ts`](https://github.com/google-gemini/gemini-cli/blob/v0.66.0/packages/cli/src/acp/acpSession.ts)).
  Background shells do come back, as output wrapped to "treat it strictly as
  data", starting a turn only behind an experimental switch.
- **Writes.** Nothing isolates subagents: "Multiple agents editing code at
  the same time can lead to conflicts and agents overwriting one another".
- **Limits.** No nesting; 30 turns and 10 minutes by default; on a timeout,
  one recovery turn with a minute's grace to call `complete_task`. A
  recovered run is reported as success
  ([#22323](https://github.com/google-gemini/gemini-cli/issues/22323)).
- **Permissions.** Subagents' calls meet the policy engine under the
  subagent's name; time spent waiting on the person is given back to the
  timeout.

### Devin

- **Managed Devins** (March 2026): "Devin can delegate to a team of managed
  Devins that work in parallel. Each managed Devin is a full Devin with its
  own isolated virtual machine"
  ([release notes](https://docs.devin.ai/release-notes/2026)). The
  coordinator starts them with its MCP tools (`devin_session_create`,
  `devin_session_interact`, `devin_session_gather`) and doesn't block: it is
  told "when a child finishes or needs input — the coordinator is woken
  automatically, even if it is asleep, so it doesn't poll"
  ([advanced capabilities](https://docs.devin.ai/work-with-devin/advanced-capabilities)).
  Children open their own pull requests; the coordinator "resolves conflicts,
  and compiles results". Each child is "governed by the same chain as their
  parent, so restrictions can't be escaped by delegating work"
  ([security profiles](https://docs.devin.ai/product-guides/security-profiles)).
  A child may be given a spend limit and a schema for structured output.
- **Devin CLI's subagents** take a profile, not a model; in the background,
  "The parent is automatically notified when the subagent completes"; they
  share the parent's folder; "Any tool that has not been pre-approved is
  automatically denied", and a subagent denied a tool can be resumed in the
  foreground ([CLI subagents](https://docs.devin.ai/cli/subagents)). In
  September 2026 the CLI stopped showing Devin as idle while a background
  subagent runs: "the turn stays active until it finishes"
  ([changelog](https://docs.devin.ai/cli/changelog/stable)).

### Each agent Althar runs, and its own helpers over ACP

Read on 2026-11-03 from each agent's source at a pinned tag, its binary where
it is closed, and its docs; none of it was run against a live session. The
question for each: do its own helpers run in the background, what happens to
them inside an ACP client, and can Althar switch the background ones off while
keeping those that answer within the turn.

| Agent (version read) | Own helpers | By default | Over ACP | Switch Althar can pass |
| --- | --- | --- | --- | --- |
| Claude Code 2.1.312 (claude-agent-acp 0.99.1) | `Agent`, `run_in_background` | background since 2.1.198 | **turn held open** | `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1`: background off, in-turn kept |
| Codex 0.165.0 (codex-acp 2.5.0) | `spawn_agent`, `wait_agent` | never blocks | an idle parent never woken | `features.multi_agent = false`: all off |
| OpenCode 1.19.5 | `task`, `background` | in-turn | a background result never streamed | `OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=false`: background off, in-turn kept |
| Copilot CLI 1.0.105 | `task`, `mode: "background"`, sidekicks | the model picks | **turn held open; the next prompt kills them** | `--excluded-tools task`: all off |
| Junie 3893.6 | `spawn_subagent`, `waitForResult` | background | not verified | none found |
| Grok Build 1.0.70 | `spawn_subagent` | background | wakes the parent with turns Althar didn't ask for | `GROK_SUBAGENTS=0`: all off |
| Kimi Code 2.4.1 | `Agent`, `run_in_background` | in-turn | wakes the parent, but **that turn never reaches the client** | `TaskList`, `TaskOutput`, `TaskStop` disabled: background off, in-turn kept |
| Mistral Vibe 3.0.4 | `agents.spawn`, `wait` | never blocks | a late result waits for the person's next message | `VIBE_ENABLE_SUBAGENTS=false`: all off |
| Qwen Code 0.26.6 | `agent`, `run_in_background` | background | **wakes the parent with a turn of its own, streamed** | none built in |
| Antigravity ACP server 1.3.0 | `start_subagent` | always background | the helper's text isn't streamed | `_meta.agy.disabledTools: ["start_subagent"]`: all off |

Only three of the ten keep in-turn helpers with the background ones off:
Claude Code, OpenCode and Kimi. One, Qwen Code, brings a background result
back over ACP as a turn of its own. The others hold the turn, lose the result
or never send it.

- **Claude Code.** `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS` came in 2.1.4
  ([changelog](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)):
  set to `1`, it "remove[s] the `run_in_background` parameter from the Bash,
  PowerShell, and subagent tools" and turns off Ctrl+B and auto-backgrounding
  ([env vars](https://code.claude.com/docs/en/env-vars)). The Agent tool
  stays, and "Claude waits for subagents to finish before it continues"
  ([sub-agents](https://code.claude.com/docs/en/sub-agents)); in the 2.1.312
  binary, `shouldRunAsync` is false whenever background tasks are disabled,
  even for an agent defined with `background: true`. The adapter merges the
  process's environment and `_meta.claudeCode.options.env` into Claude Code's.
  What it costs: no detached shell command (a dev server goes through
  Althar's `run_project`), and a command that times out stops rather than
  moving to the background. The Monitor tool and MCP tasks still run in the
  background; whether they hold the ACP turn wasn't checked. A narrower flag,
  `backgroundAgentLaunchDisabled`, that would keep Bash's background, is set
  only inside `claude mcp serve`.
- **Codex.** Children never block: `spawn_agent` "returns the spawned agent
  id" at once, and the parent only hears in its turn by calling `wait_agent`
  ([`multi_agents_spec.rs`](https://github.com/openai/codex/blob/rust-v0.165.0/codex-rs/core/src/tools/handlers/multi_agents_spec.rs)).
  `features.multi_agent` (stable, on by default,
  [`features/src/lib.rs`](https://github.com/openai/codex/blob/rust-v0.165.0/codex-rs/features/src/lib.rs))
  or `agents.enabled` takes every subagent tool away; nothing narrower exists.
  `wake_on_agent_messages`, which would wake an idle parent, is under
  development and off in 0.165.0. Althar passes it in the config codex-acp
  merges into each session.
- **OpenCode.** On the 1.x line the task tool refuses `background: true`, and
  drops it from the schema the model sees, unless
  `OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS` is on, which
  `OPENCODE_EXPERIMENTAL=true` also turns on; set to `false`, it wins
  ([`task.ts`](https://github.com/anomalyco/opencode/blob/v1.19.5/packages/opencode/src/tool/task.ts)).
  The 2.x line (`packages/core` 2.2.5, 2026-10-30) always offers `background`
  on its `subagent` tool, with no switch found.
- **GitHub Copilot CLI.** `task` runs a helper in the turn or with
  `mode: "background"`, with `read_agent`, `write_agent` and `list_agents`
  ([command reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference)).
  Over ACP, "prompt #1 stays open while the background agent runs", and the
  next `session/prompt` aborts the session and every background helper with
  it ([#4555](https://github.com/github/copilot-cli/issues/4555), open);
  an async shell holds the prompt the same way
  ([#5293](https://github.com/github/copilot-cli/issues/5293)), and parallel
  helpers' text arrives with nothing saying whose
  ([#4106](https://github.com/github/copilot-cli/issues/4106)).
  `--excluded-tools`, honoured over ACP since 1.0.60
  ([changelog](https://github.com/github/copilot-cli/blob/main/changelog.md)),
  takes `task` away whole; `subagents.disabledSubagents` only names agents.
  Sidekick agents, a `sidekick:` block in an agent file, "run automatically in
  the background", and Althar shares the person's `agents` folder.
- **Junie.** Read from the 3893.6 jar
  ([releases](https://github.com/JetBrains/junie/releases)); the docs only say
  a subagent "runs it as a subtask"
  ([subagents](https://junie.jetbrains.com/docs/junie-cli-subagents.html)).
  `spawn_subagent`'s `waitForResult` "defaults to false (background)", and the
  child "runs concurrently; you will be notified when it finishes"; a child
  may work in a worktree (`useWorktree`). Internal `subagents_enabled` and
  `subagents_mode` properties exist, with no way found to set them from
  outside. What a background child does to an ACP turn wasn't verified.
- **Grok Build.** xAI's closed CLI (`@xai-official/grok` 1.0.70, 2026-10-23),
  read from the strings in its binary: "background is true by default … You
  get a notification … in a new turn after your turn ends", and a waiting call
  "stops waiting after 10 minutes". Its own terminal app speaks ACP to
  `grok agent stdio` and handles a "background wake turn", so Althar would get
  turns it didn't ask for. `GROK_SUBAGENTS=0`, `--no-subagents` or
  `subagents.enabled` takes them all away. It also reads Claude Code's,
  Cursor's and Codex's agent files.
- **Kimi Code.** In
  [`agentTool.ts`](https://github.com/MoonshotAI/kimi-code/tree/2c73f3f50af4fa7f2540ca0d2e33b07a1408e3a7),
  `run_in_background` (default false) is allowed only while `TaskList`,
  `TaskOutput` and `TaskStop` are all on, so disabling them in
  `[tools] disabled` of `$KIMI_CODE_HOME/config.toml`
  ([config](https://github.com/MoonshotAI/kimi-code/blob/2c73f3f50af4fa7f2540ca0d2e33b07a1408e3a7/docs/en/configuration/config-files.md))
  refuses background helpers and keeps in-turn ones, and probably background
  shell commands too. An idle session runs a turn when a helper's notice is
  waiting, but `acp-server/src/session.ts` drops every event of a turn no
  prompt started, so that turn's words and edits never reach the client.
- **Mistral Vibe.** Since 3.0 the spawn tool "does not block", and "a result
  that arrives after your final answer, does not wake you. It will reach you
  only in your next turn"
  ([`default_prompts.json`](https://github.com/mistralai/mistral-vibe/blob/v3.0.4/harness/core/src/core/prompt/default_prompts.json),
  v3.0.4, 2026-10-30). `enable_subagents`, default true, is read from the
  `VIBE_` environment prefix.
- **Qwen Code.** Not Gemini CLI's `invoke_agent` but a Claude Code–like
  `agent` tool, whose helpers have run in the background by default since
  [#7048](https://github.com/QwenLM/qwen-code/pull/7048) (2026-07-18). Over
  ACP, an idle session whose helper finishes runs the turn itself, sending
  `session/update` with `_meta.source: "background_notification"` and ending
  with `_qwencode/end_turn`
  ([`Session.ts`](https://github.com/QwenLM/qwen-code/blob/042c023b7beb4ad2a9ef95b2906b3564e3f23089/packages/cli/src/acp-integration/session/Session.ts),
  [sub-agents](https://github.com/QwenLM/qwen-code/blob/042c023b7beb4ad2a9ef95b2906b3564e3f23089/docs/users/features/sub-agents.md)).
  The default is `run_in_background ?? definition.background ?? true`, with
  no setting over it; a `PreToolUse` hook rewriting the input might force
  in-turn, untested.
- **Antigravity.** "Subagents run asynchronously in the background", up to
  ten levels deep, in a worktree or the shared folder
  ([subagents](https://antigravity.google/docs/subagents/)). The ACP server
  filters a session's tools by `_meta.agy.disabledTools` since 1.2.1
  (2026-09-23, [changelog](https://antigravity.google/docs/changelog/)), and
  1.3.0 enables subagents unless `start_subagent` is among them; "only the
  ROOT trajectory's text is the user-facing answer". Whether a running helper
  holds the turn wasn't verified.

## Orchestrators like Althar

The question for each: can one agent session start another, perhaps another
agent or model, and get its result back? Source read on 2 November 2026 at
the commits named.

| | Start | The caller's turn | The result | Writes | Agent and model |
|---|---|---|---|---|---|
| **Orca** | `orca orchestration worker-start` | **ends**, since v1.4.246 (2 November 2026); blocked on `check --wait` before | the worker sends `worker_done`; Orca types a wake line into the coordinator's terminal, or posts a chat message | shares by default; a worktree when asked | any of Orca's agents, `--model` |
| **Nimbalyst** (was Crystal) | MCP `spawn_session`, `create_session` | ends | a queued `[Child Session Update]` prompt starts the parent's next turn | the caller's folder | the caller's, or any provider |
| **Agent Orchestrator** | `ao spawn`, from a session told it is "coordination-only" | ends | the worker's `ao report --done`, batched into one new turn | a worktree and branch each | any harness, `--model` |
| **Superset** (now Paradev) | a skill, `superset agents create`, MCP `agents_create` | **blocks** in `agents wait`, or polls | a `SUPERSET_WORKER_DONE` block read off the terminal | a workspace each when editing | any preset, `--model` |
| **Sculptor** (pi only) | a `subagent` tool | ends | Sculptor queues a wake turn on its own input | shared (inferred) | pi only |
| **Vibe Kanban** | MCP `start_workspace`, `run_session_prompt` | answers at once | polling `get_execution`, whose final message is always empty | a workspace and branch each | an executor per session |
| **Conductor** | hosted MCP and API, cloud workspaces only | answers at once | polling status every 15 seconds, then the transcript | a workspace each | Claude Code, Codex or Cursor, and a model |
| **Claude Squad, Terragon** | none between agents | – | – | a worktree or sandbox each | – |

- **Orca** ([`stablyai/orca`](https://github.com/stablyai/orca) at
  `5e02b47d1140`). The coordinator runs
  `orca orchestration worker-start --spec "<task>" --agent codex`, from a
  skill behind an experimental setting. Its guide: "Start every independent
  worker, then end your turn. 'Report back' and 'tell me when it's done'
  still mean end your turn; Orca wakes you"
  ([guide](https://github.com/stablyai/orca/blob/5e02b47d1140/skill-guides/orchestration.md#L33)),
  new on 2 November 2026: "coordinators end their turn and Orca wakes them …
  A lot more token efficient and reliable"
  ([releases](https://github.com/stablyai/orca/releases?q=orchestration&expanded=true)).
  The worker sends "a 3-sentence summary: what you did, what you found,
  what's left" once; a worker that ends without it is reported as "Worker
  stopped without reporting", with its last 2,000 characters
  ([`worker-turn-stop-report.ts`](https://github.com/stablyai/orca/blob/5e02b47d1140/src/main/runtime/orchestration/worker-turn-stop-report.ts#L39)).
  For a terminal coordinator, Orca types the wake into its terminal and holds
  the Enter while it is busy, since "an open dialog would take the Enter as
  its answer". Workers can't start workers ("Complete this task yourself"),
  are told never to ask the person because "the coordinator cannot see or
  answer it", and after three failed starts the dispatch stops.
- **Nimbalyst** ([`Nimbalyst/nimbalyst`](https://github.com/Nimbalyst/nimbalyst)
  at `b01bb2a0f8ef`; Crystal was retired for it in February 2026). Its MCP
  tools take `reporting: none | final | messages`; reports "arrive with your
  next turn", and the tool to read them now says "Never poll"
  ([`metaAgentServer.ts`](https://github.com/Nimbalyst/nimbalyst/blob/b01bb2a0f8ef/packages/electron/src/main/mcp/metaAgentServer.ts#L346)).
  When a child completes, errors, waits or is interrupted, a prompt is queued
  for the parent, which starts it if idle, **except on an error**, to avoid a
  wake loop on instant 429s. It allows four children in flight and fifty in
  a parent's life, because "a completion-wakeup re-drives the parent, a weak
  model spawns another child, the child settles in milliseconds"
  ([`metaAgentSessionQueries.ts`](https://github.com/Nimbalyst/nimbalyst/blob/b01bb2a0f8ef/packages/electron/src/main/services/metaAgentSessionQueries.ts#L13)).
  Children fell back to Claude Opus under other parents until June 2026.
  A child's permission or question reaches the parent, which answers it.
- **Agent Orchestrator** ([`OrchestratorInc/agent-orchestrator`](https://github.com/OrchestratorInc/agent-orchestrator)
  at `25bc9b148f76`). A coordination-only session that must "Never ever make
  code changes" runs `ao spawn`; each worker gets its own worktree and
  branch, and its `ao report --done` waits five minutes for others before it
  is delivered; `--needs-input` goes at once, `--stuck` interrupts. Reports
  "remain pending when none is active. AO never spawns an orchestrator to
  deliver a report." In a chat, waiting reports go "as one provider input"
  after the turn ([architecture](https://github.com/OrchestratorInc/agent-orchestrator/blob/25bc9b148f76/docs/architecture.md#L626));
  "Automation must never inject input into a blocked session".
- **Superset**, renamed Paradev on 26 October 2026
  ([`ParadevAI/Paradev`](https://github.com/ParadevAI/Paradev) at
  `d75ba5c9fbe6`). The `orchestrate` skill (August 2026) has a Claude Code or
  Codex coordinator create a workspace and an agent in it, then "Wait for a
  worker instead of polling its screen" with `superset agents wait`, one
  worker at a time; the result is a block the worker prints, which is "a
  prompt convention visible in terminal snapshots, not durable Paradev
  events" ([skill](https://github.com/ParadevAI/Paradev/blob/d75ba5c9fbe6/plugins/superset/skills/orchestrate/SKILL.md#L58)).
  "Paradev does not merge worker branches automatically". Its presets start
  agents with their permissions off.
- **Sculptor** ([`imbue-ai/sculptor`](https://github.com/imbue-ai/sculptor)).
  For its pi harness, a `subagent` tool "returns IMMEDIATELY … The launching
  turn then ends — the user keeps chatting while the children run", and
  Sculptor queues the wake as a turn of its own. Letting the agent wake itself
  inside a run had starved the person's queued messages, made "one endless
  thinking turn", and broken Stop, so Sculptor became "the only
  turn-initiator" ([design](https://github.com/imbue-ai/sculptor/blob/ea2a9dffea13/agent_docs/scu-1776-pi-wake-serialization/design.md)).
- **Vibe Kanban** (sunsetting since April 2026, community-run since). Its
  MCP server starts workspaces and sessions on any of nine agents, and
  `run_session_prompt` will "return immediately"; the caller polls
  `get_execution`, whose `final_message` is always empty
  ([#3258](https://github.com/BloopAI/vibe-kanban/issues/3258)).
- **Conductor** (closed source). A hosted MCP server and API (0.82.0, August
  2026) start sessions in cloud workspaces only; the cookbook polls status
  "every ~15 seconds", with the caveat "Wait for `working` before trusting
  `idle`" ([API](https://www.conductor.build/docs/api)). The brief is "a
  self-contained implementation brief … The implementing session shares no
  context with you." Since 0.77.0 agents' own background subagents show "a
  dedicated timer and task details".
- **The Codex app** is in the Codex section: its subagents block the chat
  that started them, and its chats in worktrees or the cloud come back by
  `codex apply`.
- **Claude Squad** runs each agent in a worktree and has no way for one to
  start another; **Terragon** shut down in January 2026, its agents able
  only to suggest a follow-up task to the person.

## Protocols

### ACP

Read at the spec repository's
[`971b6cb`](https://github.com/agentclientprotocol/agent-client-protocol/tree/971b6cb7fbf034ab6f81e6b7d1d0615bcc31ef05)
(2 November 2026): schema v1 1.29.1, and v2's draft at 2.0.0-alpha.13. Althar
speaks v1 through `@agentclientprotocol/sdk` 1.5.1.

- **v1 lets an agent send updates outside a turn, and builds nothing on it.**
  "Session updates are not limited to active prompt turns", but a turn ends
  only with `session/prompt`'s answer, and nothing lets an agent start one or
  say the session is busy again
  ([v1 prompt turn](https://github.com/agentclientprotocol/agent-client-protocol/blob/971b6cb7fbf034ab6f81e6b7d1d0615bcc31ef05/docs/protocol/v1/prompt-turn.mdx#L33)).
  The v2 announcement: it "was a common point of confusion for
  implementers" ([ACP v2 draft](https://agentclientprotocol.com/announcements/acp-v2-draft)).
  v1 doesn't say what a second `session/prompt` during a turn does.
- **v2, a draft since 20 July 2026, makes work the agent starts ordinary.**
  `session/prompt` answers when the message is taken, not when the turn
  ends; work is reported by `state_update` (running, requires action, idle);
  "Foreground work can also start without a prompt, such as when the Agent
  follows up on a background task that finished"; and a client may prompt
  in any state, which the agent takes at once or holds
  ([v2 prompt lifecycle](https://github.com/agentclientprotocol/agent-client-protocol/blob/971b6cb7fbf034ab6f81e6b7d1d0615bcc31ef05/docs/protocol/v2/prompt-lifecycle.mdx#L66)).
  Its [Background Work RFD](https://github.com/agentclientprotocol/agent-client-protocol/blob/971b6cb7fbf034ab6f81e6b7d1d0615bcc31ef05/docs/rfds/v2/background-work.mdx)
  (in the v2 schema since 30 October) puts a `background` list of terminals,
  tool calls and subagents in every `state_update`, and adds a `paused`
  status and cancelling one call. It has no v1 form. Its motivation is
  Claude Code's subagents running "in the background by default" and Codex's
  outliving the root turn, worked around by a private `async_task_*`
  extension "that only one Client negotiates".
- **Subagents** are an Active RFD, in v1's unstable schema since 1.24.0
  (30 September 2026) ([RFD](https://github.com/agentclientprotocol/agent-client-protocol/blob/971b6cb7fbf034ab6f81e6b7d1d0615bcc31ef05/docs/rfds/subagents.mdx),
  [#1992](https://github.com/agentclientprotocol/agent-client-protocol/pull/1992)).
  A v1 client declares `clientCapabilities.subagents`; the agent then sends
  a `subagent_update` on the parent for each child session (title, state,
  its folder), with messages between sessions as `session_message`s. A
  child's state is "the only place a v1 Client learns that the child's work
  failed". The client can't prompt a child, only cancel it; cancelling a
  parent cancels only the children its work waits on; and "Clients MUST NOT"
  add a parent's and a child's costs together. Its FAQ: a session, not a tool
  call, because a session owns a conversation; and `session/fork` isn't
  enough, because a fork is the client's.
- **Steering** a turn under way is a proposal
  ([#1261](https://github.com/agentclientprotocol/agent-client-protocol/pull/1261),
  `delivery: "steer" | "queue"`); both reference adapters ship a private
  `_session/steering`, whose outcome may be `injected` or `startedNewTurn`
  ([codex-acp](https://github.com/agentclientprotocol/codex-acp/blob/ab513aa482c36233b0251f904b97474272e864ec/docs/steering.md)).
- **`session/fork`** (a Draft RFD, unstable since December 2025) makes a new
  session from the current conversation, the client's to start.
- **The adapters.** claude-agent-acp sends the RFD's form to a client that
  declares `subagents`, an earlier draft to JetBrains AIR, and otherwise
  keeps Agent calls as tool calls, a child's calls carrying
  `_meta.claudeCode.parentToolUseId`
  ([README](https://github.com/agentclientprotocol/claude-agent-acp/blob/1e986b526d3f0448212c592a56fad59bea5138b3/README.md#subagent-sessions));
  on v1 it holds the turn open while background subagents live (see Claude
  Code over ACP). codex-acp sends child sessions only after the same
  negotiation and "does not support targeted child cancel or close"
  ([subagent sessions](https://github.com/agentclientprotocol/codex-acp/blob/ab513aa482c36233b0251f904b97474272e864ec/docs/subagent-sessions.md)).
- **Zed**, the main ACP client, dropped `subagent_update` until 22 October
  2026 ([#65976](https://github.com/zed-industries/zed/pull/65976)) and
  still advertises `subagents` only behind a beta flag
  ([#66078](https://github.com/zed-industries/zed/pull/66078)); it draws
  subagents as cards in the thread that can't be prompted.

### MCP

The latest spec is 2026-07-28
([changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)).

- **MCP is stateless now, and the server speaks only when asked.** No
  `initialize` and no sessions; sampling, roots and logging are deprecated
  ([SEP-2577](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2577));
  a server's requests "MUST be associated with an originating client-to-server
  request" ([SEP-2260](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2260));
  a server that needs input returns `input_required` and the client calls
  again ([SEP-2322](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2322)).
- **Tasks moved out of the core into an extension**
  ([SEP-2663](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/d0e246ea3c69eafaa2806bc4cd28025703ba2c2b/docs/seps/2663-tasks-extension.mdx)),
  after 2025-11-25's experimental tasks
  ([SEP-1686](https://modelcontextprotocol.io/seps/1686-tasks)), whose
  `tasks/result` was "a blocking trap" and whose handshake was "fragile". A
  server may answer a `tools/call` with a task; the client polls `tasks/get`,
  and may listen for `notifications/tasks`; cancelling is "cooperative … not
  obligated to actually stop the work". The SEP tells clients they "can
  transparently drive the polling flow internally and surface only the
  final, completed result": the model still waits.
- **Only Claude Code wakes a model on a late result.** It took MCP tasks in
  2.1.304 (19 October 2026, a beta, main conversation only), and "If Claude
  is idle when the result arrives, Claude starts on it unprompted"; a plain
  MCP call moves to the background after two minutes
  ([MCP](https://code.claude.com/docs/en/mcp.md#mcp-tasks-that-run-on-the-server)).
  The extension's client matrix ticks Claude, Claude Code and MCPJam, not
  Claude Desktop, VS Code, Cursor or ChatGPT
  ([client matrix](https://modelcontextprotocol.io/extensions/client-matrix));
  Codex has an open request
  ([#48617](https://github.com/openai/codex/issues/48617)) and only logs
  progress and resource notifications
  ([`logging_client_handler.rs`](https://github.com/openai/codex/blob/adca20357620101686ebf633577d1d7e989e75b3/codex-rs/rmcp-client/src/logging_client_handler.rs#L63));
  Gemini CLI declares only roots
  ([`mcp-client.ts`](https://github.com/google-gemini/gemini-cli/blob/0ac57c029b848d109eef940afe0db4b5a0c3dad0/packages/core/src/tools/mcp-client.ts#L1880)).
- **A tool that waits meets each client's timeout:** 60 seconds in Codex
  (`tool_timeout_sec`), 30 in OpenCode by its docs, 10 minutes in Gemini CLI,
  60 seconds in the TypeScript SDK by default
  ([`protocol.ts`](https://github.com/modelcontextprotocol/typescript-sdk/blob/3b73021a0a2272c0c04c3917bcdb03398b3ec63f/src/shared/protocol.ts#L106)),
  about 28 hours in Claude Code.
- A Triggers and Events working group is incubating "a standardized callback
  mechanism — webhooks or similar"
  ([repository](https://github.com/modelcontextprotocol/experimental-ext-triggers-events)),
  with no SEP yet. Claude Code's channels let a server "inject directly in
  this session", a research preview that doesn't work on 2026-07-28
  connections ([channels](https://code.claude.com/docs/en/channels-reference.md)).

### What the protocols leave to Althar

Neither protocol gives a way, on every agent Althar runs today, for a tool to
come back later and wake the model. What works everywhere is the client's
own move: Althar sends the lead a new `session/prompt` with the result, as it
sends news now. A tool that waits for a helper would meet each client's
timeout, and a tool that returns a task would be polled by the client while
the model waits.

## Frameworks

Only what bears on "start a helper, keep talking, be woken with its result".

| Framework | Start | The caller | The result | Context in | Wakes an idle caller |
|---|---|---|---|---|---|
| OpenAI Agents SDK, `as_tool` | a tool call | blocks | the tool's result | a string; no history | – |
| OpenAI Responses, `background: true` | a flag | doesn't block | polling, a resumed stream, a webhook | the request | by webhook |
| Google ADK, AgentTool and sub-agents | a tool call, `transfer_to_agent` | blocks (inferred), or hands over | the tool's result, `finish_task` | an isolated session branch | no |
| ADK, `LongRunningFunctionTool` | a tool call | the run pauses | the client sends the response in a new run | – | the client must |
| A2A | `SendMessage`, `returnImmediately` | either | a stream, `GetTask`, a push webhook | a message and `contextId` | by webhook |
| LangGraph Agent Server | `runs.create` | doesn't block | `runs.join`, polling, a webhook | the thread's state | by webhook |
| Deep Agents, async subagents | `start_async_task` | doesn't block | a message, or `check_async_task` | the brief, or a fork | yes, in one deployment |
| Managed Deep Agents, `async: True` | a subagent tool | doesn't block | before its next model call, or a new run | a shared sandbox | yes, a new run |
| Microsoft Agent Framework, background agents | `background_agents_start_task` | doesn't block | wait and results tools | text, to a child session | only by a loop |
| CrewAI, `async_execution` | a task's flag | doesn't block | a later task's `context` joins it | task outputs | no |

- **OpenAI Agents SDK** (Python v0.24.0, 2026-10-15). A handoff gives the
  conversation to another agent, which by default "gets to see the entire
  previous conversation history"
  ([handoffs](https://openai.github.io/openai-agents-python/handoffs/));
  `Agent.as_tool` keeps it, and "The parent run's conversation state is not
  inherited automatically"; the nested run drains before returning
  ([tools](https://openai.github.io/openai-agents-python/tools/)). Nothing
  runs in the background in either SDK. An approval inside a nested agent
  "still surfaces on the outer run"
  ([human in the loop](https://openai.github.io/openai-agents-python/human_in_the_loop/)).
  The Responses API's `background: true` is a request polled, resumed or
  answered by webhook, retried "for up to 72 hours", duplicates expected
  ([background](https://developers.openai.com/api/docs/guides/background),
  [webhooks](https://developers.openai.com/api/docs/guides/webhooks)).
- **Google ADK** (2.0, May to August 2026). Sub-agents in `task` or
  `single_turn` mode "operate in its own isolated session branch", return by
  themselves, and only `single_turn` ones run in parallel
  ([collaboration](https://adk.dev/workflows/collaboration/)). A
  `LongRunningFunctionTool` returns a pending ticket, "the agent runner
  pauses the agent run", and the client sends the result back in a new run
  ([function tools](https://adk.dev/tools-custom/function-tools/)). Resumed
  tools run "at least once, and may run more than once"
  ([resume](https://adk.dev/runtime/resume/)).
- **A2A** (v1.0.0, 2026-03-12; v1.0.1 in May). Tasks are submitted, working,
  input-required, auth-required, completed, failed, canceled or rejected; a
  terminal task "cannot restart", and a follow-up is a new task in the same
  context ([spec](https://a2a-protocol.org/latest/specification/),
  [life of a task](https://a2a-protocol.org/latest/topics/life-of-a-task/)).
  `returnImmediately` makes a send not wait; a stream closes on a terminal
  or interrupted state and `SubscribeToTask` reattaches; push delivery is at
  least once and "SHOULD process notifications idempotently"; cancelling "is
  not guaranteed" ([streaming and async](https://a2a-protocol.org/latest/topics/streaming-and-async/)).
- **LangGraph and Deep Agents.** A background run on the Agent Server is
  joined, polled or answered by webhook; a run paused at an `interrupt()`
  reports success
  ([webhooks](https://docs.langchain.com/langsmith/use-webhooks)). New input
  while a run goes is enqueued, rejected, interrupts it or rolls it back
  ([double-texting](https://docs.langchain.com/langsmith/double-texting)).
  Deep Agents' subagents are isolated by default, "only sees the delegated
  task", with a fork as a beta; the parent gets "only the final result, not
  the dozens of tool calls" ([subagents](https://docs.langchain.com/oss/python/deepagents/subagents)).
  Its async subagents (deepagents 0.5.0, April 2026) came because "If a
  subagent takes an hour, you have to wait an hour": `start_async_task`
  returns an id, and completion arrives as a tagged human message; "In a
  single deployment, a subagent can wake an idle supervisor". Task records
  live in a state channel that survives compaction, a child waiting for
  input shows as waiting, and the supervisor "cannot answer or approve on the
  user's behalf"; the docs' troubleshooting covers "polling right after
  launch, stale status reports, truncated task IDs"
  ([async subagents](https://docs.langchain.com/oss/python/deepagents/async-subagents)).
  Managed Deep Agents (v0.10, 2026-10-29) deliver by the parent's state: a
  busy parent gets the result before its next model call, an idle one is
  woken with a new run, one waiting on an approval gets it after the person
  answers ([post](https://langchain.com/blog/managed-deep-agents-browser-use-and-asynchronous-subagents)).
- **Microsoft Agent Framework** (1.0, April 2026; AutoGen archived). Its
  experimental background agents give the parent tools to start, wait for
  the first to finish (300 seconds, then "leaves the tasks running"), read
  results, continue and clear; a task is "lost" after a restart, "There is no
  cancellation tool in the provider", and a child's approval isn't passed up,
  so children run without asking
  ([background agents](https://learn.microsoft.com/en-us/agent-framework/agents/background-agents)).
  AutoGen's agent tools needed parallel tool calls off: "Agents cannot run
  concurrently as they maintain internal state".
- **CrewAI.** Delegation is two tools; its troubleshooting admits agents
  "delegate back and forth endlessly"
  ([collaboration](https://docs.crewai.com/en/concepts/collaboration)), and a
  hierarchical manager often delegates nothing
  ([#4783](https://github.com/crewAIInc/crewAI/issues/4783)). An async task
  is joined by naming it in a later task's context.
- **Others with background tools.** Pydantic AI's `BackgroundTools` sends a
  "started" message, then the result as a user message; "A normal run waits
  for its background tools to finish", and results not yet delivered when a
  run stops "are dropped"
  ([docs](https://pydantic.dev/docs/ai/harness/background-tools/index.md)).
  OpenRouter's agent SDK injects a result "at the next turn boundary" and,
  when the model ends with tasks running, drains, detaches (results
  "orphaned") or cancels
  ([async tools](https://openrouter.ai/docs/agent-sdk/call-model/async-tools.md)).

## Patterns and lessons

### What works

- **Answer at once with a handle, and deliver the result as a message at the
  next turn's edge.** Claude Code's `async_launched` and its later
  `<task-notification>`, OpenCode's `<subagent>` message that wakes an idle
  parent, Deep Agents' tagged message, Managed Deep Agents (before the next
  model call if busy, a new run if idle, after the person's answer if waiting
  on one), Pydantic AI and OpenRouter ("at the next turn boundary"), and
  Devin's coordinator "woken automatically, even if it is asleep, so it
  doesn't poll". The host that owns the parent's conversation is the one that
  can deliver; over ACP, that is the client.
- **A brief in, the last message out, the transcript kept.** Every product
  that lets a helper be another model starts it fresh from a brief ("It
  doesn't see your conversation history", Claude Code; "Subagents start with
  a clean context", Cursor; "stateless … Provide each sub-agent with complete
  context", Copilot), and returns only the final message, with the
  transcript one step away. Forks exist only within one agent (Claude Code,
  Deep Agents, Cursor's `/fork`).
- **A folder of its own for anything that writes, and the work brought back
  on purpose.** Cursor's subagents "in its own environment" whose changes
  "stay on each subagent's branch until the parent agent merges the
  results"; Factory's `droid exec --worktree` "without file conflicts";
  Amp's threads with "its own … working copy"; Devin's and Copilot's cloud
  agents on machines and branches of their own; VS Code's background
  sessions, with an action to apply. Shared folders come with a warning in
  every product that has them.
- **Read-only helpers for looking.** Claude Code's Explore and Plan,
  OpenCode's and Cursor's `explore`, Amp's Oracle that "never edits files",
  Devin CLI's `subagent_explore`, Factory's Spec Mode.
- **One level, and a cap.** OpenCode, Factory, Cursor, Gemini CLI, VS Code
  and Devin CLI go one level deep by default; Claude Code went from one to
  three, Copilot from six to four "to curb runaway recursive sub-agent
  delegation". Claude Code caps 20 at once "so one message can't fan out
  unbounded background agents", Copilot 2 to 32 by plan.
- **Never more than the parent.** Devin: "restrictions can't be escaped by
  delegating work"; Copilot: "Subagent sessions keep parent tool
  restrictions"; Factory: "Delegated subagents inherit the parent sandbox
  policy"; Claude Code: a subagent "can't escalate".
- **A result is data, not the person.** Claude Code's notifications say "no
  human input has occurred" and its reports "carry no authority"; Gemini
  CLI's background output is to be treated "strictly as data".
- **A record outside the transcript.** Claude Code names the output file in
  each notification so it survives compaction; Deep Agents keeps task
  records in a state channel compaction doesn't touch; OpenCode persists its
  notification and delivers it once; MCP's tasks extension asks clients to
  persist task ids.
- **One wake for several results.** Claude Code and Deep Agents answer
  several completions in one turn.
- **Wake on "needs input" as well as on "done"** (Devin; A2A's
  input-required; Deep Agents' waiting).

### What to avoid

- **Relying on an agent's own wake over ACP.** ACP v1 has no turn the agent
  starts; Claude Code's adapter holds the turn open instead, Cursor's and
  Devin's CLIs do the same, and OpenCode's background result never reaches
  the client.
- **Holding the parent's turn while helpers run.** It "hides the end of the
  answer", the next message "steers into an old turn", and the person waits:
  Zed's composer stayed locked about two minutes after the answer
  ([claude-agent-acp#773](https://github.com/agentclientprotocol/claude-agent-acp/issues/773)).
- **Polling tools.** Models poll at once, report stale status, and loop;
  Claude Code removed `TaskOutput`, OpenCode `task_status`.
- **Helpers in the parent's folder that write.**
- **Asks denied in silence.** The helper then reports success for what never
  happened.
- **Unbounded fan-out**, in count, depth or time.
- **Results that read as the person**, or that the parent can predict.
- **A tool that waits for the helper,** which meets every client's tool
  timeout (60 seconds in Codex).

### What people complain about

- **Claude Code's changelog is a list of the ways a background result goes
  missing.** Background results came back as "raw transcript data instead of
  the agent's final answer" (2.1.47, [#26012](https://github.com/anthropics/claude-code/issues/26012));
  notifications lacked the output path, "which made it difficult for parent
  agents to recover agent results after context compaction" (2.1.71); a
  task's output "could hang indefinitely when the task completed between
  polling intervals" (2.1.81); background subagents became "invisible after
  context compaction, which could cause duplicate agents to be spawned"
  (2.1.83); a subagent that resumed another was "never … woken by that
  agent's completion (the notification went to the main conversation
  instead)" (2.1.260); "a finished subagent's report being lost when the
  conversation that launched it was compacted before the report was read"
  (2.1.280). Killed background agents respawned by themselves (2.1.211).
- **Authority had to be taken away from results.** Notifications now
  "explicitly state that no human input has occurred, preventing fabricated
  in-transcript approvals from being acted on" (2.1.205); relayed
  `SendMessage`s "no longer carry user authority" (2.1.166); reports are
  scanned for instructions (2.1.210).
- **Background asks went from denied to shown.** Until 2.1.186 a background
  subagent's permission prompts were denied without asking; then they showed
  in the main session, naming the agent.
- **Isolation leaked.** Worktree subagents leaked their working folder back
  to the parent's shell (2.1.97), subagents in background sessions bypassed
  the worktree guard "writing to the shared checkout" (2.1.154), and isolated
  subagents could redirect git into the main checkout (2.1.216, 2.1.222).
- **Fan-out runs away.** The 20-at-once cap came "so one message can't fan
  out unbounded background agents" (2.1.217); the SDK warns that Opus 5
  "delegates to subagents more readily" and tells it not to unless asked
  ([SDK subagents](https://code.claude.com/docs/en/agent-sdk/subagents#run-opus-5-with-subagents)).
- **Over ACP, a turn the agent starts has nowhere to go.** Updates arrive
  "after session/prompt resolves", so a client shows done while output still
  streams ([#864](https://github.com/agentclientprotocol/claude-agent-acp/issues/864));
  the fix of holding the turn open "hides the end of the answer", the next
  message "steers into an old turn", and one turn was held about two hours
  ([#1262](https://github.com/agentclientprotocol/claude-agent-acp/pull/1262)).
- **OpenCode lost a wake** when the parent's session was unloaded after an
  idle hour ([proof script](https://github.com/anomalyco/opencode/blob/1bf08ae46a91f7793c756e4ee521e37b6b554064/script/drive/subagent-eviction.md)),
  and grandchildren's asks hung silently until v2.0.3
  ([#13715](https://github.com/anomalyco/opencode/issues/13715)). Its
  helpers share the parent's folder, and people say agents "step on each
  other's changes constantly" ([#17994](https://github.com/anomalyco/opencode/issues/17994)).
- **People's issues say the same, louder** (Claude Code's tracker; most of
  these were closed by its inactivity bot, not fixed):
  - Results lost: background agents "go idle without delivering the final
    report" ([#74113](https://github.com/anthropics/claude-code/issues/74113));
    "Only 1 out of 3 agents sent a notification" when several finished at
    once ([#20754](https://github.com/anthropics/claude-code/issues/20754));
    a notification queued and never delivered, after which the session
    "re-ran an expensive duplicate"
    ([#85534](https://github.com/anthropics/claude-code/issues/85534));
    nested children's notifications skip the subagent that started them
    ([#75043](https://github.com/anthropics/claude-code/issues/75043)).
  - Woken wrongly: a notification arriving as a user turn, and the model
    "impersonated the user"
    ([#39027](https://github.com/anthropics/claude-code/issues/39027)), or
    approved its own pending question
    ([#36690](https://github.com/anthropics/claude-code/issues/36690)); the
    lead saying "All agents done" minutes before they were
    ([#68922](https://github.com/anthropics/claude-code/issues/68922));
    acknowledging each notification "wasting tokens on a meaningless
    response" ([#18544](https://github.com/anthropics/claude-code/issues/18544));
    each completion waking the parent twice
    ([#95601](https://github.com/anthropics/claude-code/issues/95601)).
  - Cost: one workflow started 46 Opus subagents, about 3M tokens, without
    asking ([#66023](https://github.com/anthropics/claude-code/issues/66023));
    "3 requested → 24 ran", children polling with `sleep`
    ([#82565](https://github.com/anthropics/claude-code/issues/82565));
    background agents have no cap on tokens, turns or time
    ([#94013](https://github.com/anthropics/claude-code/issues/94013)); the
    progress summaries were 22.7% of one session's requests
    ([#86879](https://github.com/anthropics/claude-code/issues/86879),
    [HN, 29 October 2026](https://news.ycombinator.com/item?id=50284255)).
  - Folders: worktrees branched from the default branch, so a fan-out of 17
    "aborted with zero output"
    ([#75045](https://github.com/anthropics/claude-code/issues/75045)); a
    subagent's working folder leaked into the parent's checkout and
    destroyed untracked files
    ([#52958](https://github.com/anthropics/claude-code/issues/52958));
    parallel subagents share one folder with no warning
    ([#101461](https://github.com/anthropics/claude-code/issues/101461)).
  - Asks: writes silently denied while the subagent still reports success
    ([#32402](https://github.com/anthropics/claude-code/issues/32402)); the
    parent gets no sign a helper is blocked
    ([#99887](https://github.com/anthropics/claude-code/issues/99887)); "came
    back to about 7 queued prompts"
    ([#101339](https://github.com/anthropics/claude-code/issues/101339)); the
    SDK's permission channel closes when the main turn ends, so a helper
    still running can't ask
    ([sdk-ts#376](https://github.com/anthropics/claude-agent-sdk-typescript/issues/376)).
  - Defaults changed under people: foreground dispatch replaced by forks
    through a remote rollout
    ([#54595](https://github.com/anthropics/claude-code/issues/54595)), and
    `run_in_background: false` no longer blocking
    ([#85765](https://github.com/anthropics/claude-code/issues/85765)).
  - Over ACP: Zed cancels before each new prompt, which kills held background
    subagents ([acp#976](https://github.com/agentclientprotocol/claude-agent-acp/issues/976));
    the wake-up turn streams outside any prompt and a generic client gets no
    "still running" sign
    ([acp#1285](https://github.com/agentclientprotocol/claude-agent-acp/issues/1285)).
- **Codex: late results never reach an idle parent.** "Long-running
  background sub-processes and sub-agents do not inform the calling agent
  when they complete"; the agent "spins up the sub-task, responds to the
  user, and then does nothing"
  ([#15723](https://github.com/openai/codex/issues/15723)); "results surface
  only after the next user prompt", once after 3 h 27 min
  ([#40932](https://github.com/openai/codex/issues/40932)); in a week, "31
  children finished while their parent was idle, and none woke it", and
  polling cost 89 `wait_agent` calls, 66 timeouts and about 10.3M tokens to
  learn "not yet" ([#46120](https://github.com/openai/codex/issues/46120)).
  The ask there: wake only on completion, batch children that end together,
  skip a parent that was interrupted or paused, citing Claude Code's
  notifications. A slow child read as stalled gets its work redone
  ([#16900](https://github.com/openai/codex/issues/16900)).
- **Codex: forks multiply cost.** v2's default whole-history fork: 242M
  tokens in 2 h 44 min ([#46023](https://github.com/openai/codex/issues/46023)),
  a five-hour quota from 22% to 98% in 117 seconds with two research
  subagents ([#58898](https://github.com/openai/codex/issues/58898)), an
  image-heavy history copied into every child
  ([#58291](https://github.com/openai/codex/issues/58291)).
- **Codex: Stop doesn't stop them.** The parent's Stop left a child and its
  command running ([#55521](https://github.com/openai/codex/issues/55521));
  interrupting a child left its sandboxed command running and the parent's
  wait never ended ([#57863](https://github.com/openai/codex/issues/57863)).
- **Codex: the brief should be readable.** Encrypted delegation messages
  "remove readable task audit trail"
  ([#28058](https://github.com/openai/codex/issues/28058)).
- **Codex: people want to choose the helper's model.** Hiding it caused a
  100-comment issue ([#31814](https://github.com/openai/codex/issues/31814)).
- On Hacker News: "When i used subagents with codex, it made tasks take
  literally 10x longer with a worse result"
  ([HN](https://news.ycombinator.com/item?id=50031281)).
- **Where a product notifies the parent itself, that is its most reported
  bug.** Cursor: "The parent chat stays idle until the user messages again"
  ([forum 172421](https://forum.cursor.com/t/parent-agent-goes-idle-for-hours-after-background-subagents-finish-completion-does-not-resume-the-chat/172421));
  a complete transcript on disk while the parent gets "connection was
  interrupted", "specifically in the return channel"
  ([forum 166499](https://forum.cursor.com/t/subagent-bugbot-completes-but-result-returns-connection-was-interrupted-handoff-fails-in-both-sync-and-background-modes/166499));
  a parent that decided it "can't see" a result and ran the audit again
  ([forum 164392](https://forum.cursor.com/t/agent-offers-to-run-sub-agent-but-cant-see-results-in-user-visible-summary-so-re-runs-sub-agent-functionality-wasting-tokens/164392)).
  Copilot CLI: an orchestrator that gets no completions
  ([#2923](https://github.com/github/copilot-cli/issues/2923)), "about 1 in 3
  general-purpose background agents hangs"
  ([#3350](https://github.com/github/copilot-cli/issues/3350)), follow-ups
  delayed by up to "about 8.5 hours"
  ([#5143](https://github.com/github/copilot-cli/issues/5143)).
- **What stopping the parent does keeps changing.** Cursor went from
  "always stop the child subagents" to children that outlive a finished
  parent and still edit "the same working tree" once an ask is approved
  ([forum 169891](https://forum.cursor.com/t/parent-agent-reports-task-complete-while-subagents-still-have-pending-actions/169891));
  Devin's CLI went from stopping them on cancel, to parking them, to keeping
  the turn open.
- **Worktrees help, and bringing work back is where it breaks.** Cursor's
  worktree agents "forget that they are working in their own worktree …
  start overwriting each others code"
  ([forum 149072](https://forum.cursor.com/t/multi-agent-mode-loose-worktree-and-apply-undo-apply/149072));
  applies that conflict "reverted" earlier changes
  ([forum 139575](https://forum.cursor.com/t/how-to-properly-use-worktree-and-do-tasks-in-parallel/139575)).
- **Status must be honest.** Gemini CLI reports a run cut off at its turn
  limit as success ([#22323](https://github.com/google-gemini/gemini-cli/issues/22323));
  Cursor treated a failed subagent as finished until v2026.10.22.
- **Reviewing is the bottleneck, not writing.** Ten months of Copilot's
  cloud agent in dotnet/runtime: 878 pull requests, 67.9% merged, "one
  person can generate PRs faster than a team can review them", and success
  went from 38% to 69% once its environment was set up
  ([Toub](https://devblogs.microsoft.com/dotnet/ten-months-with-cca-in-dotnet-runtime/)).
- **Blocking delegation was the top request, and everyone moved to "answer
  now, report later".** OpenCode's "True Async/Background Sub-Agent
  Delegation" ([#5887](https://github.com/anomalyco/opencode/issues/5887)):
  "the gap between opencode and claude code is quite wide on subagent
  orchestration"; Factory's turn now finishes "while background tasks keep
  running"; Roo Code's request for parallel agents (83 comments,
  [#12330](https://github.com/RooCodeInc/Roo-Code/issues/12330)) was still
  open when it was archived.
- **Stuck helpers with no time limit.** OpenCode's subagents "frequently
  getting stuck with no timeout/retry, which then hangs the session"
  ([#11865](https://github.com/anomalyco/opencode/issues/11865)); Cline's
  "stuck in infinite loop … continuously deducting tokens"
  ([#9673](https://github.com/cline/cline/issues/9673)), after which
  `spawn_agent` got a hard five minutes.
- **Stopping the parent must stop the children,** or say it doesn't. Cline
  left them running until September 2026 ("Stopping a session now actually
  stops everything it started",
  [desktop-v0.0.21](https://github.com/cline/cline/releases/tag/desktop-v0.0.21));
  Factory's runs left "stray processes" (v0.229.0).
- **Decide up front whether a helper can wait on the person.** OpenCode's
  nested asks hung silently for eight months
  ([#13715](https://github.com/anomalyco/opencode/issues/13715)); Factory's
  crashed the session, so it now rejects them; Cline's children asking on one
  terminal meant "a single `y` could approve more than one pending
  operation". A hidden or unrouted ask is worse than either answer.
- **A result delivered as a user message can be billed as one.** OpenCode's
  synthetic messages counted as premium requests on GitHub Copilot
  ([#8030](https://github.com/anomalyco/opencode/issues/8030)).
- **Keep summaries, not transcripts, in the record.** Cline's team store
  reached 1.66 GB from every streamed chunk, and now keeps "a summary instead
  of the transcript" ([sdk v0.0.90](https://github.com/cline/cline/releases/tag/sdk%2Fsdk%2Fv0.0.90)).
- **Persist the pending helper and its delivery outside the agent.** OpenCode
  (a marker and a notification id, delivered once) and Roo Code (the parent
  waiting on a named child, in its saved history) both came to it after
  losing results.
- **Orchestrators moved from waiting to being woken.** Orca rebuilt its
  orchestration on 2 November 2026 so coordinators end their turn, "a lot
  more token efficient and reliable"; Nimbalyst's tools say "Never poll";
  Superset and Conductor still block or poll. One measurement put an idle
  parent's waiting turns at 6.5% of tokens and 12.7% of cost
  ([dev.to](https://dev.to/maxstravion/the-idle-parent-trap-on-llm-agents-1ma5)).
- **Deliver at the session's prompt, never through keystrokes.** Orca typed
  a wake into the coordinator's terminal while a person was typing, and it
  went in with their draft ([orca#36685](https://github.com/stablyai/orca/issues/36685)),
  and typed it again after it was read
  ([#36691](https://github.com/stablyai/orca/issues/36691)); once Claude Code
  wrapped pasted text, Agent Orchestrator delivered one batch 51 times over
  an hour and a half ([#7606](https://github.com/OrchestratorInc/agent-orchestrator/issues/7606)),
  and a stuck-report interrupt cancelled six running turns and a message the
  person had just sent ([#7434](https://github.com/OrchestratorInc/agent-orchestrator/issues/7434)).
- **One component starts turns.** Sculptor's agent waking itself inside a run
  starved queued messages and broke Stop; the host became "the only
  turn-initiator", wakes queued with the person's messages.
- **Waking on everything floods the parent, and a wake can loop.** Nimbalyst
  stopped informational reports by default, keeps only the newest update per
  child, doesn't wake on a child's error after an instant-429 loop, and caps
  fifty children in a parent's life beside four at once; Agent Orchestrator
  holds a done report five minutes for the others.
- **Settle on the helper's turn end, not on a report it may skip.** An Orca
  worker ended on a question in plain text, with no `worker_done`, and the
  dispatch looked fine for seven minutes
  ([#37040](https://github.com/stablyai/orca/issues/37040)).
- **Idle is hard to read from outside.** Vibe Kanban took Claude Code for
  idle while it waited on its Task subagents, and committed partial work
  ([#2783](https://github.com/BloopAI/vibe-kanban/issues/2783)).
- **Models drift silently.** Nimbalyst's children fell back to Claude Opus
  under other parents; Agent Orchestrator's prompt forbids substituting a
  requested model.
- **Parallel readers, one writer.** Cognition's "Don't Build Multi-Agents"
  (June 2025) found parallel subagents made "conflicting decisions"
  ([post](https://cognition.com/blog/dont-build-multi-agents),
  [HN](https://news.ycombinator.com/item?id=45096962)); its follow-up (April
  2026) says what works is when "writes stay single-threaded and the
  additional agents contribute intelligence rather than actions", that a
  reviewer with a clean context that sees only the diff beats one with the
  coder's history, and that "Agents assume they share state with their
  children when they don't"
  ([post](https://cognition.com/blog/multi-agents-working)). LangChain:
  "Read actions are inherently more parallelizable than write actions"
  ([post](https://www.langchain.com/blog/how-and-when-to-build-multi-agent-systems)).
- **Breadth pays, at a price.** Anthropic's research system, an Opus lead
  with Sonnet subagents, beat a single Opus by 90.2%; agents use about 4× the
  tokens of chat and multi-agent systems about 15×; "Most coding tasks have
  fewer parallelizable parts than research"; vague briefs duplicated work,
  and early versions spawned "50 subagents for simple queries"; subagents
  "pass lightweight references back" rather than everything
  ([post](https://www.anthropic.com/engineering/multi-agent-research-system)).
- **Dependent work in swarms goes badly.** Anthropic's red team saw 80
  agents open hundreds of pull requests and merge few, 18 of 30 same-model
  agents pick the same branch name, and agents with no channel poll at about
  30 a second; "transmitting context is about as costly as acting on it"
  ([post](https://www.anthropic.com/research/multiagent-systems),
  [HN](https://news.ycombinator.com/item?id=49316271)).
- **Polling invites busy-waiting and stale reads.** LangChain's async
  subagents had models "polling right after launch, stale status reports,
  truncated task IDs", fixed by pushing the result; Microsoft's background
  agents depend on wait and poll tools, and lose their tasks on a restart.
- **Results are data, not orders.** Microsoft: "A compromised child can
  exfiltrate delegated input or return indirect prompt-injection content";
  Pydantic: untrusted results "could imitate another task's result". A
  supervisor "cannot answer or approve on the user's behalf" (Deep Agents).
- **Deliveries come twice.** A2A and OpenAI's webhooks both say to expect
  duplicates and handle them idempotently.

### What this means for Althar

[ADR-087](../decisions/tasks.md#helpers)
takes these: Althar, as the client that owns the lead's conversation, sends
the result as a turn of its own, the same on every agent, after the turn
under way and batched; a helper works in a copy of its own and brings
writing back on purpose; it never has more than its lead; it starts from a
brief, and hands back its last message, kept before it is sent; and it is
capped in number, depth and time. It switches off each agent's own background
helpers where it can, keeping those that answer within the turn where the
agent allows it ([Each agent Althar runs](#each-agent-althar-runs-and-its-own-helpers-over-acp)).

### Not found

- Amp's and Factory's exact delivery of a background result (closed source,
  and Factory's docs contradict themselves).
- How Codex cloud tasks are stopped from the app, and whether a cloud result
  can come back into the chat that sent it.
- Concurrency caps for Orca's workers, Agent Orchestrator, Superset and
  Conductor; Devin's ("depends on your plan").
- Whether OpenCode, Gemini CLI, Cursor, Cline or Devin show their own
  subagents to an ACP client as child sessions.
- What Junie's and Antigravity's background helpers do to an ACP turn, and
  how Junie's can be switched off.
- Reddit, which the research couldn't reach; Hacker News threads were read
  where they turned up.
