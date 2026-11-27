# ADR-115: An infra command is a read or a change, per tool, and unsure counts as a change

> A proposal, not built. Where it would fold in:
> [what-agents-may-do.md § What asks](../what-agents-may-do.md#what-asks)
> and [§ The person's rules](../what-agents-may-do.md#the-persons-rules)
> (how a deploy is read). The plan is [Ops mode](../../plans/ops-mode.md);
> this is step A, [DEV-283](https://linear.app/althar/issue/DEV-283), and the
> classification step B's gate keys off
> ([DEV-284](https://linear.app/althar/issue/DEV-284)).

- **Status:** Proposed
- **Date:** 2026-11-24
- **Owner:** Runtime maintainers (the rules)
- **Related:** [ADR-013 and ADR-018, the person's rules](../what-agents-may-do.md#the-persons-rules),
  [ADR-067 and ADR-097, what asks](../what-agents-may-do.md#what-asks),
  [ADR-071, the sandbox is the boundary](../what-agents-may-do.md#the-sandbox-is-the-boundary),
  [ADR-113, the Ops profile](113-an-ops-sandbox-profile-opens-ssh-and-never-keys.md),
  [ADR-114, `ops_run`](114-secrets-go-to-one-run-never-to-the-agent.md),
  [ADR-116, environments and the gate](116-environments-bind-targets-and-set-the-gate.md).

## Context

The rules already read deploy tools by their subcommand (`DEPLOYERS`,
`DESTROYERS`, `dryRun()` in `packages/runtime/src/rules.ts`): teardown is
on the irreversible list and asks; a plain deploy goes ahead with
everything allowed, "since the next deploy replaces it". `ansible-playbook`
and `ssh host 'command'` aren't read at all. For an infrastructure
repository the line that matters is another one: does this command
**look** at a system, or **change** it?

## Decision

**In the Ops profile, every infra command, in the lead's shell or through
`ops_run`, is one of four:**

- **read:** it looks and changes nothing; it goes ahead, in every
  environment;
- **change:** it changes something; it gets the rule kind `infra`, which
  the profile's own check holds for the person (with only A built), or
  the environment's gate (with B);
- **secret:** it shows a credential; it is refused, as reading `~/.ssh` is;
- **unsure:** the rules can't tell; it is treated as a change.

A change or unsure command to a host (`ssh`, `scp`, `rsync`, `sftp`) in the
lead's shell is refused there with "Run it through `ops_run`", so that
every change has one runner that gates, locks and logs it (ADR-116,
ADR-117). Reads over `ssh` go ahead in the shell, and are in the thread,
not the run log.

Teardown stays on the irreversible list, as today, and asks whatever the
environment. The new module `opsCommands.ts` reads the words; `rules.ts`
calls it from `kindsOf` beside `deploys()` and `destroys()`, for each
command of a line, after wrappers (`sudo`, `timeout`, `env`) are taken
off, as now, and only where the task's profile is Ops.

### Per tool

Flags are read wherever they stand; subcommands in the subcommand's
place, never in arguments or quoted text, as `deploys()` does now.

| Tool | Read | Change | Secret (refused) |
|---|---|---|---|
| **ansible-playbook** | `--check`/`-C` (with or without `--diff`); `--syntax-check`, `--list-hosts`, `--list-tasks`, `--list-tags` | Anything else | `-e @vault.yml` with `--ask-vault-pass` from a lead (it has no password); `ansible-vault view`, `decrypt`, `edit` from a lead |
| **ansible** (ad hoc) | Modules `ping`, `setup`, `gather_facts`, `stat`, `find`, `slurp`* of a non-secret path, `service_facts`, `package_facts`; `command`/`shell` with an argument the ssh column reads as a read | Any other module; `-b` alone doesn't change it | `slurp`/`fetch` of a secret path |
| **ansible-inventory, ansible-doc, ansible-config, ansible-lint, ansible-galaxy** | All (Galaxy installs into the caches ADR-113 opens) | | A vault password file they name, read by its path (`secretOf`) |
| **terraform, tofu, terragrunt** | `plan` (with `-destroy` or `-refresh-only`; never `-out`, below), `validate`, `fmt` (`-check` or not: it only touches the worktree), `show` of the state in its human form, `graph`, `providers`, `version`, `init` without `-migrate-state`/`-force-copy`/`-reconfigure`, `workspace list`/`show`/`select`, `state list`, `get`; terragrunt's `run-all` of those | `apply` (and `apply -refresh-only`), `import`, `refresh`, `taint`, `untaint`, `state mv`/`rm`/`push`/`replace-provider`, `force-unlock`, `workspace new`/`delete`, `init -migrate-state` | `output` without a name or with `-json`/`-raw` (shows sensitive values), `state show`, `state pull`, `show -json`, `show` of any plan file, `plan -out` with a path of the caller's, `console` |
| **pulumi** | `preview`, `stack ls`/`select`/`history`, `config` without `--show-secrets`, `about`, `whoami` | `up`, `refresh`, `import`, `cancel`, `stack rm`, `state delete`/`unprotect`, `config set` | `stack output --show-secrets`, `config --show-secrets`, `stack export` |
| **kubectl** | `get`, `describe`, `logs`, `top`, `explain`, `api-resources`, `api-versions`, `version`, `cluster-info`, `diff`, `auth can-i`, `events`, `rollout status`/`history`, `config get-contexts`/`current-context`/`view` (minified, without `--raw`), any verb with `--dry-run=client\|server` | `apply`, `create`, `replace`, `patch`, `edit`, `set`, `scale`, `autoscale`, `label`, `annotate`, `expose`, `run`, `rollout restart`/`undo`/`pause`/`resume`, `cordon`, `uncordon`, `drain`, `taint`, `certificate approve`, `config use-context`/`set-*` (they write the person's kubeconfig) | `get`/`describe` of `secret(s)` with `-o yaml\|json\|jsonpath\|go-template`, `config view --raw`, `create token` |
| **kubectl, unsure** | | `exec`, `attach`, `debug`, `cp`, `port-forward`, `proxy`: a shell or a tunnel into the cluster, read like `ssh` below where the words allow (`exec pod -- cat /etc/hosts` is a read) | |
| **helm, helmfile** | `list`, `status`, `history`, `get notes`/`metadata`/`hooks`, `template`, `lint`, `show`, `search`, `diff` (plugin), `repo list`/`add`/`update` (local), `dependency build`/`update`, `install`/`upgrade` with `--dry-run`; helmfile `diff`, `template`, `lint`, `list` | `install`, `upgrade`, `rollback`, `uninstall` (also irreversible), `test`; helmfile `apply`, `sync`, `destroy` | `get values`, `get all`, `get manifest` (Secrets in clear); `registry login` |
| **kustomize** | `build`, `cfg` reads | `edit` only touches the worktree: read | |
| **ssh** | `ssh host` + a remote command the rules read as a read, below | A remote command they read as a change; `ssh host` with no command (a login shell the agent can't use anyway) | A remote read of a secret path, below |
| **scp, rsync, sftp** | Copying **from** a host into the worktree | Copying **to** a host; `rsync --delete` to a host is also irreversible | Copying a secret path from a host |

\* `slurp` returns a file's contents.

**Saved plans are Althar's.** A plan file holds the run's inputs and the
resources' values in clear, sensitive ones included, whatever the
streamed output masks. So `ops_run` saves the plan itself, into the run's
private folder (ADR-114), applies that file, and renders it for the card
only in Terraform's human form, masked; a caller's `-out`, `show` of a
plan file and `show -json` are refused. A plan never lands in the
worktree.

**A remote command over `ssh`** (and `ansible -m command|shell`,
`kubectl exec … --`) is read with the same shell reader as a local line
(`shellCommands.ts`). A program is a read only in the argument forms
listed for it; any other form of a listed program, and any program not
listed, is unsure:

- **Reads, by exact form:**
  - `systemctl status|is-active|is-enabled|is-failed|list-units|list-timers`,
    and `show` only with `-p`/`--property` naming only listed properties
    (below); `journalctl` without
    `--vacuum-*`, `--rotate`, `--flush` or `--sync`;
  - `cat`, `less`, `head`, `tail`, `grep`, `zgrep`, `ls`, `stat`, `file`,
    `wc` of paths not in the secret list below; `find` without `-delete`,
    `-exec`, `-execdir`, `-ok`, `-fprint*`, `-fls`;
  - `df`, `du`, `free`, `uptime`, `w`, `who`, `last`, `id`, `whoami`,
    `uname`, `ps` without `e`, `-E` or an `eww` form, `top -bn1`, `ss`,
    `netstat`, `ip` with `a|addr|r|route|link` and `show` or nothing after,
    `ping` with `-c`, `dig`, `host`;
  - `hostname` with no argument or only `-f`, `-s`, `-d`, `-i`, `-I`
    (a name after it sets it); `date` with no argument or only a
    `+FORMAT`, `-u`, `-R`, `-I…` (`-s`, `--set` or a bare date sets the
    clock);
  - `curl` and `wget` with no body, method other than `GET`/`HEAD`,
    upload or output file;
  - `docker ps|images|logs|stats --no-stream`, and `docker inspect` only
    with a `--format`/`-f` that selects listed fields (below); `crictl
    ps|logs`, and `crictl inspect` only with `-o go-template` that
    selects listed fields;
  - `nginx -t`, `apachectl -t` or `configtest`, `sshd -t`,
    `openssl x509 -noout`, `dpkg -l`, `rpm -q`, `apt list`, `dnf list`;
  - `sudo` (without `-s`, `-i`, `-e` or `-u` of a shell) before any of
    these, as the same form.
- **Inspections by allowlisted fields, never by "has a format".** A
  format can select the very values an unformatted inspection leaks, so
  what narrows a read is the fields it names, matched against a list:
  - **Container inspection:** accept exact scalar templates. For Docker
    these are `{{.State.Status}}`, `{{.State.Running}}`,
    `{{.State.ExitCode}}` and `{{.RestartCount}}`. For crictl these are
    `{{.status.state}}` and `{{.status.exitCode}}`. Apply each list only
    to that tool's supported container form.
  - **Secret:** a template that selects `.Config.Env`, `.Config.Cmd`,
    `.Config.Entrypoint`, `.Args`, `.Spec`, `.Config` or `.` as a whole,
    selects container environment entries in the CRI runtime spec,
    uses `json`, `printf "%v"` or `range` over the whole object (a way
    of printing what the field list can't see), or `-o json`/`-o yaml`
    for `crictl`; the same for `docker inspect` of a service, secret or
    config.
  - **Unsure:** a template that names a field the list doesn't have, or
    that the reader can't parse (a function, a nested `with` it can't
    follow).
  - **`systemctl show -p`:** read for `ActiveState`, `SubState`,
    `LoadState`, `UnitFileState`, `Result`, `MainPID`, `NRestarts`,
    `ExecMainStatus`, `ExecMainStartTimestamp` and `ActiveEnterTimestamp`,
    with every requested property checked and a secret selection taking precedence;
    **secret** for `Environment`, `EnvironmentFiles`, `PassEnvironment`,
    `ExecStart`, `ExecStartPre`, `ExecStartPost`, `ExecStop`, `ExecReload`,
    `LoadCredential`, `SetCredential`, `ImportCredential`; any other
    property is unsure. `systemctl cat` prints the unit file, including
    its `Environment=` lines, so it is **unsure**, not a read.
- **Inspections whose plain output carries credentials** are secret, not
  read, unless narrowed to listed fields as above: `env`, `printenv`,
  `set`, `export -p`, `systemctl show` without a property, `docker
  inspect` and `crictl inspect` without a format, `ps` with environment
  forms, `cat /proc/*/environ`.
- **Secret paths, refused:** `/etc/shadow`, `/etc/gshadow`, `~/.ssh` and
  `/root/.ssh` but `known_hosts` and `authorized_keys`, `*.key`, `*.pem`
  under `/etc/ssl/private` or a `private/` folder, `.env` files,
  `/proc/*/environ`, `/etc/*/secrets*`, a vault's own files. The list is
  the local `SECRET_PLACES` read as remote paths, and grows in review.
- **Everything else** on a remote host is a change. A remote line with a
  pipe, `$(…)` or a script is read as a local one is; what can't be read
  is unsure.

### What a read runs

Before classifying a preview as a read, Althar inspects the code and inputs
it would execute, including dependencies. A playbook can contain a task
with `check_mode: false` on the default branch. Ansible may change a host
during that preview. A Terraform external data source or a custom plugin
can likewise execute a program during planning.

Changed executable inputs still count as unsure. For merged inputs a
preview qualifies as a read only when all reachable operations have known
read-only preview behavior. Dynamic includes, unknown plugins and arbitrary
programs such as a Pulumi stack leave the result unsure. Apply this check
also to discovery and refreshes. Do not execute repository code to decide
whether it is safe to execute.

When a preview could change a target or Althar cannot establish that it is
read-only, show the person the requested command and the reason without
running a preview. This overrides the ordinary dev and staging defaults.
Approval covers exactly one execution under the change lock in step B.
A subsequent apply or retry requires its own approval (ADR-116).

### Unsure

[What asks](../what-agents-may-do.md#what-asks) says "when unsure,
allow". The Ops profile is the one place that gives way: the person
switched it on to be asked about changes to running systems, and a
command the rules can't read on prod is exactly what they want to see.
So, in the profile only:

- an unreadable remote command, an unknown subcommand of a known tool, an
  `ops_run` read whose preview is preview-unsafe as above, and a script named for
  infra work (`./deploy.sh`, `make apply`, `just provision`: today's
  `deploys()` words, plus `apply`, `provision`, `rollout`, `migrate`) are
  unsure;
- except for the preview rule above, unsure is gated as a change: with A, it asks; with B, dev goes ahead
  anyway, staging is judged, prod asks.

What isn't an infra command at all (`ls`, `npm test`, an edit) is read as
today. A shell script the rules can't open still goes ahead unread
(ADR-097), which is why credentials stay out of the shell (ADR-114) and
prod's keys out of its SSH agent (the plan's B3).

### Where the kind sits

- A new rule kind, **`infra`**, joins `RULES` in `ruleContext.ts`, with
  its words in `RULE_WORDS` ("Changing infrastructure").
- **Its own check, not the Ask me list.** In `rules.ts` today, `decide`
  returns `ALLOW` in allow mode once the irreversible list and the
  person's named Ask commands have answered, without reading the
  project's `ask` kinds, and `decideInside` does the same. A kind on the
  Ask me list would therefore never ask under Allow everything, every
  project's default. So `RuleContext` gains the **task's effective
  profile** (the task's override, else the project's), and both `decide`
  and `decideInside` check it right after Never, secrets and the
  irreversible list, before any `ALLOW`: in Ops, an `infra` or unsure
  infra command gets the profile's verdict (with A, ask the person; with
  B, the environment's gate). A task's Allow everything (ADR-043) doesn't
  reach it. The person can loosen it for a project in Rules
  ("Infrastructure changes go ahead", which with B is every environment
  set to `go` but prod); an agent can't.
- **Code keeps today's rules exactly.** In the Code profile `opsCommands.ts`
  isn't called: `kubectl apply`, `terraform apply`, `helm upgrade` and
  `pulumi up` stay `deploy`, as `DEPLOYERS` has them, with what a project
  set for `deploy` (Ask me, Never, an allow rule) holding as it does now.
  In Ops, those commands are `infra` instead; `deploy` keeps publishing
  and deploys outside infra tools (`wrangler deploy`, `npm publish`).
  Teardown stays irreversible in both.
- **Acceptance cases,** each with Allow everything on, which is the
  default, and off: on one project, an Ops task's `ops_run terraform
  apply` waits for the person (with A) while a Code sibling's `terraform
  apply` in its shell goes ahead as a deploy does today; a project whose
  rules ask before `deploy` still asks for the Code sibling; switching the
  Ops task to Code (or the sibling to Ops) changes only that task's
  verdicts; `decide` and `decideInside` agree on every case.
- The card for an `infra` ask says which word made it a change: "`terraform
  apply` changes infrastructure"; for unsure, "Althar can't tell whether
  `ssh web1 ./fix.sh` changes web1, so it asks."
- Allow always on such a card writes a command rule as today, never "allow
  `infra`" as a kind from a card.

## Alternatives

- **Everything an infra tool does asks.** The read that should be free
  (`--check`, `plan`, `get`) would ask, and the person would answer
  without reading. Rejected: it's the problem the profile is for.
- **Unsure goes ahead, as elsewhere.** Then `ssh prod ./fix.sh` runs on
  prod unasked, in the profile meant to stop it. Rejected, for the
  profile only.
- **Ask the tool:** run `terraform plan` and apply only if it shows no
  change. Good for the card (ADR-116 shows it), but it can't classify
  `ssh` or `ansible`, and a plan isn't the command.
- **The coordinator's judge classifies.** A minute per command, and a
  model reading words the rules can read. Rejected: the judge answers
  staging's gate, not the classification.

## Consequences

- `ansible-playbook --check`, `terraform plan`, `kubectl get`, `ssh host
  'systemctl status x'` run with nothing to answer, in every environment.
- The table is code with tests, and grows like the deploy list: a tool or
  subcommand that's missing is unsure, so it asks rather than slips by.
- A change to the table is a change to what asks, reviewed as one.

## What an implementation touches

- New `packages/runtime/src/opsCommands.ts`: the table above, the remote
  command lists, `classify(words): 'read' | 'change' | 'secret' | 'unsure'`
  with the word that decided it.
- `packages/runtime/src/rules.ts`: `kindsOf` calls it beside `deploys()`
  where the task's profile is Ops; `DEPLOYERS`, `destroys()` and
  `DESTROYERS` unchanged, so Code reads as now; `decide` and
  `decideInside` refuse `secret` as `credentialReason` does, and check
  the profile's verdict for `infra` and unsure before every `ALLOW`
  return; a change to a host in the shell is refused toward `ops_run`.
- `packages/runtime/src/ruleContext.ts`: `infra` in `RULES`, `RULE_WORDS`,
  and the task's effective profile in `RuleContext`; `Permissions.ts`
  (`runRules`) fills it from the task's override or the project's
  `sandboxProfile` (`Policies.ts`).
- `packages/runtime/src/shellCommands.ts`: reading `ssh`'s remote command,
  `kubectl exec --`'s and `ansible -a`'s as lines.
- `packages/runtime/src/OpsRuns.ts` (ADR-114): the preview-unsafe scan of
  what a read would run (merged code included), the inspection field
  lists, and the saved plan in the run's folder.
- `packages/runtime/src/tally.ts`: `infra` and `unsure` counted, so a kind
  agents keep working around shows in Rules' "Last 14 days".
- `packages/ui/src/lib/commandGlance.ts` and
  `packages/ui/src/thread/Permission/`: the card's line.
- Tests: a table test per tool and row, in `packages/runtime/tests/`
  beside `rulesReadings.test.ts`; `--dry-run` and `--check` with every
  spelling; remote lines with pipes and `sudo`; every listed remote
  program in a form that changes something (`hostname web9`, `date -s`)
  read as unsure; the Ops task and Code sibling cases above, through both
  `decide` and `decideInside`. Inspections: `docker inspect -f
  '{{.Config.Env}}' web`, `docker inspect --format '{{json .}}' web`,
  `crictl inspect -o json`, and `systemctl show -p Environment app` are
  secret; `systemctl cat app` and a template naming an unlisted field are
  unsure; `docker inspect -f '{{.State.Status}}' web` is a read. Previews:
  merged, unchanged playbook with a `check_mode: false` task that runs a
  `command` is preview-unsafe on `--check`, in an Ops task, and
  its preview isn't started before the decision or again after the lock;
  a plain merged playbook with none of the constructs is a read.
