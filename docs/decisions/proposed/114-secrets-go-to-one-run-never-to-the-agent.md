# ADR-114: Secrets go to one run through `ops_run`, never to the agent

> A proposal, not built. Where it would fold in:
> [what-agents-may-do.md § Althar's tools outside the sandbox](../what-agents-may-do.md#althars-tools-outside-the-sandbox)
> (`ops_run`) and a new section on the person's secrets, shared with
> DEV-208. The plan is [Ops mode](../../plans/ops-mode.md); this is step A,
> [DEV-283](https://linear.app/althar/issue/DEV-283).

- **Status:** Proposed
- **Date:** 2026-11-24
- **Owner:** Runtime and desktop main-process maintainers
- **Related:** [ADR-057, Althar's tools outside the sandbox](../what-agents-may-do.md#althars-tools-outside-the-sandbox),
  [ADR-023, Althar runs the project itself](../workspaces-and-runs.md#running-the-project),
  [ADR-028, the keyring](../packaging.md#off-a-mac-windows-and-the-keyring),
  [ADR-020, what agents hand back](../tasks.md#what-agents-hand-back),
  [ADR-113, the Ops profile](113-an-ops-sandbox-profile-opens-ssh-and-never-keys.md),
  [ADR-115, read or change](115-a-command-is-read-or-change-per-tool-and-unsure-asks.md),
  [ADR-117, the run log](117-one-task-per-environment-and-every-run-in-the-log.md),
  DEV-208 (a store for the person's secrets).

## Context

Infra tools need credentials an agent must never see: an Ansible vault
password, a Terraform Cloud token, the AWS profile a provider reads, a
kubeconfig's token or the plugin that fetches one. Anything in a lead's
environment or readable in its sandbox is something a script can print
into the conversation, and a credential sent to a model's provider can't
be taken back ([what agents may do § What asks](../what-agents-may-do.md#what-asks)).

Althar already keeps one kind of secret, a code host's token, sealed by
the main process's keyring and never in the record or a log
(`packages/runtime/src/Secrets.ts`, `apps/desktop/src/main/keyring.ts`).
DEV-208 asks for a store of the person's own secrets; it isn't built.

## Decision

**A command that needs credentials runs through Althar's `ops_run`
tool, outside the lead's sandbox, in a sandbox of the run's own.**
Althar starts the process; it reaches the credentials its target needs
and nothing else of the person's home; the secrets go to that process
alone; what comes back to the lead is the output, masked.

### `ops_run`

- **Served to leads in the Ops profile** (ADR-113), from the pool beside
  `run_project` (`ToolServer.ts`). Arguments: `argv` (a list, never a
  shell line), the folder in the worktree it runs from, and an optional
  environment (ADR-116) where the command doesn't say one.
- **Only infra tools as the program:** `ansible-playbook`, `ansible`,
  `ansible-inventory`, `terraform`, `tofu`, `terragrunt`, `pulumi`,
  `kubectl`, `helm`, `helmfile`, `kustomize`, and `ssh`, `scp` and `rsync`
  for what changes a host (ADR-115 sends those here). No shell, no `env`,
  no `bash -c`, no pipes: what runs is exactly the words the card and the
  log show, and ADR-115 reads them without guessing.
- **No secret in `argv`.** A credential is named, never written:
  `${secret:DB_PASSWORD}` in an argument is replaced by Althar in the
  run's process only, and the card, the record and the log keep the
  reference. `ops_run` refuses, before anything is shown or recorded, an
  argument that carries a value where a credential goes: `-e` and
  `--extra-vars`, `-var`, `--set`, `--set-string`, `-backend-config` and
  `--config` pairs whose key reads as one (`password`, `passwd`,
  `secret`, `token`, `key`, `credential`, `auth`, case and separators
  aside); `--token`, `--password`, `--kube-token`, `--client-key`,
  `--vault-password`; and any argument containing a stored secret's
  value. The refusal says to use a reference.

### Where it runs, and what it reaches

An infra tool runs more than its own code: Ansible's roles, plugins and
`library/` modules from the worktree, Terraform's providers and
`external` programs, Helm's and kubectl's plugins. That code is the
lead's to change. So a run is not "the person, outside every sandbox":

- **In a sandbox of its own,** the same OS sandbox a lead's session has
  (bubblewrap with its own process namespace on Linux, Seatbelt on
  macOS), started by the runtime. It reads the worktree, the tool's
  binaries and Althar's folder for this run; it writes that folder and
  the run-only caches below; the network is open, as the tool needs it.
- **Only the credentials of its target.** The rest of the person's home,
  every one of `SECRET_PLACES` included, is denied. What the target
  needs is named where its environment is (ADR-116's `credentials:`, or
  the project's settings with only A) and copied for the run into its
  folder, narrowed: a cluster config of the one context, minified and
  flattened by Althar; one cloud profile's settings; a service-account
  file; a Terraform Cloud token as `TF_TOKEN_*`. A tool that finds
  nothing it was given fails, and says what it looked for.
- **Trusted executables only from caches the lead can't write.** The
  caches ADR-113 opens to the lead are its to fill; a run uses caches of
  its own under Althar's profile, which no lead writes: Terraform
  providers verified against `.terraform.lock.hcl`'s hashes from the
  default branch, Ansible collections and roles installed by Althar from
  `requirements.yml` as merged, Helm and kubectl plugins the person
  installed (never `HELM_PLUGINS` or a `PATH` from the worktree).
- **Code the task changed runs only on a decision.** Where the files a run
  executes (roles, plugins, `library/`, `filter_plugins/`, local Terraform
  modules, `*.tf` with `external` or `local-exec`, a chart's templates)
  differ from the default branch, the run is unsure (ADR-115) whatever its
  flags say, with only A as with B: it asks, and in B goes to its
  environment's gate. Unchanged, merged code runs as its flags say.
- **Where no such sandbox starts** (Windows, the Flatpak, Linux without
  bubblewrap), `ops_run` runs nothing that needs a credential, and says
  why. Credential-free reads (`terraform validate`, `ansible-lint`) still
  run there.

Masking (below) is for what the tool prints. It is not this boundary.
- **Each call is classified (ADR-115) and decided** by the rules, and in
  step B by the environment's gate (ADR-116) and lock (ADR-117), before it
  starts. A read starts at once.
- **Its output streams to a card in the thread,** as Run's does, and the
  lead gets it, masked, when the run ends or as it goes (`follow: true`).
  It can be stopped from the card or by `ops_stop`; stopping ends its
  process group (`stopping.ts`).
- **It carries `ALTHAR_WORK`,** so the load meter and settling find its
  processes (`machine.ts`), and settling a task stops what it left running.

### Where secrets live

- **In DEV-208's store, its first slice built for this:** a secret has a
  name (`ANSIBLE_VAULT_PASSWORD`, `TF_TOKEN_app_terraform_io`), a value
  sealed by the keyring as a code host's token is (`Secrets.ts` through
  main), a project, and the environments that get it (all, until B adds
  environments). Never in `settings.json`, the record or a log.
- **Kinds by how they're handed over:** a **file** (a vault password, a
  service-account JSON) or an **environment variable** (a token).
- **Added by the person, never through chat.** A lead that needs one
  calls `ops_run`, which fails with "needs `ANSIBLE_VAULT_PASSWORD`";
  Althar shows a card, "Prod's vault password, for ops runs in
  infra-live", with a field the person fills in. The value goes from the
  window to main to the store; it never passes through the runtime's
  record or the agent.
- **Shown as names with masked values,** replaceable, never revealed, with
  the runs that used each (from ADR-117's log).
- **Later, references:** a file the person already keeps (`~/.vault_pass`),
  or a password manager (`op://vault/item/field`), read by Althar at run
  time. The plan's open question 5.

### How a secret reaches one run

- **Only while nothing else could read it.** A secret, or a narrowed
  credential above, is handed over only while every agent session running
  on this computer, in any project, is held by a sandbox that denies
  reads of Althar's runs folder and has a process namespace of its own:
  Claude Code's, where it starts. While a Codex, OpenCode or unsandboxed
  session runs (one that could read a same-user `0600` file, or another
  process's descriptors), `ops_run` doesn't hand a secret over, and says
  which session stands in the way; the person can stop it or wait. A
  session of that kind doesn't start while a run holding a secret goes
  on: it waits for the run, with a line saying so.
- **A file secret** goes by an inherited descriptor where the tool takes
  one (`--vault-password-file /dev/fd/3`, a pipe Althar writes and
  closes), so it is never on disk. Where a tool needs a path, it is
  written into the run's folder under Althar's profile (`runs/<run id>/`),
  mode `0600`, inside the run's sandbox and denied to every session's,
  and removed when the run ends, however it ends, and on Althar's next
  start for a run that crashed. The tool is pointed at it by its own flag
  or variable: `ANSIBLE_VAULT_PASSWORD_FILE`,
  `GOOGLE_APPLICATION_CREDENTIALS`.
- **A variable secret** is set in the run's environment only, built from
  `runProcess.ts`'s allowlist, never Althar's own environment. Another
  process can't read it from a lead's sandbox: on Linux each sandbox has
  its own process namespace; on macOS `ps` runs outside the sandbox
  (`ALWAYS` in `sandboxReach.ts`), so the rules refuse `ps` with `e`,
  `-E` or `eww`, and reading `/proc/*/environ`, as credential reads.
- **Never to the lead's session,** a helper, the coordinator's judge, a
  review copy, or Run. DEV-208 decides those later, opt-in per secret.

### Masking what comes back

Before output reaches the lead, the card or the log, Althar replaces:

- every value it handed to the run, and its base64 form;
- every vault value it could open for the run: Althar decrypts the
  repository's vault files and `!vault` strings itself, in memory, for the
  length of the run, to know what to mask, and keeps none of them;
- what the tool marks as secret where it says so (`terraform`'s
  `(sensitive value)` is already hidden).

Masking is best effort, and says so: a secret transformed by a template
(split, hashed, wrapped) isn't found. The card warns when a run uses
`--diff` on a play that templates a vault value.

## Alternatives

- **Secrets in the lead's environment, its commands sandboxed.** Every
  `echo $VAR` and every crash dump shows it. Rejected.
- **A vault password script the sandbox may run** (a helper that asks
  Althar over a socket). The agent runs it too. Rejected.
- **The agent runs tools in its shell; Althar injects only into matching
  commands.** A shell line can't be matched to what it runs (ADR-097:
  what the rules can't read goes ahead), so the injected value reaches
  whatever the line really does. Rejected for the same reason `ops_run`
  takes `argv`.
- **Leave secrets to the person's own tooling** (`aws-vault exec`, `sops`)
  in the lead's shell. Those still put the credential in the agent's
  process. A reference (`op://`) read by Althar keeps their tooling
  without that.

## Consequences

- A lead never holds a credential file or token, in any profile; its SSH
  agent is the one way it reaches a host, and B3 takes prod's keys out of
  that.
- A run's own code, the task's changes included, sees only its target's
  credentials, and runs at all only on a decision where the task changed
  it.
- Infra commands and changes to hosts go through one tool, which gives
  step B a single place to classify, gate, lock and log them.
- `ops_run` needs the OS sandbox the leads use, started by the runtime
  for a process of its own. Where it can't start, nothing that needs a
  credential runs, which is stricter than today.
- A Codex, OpenCode or unsandboxed session anywhere on the computer holds
  secret runs back while it runs: a same-user file or descriptor is
  readable without read isolation.
- An agent can't use a tool's interactive prompts through `ops_run`
  (`terraform apply` without `-auto-approve` waits on stdin). `ops_run`
  gives no stdin and adds nothing; the classification reads `apply` as a
  change either way, and B's card is the approval.
- A secret store exists before the rest of DEV-208, scoped so DEV-208
  extends it rather than replaces it.

## What an implementation touches

- New `packages/runtime/src/OpsRuns.ts`: the `ops_run` and `ops_stop`
  tools, served from `ToolServer.ts` (`POOL`) for leads in Ops, wired in
  `Runtime.ts`; built on `Launches.ts` and `runProcess.ts` (process,
  environment allowlist, live output) and `stopping.ts`; the `argv`
  check for inline credentials and `${secret:…}` references.
- The run's sandbox: `packages/provider-adapters/src/registry.ts`'s
  sandbox settings (`claudeSandboxStarts`, the deny list) reused for a
  process the runtime starts, with the run's folder, its narrowed
  credentials and Althar's run-only caches; `toolPlaces.ts` for those
  caches; the comparison with the default branch of the files a run
  executes.
- `packages/runtime/src/Sessions.ts` and `Busy.ts`: which sessions are
  held by a read-isolating sandbox, so secret delivery waits for the
  others, and they wait for it.
- `packages/runtime/src/Secrets.ts`: named secrets per project and
  environment beside code hosts' tokens; `apps/desktop/src/main/keyring.ts`
  unchanged; a main-process path for the person's value that bypasses the
  runtime's record.
- `packages/runtime/src/rulePaths.ts` and `rules.ts`: `credentialReason`
  refuses `ps` environment reads and `/proc/*/environ`; the runs folder
  joins the deny list.
- `packages/provider-adapters/src/registry.ts`: every session's read deny
  list gains the runs folder.
- `packages/persistence-sqlite/src/migrations/`: the secrets' names,
  projects and environments (values stay sealed in files, as tokens are).
- `packages/contracts/src/Api.ts`: the secret card, the list, `ops_run`'s
  card.
- `packages/ui/src/thread/RunCard/` (an ops run's card),
  `apps/desktop/src/renderer/features/projectSettings/` (the secrets list).
- Tests: a run gets its file and variable and the lead's session doesn't;
  the file is gone after the run, after a stop and after a crash; output
  is masked; `ops_run` refuses a shell as its program, an inline
  credential in `argv`, and a secret while an unsandboxed session runs; a
  run reads nothing of the home folder beyond what it was given.
