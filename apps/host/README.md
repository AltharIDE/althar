# @althar/host

A persistent Althar project home under plain Node on Linux. The service owns the runtime, SQLite writer, projects and agent processes; an attached client does not own their lifetime. It uses the existing versioned private API and its socket authority rules.

This is the host service foundation of [ADR-103](../../docs/decisions/proposed/103-projects-live-locally-or-on-a-host-and-place-work-in-pools.md), including signed portable releases and a managed updater. Desktop SSH bootstrap, protected client enrollment, remote files and previews, worker pools and relay transport still need implementation. Real provider subscription login/refresh and systemd reboot on a personal VPS remain release gates. Tests use temporary profiles; release smoke checks probe real bundled provider binaries without credentials.

## Build and initialize

Use the pinned Bun and Node versions in the repository. Linux, git and Node 24.22 or the repository's newer pinned Node are required. systemd user services need a user manager and `systemd-notify`; encrypted user credentials additionally need a systemd version supporting user-scoped sealing.

From the repository root:

```sh
bun install --frozen-lockfile
bun --filter @althar/host build
node apps/host/dist/althar-host.js init --project /absolute/path/to/repository
node apps/host/dist/althar-host.js serve
```

`--project` is repeatable and opens existing repositories. It does not clone, move or upload a desktop project. Repeated initialization preserves identity and keys. Stop the running host before provisioning more projects, because the database allows one writer.

Defaults are deliberately separate from the desktop:

| State | Location |
| --- | --- |
| Profile, SQLite, artifacts, encrypted connector secrets and backups | `$XDG_DATA_HOME/althar-host`, falling back to `~/.local/share/althar-host` |
| Task worktrees | `<profile>/worktrees` |
| Separate master key | `$XDG_CONFIG_HOME/althar-host/master-key`, falling back to `~/.config/althar-host/master-key` |
| User unit | `$XDG_CONFIG_HOME/systemd/user/althar-host.service` |
| Managed program, staged releases and update recovery journal | `$XDG_DATA_HOME/althar-host-program`, falling back to `~/.local/share/althar-host-program` |

`--profile`, `--worktrees` and `--key-file` accept custom paths. The worktree location is recorded in `host.json`; subsequent launches reuse it. An explicit different location is refused. Move workspaces deliberately while the service is stopped, repair git worktree references, update the stored location and validate before starting. A missing recorded directory fails startup rather than being recreated. The host does not migrate desktop keyring ciphertext.

Keep the master key outside the profile, its backup folders, all project repositories and task worktrees. Startup checks its ownership, mode, type, size and vault fingerprint. It never generates a replacement key during `serve`, or during `init` when vault metadata already exists. Do not point this host at the desktop's profile.

## Supervision

After initialization, install a systemd **user** unit, with absolute Node and built-entry paths captured from the command that installs it:

```sh
node apps/host/dist/althar-host.js install-service
systemctl --user enable --now althar-host.service
node apps/host/dist/althar-host.js status --wait --json
journalctl --user -u althar-host.service -f
systemctl --user stop althar-host.service
```

`install-service --start` combines installation and explicit enable/start. Without that flag it only writes the managed unit and reloads the user manager. Updating a running unit does not implicitly restart its runtime: use `systemctl --user restart althar-host.service` deliberately. Put overrides in a systemd drop-in; reinstalling replaces the Althar-managed unit. Unrelated unit files are refused. Custom `--service-name` supports separate profiles; never run two services on the same profile.

If the user manager must survive logout or start at boot, the server administrator must configure lingering for the host's OS user (usually `loginctl enable-linger <user>`). Installation does not change system-wide policy or enable lingering itself. A source installation needs its built entry, installed dependencies and Node at the captured paths. Converting to managed updates below captures a complete portable bootstrap, including Node and the locked ACP dependency closure.

The unit delivers the protected key through `LoadCredential`; the process uses `%d/master-key`. There is no interactive desktop keyring dependency. `CREDENTIALS_DIRECTORY` is also recognized for a manually configured service's `serve` command. The host removes supervisor credential and notification variables before starting the runtime's agents. API readiness is announced only after storage, reconciliation and the private socket have started. Health calls `GetConnectionInfo`, without provider probes or access to the master key. Readiness waits end after 30 seconds.

SIGTERM and SIGINT close the runtime scope, its agent sessions, private endpoint and database lock. systemd kills the entire service cgroup after its bounded shutdown timeout, including detached agent children. It restarts transient failures with bounded start retries; usage/configuration refusals do not create a restart loop. `PrivateTmp` is intentionally absent: the private Unix socket must be reachable by clients outside the unit. The unit exposes no public TCP API.

Exit codes: 0 success or graceful service stop, 64 invalid command/configuration syntax, 75 unavailable service/storage or occupied profile, 78 missing/unsafe initialization or incompatible encryption, 130 interrupted finite command, 1 unexpected failure. Runtime diagnostic logs go to stderr, and command results go to stdout; `--json` emits command results as JSON lines.

## Managed releases and updates

Obtain the Ed25519 **public** release key through an independently trusted channel. Do not trust a key supplied by the update feed itself. The repository does not contain a provisional production key. The release operator must provision the signing secret and publish the corresponding public key before this can use official releases.

After initialization, stop the host once its work has finished, then convert it using an official Node distribution (including its `LICENSE`) and a built checkout with frozen dependencies:

```sh
systemctl --user stop althar-host.service
node apps/host/dist/althar-host.js configure-updates --release-key /trusted/host-release.pub
systemctl --user enable --now althar-host.service
sh "$HOME/.local/share/althar-host-program/launcher" update-status
```

Use `--installation /absolute/program/path` on commands if overriding the default. Keep that directory outside the profile, worktrees and credential files. Custom profile, service name and credential options must match the initialized service. For an OS-sealed key, pass `--encrypted-credential` during conversion too. Configuration changes preserve the original home identity, data, key and worktrees. The first captured executable is trusted local code; all subsequent downloaded code requires a valid pinned-key signature.

The installed timer checks and stages hourly, with startup delay/jitter. It downloads and verifies without stopping the host. Explicit requests use a durable queue and an independent updater unit:

```sh
# Check/download/verify now, without applying.
sh "$HOME/.local/share/althar-host-program/launcher" update --wait
# Explicit maintenance: stops the host and its agents, then starts the new release.
sh "$HOME/.local/share/althar-host-program/launcher" update --apply --wait
journalctl --user -u althar-host-update.service
```

The default is **explicit application**. `configure-updates --automatic-updates` opts into activating a verified compatible staged release on the next service start, before accepting work. `--manual-updates` switches back. Automatic mode does not restart a running host; an idle-time restart needs an admission/drain barrier that is separate work. `update --apply` deliberately interrupts running work, so schedule it after work finishes. A release changing the API or storage fingerprint always requires explicit `--apply --allow-incompatible`, including in automatic mode. Check client compatibility and retain an independent export before that maintenance.

Before activation the controller reserves storage, stops the service, takes a SQLite snapshot and runs only the candidate's storage migration/validation. No agents or external runtime effects run in that preparation step. The new service confirms its home and authenticated API readiness before becoming current. The separate updater process survives stopping the host; a kernel lock and durable phase journal support interruption/reboot recovery.

- A preparation failure restores the pre-start SQLite snapshot before restarting the previous code.
- A compatible startup failure reverts code while retaining newer database writes.
- An incompatible failure after runtime startup leaves the service stopped and data preserved. `update-status` reports recovery required. Stage a corrected newer release and explicitly apply it with `--allow-incompatible`; do not point old code at migrated data or remove the reservation to bypass recovery. If manual restore is necessary, stop both host/updater units and restore a compatible, complete export deliberately.
- A missing/foreign database reservation blocks automatic restoration. Older code also refuses a database with newer recorded migrations.

Installed releases remain usable offline after their manifests expire; a newly activated release must still be fresh. Signed metadata binds version/sequence, platform, API/storage compatibility, archive digest/size and extraction inventory. Downgrades, conflicting sequence numbers, unsafe archive paths/links and incomplete bundles are refused. Active/bootstrap/staged/quarantined/recovery references are retained, with three additional historical releases, three historical updater snapshots and 100 completed request receipts. This retention is not an export or full-profile backup. Use journal policy for log rotation.

For key rotation, rerun `configure-updates --release-key /trusted/new-release.pub` before signing with that key. Previous public keys stay pinned for retained release verification (up to eight). This handles routine rotation; compromised-key recovery requires deliberate operator intervention and replacing affected trusted installations.

## Producing a release

`host-release.yml` uses independent `host-v<apps/host version>` tags, requires the exact main commit's host and post-merge validation, builds natively on Linux x64/arm64 and creates one **draft**, never the desktop's latest release. Official Node and Linux glibc are the packaging target. The protected `release` environment must require review and contain `ALTHAR_HOST_RELEASE_SIGNING_KEY`, an Ed25519 private PEM. Keep its recovery copy offline and distribute only the public verification key independently. Never put the private key in arguments, repository files, release assets or logs.

Raise the host version, add `release-notes/<version>.md`, merge and wait for main validation, then tag that commit `host-v<version>` (or dispatch from main). Complete real VPS/systemd reboot and provider headless sign-in/refresh validation before publishing the draft manually. Published versions and signed assets are immutable; a corrected build gets a new version and sequence. Expiring unpublished drafts may need a fresh version. Nothing in this change provisions a production key or publishes a release.

`bun run release:smoke` builds a complete portable release using a throwaway signing key, verifies signature/hash and runs its bundled adapters/native CLIs outside the workspace, with no provider credentials. CI runs it natively on x64 and arm64 on every host verification. It requires an official Node installation with its license file.

## OS-sealed keys and recovery

Prefer `LoadCredentialEncrypted` when the server's systemd supports **user-scoped** encryption and decryption. Follow that system's credential policy; do not use null-key encryption. For versions supporting `systemd-creds --user`, an operator can seal the existing key under the credential name `master-key`, then install:

```sh
umask 077
systemd-creds --user encrypt --name=master-key /private/master-key /private/host.cred
node apps/host/dist/althar-host.js install-service --encrypted-credential /private/host.cred
systemctl --user restart althar-host.service
```

The service never falls back from the encrypted credential to the original plaintext file. Installation validates the private sealed file and metadata; systemd's ability to unseal it and the matching vault fingerprint are verified at actual service startup. Check readiness after restarting. Once startup is proven, the live plaintext source can be removed **only after** keeping a secure, separate recovery copy. Manual `init` or `serve` without the delivered credential still requires the original key via `--key-file`. OS sealing may be machine/user bound; a ciphertext blob alone is not a portable recovery key.

For a consistent export, stop the service and copy the whole profile, original project repositories and task worktrees, preserving ownership and private permissions. The profile includes encrypted connector secrets and `host-vault.json`. Provider tools own their sign-in stores separately; use each provider's supported reauthentication on the restored host. SQLite's automatic database backups do not back up secrets, artifacts, repositories, provider sign-ins or the key. Back up the master key separately from the export; never include it in an image or worktree. Restore original absolute paths, or deliberately migrate the worktree and git references before starting. A wrong or missing key cannot decrypt old secrets and is never automatically repaired.

Encryption protects copied secret files while the key stays separate. It does not protect against an administrator, a compromised OS user, or a disk copy containing both. Agents currently run as the service's OS user and are trusted with that user's files; private modes and stripped environment variables are not isolation against that same user. Use a dedicated OS account for a trusted personal host. Do not accept untrusted tenants or shared-worker workloads here; isolated workers, short-lived credential grants and tenant boundaries are later work. Connector secrets use this encrypted store; provider tools retain their own credential storage.

## Development

```sh
cd apps/host
bun run check
bun run test tests/vault.test.ts tests/home.test.ts --maxWorkers=1
bun run test tests/process.test.ts --maxWorkers=1
```

Both `test` and `test:coverage` build the Node entry first, including when the repository's changed-test stress runner invokes them on a clean checkout. CI's dedicated `host.yml` gates type-aware checks, the build, process/integration tests and at least 90% line and branch coverage on pull requests, in the merge queue and on main. No real service is installed by tests; service manager calls are injected, while the built process, signals, git, database and socket are exercised directly. Real VPS/systemd reboot and real-provider validation must precede a supported personal-host release.

## SSH clients

The running service accepts attached clients through `connect-stdio`, a framed
noninteractive helper launched over system OpenSSH. It requires an explicit
`--home-id` and `--client-api-version`; it opens only the private API connection
and never starts a second runtime. Its stdout is protocol data, not terminal
text. The private endpoint secret stays on the host. SSH access conveys socket
authority, so it cannot approve permissions or pair a device.

See the [CLI attachment guide](../cli/README.md#attach-to-a-running-home) for
inspection, home pinning and task attachment, and the [transport architecture](../../packages/transport-node/ARCHITECTURE.md)
for lifecycle and protocol limits. Disconnecting the SSH client leaves the
service and its sessions running. Existing service updates are unchanged: an
explicit apply restarts the service and disconnects attached clients, which
check the new host identity/API version when reconnecting. A newer incompatible
API requires a compatible client before attachment.
