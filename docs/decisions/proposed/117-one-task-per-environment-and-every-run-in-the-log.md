# ADR-117: One task changes an environment at a time, every run is in the log, and a task can end "ran"

> A proposal, not built. Where it would fold in:
> [workspaces-and-runs.md](../workspaces-and-runs.md) (the lock, beside
> Local's one task at a time), [tasks.md § Kinds, read from what a task has](../tasks.md#kinds-read-from-what-a-task-has)
> and [§ Needs you and settling](../tasks.md#needs-you-and-settling) (the
> "ran" ending), and [reviews.md § Outputs show the change as built](../reviews.md#outputs-show-the-change-as-built)
> (runs in Outputs). The plan is [Ops mode](../../plans/ops-mode.md); this
> is step B, [DEV-284](https://linear.app/althar/issue/DEV-284).

- **Status:** Proposed
- **Date:** 2026-11-24
- **Owner:** Runtime and desktop maintainers
- **Related:** [ADR-091, Local, one task at a time](../workspaces-and-runs.md#local),
  [ADR-008, recorded facts are complete](../foundations.md#recorded-facts-are-complete-behaviour-may-start-simple),
  [ADR-020, what agents hand back](../tasks.md#what-agents-hand-back),
  [ADR-068, settling stops everything](../workspaces-and-runs.md#settling-stops-everything),
  [ADR-114, `ops_run`](114-secrets-go-to-one-run-never-to-the-agent.md),
  [ADR-116, environments and the gate](116-environments-bind-targets-and-set-the-gate.md),
  #1160's ADR-108 (the Environments room) and ADR-112 (panels), in
  [#1160](https://github.com/AltharIDE/althar/pull/1160).

## Context

Two tasks applying to the same environment at once is how a half-applied
change meets another: Terraform's state lock refuses the second apply,
Ansible has no lock at all, and `kubectl apply` simply races. Afterwards
the person needs to know what ran where, from which code, on whose word,
and how it ended, which a thread's scroll doesn't tell. And some ops
work ends with a run, not a pull request: rotating a certificate,
restarting a stuck service, applying an already-merged plan.

## Decision

### One task per environment

- **A task takes an environment's lock with its first change there**
  that the gate allows (ADR-116), before it starts. Reads take no lock:
  `--check`, `plan` and `get` run beside anyone's change.
- **It holds it until the task settles,** or its lead lets go
  (`ops_release`), or the person does from the environment's view. A task
  that holds a lock and has been idle for an hour shows "holds prod, idle
  1 h" in Needs you; nothing lets go on its own, since a half-done
  rollout is worse with two hands on it.
- **A second task's change waits:** its `ops_run` returns "Waits for prod:
  held by ‘Rotate the API certificates’", the task waits as a Local task
  waits for the checkout (`workspace.move_waits`, `local.ts`), and goes on
  when the lock is free. Its lead can do other work meanwhile, or the
  person can move it to the front of the line for that environment.
- **Several environments, several locks,** taken in a fixed order (by
  name) so two tasks never hold one each waiting on the other.
- **Recorded facts, not memory:** `environment.locked`, `.released`,
  `.waits`, so a lock survives Althar restarting and the record says who
  held what when. `keyedLock.ts` stays for in-process waits.
- **This computer only.** Two people, or two Althars, each lock their
  own; Terraform's state lock still holds between them. A lock shared by
  a team waits for the Cloud (C).

### The run log

Every `ops_run`, read or change, is a run in the log, recorded as facts
(`ops_run.started`, `.decided`, `.ended`) with a row in `ops_runs`:

| Field | What |
|---|---|
| **Run** | Its id, the task, the lead (agent, model, session) |
| **Command** | `argv` as it ran, the folder, the tool's version |
| **Kind** | Read, change, unsure, and the word that decided it (ADR-115) |
| **Environment and target** | The environment(s), and the hosts, workspace or context and namespace found (ADR-116) |
| **Code** | The commit, its branch, whether it's on the default branch, and that the worktree had no uncommitted changes |
| **Decision** | Allowed by the rules, the coordinator (its judgment's id), or the person (the card, and their device); refused, and why; the rules' revision |
| **Plan** | The dry run's output, masked, kept in the artifact store by digest (ADR-020), and its summary |
| **Secrets** | By name only, which the run was given |
| **Lock** | Which lock it took or waited on, and for how long |
| **Times and result** | Started, ended, exit code, stopped by whom where it was stopped |
| **Output** | The whole output, masked, in the artifact store by digest; its last lines on the row |

- **Live while it runs:** the run's card in the thread streams its
  output, as Run's does; a Stop on it stops the process group
  (`stopping.ts`), records who stopped it, and leaves the lock with the
  task (a stopped apply needs a look before anyone else's).
- **In the task's Outputs,** each run as a card, newest first, with its
  environment, result and a link to its output.
- **An environment's view:** every run against it from every task, newest
  first, its lock and its waiters; the Environments room of #1160's
  ADR-108 where that's built, a section of the project's settings until
  then.
- **Kept with the project,** not the task's folder: cleaning a finished
  task's worktree away (ADR-056) leaves its runs.

### The "ran" ending

- **A task can end "ran, with this result",** a fourth ending beside here,
  the branch, and a pull request (`TaskEnd`), for ops work whose result is
  a run: "Ran `ansible-playbook rotate-certs.yml` on prod, 12 hosts, 3
  changed, exit 0."
- **Its lead says so in `finish_step`,** naming the runs that are its
  result; the task's card and Needs you show the last of them, its
  environment and exit code, and settling it reads like any other.
- **Changes to the repository still go through pull requests** under the
  project's rules: a task that changed a playbook and ran it ends in a
  pull request, with its runs listed in it, and a task can end in both.
  A "ran" task whose worktree has commits says so on its card, so they
  aren't left behind silently.
- **The Ops task preset** (#1160 lists it among a DevOps lens's first)
  plans this ending by default.

## Alternatives

- **The lock per run, not per task.** Two tasks could interleave applies
  between each other's plan and apply. Rejected.
- **A lock that expires.** A half-done rollout handed to another task by
  the clock. Rejected; the idle line and the person's release instead.
- **The log in the thread only.** It is there, and it can't be searched
  per environment, and it goes with a task. Rejected as the only place.
- **Leave locking to the tools' own.** Terraform has one; Ansible, kubectl
  and Helm have none.

## Consequences

- "Who changed prod, from which commit, on whose word" has one answer.
- A second task on a locked environment waits rather than racing, and
  says why.
- A task can be useful without code changes, which tasks' kinds and the
  board have to show without making it look like a lost pull request.

## What an implementation touches

- New `packages/runtime/src/environmentLocks.ts`: take, release, wait, in
  name order, as recorded facts through `records.ts` (`change`), modelled
  on `local.ts`'s waits; `stopping.ts` and `settled.ts` release on
  settling.
- `packages/runtime/src/OpsRuns.ts` (ADR-114): the run's facts, its row,
  the plan and output into `Artifacts.ts`, live output as `Launches.ts`
  streams Run's.
- `packages/persistence-sqlite/src/migrations/`: `ops_runs` and the
  environment locks' projection, the next free migration numbers.
- `packages/contracts/src/Api.ts`: `TaskEnd` gains `ran`; the run and the
  lock in the API; `packages/runtime/src/runRecords.ts` (`TaskEnding`),
  `runShipping.ts` (`shipEnding`), `kinds.ts`, `needsYou.ts`,
  `presets.ts` (the Ops task preset), `Coordinator.ts` (`propose_plan`'s
  ending).
- `packages/ui/src/thread/RunCard/` (an ops run's card),
  `packages/ui/src/thread/Evidence/` or Outputs (runs),
  `apps/desktop/src/renderer/features/board/` (a "ran" card and a waiting
  task), and the environment's view.
- Tests: a second task waits and goes on; a lock survives a restart;
  settling releases; a stopped run keeps the lock; every run is in the log
  with its commit, target, decision and exit code; a "ran" ending settles.
