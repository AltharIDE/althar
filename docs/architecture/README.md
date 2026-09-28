# Charrette Architecture Plan

> **Status:** Working architecture baseline
> **Date:** 2026-09-20
> **Scope:** Local-first MVP with explicit seams for later cloud authority
> **Audience:** Product engineers familiar with web or mobile development

## What Charrette is

Charrette is a durable coordination layer for engineering work.

It lets a person define work at the level of a project, connect the repositories
and external systems that work needs, delegate parts of it to coding agents, and
retain the resulting evidence, decisions, and useful knowledge after any
particular agent conversation has ended.

Charrette is therefore an **agent harness**, but not a new agent runtime:

- Charrette owns projects, tasks, workflow state, policy, approvals,
  integrations, skills, evidence, and recovery.
- Codex, Claude Code, or another provider owns its model calls, context window,
  native tool loop, provider conversation, and provider authentication.
- Charrette supervises and interprets provider work without trying to reproduce
  the provider internally.

This distinction is the architectural centre of the product. Existing coding
agents already solve model/tool interaction. Charrette's reason to exist is the
durable layer above them.

## The product model

The main concepts form one chain:

```mermaid
flowchart LR
    Project --> Task
    Task --> Run
    Run --> Workflow["Workflow execution"]
    Workflow --> Attempt["Node attempts"]
    Attempt --> Agent["Agent / tool / person"]
    Attempt --> Evidence["Artifacts and observations"]
    Evidence --> Record["Decisions and knowledge"]
    Record --> Project
```

In plain terms:

1. A **project** is the durable coordination space.
2. A project may refer to zero, one, or many repositories.
3. A **task** describes desired work and the repositories or systems it may use.
4. Starting the task creates a **run**.
5. The run materializes a durable **workflow**.
6. Workflow nodes ask an agent, tool, integration, or person to do something.
7. Charrette records attempts, approvals, outputs, verification, and
   uncertainty.
8. Useful results become project evidence, decisions, or scoped knowledge.

These objects remain distinct because they have different lifetimes. A provider
conversation may disappear while the project, task, workflow history, and
evidence remain useful.

## What a project means

A project is not a folder, Git repository, checkout, team, or agent chat. It is
the durable place where related intent, work, policy, history, and context meet.

It may contain:

- no repository, for research or planning;
- one repository, for the common application case;
- several repositories, for work spanning frontend, backend, infrastructure,
  documentation, or shared libraries.

Repository identity is shared project metadata. A filesystem path and
credential belong to one device or runner. Consequently two collaborators can
refer to the same logical repository while mapping it to different local
clones.

Project is the first useful coordination boundary, not a claim that all
engineering knowledge must remain project-scoped forever. Knowledge may later
need task, repository, product, team, organization, or federated scope.

## A representative interaction

Consider a task that changes a web application and its API:

1. The user creates a project and selects two existing repositories.
2. Charrette records two shared repository bindings and this computer's local
   paths separately.
3. The user creates a task that may write the frontend and read/write the API.
4. Charrette prepares managed workspaces without changing either selected
   working copy.
5. A workflow invokes one coding-agent runtime with the required repositories,
   skills, tools, and policy.
6. The user interrupts the current turn with a new constraint.
7. Charrette acknowledges the interruption, safely stops the active turn, and
   continues the unfinished task with the new message at the front of the
   queue.
8. The workflow verifies the resulting changes independently.
9. Charrette retains repository-specific changes, verification evidence,
   decisions, and any promoted knowledge claim.

The provider session helped perform the work. It did not become the identity or
sole record of the work.

## The local application

The MVP is one installed product with a UI and a local backend:

```mermaid
flowchart TB
    UI["Electron renderer<br/>web UI"]
    Main["Electron main<br/>native application shell"]
    Runtime["Charrette runtime<br/>local control plane"]
    Store[("SQLite + artifact store")]
    Provider["Codex / Claude Code / other agent runtime"]
    Connector["Git host / Linear / Jira connector"]
    MCP["MCP tools and resources"]
    Skills["Resolved skill snapshot"]

    UI <-->|"narrow typed bridge"| Main
    Main <-->|"versioned local protocol"| Runtime
    Runtime <--> Store
    Runtime <--> Provider
    Runtime <--> Connector
    Provider <--> MCP
    Skills --> Runtime
```

For a web/mobile developer, the renderer is the frontend and the Charrette
runtime is a backend service that happens to run on the same computer. Electron
main is the thin native shell between them.

The separate runtime:

- remains the only writer to the local database;
- owns long-running providers and tools;
- keeps filesystem, shell, and credentials out of the renderer;
- can reconcile work after a UI reload or runtime crash;
- provides one typed API to the desktop and a possible diagnostic CLI.

This is process separation, not microservices. There is one product, one local
authority, and one database.

## Architectural boundaries

Four concepts that may all look like “plugins” are intentionally separate:

| Boundary | Purpose | Example |
|---|---|---|
| Provider runtime adapter | Run an agent session | Codex app-server |
| Domain connector | Reconcile durable external state | Linear, Jira, GitHub |
| MCP connection | Expose callable tools/resources | Search or database tool |
| Skill package | Supply procedural knowledge/resources | Review or migration skill |

They have different authentication, failure, retry, permission, and persistence
semantics.

Workflow execution is another boundary. A workflow definition is immutable; a
run receives a revisioned execution graph. An agent may propose a bounded graph
change, but Charrette validates and commits it. Agents do not rewrite completed
history or silently expand their authority.

## Reading order

The detailed documents build the architecture in the order a reader encounters
the concepts:

1. [Concepts and project model](01-concepts-and-project-model.md)
   explains projects, multi-repository identity, tasks, runs, workspaces,
   collaboration, chat queuing, and scope.

2. [Desktop application and local runtime](02-desktop-runtime.md)
   explains Electron's processes, the local-backend model, IPC, long-running
   child processes, shutdown, crashes, and code/package boundaries.

3. [Agent runtime and authentication](03-agent-runtime-and-auth.md)
   explains what Charrette delegates to Codex or another provider, adapter
   tiers, process ownership, approvals, and hostile CLI-only authentication.

4. [Workflow engine](04-workflow-engine.md)
   explains durable graphs, node attempts, retries, dynamic changes,
   self-repair, compensation, interruption, and workflow authoring.

5. [Integrations and skills](05-integrations-and-skills.md)
   explains Linear/Jira/Git hosting connectors, MCP, synchronization,
   credentials, skill resolution, and skill trust.

6. [Persistence, security, scale, and cloud](06-persistence-security-and-cloud.md)
   explains SQLite, artifacts, trust boundaries, performance constraints,
   local authority, and future collaboration/cloud ownership.

7. [Precedents and architecture validation](07-precedents-and-validation.md)
   compares relevant systems, records required architecture decisions, and
   states the evidence that would validate or invalidate the design.

## System-wide invariants

These rules matter more than the eventual class or folder names:

1. One accepted writer advances an aggregate revision; retried commands are
   idempotent.
2. Task, run, workflow execution, node attempt, provider session, workspace,
   integration connection, and skill version are different identities.
3. Display states such as “working” and “needs you” are derived from durable
   facts.
4. A project may bind zero, one, or many repositories and survives changes to
   that set.
5. Shared repository identity never implies a shared path or credential.
6. One run attempt has one controller generation: an incrementing ownership
   token that prevents an older worker from writing after replacement.
7. Completed or running workflow nodes cannot be retroactively rewritten.
8. A graph change cannot broaden repositories, tools, credentials, external
   mutation rights, visibility, or budget without policy evaluation.
9. An approval binds an exact action digest, inputs, actor, policy, and expiry.
10. Provider authentication stays inside the provider's supported mechanism.
11. Skills add instructions and resources, never ambient authority.
12. MCP tool availability is distinct from permission to invoke it.
13. External systems remain authoritative for their own resources.
14. Login, linking, sharing, cloning, uploading, and cloud execution are
    separate user actions.
15. Every retry, loop, fan-out, repair, and background poll has a bound.
16. Interrupting a chat turn acknowledges and stops that turn, then continues
    the unfinished objective with the new input. It is not task cancellation.

## MVP architecture boundary

The local MVP includes:

- one local profile and no mandatory account;
- projects with zero or more repository bindings;
- several explicitly selected local clones or Git URLs;
- managed workspaces that do not mutate selected working copies;
- one host satisfying each run's full repository and credential set;
- one structured provider adapter;
- one immutable, code-owned workflow with attention and verification;
- durable chat input with interrupt-and-continue behavior;
- persisted attempts, observations, approvals, artifacts, changes, and claims;
- trusted skills resolved into a frozen run snapshot;
- restart reconciliation, diagnostics, backup, and restore.

It does not require:

- a home-grown model/tool loop;
- a provider marketplace;
- a visual workflow builder;
- arbitrary agent-authored executable nodes;
- automatic cross-device source cloning;
- both Linear and Jira;
- cloud custody of subscription CLI credentials;
- multi-host execution within one run;
- CRDT-based collaboration;
- distributed event sourcing;
- a general-purpose secret manager;
- claims that host-native execution is sandboxed.

The architecture retains seams for these capabilities without making them
present-tense product promises.

## Product choices still requiring sign-off

The architecture uses the recommended defaults below. They remain explicit
product choices:

| Choice | Recommended default | Why it matters |
|---|---|---|
| First provider mechanism | Prefer Codex app-server over stdio, subject to compatibility/lifecycle validation; keep the Codex SDK as the simpler fallback | Determines event, approval, resume, and packaging behavior |
| Generic provider protocol | Keep a Charrette port; add stable ACP adapters where useful | Avoids coupling the domain to a draft or provider-specific protocol |
| Subscription-backed CLI auth | Local execution through the official CLI only | Cloud must not extract or relay consumer subscription credentials |
| First issue tracker | Choose Linear or Jira from the first serious cohort | Building both obscures field ownership and reconciliation lessons |
| MCP posture | Charrette broker with explicit grants and audit | Provider-native pass-through is less consistently observable |
| Workflow authoring | Inspectable code-owned definitions; declarative/visual authoring is not assumed | Prevents an editor from preceding trustworthy execution semantics |
| Dynamic repair | Bounded graph-patch proposals plus human escalation | Unrestricted replanning is not replayable or safely resumable |
| Skill format | Agent Skills-compatible `SKILL.md` packages | Avoids a Charrette-only ecosystem |
| Critical skill activation | Explicit version pins in the run snapshot | Silent latest-version resolution makes runs irreproducible |
| Repository-free projects | Allowed | Supports research while keeping project independent of source topology |
| Multi-host run | Excluded from the local architecture | Requires distributed leases, transfer, cancellation, and partial-failure rules |
| Local external refresh | Cursor-based pull/on-demand refresh; no hidden public tunnel | Reliable webhooks require explicit cloud ingress |

## Primary references

- [Codex app-server](https://learn.chatgpt.com/docs/app-server)
- [Codex SDK](https://learn.chatgpt.com/docs/codex-sdk)
- [Codex authentication](https://learn.chatgpt.com/docs/auth)
- [Building Codex skills](https://learn.chatgpt.com/docs/build-skills)
- [Agent Client Protocol](https://github.com/agentclientprotocol/agent-client-protocol)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [Agent Skills specification](https://agentskills.io/specification)
- [LangGraph durable execution](https://docs.langchain.com/oss/javascript/langgraph/thinking-in-langgraph)
- [Temporal workflows](https://docs.temporal.io/workflow-definition)
