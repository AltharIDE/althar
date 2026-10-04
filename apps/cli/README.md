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

## Work on it

From `apps/cli`:

| Command | What it does |
| --- | --- |
| `bun run build` | Builds `dist/althar.js`, with everything but Node's own modules inlined |
| `bun run check` | Format, type-aware lint and type checks |
| `bun run test:coverage` | The tests, with the coverage gate: 90% of lines and branches |
| `bun run verify` | Check and coverage, as CI runs them |

See [ARCHITECTURE.md](ARCHITECTURE.md) for how it is put together.
