# Install an Althar home over SSH

The desktop opens its authenticated SSH connection and sends `ssh.sh` to `sh -s -- <operation> <arguments>`. Use an ordinary Linux login or explicitly begin with a root login that can create the dedicated `althar` account. The script assumes 64-bit Linux with systemd, OpenSSH and the usual core utilities. It uses `curl` for a server-side download. Upload works when the server has no internet access or lacks `curl`.

## Desktop protocol version 1

Quote each argument independently before passing the remote command string to SSH. Use the same login and its usual home and XDG directories throughout. The script writes JSON lines to stdout. The desktop owns SSH reachability and host-key verification and reports failures that occur before the script runs.

1. Send `probe`. The `look done` event reports `os`, `arch`, `login`, `root`, `systemdUserManager`, `freeKiB`, `git`, and `linger`. Unsupported OS and architecture, an unavailable user manager, and insufficient disk space have distinct failure codes. The script repeats the disk check against the actual release before a download or upload.
2. If `root` is true, send `root-login <public-key>`. Use the complete bare public key corresponding to the intended SSH identity, with its type and base64 data and without its comment. The script creates `althar`, installs that key, and enables linger. It reports `login: "althar"`. Reconnect as that user with the same SSH key before installing the home. A pre-existing unrelated account named `althar` is an `AccountConflict`.
3. On the desktop, fetch and verify the Ed25519 release envelope against the independently trusted release key. Check platform, target architecture, freshness and manifest format. The existing host verifier in `apps/host/src/updates/release.ts` defines the signed bytes and policy. Derive the digest, compressed and unpacked size, and source URL exclusively from the verified manifest. Supply the original envelope and pinned public key as standard, single-line base64. A signature failure must stop setup with `SignatureMismatch`.
4. Send `install download <sha256> <bytes> <unpackedBytes> <url> <envelope-base64> <key-base64>` to download on the server. `get progress` includes `bytes` and `totalBytes`. After `CannotDownload`, the desktop can offer upload. Fetch and verify the archive on the desktop, send `prepare-upload <bytes> <unpackedBytes>`, and upload by SFTP to the returned `uploadPath`. After the upload completes, send `install upload <sha256> <bytes> <unpackedBytes> <uploadId> <envelope-base64> <key-base64>`. The server checks exact size and digest before extracting or executing the archive. Report upload bytes from the SFTP transfer. A truncated or mismatched archive stops with `SignatureMismatch`.
5. Once the install operation returns `setup started` with `detached: true`, poll `status` with the same login. This forwards `althar-host setup status --json` where a bootstrapped release exists. The status object contains `protocol`, `state`, `events`, and `rawOutput`. `state` is `absent`, `queued`, `running`, `interrupted`, `failed`, or `done`. The final `identity done` event contains `homeId`, `hostDeviceId`, `apiVersion`, and `version`. Before a release is staged, `status` returns the stored transfer JSON lines if available.
6. Use `resume` after an interrupted install once the archive was verified and staged. It forwards `althar-host setup --resume --json`. Before staging, repeat the transfer using the already verified descriptor. `LockHeld` means the current setup is still running. Poll it. Each attempt keeps the existing home ID, and a completed setup returns its recorded identity on rerun. Existing updater settings are preserved. A new installation defaults to manual update application.

For a normal login with linger off, `look done` includes `action.code: "LingerOff"` and the exact `loginctl` command. The current SSH session can install and start the home. For the user manager to survive the last logout or restart automatically after reboot, the administrator must run that command. Until then, an interrupted setup can resume on reconnect. The ordinary-user script makes no system-wide changes.

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

Publishing the release and distributing its public trust anchor are separate release tasks. Once setup returns the home identity, the desktop can use the existing SSH stdio connection. The default launcher is `${XDG_DATA_HOME:-$HOME/.local/share}/althar-host-program/launcher`.
