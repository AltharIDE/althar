# @althar/cli

A command-line client for the Althar runtime, the first step of the MVP's build order: the agent harness without a UI. It opens a folder as a project, starts a task in a worktree of its own, and starts the task's agent, which begins on the task from its brief. Then you talk to it. The runtime runs inside the CLI's own process, over the same profile the app will use.

## Use it

Build it once, then run it on Node (not Bun: the store needs `node:sqlite`):

```bash
bun run build
```

```bash
node dist/althar.js ~/work/meridian --task "Retry the checkout" --agent codex
```

The agent must be signed in with its own tool first (`claude auth login`, `codex login`, `opencode auth login`); the CLI checks, and names the command when it isn't.

Then type to talk to the agent. Your message waits for the agent's turn to end.

| Command | What it does |
| --- | --- |
| `/interrupt <text>` | Stop the turn, and say this first |
| `/model <id>` | Change the model; the session carries on |
| `/agent <id> [model]` | Hand the task to another agent, briefed with the thread so far |
| `/allow [reason]`, `/reject [reason]` | Answer the question waiting for you, when the rules keep an action for you |
| `/stop` | Stop the session |
| `/quit` | Stop everything and leave; so does Ctrl-C |

| Option | Default |
| --- | --- |
| `--agent` | `claude-code`; also `codex` and `opencode` |
| `--model` | The agent's own default |
| `--profile` | `~/Library/Application Support/Althar` on macOS, or `$ALTHAR_PROFILE` |
| `--worktrees` | `~/Althar`, or `$ALTHAR_WORKTREES` |

One runtime at a time can use a profile; a second CLI on the same profile stops with `DatabaseInUse`.

## Attach to a running home

The existing folder command above still embeds the runtime. `attach` connects
to an already running home instead; it never opens its database, checks local
provider sign-in or owns the home's lifetime. Agents and repositories live on
the home. Open/provision the project there first.

```bash
node dist/althar.js inspect --profile /absolute/path/to/profile
node dist/althar.js inspect --ssh my-vps
# Verify the printed home identity independently, then list its projects:
node dist/althar.js inspect --ssh my-vps --home home_<32-hex-digits>
node dist/althar.js attach --ssh my-vps --home home_<32-hex-digits> --project proj_<32-hex-digits> --task "Retry checkout" --agent codex
node dist/althar.js attach --ssh my-vps --home home_<32-hex-digits> --thread thr_<32-hex-digits>
```

For local attachment replace `--ssh … --home …` with `--profile /absolute/path`;
`--home` can also pin a local profile. SSH uses system OpenSSH and the managed
host launcher. Configure and verify your host key and noninteractive key/agent
authentication in a terminal first. Optional `--ssh-config`, `--ssh-port`,
`--remote-launcher` and `--remote-profile` select an explicit config, port or
absolute remote paths. No arbitrary remote command is accepted.

**In attached mode `/quit`, EOF, Ctrl-C and SIGTERM disconnect only.** Work
continues on the home; reattach with the printed thread ID. `/stop` explicitly
stops the session. `/allow` and `/reject` cannot approve anything: SSH/socket
authority is not person authority. Answer in the trusted desktop window.
`/interrupt`, `/model` and `/agent` use the shared versioned command API.

New-task attachment prints a creation command ID before dispatching. If a
connection fails with an uncertain outcome, use the same `--command-id cmd_…`
with the same creation options to recover its receipt. The corresponding
session start uses a separate deterministic ID too. Prefer `--thread` to join
an existing task without starting or switching its agent. Commands are never
automatically replayed. History changes trigger a fresh checked snapshot; a
disconnected client exits with a visible error. This terminal shows the newest
100 items and cumulative live text, with each item limited to 65,536 characters; older history, full oversized items, files and rich evidence
remain in the desktop interface.

## Work on it

From `apps/cli`:

| Command | What it does |
| --- | --- |
| `bun run build` | Builds `dist/althar.js`, with everything but Node's own modules inlined |
| `bun run check` | Format, type-aware lint and type checks |
| `bun run test:coverage` | The tests, with the coverage gate: 90% of lines and branches |
| `bun run verify` | Check and coverage, as CI runs them |

See [ARCHITECTURE.md](ARCHITECTURE.md) for how it is put together.
