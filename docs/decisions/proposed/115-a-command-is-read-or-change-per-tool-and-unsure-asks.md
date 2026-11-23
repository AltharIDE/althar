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
  the profile puts on the project's Ask me (with only A built), or the
  environment's gate (with B);
- **secret:** it shows a credential; it is refused, as reading `~/.ssh` is;
- **unsure:** the rules can't tell; it is treated as a change.

Teardown stays on the irreversible list, as today, and asks whatever the
environment. The new module `opsCommands.ts` reads the words; `rules.ts`
calls it from `kindsOf` beside `deploys()` and `destroys()`, for each
command of a line, after wrappers (`sudo`, `timeout`, `env`) are taken
off, as now.

### Per tool

Flags are read wherever they stand; subcommands in the subcommand's
place, never in arguments or quoted text, as `deploys()` does now.

| Tool | Read | Change | Secret (refused) |
|---|---|---|---|
| **ansible-playbook** | `--check`/`-C` (with or without `--diff`); `--syntax-check`, `--list-hosts`, `--list-tasks`, `--list-tags` | Anything else | `-e @vault.yml` with `--ask-vault-pass` from a lead (it has no password); `ansible-vault view`, `decrypt`, `edit` from a lead |
| **ansible** (ad hoc) | Modules `ping`, `setup`, `gather_facts`, `stat`, `find`, `slurp`* of a non-secret path, `service_facts`, `package_facts`; `command`/`shell` with an argument the ssh column reads as a read | Any other module; `-b` alone doesn't change it | `slurp`/`fetch` of a secret path |
| **ansible-inventory, ansible-doc, ansible-config, ansible-lint, ansible-galaxy** | All (Galaxy installs into the caches ADR-113 opens) | | A vault password file they name, read by its path (`secretOf`) |
| **terraform, tofu, terragrunt** | `plan` (with `-out`, `-destroy` or `-refresh-only`), `validate`, `fmt` (`-check` or not: it only touches the worktree), `show`, `graph`, `providers`, `version`, `init` without `-migrate-state`/`-force-copy`/`-reconfigure`, `workspace list`/`show`/`select`, `state list`, `get`; terragrunt's `run-all` of those | `apply` (and `apply -refresh-only`), `import`, `refresh`, `taint`, `untaint`, `state mv`/`rm`/`push`/`replace-provider`, `force-unlock`, `workspace new`/`delete`, `init -migrate-state` | `output` without a name or with `-json`/`-raw` (shows sensitive values), `state show`, `state pull`, `show -json` of a state, `console` |
| **pulumi** | `preview`, `stack ls`/`select`/`history`, `config` without `--show-secrets`, `about`, `whoami` | `up`, `refresh`, `import`, `cancel`, `stack rm`, `state delete`/`unprotect`, `config set` | `stack output --show-secrets`, `config --show-secrets`, `stack export` |
| **kubectl** | `get`, `describe`, `logs`, `top`, `explain`, `api-resources`, `api-versions`, `version`, `cluster-info`, `diff`, `auth can-i`, `events`, `rollout status`/`history`, `config get-contexts`/`current-context`/`view` (minified, without `--raw`), any verb with `--dry-run=client\|server` | `apply`, `create`, `replace`, `patch`, `edit`, `set`, `scale`, `autoscale`, `label`, `annotate`, `expose`, `run`, `rollout restart`/`undo`/`pause`/`resume`, `cordon`, `uncordon`, `drain`, `taint`, `certificate approve`, `config use-context`/`set-*` (they write the person's kubeconfig) | `get`/`describe` of `secret(s)` with `-o yaml\|json\|jsonpath\|go-template`, `config view --raw`, `create token` |
| **kubectl, unsure** | | `exec`, `attach`, `debug`, `cp`, `port-forward`, `proxy`: a shell or a tunnel into the cluster, read like `ssh` below where the words allow (`exec pod -- cat /etc/hosts` is a read) | |
| **helm, helmfile** | `list`, `status`, `history`, `get notes`/`metadata`/`hooks`, `template`, `lint`, `show`, `search`, `diff` (plugin), `repo list`/`add`/`update` (local), `dependency build`/`update`, `install`/`upgrade` with `--dry-run`; helmfile `diff`, `template`, `lint`, `list` | `install`, `upgrade`, `rollback`, `uninstall` (also irreversible), `test`; helmfile `apply`, `sync`, `destroy` | `get values`, `get all`, `get manifest` (Secrets in clear); `registry login` |
| **kustomize** | `build`, `cfg` reads | `edit` only touches the worktree: read | |
| **ssh** | `ssh host` + a remote command the rules read as a read, below | A remote command they read as a change; `ssh host` with no command (a login shell the agent can't use anyway) | A remote read of a secret path, below |
| **scp, rsync, sftp** | Copying **from** a host into the worktree | Copying **to** a host; `rsync --delete` to a host is also irreversible | Copying a secret path from a host |

\* `slurp` returns a file's contents.

**A remote command over `ssh`** (and `ansible -m command|shell`,
`kubectl exec … --`) is read with the same shell reader as a local line
(`shellCommands.ts`), its first word against two lists:

- **Reads:** `systemctl status|is-active|is-enabled|is-failed|list-units|list-timers|show|cat`,
  `journalctl`, `cat`, `less`, `head`, `tail`, `grep`, `zgrep`, `ls`,
  `find` (without `-delete`, `-exec`, `-fprint`), `stat`, `file`, `df`,
  `du`, `free`, `uptime`, `w`, `who`, `last`, `ps`, `top -bn1`, `ss`,
  `netstat`, `ip a|r|link`, `ping`, `curl` and `wget` without a body or
  output file, `dig`, `host`, `uname`, `hostname`, `id`, `whoami`, `date`,
  `env` (not `printenv` of a secret), `docker ps|logs|inspect|images|stats --no-stream`,
  `crictl ps|logs`, `nginx -t`, `apachectl -t`, `sshd -t`, `openssl x509 -noout`,
  `dpkg -l`, `rpm -q`, `apt list`, `dnf list`; and `sudo` before any of them.
- **Secret paths, refused:** `/etc/shadow`, `/etc/gshadow`, `~/.ssh` and
  `/root/.ssh` but `known_hosts` and `authorized_keys`, `*.key`, `*.pem`
  under `/etc/ssl/private` or a `private/` folder, `.env` files,
  `/proc/*/environ`, `/etc/*/secrets*`, a vault's own files. The list is
  the local `SECRET_PLACES` read as remote paths, and grows in review.
- **Everything else** on a remote host is a change. A remote line with a
  pipe, `$(…)` or a script is read as a local one is; what can't be read
  is unsure.

### What a read runs

A read runs the repository's code, and the code is the lead's worktree.
`terraform plan` runs `data "external"` programs; `ansible-playbook --check`
runs a task with `check_mode: false` for real, and every `pipe` lookup
and local action. So in `ops_run`, before a read against staging or prod
(ADR-116) starts, Althar compares the files it runs (the playbook, its
roles and plugins; the module's `.tf` files and local modules) with the
default branch. Where the task changed one, and the change adds
`check_mode: false|no`, `delegate_to: localhost`, a `pipe`/`lines`
lookup, a `local_action`, or a `data "external"`, the read is **unsure**:
it is gated as a change, and the card says why. Unchanged code, already
reviewed and merged, runs as a read. In the lead's shell, where only `ssh`
runs, none of this arises.

### Unsure

[What asks](../what-agents-may-do.md#what-asks) says "when unsure,
allow". The Ops profile is the one place that gives way: the person
switched it on to be asked about changes to running systems, and a
command the rules can't read on prod is exactly what they want to see.
So, in the profile only:

- an unreadable remote command, an unknown subcommand of a known tool, an
  `ops_run` read whose code changed as above, and a script named for
  infra work (`./deploy.sh`, `make apply`, `just provision`: today's
  `deploys()` words, plus `apply`, `provision`, `rollout`, `migrate`) are
  unsure;
- unsure is gated as a change: with A, it asks; with B, dev goes ahead
  anyway, staging is judged, prod asks.

What isn't an infra command at all (`ls`, `npm test`, an edit) is read as
today. A shell script the rules can't open still goes ahead unread
(ADR-097), which is why credentials stay out of the shell (ADR-114) and
prod's keys out of its SSH agent (the plan's B3).

### Where the kind sits

- A new rule kind, **`infra`**, joins `RULES` in `ruleContext.ts`, with
  its words in `RULE_WORDS` ("Changing infrastructure").
- With the profile on, `infra` is on the project's **Ask me**, so it asks
  with everything allowed, as the person's Ask me does (ADR-097); they
  can take it off, which the Rules screen shows as "Infrastructure
  changes go ahead". With the profile off, `infra` is read but goes ahead
  as a deploy does today.
- `deploy` stays for what it means now, publishing and deploys outside
  infra tools (`wrangler deploy`, `npm publish`); `kubectl apply`,
  `terraform apply`, `helm upgrade`, `pulumi up` move from `deploy` to
  `infra`. Their teardown stays irreversible.
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
- `packages/runtime/src/rules.ts`: `kindsOf` calls it beside `deploys()`;
  `DEPLOYERS` loses the infra tools to it; `destroys()` and `DESTROYERS`
  unchanged; `decide` and `decideInside` refuse `secret` as
  `credentialReason` does.
- `packages/runtime/src/ruleContext.ts`: `infra` in `RULES`, `RULE_WORDS`;
  `Policies.ts`: the profile adds it to `alwaysAsk`.
- `packages/runtime/src/shellCommands.ts`: reading `ssh`'s remote command,
  `kubectl exec --`'s and `ansible -a`'s as lines.
- `packages/runtime/src/OpsRuns.ts` (ADR-114): the "what a read runs"
  comparison against the default branch.
- `packages/runtime/src/tally.ts`: `infra` and `unsure` counted, so a kind
  agents keep working around shows in Rules' "Last 14 days".
- `packages/ui/src/lib/commandGlance.ts` and
  `packages/ui/src/thread/Permission/`: the card's line.
- Tests: a table test per tool and row, in `packages/runtime/tests/`
  beside `rulesReadings.test.ts`; `--dry-run` and `--check` with every
  spelling; remote lines with pipes and `sudo`.
