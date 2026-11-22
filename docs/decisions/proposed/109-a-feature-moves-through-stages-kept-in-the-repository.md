# ADR-109: A feature moves through stages kept in the repository

> A proposal, not built. Where it would fold in: a new section of
> [tasks.md](../tasks.md) (features above tasks), and
> [code-hosts.md § Trackers](../code-hosts.md#trackers) (the mirror). The
> plan is [Althar for the whole team](../../plans/whole-team.md).

- **Status:** Proposed
- **Date:** 2026-11-22
- **Owner:** Runtime and desktop maintainers
- **Related:** [ADR-008, recorded facts are complete](../foundations.md#recorded-facts-are-complete-behaviour-may-start-simple),
  [ADR-044, a project runs many things](../workspaces-and-runs.md#what-a-project-runs),
  [ADR-058, the coordinator's copies](../coordinator.md#its-copies-of-the-repositories),
  [ADR-059, trackers side by side](../code-hosts.md#trackers),
  [ADR-095, OpenSpec files](../the-persons-setup.md#skill-and-openspec-files-in-a-change),
  [ADR-108, lenses](108-a-role-is-a-lens-not-a-separate-app.md),
  [ADR-110, handoffs](110-a-stage-hands-over-when-its-artefact-merges.md),
  [ADR-111, gates](111-gates-live-on-the-code-host-and-the-tracker.md).

## Context

Tasks are the unit of work today; nothing groups them into the intent they
serve across product, design, engineering and devops. That grouping has to
be shared by a team whose members each run their own Althar, with no
server between them yet. The repository already is shared, reviewed and
read by every agent; the tracker is where many teams plan.

## Decision

**A feature is a folder in its home repository, and its stage is read from
what has merged there.**

- **A feature is `specs/<feature>/`** on the default branch of its home
  repository, with `spec.md` (product's), `design/` (design's), `build.md`
  (engineering's) and `ops.md` (devops's). The slug is the folder's name.
  A project changes the folder and the names in `flow.yaml`.
- **`spec.md`'s frontmatter is the feature's record:**

  ```yaml
  ---
  feature: offline-sync
  title: Work offline and sync when back
  owners: { spec: product, design: design, build: engineering, ship: devops }
  repositories: [althar, althar-relay]   # the home repository is first
  tracker: https://linear.app/althar/project/offline-sync
  ready: design        # optional: a stage owner's "ready for next" (ADR-110)
  skip: []             # stages this feature doesn't need
  ---
  ```

  Owners are roles, optionally people (`design: [design, "@a-designer"]`).
- **The stages are the project's, in `.althar/flow.yaml`:**

  ```yaml
  specs: specs/
  stages:
    - { id: spec,    owner: product,     artefact: spec.md }
    - { id: design,  owner: design,      artefact: design/ }
    - { id: build,   owner: engineering, artefact: build.md, pullRequests: true }
    - { id: ship,    owner: devops,      artefact: ops.md }
    - { id: operate, owner: devops }     # ongoing: never done
  roles:
    - { id: data, like: engineering }   # a custom role (ADR-108)
  ```

  With no file, these five are the default. A stage can be skipped per
  feature (`skip`), and a project can add, rename or drop stages.
- **A stage's state is read, never kept by Althar.** Done when its artefact
  has merged on the default branch, and for a stage with `pullRequests`,
  when every pull request linked to the feature for it has merged
  ([ADR-110](110-a-stage-hands-over-when-its-artefact-merges.md)). The
  current stage is the first not done and not skipped. Where the
  frontmatter's `ready` says more than the merges do, both are shown; Althar
  never picks one.
- **Several repositories.** A pull request in any of the project's
  repositories belongs to a feature by a `Feature: <slug>` line in its
  description, or a `feature:<slug>` label; Althar writes the line in the
  pull requests its own tasks open for a feature. A repository the
  frontmatter names but the project hasn't bound is shown as named and
  unread.
- **The tracker mirrors, optionally.** A feature's `tracker` link (a Linear
  project or issue, a Jira epic) is moved as its stage moves, with the
  same switch as a task's issue ("Move issues along with their tasks"), and
  its pull requests are linked there. The repository wins where they
  disagree; the tracker's own workflow may still hold a team's approvals
  ([ADR-111](111-gates-live-on-the-code-host-and-the-tracker.md)).
- **Read from the default branch, after each fetch.** Althar fetches the
  project's remotes as the coordinator's turns end (ADR-058), and reads
  `flow.yaml` and `specs/*/spec.md` from the default branch's tree with
  git, off the thread, keeping what it read as a cache it can always throw
  away and read again. A feature on a task's branch only shows on that
  task until it merges.
- **The first committed file Althar reads under `.althar/`.** Althar's own
  folders there each carry their own `.gitignore`, so `flow.yaml` beside
  them is committed as any file is. It is data and runs nothing, so a
  repository's settings trust (DEV-280) needn't hold it back.

## Alternatives

- **State in Althar's store, or a server.** Rejected now: there is no
  server, and a person's own store is not shared. The self-hosted Althar
  Cloud may sync later, reading the same files.
- **The tracker as the source.** Not every team has one, it isn't reviewed
  with the code, and an agent can't read it from the repository. It stays
  a mirror.
- **A status file per feature** (`specs/<feature>/status.yaml`) written at
  every move. Every move would be a commit and a conflict; reading the
  merges says the same without writes.
- **OpenSpec's layout.** ADR-095 keeps OpenSpec files off a repository
  unless the project says so. A project that uses it can point `specs:`
  at its folder; it isn't the default.

## Consequences

- A team with no Althar Cloud still shares features, stages and owners:
  everyone's Althar reads the same merged files.
- A stage moves only when something merges, so a feature's timeline is
  exactly its history on the default branch.
- Specs live in the code's review, with the code's history and owners.

## What an implementation touches

- New: `packages/runtime/src/features.ts` (read `flow.yaml` and the
  specs, work out stages), a feature view in `packages/contracts/src/Api.ts`,
  and a derived cache table in `packages/persistence-sqlite/src/migrations/`.
- `packages/runtime/src/coordinatorFolder.ts` and the fetch as turns end
  (when to read again), `repositoryInstructions.ts` and `conventions.ts`
  (the existing readers of repository files, as a pattern),
  `projectTracker.ts` and `packages/connectors/src/linear.ts`, `jira.ts`
  (the mirror), `runTools.ts` (the `Feature:` line in descriptions).
- `packages/ui/src/board/` and a new `features/feature/` in the desktop
  app: the feature card and its timeline, read-only, from the prototype's
  chosen direction.
