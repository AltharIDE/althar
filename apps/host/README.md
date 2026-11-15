# @althar/host

A persistent Althar project home under plain Node on Linux. The service owns the runtime, SQLite writer, projects and agent processes; an attached client does not own their lifetime. It uses the existing versioned private API and its socket authority rules.

This is the host service foundation of [ADR-103](../../docs/decisions/proposed/103-projects-live-locally-or-on-a-host-and-place-work-in-pools.md). Desktop SSH bootstrap, protected client enrollment, remote files and previews, signed standalone distribution, worker pools and relay transport still need implementation. Real provider subscription login and refresh on a personal VPS remain a release gate. The process tests use temporary profiles and fake agents.

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

If the user manager must survive logout or start at boot, the server administrator must configure lingering for the host's OS user (usually `loginctl enable-linger <user>`). Installation does not change system-wide policy or enable lingering itself. Retain the built entry, its installed dependencies and the Node binary at the captured paths. The JavaScript bundle alone is not a portable signed release: provider ACP subprocess packages must remain installed beside the workspace.

The unit delivers the protected key through `LoadCredential`; the process uses `%d/master-key`. There is no interactive desktop keyring dependency. `CREDENTIALS_DIRECTORY` is also recognized for a manually configured service's `serve` command. The host removes supervisor credential and notification variables before starting the runtime's agents. API readiness is announced only after storage, reconciliation and the private socket have started. Health calls `GetConnectionInfo`, without provider probes or access to the master key. Readiness waits end after 30 seconds.

SIGTERM and SIGINT close the runtime scope, its agent sessions, private endpoint and database lock. systemd kills the entire service cgroup after its bounded shutdown timeout, including detached agent children. It restarts transient failures with bounded start retries; usage/configuration refusals do not create a restart loop. `PrivateTmp` is intentionally absent: the private Unix socket must be reachable by clients outside the unit. The unit exposes no public TCP API.

Exit codes: 0 success or graceful service stop, 64 invalid command/configuration syntax, 75 unavailable service/storage or occupied profile, 78 missing/unsafe initialization or incompatible encryption, 130 interrupted finite command, 1 unexpected failure. Runtime diagnostic logs go to stderr, and command results go to stdout; `--json` emits command results as JSON lines.

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
