# Talk to Althar from a terminal

Use the CLI to open a project and talk to its agent, or to join a home that's already running. A home can be on your computer or on a Linux server you reach over SSH. [Try a Linux home](../host/preview/README.md)

## Use it

Build the CLI from `apps/cli`. Run the result with Node, which provides the SQLite support the local runtime needs.

```sh
bun run build
node dist/althar.js ~/work/meridian --task "Retry the checkout" --agent codex
```

Choose a Git checkout and describe the task. Sign in to the agent's own tool first, for example with `codex login`, `claude auth login` or `opencode auth login`. The CLI tells you which sign-in command to use if it needs one.

This starts a local runtime and a task in its own worktree. Type a message and press Enter to send it after the agent's current turn.

| Command | What it does |
| --- | --- |
| `/interrupt <text>` | Stop the current turn and send this message first |
| `/model <id>` | Change the model and carry on with the session |
| `/agent <id> [model]` | Hand the task and its conversation to another agent |
| `/allow [reason]`, `/reject [reason]` | Answer a permission request in local mode |
| `/stop` | Stop the session |
| `/quit` or Ctrl-C | Leave the CLI and stop its local runtime |

| Option | Default |
| --- | --- |
| `--agent` | `claude-code`. You can also choose `codex` or `opencode`. |
| `--model` | The agent's default |
| `--profile` | `~/Library/Application Support/Althar` on macOS, or the path you set in `$ALTHAR_PROFILE` |
| `--worktrees` | `~/Althar`, or the path you set in `$ALTHAR_WORKTREES` |

If you see `DatabaseInUse`, a runtime already has that profile open. Use `attach` to join a running home or choose another profile for a separate local session.

## Attach to a running home

Use `attach` when the project and its agent are already on an Althar home. The home keeps its database and runs the agent, so your terminal can come and go.

1. Open the checkout on the home first. For a server, check that `ssh my-vps` works with your SSH key. Use the name or alias that you normally connect with in place of `my-vps`.
2. Inspect the home and compare its `homeId` with `althar-host status --json` on the server. Set `HOME_ID` to that value before you run the second command. For an unpacked preview, include `--remote-launcher /absolute/path/to/althar-host` on each SSH command. Use `--remote-profile` if you set up a custom profile.

   ```sh
   node dist/althar.js inspect --ssh my-vps
   node dist/althar.js inspect --ssh my-vps --home "$HOME_ID"
   ```

3. Start a new task using a project ID from the list, or join a task using its existing thread ID. Set `PROJECT_ID` or `THREAD_ID` to the ID you looked up, then run the matching line.

   ```sh
   node dist/althar.js attach --ssh my-vps --home "$HOME_ID" --project "$PROJECT_ID" --task "Retry checkout" --agent codex
   node dist/althar.js attach --ssh my-vps --home "$HOME_ID" --thread "$THREAD_ID"
   ```

For a home on this machine, use `--profile /absolute/path/to/profile` in place of the SSH target. You can also supply `--home` to verify the local identity. `--ssh-config` and `--ssh-port` are available for a different OpenSSH setup. [Host guide](../host/README.md#ssh-clients)

In an attached session, `/quit`, Ctrl-C and a closed terminal disconnect your view and let the home's work continue. Rejoin with the printed thread ID. Use `/stop` to stop the agent's session. SSH connections have a restricted role, so use a trusted desktop window for permission answers.

If the connection fails while creating a task, reuse the printed `--command-id cmd_…` with the same options to recover the creation receipt. For an existing task, use its thread ID. The terminal shows the latest 100 items, up to 65,536 characters each. Use the desktop for older history and files.

## Connect a worker to the Desktop home

The Desktop app can use the same Linux workers as a standalone Linux home.
The worker connects to Desktop's built-in home, where your project and its task
history already live. Use a worker certificate issued by the CA you configure
for this home. Keep the worker and home private keys on their respective machines.
[Worker certificates and routes](../host/README.md#native-worker-diagnostic)

Use the CLI under the same OS account and with the same profile and worktree
paths as Desktop. Enable the private local API with `ALTHAR_API_SOCKET=1` when
starting Desktop so the CLI can look up that home's identity and projects.

```sh
node dist/althar.js workers configure --address "$PRIVATE_IP" \
  --ca "$TLS/home-ca.pem" --certificate "$TLS/home.pem" --key "$TLS/home.key"
node dist/althar.js inspect
node dist/althar.js workers enroll --certificate "$TLS/worker.pem" --project "$PROJECT_ID"
```

Restart Desktop after changing the listener configuration. Enrollment prints
the home and worker IDs for the worker's connection arguments. Use the name on
the home certificate and port 6770 by default. The worker appears in **Run on**
when a held plan can use it. To cut off a certificate, use
`workers revoke --worker <id>`. To turn off the listener, use `workers disable`
and restart Desktop. [Start an agent on the worker](../host/README.md#run-an-althar-task-on-a-separate-worker)

For an outbound worker relay on both machines, give `workers configure` the
home link file with `--relay <file>` and leave its address at the default
`127.0.0.1`. The worker connects with its own relay credentials. [Relay setup](../../packages/worker-protocol/README.md#outbound-worker-relay)

## Work on it

Run these from `apps/cli`.

| Command | What it does |
| --- | --- |
| `bun run build` | Builds `dist/althar.js` |
| `bun run check` | Checks formatting, lint and types |
| `bun run test:coverage` | Runs the suite with a 90% line and branch coverage gate |
| `bun run verify` | Runs the checks and coverage, as CI does |

See the [CLI architecture](ARCHITECTURE.md) for where the pieces live.


### Save a file made on the worker

While a worker task is running, you can bring back a build output or log by
giving its path inside the task checkout. This works even for ignored or
untracked files. Use the running Desktop profile and the project's and task's
IDs. For a secondary repository, add `--workspace` with that checkout's ID.

```sh
node dist/althar.js workers fetch-file --project "$PROJECT_ID" --task "$TASK_ID" \
  --path dist/report.json --out "$PWD/report.json"
```

The runner accepts regular files up to 16 MiB inside the checkout. It verifies
the file before saving it under the name you choose. If that name already
exists, choose another one.
