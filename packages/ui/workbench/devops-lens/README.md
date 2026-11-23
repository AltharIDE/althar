# DevOps lens

The DevOps lens in depth, for "Althar for the whole team" (`docs/plans/whole-team.md`, ADR-108 to ADR-112, DEV-283 Ops profile, DEV-284 Ops mode). The role lenses (`workbench/role-lenses` on its branch) drew the DevOps home roughly; this draws it, and the pieces behind it, as stories. The canvas `devops-lens`, in the group `role-lenses`, has the shots.

`Workbench/DevOps lens`:

1. **Home.** infra under the DevOps lens: dev, staging and prod with what runs, who decides an apply and who holds the lock; what waits on DevOps (the prod gate, Build → Ship handoffs); Prometheus alerts; the cluster at a glance; deploys.
2. **Cluster health.** Workloads, one opened (identity, replicas, rollout, pods' readiness and restarts, events), nodes' capacity. Allowlisted fields only (ADR-112): nothing from Secrets or ConfigMaps.
3. **Prod gate.** The dry run's diff or plan, the exact command, the target, the commit, the lock, Approve or Refuse; for kubectl, Terraform and Ansible, and while someone else holds prod. Staging's, decided by the coordinator, and dev's, which just ran.
4. **Run.** The approved apply live in the run log, stopped, and finished: exit code, commit, target, ending "ran, with this result", with no pull request.
5. **Alert → task.** Investigate drafts an incident task with the cluster panel's facts attached.
6. **Ops profile.** The coordinator's offer on an infra repository, and its settings: SSH agent yes, key files never, secrets per run, who decides each environment.

Made-up data (`data.ts`), from the kit's pieces. Light and dark from the toolbar. A prototype: nothing in the kit uses it.
