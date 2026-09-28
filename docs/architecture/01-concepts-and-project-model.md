# Concepts and Project Model

## Purpose

This document introduces the durable concepts that the rest of the architecture
builds on: projects, the coordinator, repositories, devices, workspaces, tasks,
leads and steps, runs, conversations, and collaboration.

The key decision is:

> A project is a durable coordination space. It may refer to zero, one, or many
> repositories, but no repository, checkout, folder, or provider conversation
> is the project itself.

That definition supports the single-repository fast path without making it a
permanent architectural constraint.

## The concepts in one pass

The product can be understood as one chain:

```mermaid
flowchart LR
    Project --> Coordinator
    Coordinator -->|"plans and hands out"| Task
    Task --> Run
    Run --> Workflow["Workflow execution<br/>lead and steps"]
    Workflow --> Attempt["Node attempts"]
    Attempt --> Session["Provider sessions / tools"]
    Attempt --> Evidence["Artifacts and observations"]
    Evidence --> Record["Decisions and retained knowledge"]
    Record --> Project
```

- A **project** is the durable place where related work and knowledge remain.
- The **coordinator** is the project's agent that you talk to. It answers
  questions, plans and orders work, drafts tasks and hands them out, and never
  writes code. Its conversation belongs to the project; the agent session
  behind it is disposable ([04](04-coordinator.md)).
- A **repository binding** says which source repository the project means.
  Each computer maps that shared identity to its own local clone.
- A **task** describes desired work and which repositories it may use.
- A **run** is one submission of that task under a workflow and policy.
- A **workflow execution** is the durable graph of steps Charrette coordinates.
- Each task has one **lead**: the agent that implements it and that you talk
  to about it. Its **steps**, such as review, run other agents as nodes of the
  graph and report back to the lead ([05](05-workflow-engine.md)).
- A **node attempt** is one try at a step.
- A **provider session** is the temporary Claude Code, Codex, OpenCode, or other agent
  conversation used by a node.
- An **observation** is something Charrette saw; an **artifact** is retained
  evidence such as a patch, log, or report.
- A **decision** records human authority. A **knowledge claim** promotes useful
  evidence into context that may help future work.

The distinctions matter because these objects do not fail or expire together.
An agent conversation can disappear while the task, evidence, decisions, and
project remain valid. A repository can be detached without making old runs
unreadable.

## What a project owns

A `Project` groups work that shares intent, durable context, decisions, policy,
history, and collaborators. It may own:

- purpose and operating constraints;
- its coordinator thread: the whole conversation with the coordinator;
- tasks, runs, workflow executions, and attention requests;
- artifacts, evidence, decisions, and knowledge claims;
- memberships and execution policy;
- logical repository bindings;
- external-resource bindings;
- project-scoped skill bindings.

A project does not own:

- a universal filesystem root;
- a user's provider account;
- a device credential;
- an external issue's authoritative state;
- a provider conversation;
- every claim that may be useful to the organization.

Project is the first useful coordination and policy boundary. The scope model
must still admit task, repository, product, programme, team, organization, and
federated knowledge later. Each knowledge claim therefore records provenance,
scope, authority, visibility, confidence, temporal validity, supersession, and
revocation rather than assuming project membership is sufficient.

## Repository identity and location

Shared identity and device-local location are distinct:

| Concept | Ownership | Contains | Excludes |
|---|---|---|---|
| `RepositoryBinding` | Project authority | Binding ID, role, normalized remote fingerprints, provider repository ID where available, allowed subpaths, default base-ref policy | Local paths and credentials |
| `RepositoryLocation` | One device or runner | Binding ID, host ID, existing or managed path, observed remotes, access capabilities, last verification | Shared authority |
| `WorkspaceSet` | One run attempt | Exact workspaces, base revisions, roles, and preparation record used together | Cross-repository atomicity claim |
| `Workspace` | One binding within an attempt | Concrete worktree/clone, base commit, branch/ref, dirty-state observation, ownership, cleanup policy | Project identity |

```mermaid
flowchart LR
    Project -->|"0..n"| Binding["RepositoryBinding"]
    Binding --> LocationA["RepositoryLocation · device A"]
    Binding --> LocationB["RepositoryLocation · device B"]
    Task -->|"requires 0..n"| Binding
    Attempt --> Set["WorkspaceSet"]
    Set --> Workspace1["Workspace · repo A"]
    Set --> Workspace2["Workspace · repo B"]
    Workspace1 --> Binding
    Workspace2 --> Binding
```

A URL is useful evidence but is not a universal repository identity. Forks,
mirrors, aliases, remote renames, and local-only repositories require:

- normalized remote fingerprints;
- provider-native repository IDs where available;
- observed Git object relationships;
- explicit user confirmation when identity is ambiguous.

The same repository may be bound to more than one project. The binding, rather
than the repository, carries project-specific role, allowed subpaths, and
policy.

## Project and source setup UX

Two entrances lead to the same model.

### Open a repository

This is the fast path:

1. The user selects an existing folder or supplies one Git URL.
2. Charrette performs read-only inspection.
3. It creates a project with one repository binding and, for a local folder,
   one device-local repository location.
4. It suggests a project name and makes **Add source** permanently available.

The fast path must not create a hidden “single repository project” subtype.

### Create a project

The deliberate path lets a user:

- name the outcome or body of work;
- select several local repositories in one picker flow;
- enter several explicit clone URLs;
- mix existing clones and managed clones;
- create a repository-free project for research or planning.

Before confirmation, a project map shows:

- repository root and nested-repository findings;
- current branch and remotes;
- duplicate or fork ambiguity;
- selected monorepo subpaths;
- whether the source is local-only;
- suggested role such as `frontend`, `service`, `infrastructure`, or `docs`.

Charrette must not recursively scan the computer or infer all sibling
repositories. Selection is explicit and bounded.

### Adding a binding on a device

Each device offers three operations:

1. **Use existing clone** — register an explicitly selected working copy
   without moving, resetting, or rewriting it.
2. **Clone on this device** — clone into a Charrette-managed source area after
   destination and credential confirmation.
3. **Map later** — retain the logical binding while this device remains unable
   to execute work that needs it.

The persistent **Sources** view shows every binding's role, shared identity,
this device's location, observed revision, capabilities, and one of:
`ready`, `needs mapping`, `needs access`, `changed`, or `unavailable`.

Tasks, evidence, and decisions remain readable when a source is unavailable.

### Existing working copies

An existing clone is an input source, not the default execution workspace.
Charrette prepares a Git worktree per task in a folder it owns,
`~/Charrette/<project>/<task>/<repository>` by default, with a root that can
be changed per project ([ADR-006](../decisions/006-worktree-per-task.md)).
Opening the task's folder in an editor shows all its repositories together.
It never:

- changes the user's current branch;
- hides or stashes their changes;
- resets their working tree;
- removes their worktree;
- rewrites remotes;
- initializes Git without a separate explicit action.

A project can declare a setup command, run in each new worktree, and untracked
files to copy into it, such as `.env`.

Working on a plain branch in the user's own checkout may come later, as an
explicit per-project choice. It relaxes the rules above and must say so where
the choice is made.

For the MVP, writable source bindings are Git repositories. A plain directory
can be attached read-only as an artifact/source reference later, but making it
a mutable workspace would discard base-revision and change-provenance
guarantees.

## Multi-repository tasks and runs

A `TaskRepositoryRequirement` records:

- binding ID;
- read, write, or observe-only intent;
- optional allowed roots;
- requested base-ref policy;
- whether the binding is required or optional.

“All repositories in the project” is never an implicit capability.

Run admission snapshots the task requirement revision. Later changes to a
binding, task, role, or default branch do not rewrite historical intent.

The preflight resolves all required bindings on one host:

- location and access capability;
- requested ref and resolved commit;
- dirty or moved-source condition;
- credential and provider availability;
- expected workspace strategy;
- read/write/tool grants;
- user-visible cost or authority escalation.

If a required binding is unresolved, the run does not partially start. The user
can map, clone, remove the requirement, or choose another capable host.

One attempt receives one `WorkspaceSet` with a workspace per participating
binding. Everything in the attempt shares it: the lead, its steps, and any
agent that takes the task over after a switch. Parallel steps in v1 only read,
so one workspace per repository is enough. Cross-repository publication is not atomic. A resulting `ChangeSet`
groups independent `RepositoryChange` records:

- binding ID;
- base and head commit;
- patch/artifact digest;
- branch/ref;
- publication or PR status;
- verification evidence.

A partial result is an explicit outcome. Recovery never pretends several Git
repositories committed or published atomically.

## Collaboration and a second device

Shared project state includes repository binding metadata, never machine paths
or credentials.

On another device:

1. The project is readable immediately within its visibility policy.
2. Each binding starts `needs mapping` unless a verified local match already
   exists.
3. The user chooses an existing clone, a managed clone, or observer mode.
4. Read-only and write capabilities are verified separately.
5. The device advertises which task requirements it can satisfy.

In the MVP a project has one coordinator, on this device. Later each member
has their own coordinator thread and session, reading the shared project state
([04](04-coordinator.md)).

A collaborator may be allowed to read project history without source access.
Source availability is neither project membership nor permission to view every
artifact.

The MVP assigns an entire run to one host. Splitting a graph across machines
would require:

- cloud-authoritative leases and fencing;
- artifact and secret movement policy;
- cross-host cancellation;
- partial-connectivity semantics;
- placement and cost policy;
- trustworthy host capability attestation.

Those are later distributed-execution decisions.

## Binding lifecycle and edge cases

### Remote rename or change

Record the newly observed remote and ask for confirmation when identity is not
provable. Historical runs retain the binding ID and the remote evidence they
observed at the time.

### Folder moved

Mark the `RepositoryLocation` unavailable. Let the user relocate or remap it.
Never silently create a second logical binding.

### Fork selected instead of canonical repository

Show the identity mismatch and offer to:

- keep it as a distinct binding;
- record it as a permitted fork location;
- cancel mapping.

Do not equate matching names with matching repositories.

### Monorepo

Use one repository binding with declared allowed roots unless subprojects need
different membership, credentials, or policy. Do not create fake repositories
for every package.

### Nested repositories and submodules

Inspection reports them. Each independently changed Git repository needs a
binding. Submodule metadata alone does not grant the agent access to the nested
repository or its credentials.

### Detached or deleted binding

Detaching stops future selection but retains a tombstoned binding record so
historical tasks, runs, claims, and changes remain intelligible.

### Local-only repository

Allow local work, label it explicitly, and prevent another device from assuming
it can clone the source. Sharing metadata does not upload its contents.

### Same repository in several projects

Keep distinct binding IDs and project policies. A device may point them to the
same source location, while each run still receives its own managed workspace.

## Core lifetimes

| Entity | Created when | Terminal or replaced when |
|---|---|---|
| `Project` | User establishes a coordination space | Archived or explicitly deleted |
| `CoordinatorThread` | The project is created (later, one per member) | Archived with the project; never truncated |
| `RepositoryBinding` | Source identity joins a project | Detached/tombstoned |
| `RepositoryLocation` | A host maps or clones a binding | Remapped, unavailable, or removed |
| `Task` | Desired work is recorded | Completed, cancelled, or archived |
| `Run` | A task is submitted under a workflow and policy | Logical outcome chosen |
| `RunAttempt` | Execution or retry is admitted | Succeeded, failed, cancelled, interrupted |
| `WorkspaceSet` | Attempt source preflight succeeds | Retained or cleaned after terminal outcome |
| `Workspace` | One repository workspace is prepared | Retained, published, or cleaned |
| `WorkflowExecution` | A workflow version is materialized for a run | Completed, cancelled, failed |
| `NodeAttempt` | A node is scheduled or retried | Succeeded, failed, cancelled, uncertain |
| `ProviderSession` | An adapter starts or resumes provider work | Provider terminal, lost, or superseded |
| `AttentionRequest` | Progress needs a human decision/input | Answered, expired, withdrawn |
| `Decision` | An actor answers an exact request | Immutable; may be superseded by a new decision |
| `KnowledgeClaim` | Evidence is promoted into durable context | Superseded, expired, or revoked |

Identifiers must never be reused across these lifetimes.

## Chat input queue and interruption

A Charrette conversation is a durable interaction stream around a task, a run,
or the project's coordinator; it is not merely the provider's current stdin.
The coordinator's thread uses the same queue and dispositions as a task's. User input can arrive while the
runtime is sampling, waiting for a tool, executing a tool, awaiting approval, or
recovering.

Each accepted `UserInput` receives a thread-local sequence and an explicit
disposition:

```ts
type InputDisposition =
  | "after_current"
  | "interrupt_and_continue"
  | "supersede_pending"
  | "cancel_run"

type UserInput = {
  id: string
  threadId: string
  sequence: number
  commandId: string
  disposition: InputDisposition
  bodyArtifactId: string
  acceptedAt: string
}
```

The default meanings are intentionally different:

- **Send / after current** appends the input to the durable FIFO.
- **Interrupt and continue** asks the active turn to stop at the earliest safe
  boundary, moves this input ahead of ordinary pending input, and then continues
  the existing task with both its unfinished objective and the new instruction.
- **Supersede pending** explicitly replaces identified, not-yet-started input;
  it does not erase completed history.
- **Cancel run** terminates the run under its cancellation policy.

An interrupt is never interpreted as “forget what you were doing.”

### Two acknowledgements

Interruption has two observable facts:

1. `InterruptRequested` — the runtime durably accepted the user's request. The
   UI can acknowledge this immediately.
2. `TurnInterrupted` — the provider stopped, or Charrette reached a safe
   boundary and fenced the old controller.

If the provider cannot confirm interruption, record
`InterruptionUncertain`. The new input remains queued, but Charrette must
reconcile possible tool or external effects before retrying them.

### Continuing prior work

After interruption, the next turn receives:

- the original task objective and current workflow node;
- a summary/reference to completed and partially completed work;
- outstanding verification, cleanup, and follow-up obligations;
- the interrupting message;
- any earlier queued inputs in their original order.

The scheduler may revise the plan in light of the new message, but unfinished
work remains pending unless the user explicitly cancels it or the new
instruction is classified as superseding it. When intent is genuinely
ambiguous, the runtime should preserve work and ask a concise question rather
than silently discard it.

### Multiple inputs and races

- Message acceptance is idempotent by `commandId`.
- Sequence allocation and queue insertion commit transactionally.
- Multiple interrupting inputs retain arrival order.
- Only one active delivery exists per thread/controller generation.
- An input arriving as a turn completes is either included in that completion's
  next queue snapshot or delivered in the next turn, never lost.
- Approval responses are correlated commands, not ordinary chat strings.
- Restart rebuilds the queue from accepted, delivered, and terminal facts.
- A stale provider/controller cannot mark a newer input consumed.

Provider-native queue or steering support may optimize delivery, but the
Charrette queue remains authoritative. An adapter without live steering uses
provider cancellation plus a new/resumed turn while preserving the same
semantics at the domain layer.

## Scope model

The MVP resolves project and task scopes, but persists an extensible reference:

```ts
type ScopeRef = {
  kind: string
  id: string
  authority: string
  revision?: string
}
```

Claims also require:

- provenance and supporting artifact references;
- creating actor or process;
- visibility and sharing policy;
- confidence and temporal validity;
- relationship to contradictory claims;
- supersession and revocation.

This avoids prematurely deciding that all useful engineering intelligence must
live beneath a project while keeping the MVP product coherent.

## Acceptance examples

1. A user opens repository A, adds repository B, and creates one task that may
   write A but only read B. The preflight and workspace set preserve that
   distinction.
2. A collaborator opens the project without access to B. They can read allowed
   decisions and evidence, but cannot start the task or infer another user's
   path.
3. A selected working copy has uncommitted changes. The run uses a managed
   worktree without stashing or changing that copy.
4. Repository B is detached after a run. Historical evidence still identifies
   the binding and commits used.
5. A project contains no repositories while research occurs; a repository is
   added later without changing project identity.
6. A user interrupts an active turn to add a constraint. The UI acknowledges
   the interrupt, the current turn stops, and the next turn continues the
   original task under the new constraint rather than treating it as a new
   unrelated task.
7. A user asks the coordinator for a small change. It drafts a task and a plan
   and hands the task to a lead; it does not edit the repository itself.
8. The user switches a task's lead to another agent mid-task. The new agent
   continues in the same workspace, from a brief, and the task's history keeps
   both sessions.

## Explicit non-goals

- Universal organization ontology in the MVP.
- Automatic discovery of every repository on a machine.
- Cross-repository transactions.
- Multi-host execution within one run.
- Treating a shared folder path as collaboration.
- Treating Git remote access as project membership.
- Mutating a user-selected working tree as a normal execution strategy (a
  plain-branch opt-in may come later; see Existing working copies).
