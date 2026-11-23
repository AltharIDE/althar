# ADR-116: Environments bind targets, and each sets the gate for a change

> A proposal, not built. Where it would fold in:
> [what-agents-may-do.md § What asks](../what-agents-may-do.md#what-asks)
> (the gate per environment) and [§ Ask about more, and the coordinator decides](../what-agents-may-do.md#ask-about-more-and-the-coordinator-decides)
> (staging's judge), and [tasks.md](../tasks.md) (environments on a task).
> The plan is [Ops mode](../../plans/ops-mode.md); this is step B,
> [DEV-284](https://linear.app/althar/issue/DEV-284).

- **Status:** Proposed
- **Date:** 2026-11-24
- **Owner:** Runtime and desktop maintainers
- **Related:** [ADR-019, the coordinator's judge](../what-agents-may-do.md#ask-about-more-and-the-coordinator-decides),
  [ADR-043, Allow everything](../what-agents-may-do.md#ask-about-more-and-the-coordinator-decides),
  [Asking is the person's word](../what-agents-may-do.md#asking-is-the-persons-word),
  [ADR-114, `ops_run`](114-secrets-go-to-one-run-never-to-the-agent.md),
  [ADR-115, read or change](115-a-command-is-read-or-change-per-tool-and-unsure-asks.md),
  [ADR-117, locks and the run log](117-one-task-per-environment-and-every-run-in-the-log.md),
  #1160's ADR-112 (panels pick environments from kube contexts) and
  ADR-109 (`.althar/flow.yaml`), in [#1160](https://github.com/AltharIDE/althar/pull/1160).

## Context

With only step A, every change asks, wherever it points: a `terraform
apply` on a scratch dev workspace asks as one on prod does. People who
run infrastructure don't treat environments alike, and an agent that
asks about dev is one whose prod cards get answered without reading.

## Decision

**A project names its environments and what each one is, in its
repository; each environment has a gate; a change is gated by the
environment it targets.**

### Binding environments, `.althar/ops.yaml`

```yaml
environments:
  dev:
    ansible: { inventory: [inventory/dev.yml], groups: [dev] }
    terraform: { workspaces: [dev], folders: [envs/dev] }
    kube: { contexts: [kind-dev] }
    ssh: { hosts: ["*.dev.internal"] }
  staging:
    ansible: { inventory: [inventory/staging.yml] }
    terraform: { workspaces: [staging], folders: [envs/staging] }
    kube: { contexts: [gke_acme_europe-west1_staging] }
    ssh: { hosts: ["*.stg.internal"] }
  prod:
    gate: person
    ansible: { inventory: [inventory/prod.yml], groups: [prod, db] }
    terraform: { workspaces: [prod, default], folders: [envs/prod] }
    kube: { contexts: [gke_acme_europe-west1_prod] }
    ssh: { hosts: [bastion.acme.com, "*.prod.internal"] }
    secrets: [ANSIBLE_VAULT_PASSWORD_PROD]
```

- **Committed, so the team shares it,** beside #1160's `.althar/flow.yaml`.
  A panel (ADR-112) picks the same environments' kube contexts.
- **Read from the default branch as merged,** never from a task's
  worktree: a lead that edits `ops.yaml` in its branch changes nothing
  until the pull request merges, and that pull request is reviewed like
  any change. Althar reads it as it reads the default branch's other
  files, on each fetch.
- **The names are the project's.** `dev`, `staging` and `prod` have the
  defaults below; any other name has `prod`'s unless it says otherwise.
- **The person's own environments,** for a repository without the file or
  a binding they don't want to commit, are kept in the project's settings
  in the same shape, and add to the file's; where both bind a target, the
  stricter wins.

### Finding a command's environment

`ops_run` (ADR-114) finds the target before it decides, outside the
sandbox, where it can read what the agent can't:

| Tool | Its target |
|---|---|
| **ansible-playbook, ansible** | The inventory (`-i`, else `ansible.cfg`'s); the hosts `--list-hosts` resolves with `--limit`; each host's groups. Every environment a host is in counts. |
| **terraform, tofu, terragrunt** | The folder it runs in (`-chdir`), then the workspace (`TF_WORKSPACE`, else `terraform workspace show`), then a `-var-file` named for an environment. |
| **pulumi** | The stack (`--stack`, else the selected one). |
| **kubectl, helm, helmfile** | `--context`, else `--kubeconfig`'s or the person's current context, read by Althar from the kubeconfig at the time of the run; helmfile's `-e`. |
| **ssh, scp, rsync** | The host as written, and as `ssh -G` resolves it (`HostName`, `ProxyJump`'s hosts too), matched against `ssh.hosts` and the inventory's hosts. |

- **Several environments:** the strictest gate of them decides, and the
  card names each.
- **None found:** a target no binding matches is **unbound**, gated as the
  strictest environment the project has, and the card offers "This is
  dev" to bind it, which writes to the person's settings (the file is
  changed by a pull request). With no environments at all, step A holds:
  every change asks.
- **Reads need no target.** They go ahead (ADR-115) and are logged with
  whatever target was found.

### The gate

| Environment | A read | A change or unsure | Teardown (irreversible list) |
|---|---|---|---|
| **dev** | Goes ahead | Goes ahead | Asks the person |
| **staging** | Goes ahead | The coordinator's judge decides, with the plan; the person where it can't | Asks the person |
| **prod** | Goes ahead | **The person, on the prod card. Always.** | Asks the person, on the prod card |

- **A file can tighten a gate, never loosen one.** `gate:` in
  `ops.yaml` takes `go`, `coordinator` or `person`; a value looser than
  the name's default is ignored, with a line in Rules saying so. Only the
  person loosens a gate, in the project's settings, and never prod's: a
  prod change on the person's word is the point of the mode.
- **Allow everything doesn't open prod.** The gate is the person's Ask me
  given ahead, which holds with everything allowed (ADR-097); a task's
  Allow everything (ADR-043) doesn't change it either.
- **Never and Ask me still win.** A command the project never allows is
  refused on dev too.
- **Staging's judge** is ADR-019's: a fresh read-only session on the
  coordinator's agent, a minute at most, with the command, the
  environment, the target hosts or resources, and the plan's summary
  (counts and the resources changed, never the whole output). Where it
  can't judge (not Claude Code, no account, a failure, an unclear
  answer), the person decides, on the same card as prod's but without
  prod's mark.

### Plan, then apply

A change against staging or prod runs in two steps, so the person sees
what will happen before it does:

1. **`ops_run` runs the tool's dry run first, itself:**
   `terraform plan -out=<run folder>/plan` (then `apply` runs that saved
   plan, exactly, and fails if the state moved); `ansible-playbook --check
   --diff` with the same arguments; `kubectl diff`; `helm diff upgrade`
   (or `--dry-run` without the plugin); `pulumi preview`. Its output
   becomes the card's plan, masked (ADR-114).
2. **The gate decides on that plan,** and the change runs only if allowed.

A plan older than fifteen minutes, or one whose commit has moved, is run
again before the card shows.

### The prod card

One card, in the task's thread and in Needs you, in prod's colour:

- **What and where:** "Apply to **prod**", the tool, and the environment's
  name as `ops.yaml` gives it.
- **The exact command,** as `ops_run` will run it, `argv` in full, with
  the folder it runs from.
- **The targets:** the hosts (and how many, with the first twenty listed),
  or the workspace and its resources, or the context and namespace.
- **The plan:** Terraform's `+ add, ~ change, - destroy` counts, then the
  resources, destroys first and marked; Ansible's changed tasks per host
  with their diffs, folded, with the line "Ansible's dry run: a module
  without check support isn't in it"; kubectl's or Helm's diff.
- **The code:** the commit it runs from, its branch, whether it's on the
  default branch ("**Not merged yet**" in bold where not), and a refusal
  where the worktree has uncommitted changes: a prod run comes from a
  commit.
- **What it gets:** the secrets by name, and the lock it will take
  (ADR-117).
- **Who asked:** the task and its lead, and why, in the lead's one line.
- **Buttons:** "Apply to prod" and "Not now". No "always", no Allow all:
  each prod change is its own card. "Not now" sends the lead the
  person's reason, if they wrote one.

From a paired device, the same card, with the plan folded (the plan's
open question 8).

## Alternatives

- **Environments in Althar's settings only.** The team can't share or
  review them, and two people's bindings drift. Kept for the person's own
  additions, under the file.
- **Bindings from the worktree.** A lead could rebind prod as dev in its
  branch. Rejected.
- **One gate for everything, the person.** What step A does; it makes dev
  as slow as prod and teaches the person to press without reading.
- **The judge for prod too.** Rejected: DEV-284 and the project's
  decision both say the person decides prod, always.
- **Plans the agent runs, the card shows.** The agent could show a plan
  from another commit, or another workspace. `ops_run` runs the plan it
  will apply.

## Consequences

- Dev is as quick as the person's terminal; prod is as safe as a reviewed
  change with one look at its plan.
- A prod card is long; it is built to be read, folded where it's long,
  and is the one card that keeps its whole contents on a phone.
- Unbound targets ask, so a new environment's first runs teach Althar its
  bindings, through the person.

## What an implementation touches

- New `packages/runtime/src/environments.ts`: reading `.althar/ops.yaml`
  from the default branch's copy (as `repositoryInstructions.ts` reads
  committed files), the person's additions, and `targetOf(argv, folder)`
  per tool, with `ssh -G` through `sshHosts.ts`.
- `packages/runtime/src/OpsRuns.ts` (ADR-114): the dry run first, the
  saved plan, the gate.
- `packages/runtime/src/rules.ts` and `Permissions.ts`: the gate as a
  verdict (`allow`, `judge`, or `ask` with the prod card's kind); the
  task's `allowEverything` doesn't reach it.
- `packages/runtime/src/PermissionJudge.ts`: `JudgeInput` gains the
  environment and the plan's summary.
- `packages/runtime/src/Policies.ts`: the person's environments and gate
  changes in `ProjectRules`.
- `packages/contracts/src/Api.ts`: the prod card's shape.
- `packages/ui/src/thread/Permission/` (a prod variant, and its story),
  `apps/desktop/src/renderer/features/projectSettings/` (environments),
  the mobile card.
- Tests: the gate per environment and per kind; strictest of several;
  unbound; a looser `gate:` ignored; a saved plan applied and one whose
  state moved refused; `ops.yaml` from a branch not read.
