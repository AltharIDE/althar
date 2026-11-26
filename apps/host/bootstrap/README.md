# Install an Althar home over SSH

If you already have SSH access to a Linux server, Althar can use that login to set up a home. Setup checks the machine, verifies the host download, installs the service and waits for it to be ready. It can carry on when the SSH connection drops, and you can reconnect to see how far it got.

Start with a regular user on a 64-bit Linux server with Git, systemd and OpenSSH. Server-side download uses `curl`. The desktop can upload the verified archive if the server can't download it. If your server gives you root access first, setup can create a dedicated `althar` user, add your SSH public key and switch to that login.

Setup needs a published signed release and a public release key you trust. To try the downloadable preview and connect to it from the desktop, use the [test guide](../preview/README.md#connect-the-desktop-to-a-test-home-over-ssh).

## Desktop protocol version 1

The desktop verifies the SSH host key and passes `ssh.sh` to `sh -s -- <operation> <arguments>`. Quote each argument separately. Continue with the same login and its usual home and XDG directories once you have selected the installation user. Read progress as JSON lines on stdout. For errors before the script starts, check SSH on the desktop.

1. **Check the server.** Send `probe`. The `look done` event reports `os`, `arch`, `login`, `root`, `systemdUserManager`, `freeKiB`, `git` and `linger`. The script reports unsupported systems, a missing user manager and insufficient disk space separately. It checks space against the actual release again before transfer.

2. **Choose the installation user.** If `root` is true, send `root-login <public-key>` with the key type and base64 data from your SSH public key. Leave off its comment. The script creates the `althar` user, adds that key and enables lingering. When it reports `login: "althar"`, reconnect with the same SSH key as that user. An existing unrelated `althar` account produces `AccountConflict`.

   For a regular login with lingering off, `look done` includes `action.code: "LingerOff"` and the exact `loginctl` command. The current SSH session can install and start the home. Ask the server administrator to run the command so the user service can survive the last logout and start after a reboot.

3. **Verify the release on the desktop.** Check the Ed25519 signature with a trusted release key, then verify the platform, architecture, freshness and manifest format. Use the digest, compressed size, unpacked size and URL from the verified manifest. Send the original envelope and the pinned public key as standard, single-line base64. Stop with `SignatureMismatch` if the signature fails. [Release verifier](../src/updates/release.ts)

4. **Transfer the archive.** Start with a server-side download. `get progress` reports `bytes` and `totalBytes`.

   ```text
   install download <sha256> <bytes> <unpackedBytes> <url> <envelope-base64> <key-base64>
   ```

   After `CannotDownload`, the desktop can fetch and verify the archive, prepare an upload and send it by SFTP to the returned `uploadPath`. Use the upload ID to complete the install. Report upload progress from SFTP.

   ```text
   prepare-upload <bytes> <unpackedBytes>
   install upload <sha256> <bytes> <unpackedBytes> <uploadId> <envelope-base64> <key-base64>
   ```

   The server checks the archive's size and digest before extracting and running it. A truncated or mismatched archive produces `SignatureMismatch`.

5. **Follow progress.** After `setup started` with `detached: true`, send `status` under the same login. Before the release is staged this can return the saved transfer events. Once the host exists, it runs `althar-host setup status --json` and returns `protocol`, `state`, `events` and `rawOutput`. The final `identity done` event reports `homeId`, `hostDeviceId`, `apiVersion` and `version`.

6. **Pick up where setup stopped.** If the archive is staged, send `resume` to run `althar-host setup --resume --json`. Before staging, retry the transfer with the verified manifest. If you see `LockHeld`, check status. A rerun preserves the home ID and any updater settings. A new installation asks for explicit update application by default.

The setup state is one of `absent`, `queued`, `running`, `interrupted`, `failed` or `done`.

## Events and failure codes

Events have `protocol: 1`, `step`, and `state`. The steps are `reach`, `look`, `get`, `setup`, `start`, and `identity`. The states are `started`, `progress`, `done`, and `failed`. A failed event has a `code`. Subprocess diagnostics are kept in the setup status and the systemd journal. Setup only enables the home service after configuration finishes, and verifies the private API identity before reporting success.

| Code | What the desktop can say |
| --- | --- |
| `UnsupportedOS`, `UnsupportedArchitecture` | Choose a supported 64-bit Linux server. |
| `NoSystemd`, `NoUserManager` | Choose a systemd host with a working user login session. |
| `CannotDownload` | The server could not fetch the archive. Try uploading it from the desktop. |
| `SignatureMismatch`, `ReleaseExtractionFailed` | The release could not be authenticated or unpacked. Stop and verify the release source. |
| `NotEnoughDisk`, `DiskUnavailable` | Check the server’s available disk space. |
| `LockHeld` | Setup is already running. Reconnect to its status. |
| `SetupLaunchFailed`, `InstallFailed`, `ServiceFailedToStart`, `IdentityMismatch` | Show the recorded stage and diagnostics. The user can resume where setup stopped. |
| `DedicatedUserRequired`, `AccountConflict`, `AccountCreationFailed`, `AccountKeyFailed`, `AccountLingerFailed`, `InvalidPublicKey` | Show the account or public-key issue before connecting again. |
| `InvalidRequest`, `InvalidLogin`, `UnsafeState`, `SetupNotFound` | Check the operation, login, or setup state before retrying. |

Once setup returns the home identity, use the SSH connection to open that home. The default launcher is `${XDG_DATA_HOME:-$HOME/.local/share}/althar-host-program/launcher`.

## Workers

A worker installs from the same signed release a home does, with the same script, through operations named `worker-…`. Its program goes in `${XDG_DATA_HOME:-$HOME/.local/share}/althar-worker-program` and its own files in `…/althar-worker`, beside any home on the same login. The desktop runs these in order from **Settings › Computers › Add a worker** (`apps/desktop/src/main/homes/workerSetup.ts`):

1. `probe`, and `root-login <public-key>` for a root login, exactly as for a home. A regular login whose `look done` says `linger: false` then gets `worker-linger`: it turns lingering on with `sudo -n` where it may, and otherwise fails `look` with `LingerOff` and the `command` for the administrator, before anything is installed. A worker is a user service, and without lingering it stops when the login ends.
2. `worker-install download|upload …`, with the same arguments as `install` (and `worker-prepare-upload` before an upload). Once the release is staged and checked, it points `current` at it and runs `althar-host worker install`, which makes the worker's own P-256 key where it has none and reports `key done` with `publicKey` (SPKI DER, base64url) and `release`.
3. The desktop's window has its home sign that key (`AddWorker`) and gets the worker's grant: its ID, the home's ID, the home's authority certificate, the worker's certificate, the name the home's certificate carries, its port and the addresses it may be reached at.
4. `worker-enroll <grant-base64url> <here>`. `here` is `1` where the window's home is the computer running SSH, so the address the login came from goes first. It writes the grant, the agents (from the release, for any project the home grants), and the `althar-worker.service` and `althar-worker-update.timer` user units, starts them, and reports `start done` with `agents`, each with `signedIn`.

5. The enroll ends with the worker's check (`althar-host worker check`): it links the bubblewrap and ripgrep of Codex's package and the release's socat into the worker's `bin`, starts bubblewrap as a run would (in a user unit with no new privileges), lists the tools on its PATH, and starts each signed-in agent once, which says its models. It reports `check done` with `sandbox` (`starts`, or `problem` and the `fix` an administrator runs), `tools` and `agents`, and keeps it in `readiness`, which the worker sends its home. `worker-check` runs it again; `worker-sandbox` runs the fix with `sudo -n` where the login may, then checks again, and otherwise fails with `NeedsAdministrator`. A root login's `root-login` writes the AppArmor rule itself where the kernel restricts user namespaces (`sandboxRule` in `setup done`).

Later, `worker-agents` checks which agents are signed in again, and `worker-sign-in <agent> browser|device` runs an agent's own sign-in. Its steps come as JSON lines (`kind`: `browser`, `device`, `open`, `refused`, `done`, `failed`); a code the browser's page shows goes back on stdin as `{"paste":"…"}`, and `{"cancel":true}` stops it. The desktop sends the script as the SSH command for this one, so stdin stays free.

**Without SSH**, the release publishes this script as `althar-worker.sh` and the release's public key as `althar-host-release.pub`. `sh -s -- join <code>` takes the newest release for the machine's architecture from beside the script, checks the archive's size and digest against its manifest, installs it as `worker-install download` would and enrolls with the code (`althar-host worker join`). Set `ALTHAR_RELEASE_BASE` to take them from elsewhere.

Further failure codes: `LingerOff`, `NoWorker` (the release carries no worker), `WorkerNotInstalled`, `InvalidCode`, `NoKey`, `WrongKey` (the home signed another key), `Expired`, `Refused` and `Unreachable` (a code's home refused or couldn't be reached).
