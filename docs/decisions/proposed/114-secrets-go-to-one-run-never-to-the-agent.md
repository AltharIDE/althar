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
tool, outside the lead's sandbox, as `run_project` does.** Althar starts
the process; the secrets go to that process alone; what comes back to
the lead is the output, masked.

### `ops_run`

- **Served to leads in the Ops profile** (ADR-113), from the pool beside
  `run_project` (`ToolServer.ts`). Arguments: `argv` (a list, never a
  shell line), the folder in the worktree it runs from, and an optional
  environment (ADR-116) where the command doesn't say one.
- **Only infra tools as the program:** `ansible-playbook`, `ansible`,
  `ansible-inventory`, `terraform`, `tofu`, `terragrunt`, `pulumi`,
  `kubectl`, `helm`, `helmfile`, `kustomize`. No shell, no `env`, no
  `bash -c`, no pipes: what runs is exactly the words the card and the log
  show, and ADR-115 reads them without guessing.
- **It runs as the person, outside the sandbox,** so the tool reads its
  own credentials where they are: `~/.aws`, `~/.kube/config` and its exec
  plugins, gcloud's. The tool reads them; the agent never does, as with
  `gh` today (`CLI_SIGN_INS`).
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

- **A file secret** is written for the run into a folder of its own under
  Althar's profile (`runs/<run id>/`), mode `0600`, outside every
  sandbox's reach (that folder is added to the deny list of every
  session), and removed when the run ends, however it ends, and on
  Althar's next start for a run that crashed. The tool is pointed at it by
  its own flag or variable: `--vault-password-file`,
  `ANSIBLE_VAULT_PASSWORD_FILE`, `GOOGLE_APPLICATION_CREDENTIALS`.
- **A variable secret** is set in the run's environment only, built from
  `runProcess.ts`'s allowlist, never Althar's own environment. Another
  process can't read it from the lead's sandbox: on Linux the sandbox has
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

- A lead never holds a credential that reaches prod, in any profile.
- Infra commands go through one tool, which gives step B a single place
  to classify, gate, lock and log them.
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
  environment allowlist, live output) and `stopping.ts`.
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
  is masked; `ops_run` refuses a shell as its program.
