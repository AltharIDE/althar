# ADR-113: An Ops sandbox profile opens SSH's config and agent, and never a key

> A proposal, not built. Where it would fold in:
> [what-agents-may-do.md § The sandbox is the boundary](../what-agents-may-do.md#the-sandbox-is-the-boundary)
> (what the profile opens) and [§ The person's rules](../what-agents-may-do.md#the-persons-rules)
> (its switch). The plan is [Ops mode](../../plans/ops-mode.md); this is
> step A, [DEV-283](https://linear.app/althar/issue/DEV-283).

- **Status:** Proposed
- **Date:** 2026-11-24
- **Owner:** Runtime and provider-adapter maintainers
- **Related:** [ADR-071, the sandbox is the boundary](../what-agents-may-do.md#the-sandbox-is-the-boundary),
  [ADR-097, agents work as the person's own](../what-agents-may-do.md#what-asks),
  [ADR-043, Allow everything for a project or a task](../what-agents-may-do.md#ask-about-more-and-the-coordinator-decides),
  [ADR-080, the tools' caches](../workspaces-and-runs.md#setting-up-a-tasks-folder),
  [ADR-114, secrets per run](114-secrets-go-to-one-run-never-to-the-agent.md),
  [ADR-115, read or change](115-a-command-is-read-or-change-per-tool-and-unsure-asks.md),
  #1160's ADR-108 (a DevOps lens defaults to this profile; [#1160](https://github.com/AltharIDE/althar/pull/1160)).

## Context

A lead's sandbox denies every place keys and sign-ins are kept
(`SECRET_PLACES` in `packages/provider-adapters/src/secrets.ts`), `~/.ssh`
as a whole among them, and lets through one Unix socket, the SSH agent's
(`sshSockets()` in `registry.ts`). That is right for code: git over SSH
signs with the agent and needs nothing else. For `ssh` to a server it
isn't enough: without `~/.ssh/config` there are no host aliases, users,
ports or jump hosts, and without `known_hosts` every connection fails host
key verification. So on an infrastructure repository the person answers
a card for every `ssh`, or Allow everything, which lets changes run on
prod unasked ([the plan's table](../../plans/ops-mode.md#the-problem-today)).

## Decision

**A named sandbox profile, Ops, beside today's, which becomes Code.** It
changes what a lead's sandbox reads and writes, and puts one kind of
command under a check of its own that holds before any allow (ADR-115).
It changes nothing else: the
same agent, tools, rules and irreversible list.

### What it opens

| What | How | Why it is safe to open |
|---|---|---|
| **The SSH agent's socket** | As today (`SSH_AUTH_SOCK`, `allowUnixSockets`) | The agent signs; it never hands out the key |
| **`~/.ssh/config`, and what it includes** (`~/.ssh/config.d/`, other `Include`s under `~/.ssh` that name no key) | Read, through an exception inside the denied `~/.ssh` | Host names, users, ports, `ProxyJump`; it names a key's path, it holds none |
| **`~/.ssh/known_hosts`**, and `/etc/ssh/ssh_known_hosts` | Read only | Public host keys. A lead never adds a host: an unknown one fails, and a card asks the person to trust its fingerprint, which Althar adds (the plan's open question 4) |
| **The repository's `ansible.cfg`, inventory, `group_vars`, `host_vars`** | In the worktree already | They are the task's files. `ANSIBLE_CONFIG` is set to the worktree's, so `~/.ansible.cfg` isn't read |
| **Tool caches** | Written, as `TOOL_PLACES` caches are (ADR-080) | Downloads and temp files: `~/.ansible/tmp`, `~/.ansible/collections`, `~/.ansible/roles`; `~/.terraform.d/plugin-cache`; `~/.cache/helm`; Linux and macOS paths per tool |
| **SSH's control sockets** | `ControlPath` set to the lead's temp folder (`-o ControlPath=$TMPDIR/ssh-%C` through `ANSIBLE_SSH_ARGS` and an `ssh` wrapper's `-F` include), never `~/.ssh` | Multiplexing works without writing to `~/.ssh` |

### What it never opens

- **Private keys**, anything else in `~/.ssh`: `id_*`, `*.pem`, `*.key`,
  every `IdentityFile` the config names, `authorized_keys`. The config's
  `IdentityFile` lines then fail to load, and ssh uses the agent, as it
  does already; `IdentitiesOnly yes` hosts need the key in the agent.
- **Cloud and cluster credentials:** `~/.aws`, `~/.azure`,
  `~/.config/gcloud`, `~/.kube`, `~/.vault-token`,
  `~/.terraform.d/credentials.tfrc.json`, `~/.docker/config.json`, all as
  today. A tool that needs them runs through `ops_run`, outside the
  sandbox, where the tool reads them and the agent doesn't (ADR-114), as
  `gh` reads its own sign-in today (`CLI_SIGN_INS`).
- **Two new places**, added to `SECRET_PLACES` for every profile:
  `~/.ansible/galaxy_token` and `~/.config/helm/registry` (Helm's
  registry login). Neither is a cache, though both sit beside caches the
  profile opens.
- **Vault password files** the person keeps anywhere (`~/.vault_pass`,
  `.vault_pass` in a checkout): a file named in `ansible.cfg`'s
  `vault_password_file` is read by Althar for `ops_run` and refused to
  the agent by the rules (`secretOf`), wherever it is.

`writesOf` keeps refusing any write in, under or over a secret place, so
a cache exception can't widen into one.

### Where it holds

The profile's promise, no key readable, holds only where the sandbox
denies reads: Claude Code on macOS, and on Linux where bubblewrap starts,
outside the Flatpak. Codex's `workspace-write` and OpenCode don't deny
reads, and the Flatpak and Windows have no sandbox Althar can hold
([what agents may do](../what-agents-may-do.md#the-sandbox-is-the-boundary)).
There the switch still turns on the rules (ADR-115), but its line says
"This agent's sandbox doesn't keep your SSH keys from scripts", and the
detection card recommends a Claude Code lead.

The same holds for the secrets `ops_run` hands to a run (ADR-114): a
same-user file or descriptor is readable by any session without read
isolation, this task's or another's, in any project. So no secret is
handed over while such a session runs anywhere on the computer, and none
at all where the run's own sandbox can't start; `ops_run` says which
session stands in the way.

### Switching it on

- **Per project, and per task,** as Allow everything is (ADR-043): a
  project field `sandboxProfile: 'code' | 'ops'` in its rules
  (`ProjectRules` in `Policies.ts`, a revision like the rest), and a task
  override in its menu, kept beside `allowEverything` on the task
  (`Permissions.ts`). The task's wins over the project's, either way. A
  plan card (`propose_plan`) can set it for the task, as it sets where a
  task works.
- **Off by default.** It is never switched on by Althar or an agent. A
  lead may ask for it through `change_settings`, which, as for anything
  that loosens what asks, is a card for the person.
- **A running session keeps its sandbox.** Switching takes effect on the
  lead's next session start, which Althar does at once between turns, as
  for a change of model.
- **What the task header shows:** "Ops" beside the task's title while it
  runs in the profile, and in the Rules screen, the profile with one
  line on what it opens.

### The detection card

When a project's repository has `ansible.cfg`, an `inventory/` or
`inventories/` folder, `*.tf` at its top or in `envs/*/` or
`environments/*/`, `Pulumi.yaml`, `kustomization.yaml`, `Chart.yaml` or
`helmfile.yaml`, the project's coordinator thread gets one card, once per
project:

> **This looks like an infrastructure repository.** Ansible
> (`ansible.cfg`, `inventory/`) and Terraform (`envs/prod/main.tf`).
> The Ops profile lets agents reach your SSH agent, `~/.ssh/config` and
> `known_hosts`, never your keys or cloud credentials. Reads such as
> `--check` and `plan` go ahead; changes ask.
>
> [Use Ops for this project] [For one task at a time] [Not now]

"Not now" is kept; the card doesn't come back unless the person opens it
from Rules. Detection only reads file names in the default branch's copy,
as `workedOutReach` does, and never switches anything.

## Alternatives

- **Open `~/.ssh` read-only.** Simplest, and every private key is then one
  `cat` away. Rejected.
- **Copy the config and `known_hosts` into the worktree** and point ssh at
  them (`-F`, `UserKnownHostsFile`). Works where the sandbox can't make an
  exception, and goes stale the moment the person edits their config. Kept
  as the fallback if Claude Code's allow-within-deny proves unreliable.
- **Credentials in the sandbox,** `~/.kube` and `~/.aws` included. Then the
  agent holds prod's token, and any script can send it anywhere. Rejected:
  `ops_run` runs the tools outside instead.
- **No profile, only rules.** Classifying commands (ADR-115) without the
  reach leaves `ssh` failing for want of its config.

## Consequences

- An infra repository works the way the person works in their terminal,
  for reads, with nothing to answer.
- The SSH agent signs for any host its keys open, so the profile keeps the
  key unreadable, not unusable. A script the rules can't read could log in
  anywhere. Step B's prod key filter closes that for prod (the plan's B3);
  until then the switch's line says so.
- A second profile makes "what the sandbox opens" a choice per task: the
  sandbox settings and their tests have two shapes to keep.

## What an implementation touches

- `packages/provider-adapters/src/secrets.ts`: `SECRET_PLACES` gains
  `.ansible/galaxy_token` and `.config/helm/registry`; a new
  `OPS_OPENS` (`.ssh/config`, `.ssh/config.d`, `.ssh/known_hosts`) and
  `secretReadRules(profile)` that leaves those out of the deny rules for
  Ops.
- `packages/provider-adapters/src/registry.ts`: `UpFront` gains
  `profile`; `claudeAsks` passes the read exceptions
  (`sandbox.filesystem` allow-within-deny) and the Ops caches through
  `writesOf`; `sshSockets()` unchanged. Codex's and OpenCode's entries
  report that they can't keep keys out (`holds`).
- `packages/runtime/src/toolPlaces.ts`: Ansible, Terraform/OpenTofu, Helm
  and kubectl entries, with their files and caches.
- `packages/runtime/src/sandboxReach.ts`: `workedOutReach` takes the
  profile; detection of infra files for the card.
- `packages/runtime/src/rulePaths.ts`: `secretOf` lets the opened files be
  read in Ops and refuses the rest of `~/.ssh`, `vault_password_file`
  paths, and the new places in every profile.
- `packages/runtime/src/Policies.ts` (`sandboxProfile` in `ProjectRules`),
  `Permissions.ts` (the task's override, `runRules`), `sessionState.ts`
  and `Sessions.ts` (a session starts with its task's profile and
  restarts on a switch), `SettingsTools.ts` (`change_settings` asks),
  `Coordinator.ts` (`propose_plan`'s field).
- `packages/runtime/src/cards.ts` or a sibling such as `reviewOffer.ts`:
  the detection card, once per project.
- `packages/contracts/src/Api.ts`, `settings.ts`: the field and the card.
- `apps/desktop/src/renderer/features/rules/` (the profile in Rules), the
  task menu and header.
- Tests: `packages/provider-adapters/tests/registry.test.ts` (both
  profiles' settings), `packages/runtime/tests/sandboxBoundary.test.ts`
  (every key path refused in both), and a real-session check that
  `cat ~/.ssh/id_ed25519` fails in Ops while `ssh -G host` reads the
  config.
