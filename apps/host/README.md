# Run an Althar home on Linux

An Althar **home** is where your projects, task history and running sessions live. Put a home on a Linux machine if you want your work to keep going when you close the desktop window. You can come back to it from the desktop or the command line.

A **worker** is a Linux machine that runs a home's tasks, one at a time. Add one from **Settings › Computers › Add a worker** with its SSH address, or with a one-time code on a machine you can't reach over SSH. The home keeps the conversation and handles permission requests. [Add a worker](#add-a-worker)

## Try the host and worker preview

Start here if you're curious about how the pieces fit. The download includes both binaries and a demo. In one terminal you can see a Git check run, the worker reconnect after a home restart and a long-running command stop on cancellation. [Download and test the preview](preview/README.md)

Once you've tried that, you can connect the desktop to a test home over SSH or use a checkout of your own. [Desktop test](preview/README.md#connect-the-desktop-to-a-test-home-over-ssh) · [Project command](#run-a-project-command-on-a-linux-worker)

## Build and initialize

The preview includes a ready-to-run `./althar-host`. For a source build, use Linux, Git and the Node and Bun versions pinned in the repository. Run these from the repository root.

```sh
bun install --frozen-lockfile
bun --filter @althar/host build
node apps/host/dist/althar-host.js init --project /absolute/path/to/repository --json
node apps/host/dist/althar-host.js serve
```

`init` registers a checkout that's already on the home machine. Pass `--project` again for each checkout you want to open. You can also leave it out and make projects from the desktop once it's connected: a home with none opens on its welcome, where its agents sign in, GitHub or GitLab connects on the home (with a token made on the host's page, or the home's own `gh` or `glab` sign-in), and a project clones from the home's code hosts or from one of your projects on the desktop. Keep the `homeId` and project IDs it prints. You can initialize again with the same profile to add projects while the service is stopped. The home keeps its identity and key.

`serve` runs in the foreground. You can stop it with Ctrl-C. For a home that stays up on its own, install the service below.

### Where the home keeps its files

| What | Default |
| --- | --- |
| Home profile, including its database, artifacts, encrypted connector secrets and backups | `${XDG_DATA_HOME:-$HOME/.local/share}/althar-host` |
| Task worktrees | `<profile>/worktrees` |
| Master key for connector secrets | `${XDG_CONFIG_HOME:-$HOME/.config}/althar-host/master-key` |
| systemd user unit | `${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/althar-host.service` |
| Managed program and update files | `${XDG_DATA_HOME:-$HOME/.local/share}/althar-host-program` |

Use a profile of its own for the home. It has its own database and key, separate from the desktop. Use `--profile`, `--worktrees` and `--key-file` if you need different paths. Keep the master key outside the profile, backups and project checkouts. Back it up separately. The home checks the key's file permissions and fingerprint at startup.

The home records the worktree path in `host.json` and expects that directory on the next start. To move it, stop the home, repair the Git worktree references, update the recorded path and check the new location before restarting.

## Supervision

A systemd **user** service lets the home keep running in the background. It needs a reachable user service manager and `systemd-notify`. In the unpacked preview, run these after initialization. For a source build, use `node apps/host/dist/althar-host.js` in place of `./althar-host`.

```sh
./althar-host install-service --start
./althar-host status --wait --json
```

Look for `"state":"ready"` and the home ID. The check waits up to 30 seconds for storage and the private API to be ready. If the service fails to start, look at its journal.

```sh
journalctl --user -u althar-host.service -n 60
systemctl --user restart althar-host.service
systemctl --user stop althar-host.service
```

- The unit remembers the absolute paths to Node and the host entry point. Keep them at those paths while it is installed.
- Omitting `--start` writes the unit and reloads systemd. Restart deliberately after changing a running installation. Put your own unit settings in a [systemd drop-in](https://www.freedesktop.org/software/systemd/man/latest/systemd.unit.html).
- Use `--service-name` with a separate `--profile` for a second home. Give each profile one running service.
- Ask the server administrator to enable lingering with `loginctl enable-linger <user>` if the service should survive the last logout and start after a reboot.

The service gets its key through systemd credentials. On stop, it closes its API and releases the database. systemd also stops child processes, including detached agents. For unit behavior and recovery details, see the [host architecture](ARCHITECTURE.md).

## SSH clients

If you already sign in to your server over SSH, you can use the same connection to open its running home. First check that your desktop can sign in with its SSH key and that it knows the server's host key. Then enter the same SSH target in **Homes → Connect a home… → SSH**. Compare the home ID shown by **Check host** with `althar-host status` on the server before connecting. [Step-by-step desktop test](preview/README.md#connect-the-desktop-to-a-test-home-over-ssh)

The desktop and CLI use the host's `connect-stdio` command for the session. This command checks the expected home ID and API version. When you disconnect, the home and its running sessions carry on. SSH lets you work with the home under a restricted role. Permission answers and device pairing require a client with the person's authority. [CLI attachment](../cli/README.md#attach-to-a-running-home) · [Transport reference](../../packages/transport-node/ARCHITECTURE.md)

Desktop-driven setup uses SSH to install a signed host on a new server: in the desktop, **Connect a home… → Set one up → Over SSH**, or **SSH** with **Set it up** once you've chosen that way. Each step shows as it goes, and setup carries on with the dialog closed or after Althar restarts. It needs a published release and the desktop's pinned release key; until the first host release is out, setup says there's nothing to install yet. Althar from Flathub can't set a home up, as its sandbox keeps your SSH keys out of reach: set it up by hand there, then connect over SSH or with a pairing code. [SSH setup reference](bootstrap/README.md)

Your first home opens on what a home is. Choose **Set one up**, then **With a pairing code** to connect a host that's already running.

## Direct HTTPS/WSS and device pairing

If your desktop can reach the home over a private network such as Tailscale, you can connect with a pairing code. Use a matching RSA or ECDSA PEM certificate and key for the HTTPS name. A private or self-signed leaf certificate of up to 4 KiB in DER form works. Keep the files private with mode 0600 and put the key outside the profile and worktrees.

```sh
althar-host configure-network --profile /path/to/profile \
  --origin https://home.example:6769 --listen-address 0.0.0.0 \
  --tls-certificate /private/tls/certificate.pem --tls-key /private/tls/key.pem
systemctl --user restart althar-host.service
althar-host pair --profile /path/to/profile
```

It prints the code and its `link`. To pair a phone, show the link as a QR (any QR tool does): a phone's camera opens it in Althar, or sends a phone without Althar to its store first. A window on the home, over SSH or this computer's own, shows the same from **Homes → Pair a phone…**.

In the desktop, open **Homes → Connect a home… → Pairing code**. Paste the code, check the destination, give the home a name and choose **Pair and open**. The home opens in its own window. Its projects stay on the server.

A code ties the connection to the home certificate's public key. It enrolls one device and expires after five minutes or when the home restarts. If a reply gets lost, the desktop can retry with the same pending key while the code is valid. The desktop stores the device key in its OS keyring. The paired connection opens existing projects and tasks, and makes a project on the home, from a repository cloned there, one the home finds in `~/code`, `~/projects` and the like, or a new one. Set up a security key separately when you want to answer permission requests from that desktop.

```sh
althar-host devices --profile /path/to/profile
althar-host revoke-device --profile /path/to/profile --device-id dev_...
althar-host disable-network --profile /path/to/profile
```

Use the `next` value from `devices` with `--after` for another page. Revocation ends that device's connections right away. Work the home already accepted may finish. Restart the service after changing or disabling the listener.

Pair again if you change the TLS key or replace a self-signed certificate. Renewals with the same key and trusted chain keep working. Back up the home database and desktop keyring according to your usual recovery plan.

### Answer permissions with a security key

Use an HTTPS home at a DNS name with a certificate your browser trusts. Pair the desktop to that same address. A personal FIDO2 security key with a PIN can confirm each answer in the browser. The home keeps the connection's existing authority and applies the specific decision once it verifies the confirmation.

1. As the server administrator, create a key file under `/etc/althar` in directories owned by root. Keep the file readable by the host service and writable by root. For the first setup, use this shape with the exact home ID from `althar-host status --json` and its HTTPS origin.

   ```json
   {
     "version": 1,
     "homeId": "home_0123456789abcdef0123456789abcdef",
     "origin": "https://home.example:6769",
     "credentials": []
   }
   ```

2. Run `configure-network` with the existing address and TLS options and `--approval-keys /etc/althar/approvals.json`. Restart the host service.
3. In the paired desktop window, open **Manage homes**, open the home's menu, then choose **Set up a security key**. Register the key you physically control and download its public key file. Compare the SHA-256 shown on that page with `sha256sum althar-approval-key.json` in your administrator session before installing it. The file contains the home, origin and paired device ID. Check those against your home and its device list.
4. Install the verified entry in the administrator's `credentials` list and restart the host service. Keep other devices' entries if they still need access. For a lost security key, revoke the paired device and remove its entry. Pair a new device to set up a replacement.

When a permission is waiting in the desktop, choose **Allow** or **Reject** and confirm the exact decision in the browser. The agent continues as soon as the home accepts it.

## Add a worker

A worker can be any 64-bit Linux machine (x64 or arm64) with systemd 254 or later and a user service manager. Git is useful for projects' setup. It works for whichever home added it: This Mac, or a Linux home of its own.

**Over SSH.** In the home's window, open **Settings › Computers › Add a worker**, type its SSH address as you would after `ssh` (a name from your SSH config, or `user@host`), and choose **Add worker**. Althar uses your own OpenSSH, its keys and your known hosts, and asks you to trust the machine's key the first time.

1. It looks the machine over. Logged in as root, it makes a user of its own, `althar`, with the SSH key you logged in with, and lingering on, as setting up a home does.
2. It installs the worker's own signed release, published beside the home's: the worker, Node, both agents' ACP adapters and the agents' own programs, and none of the home. The machine downloads it, or Althar sends it from your computer. Its signature is checked against Althar's release key before anything runs.
3. The release makes the worker's own key. Your window asks the home to sign it, and the home enrolls the worker by that key under the name you gave.
4. Althar writes what the home gave onto the worker and starts `althar-worker.service`, a systemd user service that restarts if it stops, and a timer that updates it.

It shows in **Settings › Computers** once it connects. Pick the projects it works on there, and sign its agents in: Codex with a one-time code you enter on your computer or phone, Claude Code in your browser, with the code its page shows pasted back. A worker takes no task until it has a project.

The worker is a service of its login's own, so that login must linger: without it, the worker stops when the setup's SSH session ends. A root login gets a user that lingers. For a regular login without lingering, Althar turns it on where the login may use `sudo` without a password; otherwise it stops before installing anything and shows the line for the machine's administrator, `sudo loginctl enable-linger -- <user>`, and **Try again** goes on once it has been run.

**With a code.** Choose **With a code** in the same dialog and run the line it shows on the machine. It installs the newest release from Althar's releases page and enrolls the worker with the code. The code works once, for ten minutes or until the home restarts. The window can't reach such a machine to sign its agents in, so sign them in there, as the worker's user. This says Codex's one-time code, and the worker says it's signed in once it ends:

```sh
program="${XDG_DATA_HOME:-$HOME/.local/share}/althar-worker-program/current"
"$program/node/bin/node" "$program/dist/althar-worker.js" sign-in --agent codex --way device
```

On a worker installed from a home's release, before workers had their own, it's `"$program/dist/althar-host.js" worker sign-in …` until its next update moves it to the worker's release.

### Taking a worker out

Open it in **Settings › Computers** and choose **Remove**. The home no longer accepts its key and gives it no more work, and the worker takes itself off its computer: it stops its services and removes them, its folder (its key, journal, checkouts and tools) and its program folder. Offline at the time, it does so once it next reaches its home; **Remove** also shows the line that does it there now, as the worker's user:

```sh
"${XDG_DATA_HOME:-$HOME/.local/share}/althar-worker-program/current/althar-worker" uninstall
```

Its agents' sign-ins (`~/.codex`, `~/.claude`) stay: they're the agents' own files. So does the login's lingering, and the `althar` user where setup made one. The AppArmor rule setup made for the sandbox goes where the login may use `sudo` without a password; otherwise the uninstall shows the line for the machine's administrator. Add the worker again, over SSH or with a code, and it becomes a new worker with the same key.

A worker cleans up after its tasks too. Each run gets its own checkout, its helpers' copies and some scratch, and they all go once the home has recorded how the run ended: nothing reads them after that. A worker that stopped mid-run keeps that run's checkout until its home has settled the run, and when it starts again it removes what a crash left of runs its home is done with. A workspace set up by hand, named only by its workspace ID, is never the worker's to remove.

### How a worker and its home trust each other

- **The home is its own authority.** The first time a worker is added, the home makes a certificate authority of its own and a certificate for its worker port, kept in `<profile>/workers/authority.json` and readable only by the home's user. It opens its worker port, 6770 where that is free, without a restart. Nobody makes or copies certificates.
- **A worker is its key.** The worker makes its P-256 key and keeps it. The home signs it as a client certificate and enrolls the worker by that key. A connection must present a certificate the home's authority signed, for a key the home enrolled. Removing the worker refuses its key.
- **The worker trusts only its home.** It keeps the home's authority certificate, and checks that the home's certificate names `home.althar.invalid`, whichever address it reaches the home at. It tries each address the home gave in turn, with the address the SSH setup came from first where the home is that computer.
- **Who may add, change and remove workers.** The person's own window, or a window on a Linux home over SSH, which reaches it as its operator, as `althar-host` does. A window on a device paired over the network may not. Adding a worker gives it no say in the person's word: it runs what the home sends it, for the projects picked for it, and returns changes for the home to review and publish.
- **Codes.** A code carries the home's ID, the addresses it may be reached at, its authority's certificate and a random token. The home keeps only the token's SHA-256, in memory, and opens the port codes enroll on, beside the worker port, only while one waits. A worker that lost the reply may ask again with the same key; another key can't use the code.
- **Releases.** Over SSH, your computer checks the release against Althar's pinned release key, and the worker keeps that key for its updates. With a code, the machine takes the release and its key from Althar's releases page over HTTPS, and checks the archive against its manifest; every later update must be signed by that key.

### Where a worker keeps its files

| What | Where |
| --- | --- |
| Its key, its certificate, the home's authority and addresses, its journal and task checkouts | `${XDG_DATA_HOME:-$HOME/.local/share}/althar-worker` |
| The worker release it runs, as `current`, and the one before | `${XDG_DATA_HOME:-$HOME/.local/share}/althar-worker-program` |
| Its services | `${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/althar-worker.service`, `althar-worker-update.timer` |

The timer checks hourly for a newer worker release on Althar's releases page, signed by the same key, and switches to it while the worker runs no task. A worker installed from a home's release moves to the worker's own release of the same version at its first check. `journalctl --user -u althar-worker.service` shows what the worker did, and `journalctl --user -u althar-worker-update.service` what its updates did.

**Updating now.** Once a newer worker release is out, the window offers it: under the Updates glyph in its bar, and in Settings › Computers. The home asks the worker between its runs, after the task it runs, or once it connects; the worker runs the same update in a unit of its own and says how it ended, or comes back on its new release. A worker from before this, or one set up by hand, can't be asked: it updates on its own timer, and the window gives the line to run on it now, as its own login:

```sh
systemctl --user start althar-worker-update.service
```

## Set a worker up by hand

A home that takes workers by its operator's own certificates, configured with `configure-workers`, keeps them: Add a worker shows the commands for it, and the home doesn't make its own authority. The rest of this section covers that way, a diagnostic run and a project command. Most people don't need it.

<a id="native-worker-diagnostic"></a>

<details>
<summary>The native worker diagnostic</summary>

Before running one of your own commands, ask the worker to identify its operating system. It runs `uname -s`, so the expected output is `Linux`. This is a quick way to check the certificates, the connection and the worker's enrollment.

Start with the home and worker on one Linux machine. You need a certificate authority (CA), a home certificate valid for `localhost`, and a client certificate and key for the worker. The home and worker each present a certificate so both know who is connecting. Use a dedicated, unprivileged worker user for ongoing use. Keep PEM files at mode 0600 and the home key outside the profile and worktrees.

<details>
<summary>Make certificates for a localhost test</summary>

Run this on the Linux machine that will run both the home and worker. It creates a test CA, a home certificate for `localhost`, and one client certificate. The certificates last one day. Keep the CA's private key in that directory.

```sh
tls=$(mktemp -d "$HOME/althar-worker-tls.XXXXXX")
(
  cd "$tls" || exit 1
  umask 077
  openssl req -new -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -days 1 \
    -subj '/CN=Althar trial CA' -keyout ca.key -out ca.pem \
    -addext 'basicConstraints=critical,CA:true' -addext 'keyUsage=critical,keyCertSign'
  printf 'basicConstraints=critical,CA:false\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:localhost\n' > home.ext
  printf 'basicConstraints=critical,CA:false\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=clientAuth\n' > client.ext
  for name in home client; do
    openssl req -new -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes \
      -subj "/CN=Althar trial $name" -keyout "$name.key" -out "$name.csr"
    openssl x509 -req -in "$name.csr" -CA ca.pem -CAkey ca.key -CAcreateserial \
      -extfile "$name.ext" -days 1 -out "$name.pem"
  done
)
printf 'Certificate directory %s\n' "$tls"
```

</details>

1. On the home, configure the listener and enroll the worker certificate. These examples use the default home profile and port 6770. Set `tls` to your certificate directory, or keep the value from the test above. For a custom profile, add `--profile /path/to/profile` to each host command and restart its own service. If you unpacked the preview, use `./althar-host`.

   ```sh
   althar-host configure-workers \
     --worker-ca "$tls/ca.pem" --tls-certificate "$tls/home.pem" \
     --tls-key "$tls/home.key"
   althar-host enroll-worker --worker-certificate "$tls/client.pem" --json
   systemctl --user restart althar-host.service
   althar-host status --wait --json
   ```

   Set `WORKER_ID` to the `workerId` from enrollment and `HOME_ID` to the `homeId` from status.

2. On the home, queue the diagnostic and save the printed attempt ID as `ATTEMPT_ID`.

   ```sh
   althar-host worker-run --worker-id "$WORKER_ID" --json
   ```

3. On the worker, use `./althar-worker` from the preview or build it from the repository root with `cargo build --locked --release -p althar-worker`. From the bundle directory, run it once with the IDs from step 1. If you built from source, use `target/release/althar-worker`.

   ```sh
   ./althar-worker https://localhost:6770 "$HOME_ID" "$WORKER_ID" \
     "$tls/ca.pem" "$tls/client.pem" "$tls/client.key" "$HOME/althar-worker-journal"
   ```

   Keep the worker's private key and journal with its OS account. Reuse the journal each time so a reconnect can report a result the worker already saved.

4. Back on the home, read the result.

   ```sh
   althar-host worker-result --attempt-id "$ATTEMPT_ID"
   ```

   A pass says `succeeded` and shows `Linux`. An `unknown` result means the home lost its chance to confirm the outcome, for example after a disconnect or an expired offer. Queue a new attempt if you want to try again.

For a worker on another machine, use a reachable private bind address on the home and a name covered by its certificate. Each worker gets its own client certificate. If both machines can reach a gateway, you can use the [worker relay](../../packages/worker-protocol/README.md#outbound-worker-relay).

Use `revoke-worker --worker-id "$WORKER_ID"` to cut off an enrolled certificate. Add `--project-id "$PROJECT_ID"` to remove the grant for agent execution on that project. When the grant ends, the home refuses new agent runs and checkpoints and asks the enrolled worker to stop its active run. The home keeps the reservation until the worker confirms stop. Enroll a replacement certificate separately. To close the listener, run `disable-workers` and restart the home. Preserve the home ledger at `workers/ledger.sqlite` and each worker's journal when recovering an installation.

</details>

### Run a project command on a Linux worker

Once the diagnostic works, pick a quick command from a trusted checkout. The worker needs cgroup v2 and systemd 254 or later with a user service manager. The command runs as the worker's OS user and has that user's file access. A separate user service tracks all the command's processes so cancellation can stop even a detached child.

1. Set `PROJECT_ID` to the ID in the output of `althar-host init --json --project <path>` or from the home API. On the worker, create a private UTF-8 file outside the checkout with mode 0600. Put the project ID, command name, absolute checkout path and absolute executable path on the first four lines. Use one line for each argument after that.

   For a Git check, use this shape and replace the first and third lines.

   ```text
   proj_0123456789abcdef0123456789abcdef
   check
   /srv/checkouts/example
   /usr/bin/git
   diff
   --check
   ```

2. On the worker, start the same command you used for the diagnostic and add `--project-config /private/project-command --watch`. Watch mode waits for later runs and reconnects after an interruption.

3. On the home, request the command by its name and save the returned ID as `ATTEMPT_ID`.

   ```sh
   althar-host worker-project-run \
     --worker-id "$WORKER_ID" --project-id "$PROJECT_ID" --command-name check --json
   ```

4. On the home, check the output and outcome. Use `worker-cancel` while a run is active if you want to stop it.

   ```sh
   althar-host worker-log --attempt-id "$ATTEMPT_ID"
   althar-host worker-result --attempt-id "$ATTEMPT_ID"
   althar-host worker-cancel --attempt-id "$ATTEMPT_ID"
   ```

The preview runs one configured command per worker with a one-minute budget. The home keeps up to 64 KiB of combined stdout and stderr in up to 1,024 chunks. To read new output only, use `worker-log --json` and pass its `nextOffset` back as `--offset` on the next call. A run becomes `cancelled` after the worker confirms systemd has stopped all of its processes. After a disconnect or crash, the worker's permission to run expires and systemd stops the command. Reconnect with the same journal to settle the result.

## Run an Althar task on a worker

Use a host, worker and desktop from the same release. A task with up to eight Git repositories can run on a worker; reviews run on the home. In the project, prepare a task and hold its plan. Use **Runs on** to pick the worker, or **Any free worker**, then start it. The home rechecks the lead and repositories at Start. It prefers workers with a current report, then more available memory, disk space and CPU cores.

Watch the task thread and open its diff after the agent has responded. The home receives the changes before it records the turn as finished. If a worker drops out, the home waits for it to confirm that its old run stopped before dispatching another run for that workspace.

<details>
<summary>A worker set up by hand: its agents and how it starts</summary>

1. On the home, [enroll the worker certificate](#set-a-worker-up-by-hand) with `--project-id "$PROJECT_ID"`.
2. On the worker, sign in with the provider’s supported command. Install its compatible ACP adapter there. Run the following as the worker user, substituting the project ID and the adapter executable. Use an absolute path, or `*` in place of the project ID for any project the home grants. Put any fixed executable arguments after it, with one tab per argument.

   ```sh
   umask 077
   worker_data="$HOME/.local/share/althar-worker"
   mkdir -p "$worker_data/workspaces"
   chmod 700 "$worker_data/workspaces"
   printf '%s\n%s\t%s\t%s\n' "$worker_data/workspaces" "$PROJECT_ID" codex "$ACP_EXECUTABLE" \
     > "$worker_data/agents.conf"
   ```

3. Start the worker in its own Linux terminal. Keep its journal in this location across restarts. Use the TLS files on the worker.

   ```sh
   ./althar-worker "https://$WORKER_HOME:6770" "$HOME_ID" "$WORKER_ID" \
     "$WORKER_TLS/ca.pem" "$WORKER_TLS/client.pem" "$WORKER_TLS/client.key" \
     "$worker_data/journal" --agent-config "$worker_data/agents.conf" --watch
   ```

</details>

Althar runs the saved project setup in the worker’s task checkout and keeps the result in the thread. While that checkout is active, use the task’s **Run** menu to run a saved build, test or dev server there. The run has its own output and **Stop** button.

A task can send up to eight repositories to the same worker. Althar runs setup and records Git changes separately for each repository. When a helper joins the lead’s changes, it can work in that same checkout if its provider is registered for the project on the worker. A scratch helper starts in its own copy on the worker. If its lead asked it to keep changes, the home keeps them on the helper's own Git ref so the lead can bring them in. The lead's checkout stays separate. Reviews run on the home.

Codex and Claude leads and helpers can use the skills selected for them in Althar. HTTP MCP servers connect through the home, where their credentials stay. For a selected MCP server that starts as a local command, register an executable on the worker using the same server name. Give it its own local configuration and credentials. For example, add this line to `agents.conf` before starting the worker.

```sh
printf 'mcp\t%s\t%s\t%s\n' "$PROJECT_ID" projectTools /opt/althar-tools/project-tools >> "$worker_data/agents.conf"
```

The executable can be a wrapper for a locally installed server. Keep it outside the worker’s workspaces. The thread names selected servers that are unavailable.

Bind a dev server to `localhost`, `127.0.0.1` or `::1` on the worker and have it print its HTTP address. Choose **Worker preview** when the run shows it. The page opens in a private Althar window through the home. The private window supports HTTP pages, form submissions and WebSocket live reload. It closes its connections when the run stops. A desktop connected to an older home can still read pages and assets.

To bring the task to your computer, open its **Parts** menu, choose **Worktree**, and select **Save a local copy**. Althar verifies the download and saves a fresh Git checkout in the folder you choose. The copy keeps the worker’s commits, staged files, and edits that still need staging. If the worker is offline or needs an update, you can choose the home’s current copy. You need Git on your computer.

If the worker is offline, Althar offers to save the home’s copy. Its files may be older than the files on the worker. Each copy carries an `althar-snapshot.json` record so you can see which version you opened.

The home sends a Git bundle with the task’s tracked and unignored files and the history the worker lacks. A worker keeps a copy of each project’s history in its project folder (`.althar-history.git`) and tells its home, as it connects, the newest commits that copy holds. The first send for a project carries its history, up to 4 GiB; later sends carry only the task’s new commits and changes, and the thread says how much went. A worker set up before it kept history takes whole bundles of up to 128 MiB, as before, until it updates. Where a send is still too large, the start says what makes it so (a large uncommitted, unignored file, the history, or an older worker) and what to do. The home keeps the task’s own checkout and receives the agent’s original commits and binary Git patches back. A checkpoint can contain up to 64 MiB of new commits and a 16 MiB patch. If the home checkout changes independently, the home reports the conflict and the worker keeps its files. Interrupted runs keep their checkouts under the worker’s workspace root so you can recover unsynced edits.

Publish from the home, where the project's Git credentials and approval
rules apply. The worker checkout's Git hook directs pushes back to the home.
The worker's own operator account and filesystem permissions define what
the provider can reach on that machine.

## Managed releases and updates

A managed home checks for a new release, downloads it and verifies its signature. **You choose when to apply it by default.** That lets you finish active work before the home restarts. The managed updater uses the host release feed and an Ed25519 public key you obtained from a trusted source independently of that feed. The worker runs and updates separately.

To convert a source installation, use a built checkout with frozen dependencies and an official Node distribution with its `LICENSE`. Let active work finish before stopping the service.

```sh
systemctl --user stop althar-host.service
node apps/host/dist/althar-host.js configure-updates --release-key /trusted/host-release.pub
systemctl --user enable --now althar-host.service
sh "$HOME/.local/share/althar-host-program/launcher" update-status
```

The conversion keeps your home ID, profile, key and worktrees. Use `--installation /absolute/program/path` to override where the managed program lives. Keep it separate from the profile, worktrees and keys. Match any custom profile, unit or credential options you installed with, including `--encrypted-credential` if you use it.

The timer checks roughly once an hour and stages a verified release while the home runs. You can check immediately or choose to apply a staged release.

```sh
sh "$HOME/.local/share/althar-host-program/launcher" update --wait
sh "$HOME/.local/share/althar-host-program/launcher" update --apply --wait
journalctl --user -u althar-host-update.service
```

`configure-updates --automatic-updates` lets a compatible staged release activate at the next service start. Use `--manual-updates` to return to explicit application. Changes to the API or database format always need `--apply --allow-incompatible`. Check the clients and make a separate export first. A desktop window that reaches the home over SSH does this itself for a release that only moves the data: it asks once, then applies it, and it never applies a release whose API version differs from its own.

### If an update stops partway through

The updater reserves storage, stops the old service and snapshots its SQLite database. It prepares and checks storage before the new service accepts work. It activates the candidate only after confirming the expected home identity and a ready API.

- If preparation fails, the updater restores the snapshot and restarts the previous code.
- If a compatible release fails to start, it switches back to the previous code and keeps newer database writes.
- If an incompatible release fails after starting, the updater preserves the data and leaves the service stopped. Check `update-status`, then stage a corrected release for explicit application. If you need to restore an export, stop both the host and updater first.

An installed release can run offline after its manifest expires. A release needs a fresh manifest to be activated. Keep a separate profile export for recovery. The updater's retained releases, snapshots and request receipts support update recovery.

For a planned key rotation, run `configure-updates --release-key /trusted/new-release.pub` before signing with the new key. The updater keeps up to eight verification keys for retained releases. If a signing key is compromised, replace the trust anchor on the affected installations. [Update and recovery reference](ARCHITECTURE.md#immutable-releases-and-recovery)

## OS-sealed keys and recovery

On Linux systems that support user-scoped `systemd-creds`, you can seal the existing master key for the service. Follow your system's credential policy and use a real encryption key.

```sh
umask 077
systemd-creds --user encrypt --name=master-key /private/master-key /private/host.cred
node apps/host/dist/althar-host.js install-service --encrypted-credential /private/host.cred
systemctl --user restart althar-host.service
node apps/host/dist/althar-host.js status --wait --json
```

Keep a separate recovery copy of the original key. A sealed copy can be tied to a machine or user. Manual `init` or `serve` outside the service still needs the original key passed with `--key-file`.

To back up a home, stop it and copy its full profile, project repositories and task worktrees with ownership and private permissions preserved. Save the master key separately. Restore the original paths or repair the Git worktree references after moving them. Provider tools own their sign-ins separately. Use the provider's sign-in command on the restored machine.

The host and its agents run as the home user and share that user's file access. Use a dedicated OS account and trusted code for a personal home.

## Producing a release

The [host release workflow](../../.github/workflows/host-release.yml) builds native Linux x64 and arm64 releases and opens a draft after the exact commit passes host and post-merge validation, waiting up to two hours for runs still going: on `main`, or for a patch on its version's release branch (`release/host-0.2` for 0.2.3; [Release branches](../../DEVELOPMENT.md#release-branches)).

1. On `main`, or for a patch on its release branch, bump the version in `apps/host/package.json` and add `release-notes/<version>.md`.
2. Once its validation has started or passed, tag that commit `host-v<version>` or dispatch the workflow on that branch.
3. Use the protected `release` environment with `ALTHAR_HOST_RELEASE_SIGNING_KEY` set to the Ed25519 private PEM. Keep the private key out of Git, logs and release assets. Distribute the public key separately.
4. Verify a reboot on a personal VPS and actual provider sign-in and refresh on a headless host. Publish the draft after those checks. Give a corrected release a new version and sequence so published signed assets stay immutable.
5. For a new minor or major, cut its release branch at the tag through the cascade: `gh workflow run cascade.yml -f cut=release/host-0.3 -f at=host-v0.3.0`.

A release is built with the public ids of Althar's own apps, from the repository variables `ALTHAR_GITHUB_CLIENT_ID`, `ALTHAR_GITHUB_APP`, `ALTHAR_GITLAB_CLIENT_ID` and, optionally, `ALTHAR_COPILOT_CLIENT_ID`; `bun run build` reads the same names from the environment or `apps/host/.env`, and the home's own environment overrides each at run time. A window attached to the home then offers GitHub's and GitLab's sign-in by a code: it shows in the window and the person approves in any browser. Linear's sign-in comes back to the computer's own loopback address, so a home doesn't offer it; Linear takes a pasted token there.

`bun run release:smoke` builds a portable release with a throwaway key, verifies its signature and archive and checks the bundled provider binaries outside the workspace. Use an official Node installation with its license file.

## Development

From `apps/host`:

```sh
bun run check
bun run test tests/vault.test.ts tests/home.test.ts --maxWorkers=1
bun run test tests/process.test.ts --maxWorkers=1
```

The test commands build the host entry first. CI runs the Linux host checks, measures line and branch coverage, and exercises the signed SSH install with systemd. See the [architecture](ARCHITECTURE.md) for the runtime, storage, updates and trust boundaries. [ADR-103](../../docs/decisions/proposed/103-projects-live-locally-or-on-a-host-and-place-work-in-pools.md) covers the wider design.
