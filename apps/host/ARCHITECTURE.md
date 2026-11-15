# @althar/host — Architecture

**Owner:** repository maintainers. A Linux composition root for `@althar/runtime`, independent of Electron, clients and service subscriptions. The repository [engineering target](../../ARCHITECTURE.md) applies. [ADR-103](../../docs/decisions/proposed/103-projects-live-locally-or-on-a-host-and-place-work-in-pools.md) describes the later remote-host and worker product; this app supplies its unattended single-host lifecycle.

## Ownership and flow

`options.ts` validates command input. `commands.ts` executes commands through an injectable output/service interface. `main.ts` captures delivered credential paths, strips supervisor-only environment capabilities, routes structured runtime logs to stderr and owns signal interruption. `home.ts` builds `services` with durable per-profile paths and the host's `Secrets` layer. The default runtime startup has no desktop first-screen gate, GUI callbacks or desktop telemetry dependencies.

```mermaid
flowchart LR
  systemd[systemd user manager] -->|delivered key, lifecycle| Host[Node host]
  Host -->|one owning scope| Runtime[Shared runtime]
  Runtime --> DB[(Locked profile and SQLite)]
  Runtime --> Agents[Local ACP agents and worktrees]
  Client[Authenticated client] <-->|private versioned API| Runtime
  Runtime --> Vault[Encrypted secret files]
  Host -->|separate master key| Vault
```

One profile is one persistent home owned by one person. A server can run separate profiles/units; no server-wide organization or tenant model is implied. Home, actor and device identities come from the shared runtime. Projects, approvals, commands, receipts and reconciliation remain there. This app imports only public package APIs and does not implement a second scheduler, API or permission model. Clients disconnect independently of the host scope. Shutdown closes runtime resources before zeroing the in-memory vault key. Restart reconciles interrupted work through the existing runtime; it does not replay external effects as if they had never happened.

## Storage and secrets

`configuration.ts` stores version 1 configuration and refuses automatic worktree relocation or replacement of missing storage. `vault.ts` stores version 1 metadata, a key fingerprint, a random vault id and AES-256-GCM envelopes. Each secret uses a fresh 96-bit nonce; additional authenticated data binds format version, vault and secret name. Secret plaintext is limited to 1 MiB. Invalid/tampered ciphertext is unreadable, not silently absent. Initialization can create a random 32-byte key only before vault metadata exists. A missing/wrong key, desktop ciphertext without host metadata, unsafe ownership or permission modes fail closed. Changes to persisted formats need explicit versioned migration and recovery.

`privateFiles.ts` reads bounded regular files without following final symlinks, rejects multiply linked master keys, and publishes private temporary files only after fsync. Initial creation is atomic and cannot overwrite an existing key. Replacements rename atomically and fsync the containing directory. Retried creation/deletion repeats the directory barrier even when the earlier change is already visible, so a failed fsync cannot be mistaken for durable success. Vault operations serialize through a semaphore and complete their bounded filesystem work before scope cleanup zeroes the key; an escaped service reference refuses use after its scope closes. JavaScript strings and provider SDK copies cannot be reliably erased; key buffers and intermediate plaintext buffers are erased where owned.

The master key is outside the profile/backups/worktree roots, including canonicalized aliases. Operators must also keep it outside original source repositories, images and other exported folders. User input supplies paths, never raw secret values on command lines. Error messages do not echo unknown exceptions or sealed contents. Connector secrets use this vault; provider login stores remain the provider tools' own responsibility. Copying both key and ciphertext defeats this protection.

## Trust and lifecycle

A fresh private socket launch secret grants `socket` authority. SSH access is not person authority. The host does not create a window connection, protected paired-client key or an approval bypass. Signed owner keys, version negotiation, revocation, durable admission and feed positions use the shared API's existing contracts. No public port, relay or remote filesystem is added. API health authenticates and reads connection information rather than probing agents; it is bounded to 10 seconds, or 30 seconds with readiness retry. Disk/crypto work uses asynchronous filesystem operations; no blocking subprocess runs on the host thread. Parsing is bounded by private-file size limits.

The systemd unit delivers a private or OS-sealed credential, announces actual API readiness, rate-limits restart loops and terminates the full cgroup on shutdown. Helper arguments are passed without a shell; unit paths escape systemd quoting/specifiers and suppress environment expansion in ExecStart. Installer writes only a marked managed user unit, reloads, and starts only when asked. It never changes lingering policy. Source/built dependencies must stay at their recorded paths until signed standalone distribution exists.

This is a trusted personal OS-user boundary. Same-user agents can access the user's files; mode 0700/0600 and environment stripping do not provide process or tenant isolation. Shared workers, remote credential delegation, signed distribution, SSH bootstrap, protected enrollment, provider validation, remote files and previews remain separate release work. No billing or organization authorization depends on this process layout.

## Verification

`vite.config.ts` builds for Node 24 and uses the shared medium test budget. Unit tests exercise encryption, tamper/permission refusal, atomic files and injected disk-sync failures, argument handling and service generation. Integration tests use the actual runtime, git, SQLite and authenticated Unix sockets, including single-writer exclusion, client disconnect during an agent turn, restart persistence and wrong-key refusal. Built-process tests use an empty fixture home, no stdin, no GUI and real SIGTERM/SIGINT. They do not load a developer's credentials. Service calls are injected and no host user's service is deployed by CI. Systemd/reboot and provider headless sign-in need real VPS validation before release. The dedicated workflow gates this app and runs again in the merge queue; changed-test stress runs also build before tests.

There is no graphical interface in this app. Help, safe actionable errors, JSON command results and stderr diagnostics are its operator interface. Keep stdout suitable for automation. Maintain the shared 90% coverage floor in CI; process entry wiring is excluded from source instrumentation only because it runs as a separate built process, which its lifecycle tests exercise.
