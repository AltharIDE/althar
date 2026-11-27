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
  stage: build         # optional: the stage the team says it is at
  owners: { spec: product, design: design, build: engineering, ship: devops }
  repositories: [althar, althar-relay]   # the home repository is first
  tracker: https://linear.app/althar/project/offline-sync
  ready: design        # optional: a stage owner's "ready for next" (ADR-110)
  skip: []             # stages this feature doesn't need
  pullRequests:        # optional: a stage's set, repository-qualified
    build: [althar#412, althar#415, althar-relay#88]
  ---
  ```

  Owners are roles, optionally people (`design: [design, "@a-designer"]`).
- **The stages are the project's, in `.althar/flow.yaml`:**

  ```yaml
  specs: specs/
  stages:
    - { id: spec,    owner: product,     artefact: spec.md }
    - { id: design,  owner: design,      artefact: design/ }
    - { id: build,   owner: engineering, artefact: build.md, done: pull-requests }
    - { id: ship,    owner: devops,      artefact: ops.md }
    - { id: operate, owner: devops,      done: never }   # ongoing
  roles:
    - { id: data, like: engineering }   # a custom role (ADR-108)
  ```

  A stage's `done` is `merged` (its artefact merged; the default),
  `pull-requests` (its artefact and every pull request in its set merged)
  or `never`; its `next` is the stage below it unless it names another.
  With no file, these five are the default. A stage can be skipped per
  feature (`skip`), and a project can add, rename or drop stages. A worked
  example, Saved carts, with every file filled in and the schema's
  reference, is in [the plan's example](../../plans/whole-team/example/README.md).
- **A stage's state is read, never kept by Althar.** Done when its artefact
  has merged on the default branch, and for a stage whose `done` is
  `pull-requests`, when every pull request in its set has merged
  ([ADR-110](110-a-stage-hands-over-when-its-artefact-merges.md)). The
  current stage is the first not done and not skipped. Where the
  frontmatter's `stage` or `ready` says otherwise than the merges do, both
  are shown; Althar never picks one, and never writes `stage` itself.
- **Each pull request belongs to a feature and a stage.** A pull request in
  any of the project's repositories carries a `Feature: <slug> <stage>`
  line in its description (`Feature: offline-sync build`), or a
  `feature:<slug>:<stage>` label. The stage may be left out only where the
  feature has one stage with pull requests, which it then means; a marker
  that leaves it out where there are several counts for none and is shown
  as needing one. Althar writes the line, with the stage, in the pull
  requests its own tasks open for a feature. So work opened early for a
  later stage never counts toward an earlier one.
- **A stage's set of pull requests** is the frontmatter's `pullRequests`
  list for it, repository-qualified (`althar-relay#88`), where it has one:
  then only those count, whatever else is marked, and the timeline shows
  marked ones outside the list. Without a list, the set is every pull
  request marked for that stage. Completion and reopening use the set
  alone, everywhere.
- **Unverified when the evidence isn't there.** A stage is done only when
  every merge it needs is confirmed on its repository's default branch. A
  repository the frontmatter names, or a pull request the list names, that
  this Althar can't read (the project doesn't bind the repository, access
  was lost, the host can't be reached) makes the stage **unverified**, not
  done: the timeline says which repository or pull request it couldn't
  read, and what to do (bind it, reconnect). An unverified stage hands
  over nothing ([ADR-110](110-a-stage-hands-over-when-its-artefact-merges.md))
  until every merge is confirmed. Without a list, marked pull requests in a
  repository Althar can't read can't be found at all, so a feature naming
  such a repository keeps its pull request stages unverified.
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
  (the mirror), `runTools.ts` (the `Feature:` line, with its stage, in
  descriptions), and the code host connectors' pull request search
  (finding marked pull requests by text and label).
- `packages/ui/src/board/` and a new `features/feature/` in the desktop
  app: the feature card and its timeline, read-only, from the prototype's
  chosen direction.
