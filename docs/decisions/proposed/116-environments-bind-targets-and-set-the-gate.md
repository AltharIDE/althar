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
    credentials: { kube: gke_acme_europe-west1_prod, aws_profile: acme-prod }
```

`secrets:` names the secrets a run there is given (ADR-114);
`credentials:` names which of the person's own a run's sandbox gets,
narrowed to that context or profile (ADR-114). Neither holds a value.

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

`ops_run` (ADR-114) finds the target before it decides, in the runtime. It parses trusted settings as data. Any helper process
for discovery needs ADR-114's isolation and ADR-115's read-only check.
If discovery requires executing unverified repository code, stop and ask
for a statically resolvable target. It resolves where the
command would really go, refuses the flags that could send it elsewhere,
and then **runs it pinned to that target**, so the destination the gate
and the lock saw is the only one the run can reach:

| Tool | Its target | Refused | Pinned by |
|---|---|---|---|
| **ansible-playbook, ansible** | The inventory (`-i`, else `ansible.cfg`'s); the hosts `--list-hosts` resolves with `--limit`; each host's groups. Every environment a host is in counts. | `-i` of a host list written inline (`-i web1,`), `-e ansible_host=…` and other connection variables (`ansible_host`, `ansible_port`, `ansible_user`, `ansible_ssh_common_args`, `ansible_connection`) on the command line | `--limit` set to exactly the hosts resolved, and the inventory files' digests, checked again before it starts |
| **terraform, tofu, terragrunt** | The folder it runs in (`-chdir`), then the workspace (`TF_WORKSPACE`, else `terraform workspace show`), then a `-var-file` named for an environment. | `-backend-config` overrides, `-state`, `-state-out` | `TF_WORKSPACE` set by Althar; the run's credentials only for that environment's account |
| **pulumi** | The stack (`--stack`, else the selected one). | `--cwd` outside the worktree | `--stack` set by Althar |
| **kubectl** | `--context`, else the current context of the config Althar gives it. | `--server`, `-s`, `--cluster`, `--user`, `--token`, `--kubeconfig`, `--insecure-skip-tls-verify`, `--certificate-authority`, `--as` | A config of the one context, minified (ADR-114), and `--context` set to it |
| **helm** | `--kube-context` (Helm's name for it), else the current context of the config Althar gives it. | `--kube-apiserver`, `--kube-token`, `--kubeconfig`, `--kube-as-user`, `--kube-as-group`, `--kube-ca-file`, `--kube-insecure-skip-tls-verify`, `--kube-tls-server-name` | The same one-context config, and `--kube-context` set to it |
| **helmfile** | `-e` and each release's `kubeContext` in the rendered state | `--kube-context` overriding a release's, `--kubeconfig` | The one-context config; a helmfile whose releases name more than one context is refused, and the card says to run one environment at a time |
| **ssh, scp, rsync** | The host as written, and as `ssh -G` resolves it (`HostName`, `ProxyJump`'s hosts too), matched against `ssh.hosts` and the inventory's hosts. | `-o` and `-F` that change `HostName`, `ProxyJump`, `ProxyCommand` or the port; `-J` | `-o HostName=` and `-o ProxyJump=` as resolved |

A flag the table doesn't list for a tool that takes a destination is
read as unsure, so a new override asks rather than slips by.

- **Several environments:** the strictest gate of them decides, and the
  card names each.
- **None found:** a target no binding matches is **unbound**. A change or
  unsure command to an unbound target always waits for the person,
  whatever environments the project has bound: a project that has bound
  only dev so far doesn't let a change to an unknown production host
  through as dev's. The card says "web9 isn't in any environment", and
  offers to bind it ("This is dev", "This is prod", any of the project's)
  and then decide on it as that environment, or to allow this one run
  unbound. Binding writes to the person's settings (the file is changed
  by a pull request). With no environments at all, step A holds: every
  change asks.
- **Reads need no target.** They go ahead (ADR-115) and are logged with
  whatever target was found.

### The gate

| Environment | A read | A change or unsure | Teardown (irreversible list) |
|---|---|---|---|
| **dev** | Goes ahead | Goes ahead | Asks the person |
| **staging** | Goes ahead | The coordinator's judge decides, with the plan; the person where it can't | Asks the person |
| **prod** | Goes ahead | **The person, on the prod card. Always.** | Asks the person, on the prod card |

A preview with possible side effects always requires the person's approval,
even in dev. The no-plan path below applies.

- **A file can tighten a gate, never loosen one.** `gate:` in
  `ops.yaml` takes `go`, `coordinator` or `person`; a value looser than
  the name's default is ignored, with a line in Rules saying so. Only the
  person loosens a gate, in the project's settings, and never prod's: a
  prod change on the person's word is the point of the mode.
- **Allow everything doesn't open prod.** The gate is the profile's own
  check, made before any allow (ADR-115), so neither the project's Allow
  everything nor a task's (ADR-043) reaches it.
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

A change against staging or prod runs in steps, so the person sees what
will happen before it does, and what runs is what they saw:

1. **Check the preview before executing it.** Apply ADR-115 to the actual
   inputs on every branch. If a merged playbook contains a task with
   `check_mode: false`, or read-only behavior cannot be established,
   show a card without a plan. Name the file and line, target, commit and
   exact requested operation. On every environment the person can decline
   or approve that single execution, bound to the commit, target, argv and
   input digests as in step 3. On approval skip to step 4. Record
   the execution as a change even when the request was for a preview.
2. **Generate a plan only for a verified read-only preview.** For example,
   `terraform plan -out=<run folder>/plan` (the plan stays in
   the run's private folder, ADR-115, and `apply` runs that saved plan,
   exactly, and fails if the state moved); `ansible-playbook --check
   --diff` with the same, pinned arguments; `kubectl diff`; `helm diff
   upgrade` (or `--dry-run` without the plugin); `pulumi preview`. Its
   output becomes the card's plan, masked (ADR-114).
3. **The gate decides on that plan.** The decision is bound to what the
   plan was made from: the commit (with a clean worktree), the resolved
   target and its pinning flags, the `argv`, and a digest of the inputs
   the tool reads beyond the commit (the inventory files as resolved, a
   chart's version and values, the rendered manifests, the saved
   Terraform plan).
4. **After the lock (ADR-117), immediately before it runs,** Althar checks
   that binding again: the commit and a clean worktree, the target as
   resolved now, the inputs' digest. For Ansible, kubectl and Helm, whose
   dry run isn't a file the apply uses, it runs the dry run again and
   compares its plan with the approved one, **unless the dry run is
   preview-unsafe, which is never run again on its own**: there the
   binding's digests of the code and inputs are the check, and a change
   in any of them lapses the decision. Terraform's saved plan
   checks itself. **Anything material changed** (another commit, another
   host, a different plan) and the decision lapses: the new plan goes to
   the gate again, with what changed shown first. An approval waiting
   behind another task's lock is checked this way when the lock comes.

Before refreshing a plan older than fifteen minutes, repeat step 1,
then check the decision at step 4 whatever its age.

### The prod card

One card, in the task's thread and in Needs you, in prod's colour:

- **What and where:** "Apply to **prod**", the tool, and the environment's
  name as `ops.yaml` gives it.
- **The exact command,** as `ops_run` will run it, `argv` in full with
  its pinning flags, secrets only as `${secret:NAME}` references (an
  inline credential never gets this far, ADR-114), and the folder it
  runs from.
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

When a preview could have side effects, the plan section shows the reason
and source location instead. The button names the exact execution requested.

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
  per tool, with `ssh -G` through `sshHosts.ts`: the resolved target, the
  refused override flags and the pinning flags.
- `packages/runtime/src/OpsRuns.ts` (ADR-114): the safe-dry-run check, the
  dry run, the saved plan, the gate, the decision's binding (commit,
  target, `argv`, inputs' digest) and its check after the lock.
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
  an unbound target in a project that binds only dev waits for the
  person; a looser `gate:` ignored; Helm's `--kube-context` resolved and
  `--kube-apiserver` refused, with dev current and prod named; each
  tool's run pinned to its resolved target; a dry run with a `check_mode:
  false` task, merged and unchanged, not started before a decision or
  again after the lock; a decision lapsing when the
  commit, target or plan changes while it waits for a lock; a saved plan
  applied and one whose state moved refused; `ops.yaml` from a branch not
  read.
