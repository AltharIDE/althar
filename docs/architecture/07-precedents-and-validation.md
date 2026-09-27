# Precedents and Architecture Validation

## Architectural posture

The plan is intentionally asymmetric:

- establish durable project, authority, and execution semantics early;
- reuse existing agent runtimes, protocols, and skill formats;
- delay breadth, authoring surfaces, and distributed infrastructure until the
  local workflow demonstrates value.

The measure of architecture quality is not the number of abstractions present.
It is whether the first end-to-end slice is honest, recoverable, inspectable,
and capable of evolving without redefining its core identities.

## Competitive and technical precedents

### Superset

Superset is the strongest precedent for a polished multi-agent desktop/workspace
experience:

- Electron plus a host service;
- local state and workspace/process ownership;
- parallel agent/terminal surfaces;
- worktrees and remote hosts;
- CLI/SDK/MCP-facing capabilities.

It validates Charrette's separate host/runtime process and its need for bounded
watchers, child-process ownership, and host-aware workspaces.

Charrette should not chase Superset's surface breadth in the MVP. A workspace
or terminal session is not enough to represent a multi-repository project,
durable decision, workflow revision, external-system mapping, or knowledge
claim. Charrette's defensible layer is the persistent record and authority
model above those sessions.

### Agent Orchestrator

Agent Orchestrator is strong prior art for:

- a durable daemon/control plane;
- thin clients;
- lifecycle facts and derived status;
- worktree/session/worker separation;
- SQLite and explicit runtime reaping;
- adapters around agents and Git publication.

Its most valuable lesson is to observe and persist facts rather than letting UI
components write a shared status label.

Charrette goes further only where its thesis demands it: projects may bind
several repositories; workflows, decisions, skills, external mappings, and
knowledge survive a particular agent or worktree. It should not compete on raw
adapter count or Kanban completeness.

### OpenHands

OpenHands demonstrates a useful distinction between agent/controller state and
the runtime that performs actions. Its local/container/remote runtime posture is
a better precedent than pretending host-native execution is sandboxed.

Charrette should keep an `ExecutionHostAdapter` seam, while avoiding the trap of
using an agent event stream as the complete project data model.

### Codex app-server and SDK

Codex provides two credible integration levels:

- app-server for a client needing authentication, history, approvals, and
  streamed agent events;
- SDK for simpler programmatic thread start/resume behavior.

This materially reduces the case for building a model/tool harness. Charrette
still needs its own adapter and domain because Codex sessions do not define
Charrette projects, workflow authority, connectors, or cross-run knowledge.

### Agent Client Protocol

ACP provides a promising generic JSON-RPC client-agent boundary with capability
negotiation, auth, sessions, prompts, cancellation, updates, and permission
requests.

Use it where providers implement a stable version. Do not freeze Charrette's
domain to it: protocol drafts can evolve, not every provider uses it, and it
does not solve the control-plane product model.

### MCP

MCP is the standard boundary for tools/resources. It belongs beneath policy and
audit in Charrette. It does not replace first-class synchronization connectors
for Linear, Jira, or Git hosting.

### OpenAI Agents SDK

The Agents SDK's manager-as-tools and handoff patterns are useful inside
Charrette-authored agent nodes. They do not provide durable project state,
long-running workflow recovery, or external synchronization.

### LangGraph

LangGraph is the closest reusable framework for checkpointed agent graphs,
interrupts, retries, and dynamic command routing.

It may become an implementation of an advanced agent/subworkflow port. The MVP
should first prove that Charrette's fixed graph and domain semantics are stable;
otherwise framework concepts will leak into the product before the product is
known.

### Temporal and durable execution systems

Temporal demonstrates the depth of deterministic replay, durable activities,
timers, cancellation, and workflow/worker versioning. Those are essential
lessons for the cloud architecture.

Running a Temporal control plane for an offline desktop MVP is disproportionate.
Keeping activities typed, effects idempotent/reconcilable, and workflow
versions immutable preserves a migration path.

### Archon

Archon is useful evidence for the desired authoring vocabulary: YAML DAGs,
loops, approvals, scripts, MCP, skills, and a visual builder.

It is not evidence that a graph definition format solves:

- immutable active execution;
- unknown external effects;
- controller fencing;
- workflow and skill migration;
- multi-repository authority;
- deterministic repair;
- webhook reconciliation.

Charrette should learn from Archon's product surface and shortcomings without
adopting its builder or workflow files as a correctness substrate.

## Comparison

| Concern | Superset | Agent Orchestrator | OpenHands | Archon | Charrette |
|---|---|---|---|---|---|
| Primary durable object | Workspace/host surface | Project/session/worker | Agent session | Workflow/project | Project context and work across systems |
| Agent runtime | Several agent surfaces | Adapter-managed workers | Own agent/controller | Harness over coding agents | Reused provider runtime through adapter |
| Repository model | Workspace/repo oriented | Worktree/repo oriented | Runtime workspace | Workflow workspace | Project binds 0..n repos; per-host locations |
| Workflow semantics | Task/session oriented | Durable lifecycle | Controller loop | YAML DAG/loops | Versioned graph, attempts, repair, patch validation |
| Integrations | Broad host/product surface | Git/PR oriented | Tool/runtime integrations | MCP and workflow steps | Typed connectors plus MCP with separate authority |
| Skills | Provider/tool dependent | Limited/not central | Agent prompts/tools | First-class skill concept | Open skill packages with frozen resolution |
| Collaboration | Remote/org product | Daemon and clients | Hosted/server options | Server/product workflows | Cloud-authoritative shared aggregates later |
| Differentiator | Parallel agent workspaces | Supervision through publication | Agent/runtime isolation | Workflow authoring | Durable evidence, decisions, knowledge, and authority |

No reference system eliminates the need for Charrette's domain. Several can
eliminate the need to implement its underlying agent loop, tool protocol, or
future workflow machinery from first principles.

## Required ADRs

An architecture decision record (ADR) is a short document that captures one
important choice, its alternatives, and the evidence behind it. These ADRs keep
implementation-specific decisions from becoming undocumented assumptions:

1. **Runtime lifetime and packaging**
   Desktop supervision, quit semantics, reconciliation, daemon extraction.

2. **Local control-plane transport**
   MessagePort/socket choice, authentication, versioning, CLI coexistence.

3. **First provider integration**
   App-server versus SDK/CLI evidence, support matrix, degraded behavior.

4. **Provider and external authentication**
   Principals, opaque credential references, local subscription CLI policy,
   cloud credentials, rotation and revocation.

5. **Trusted-host execution threat model**
   Paths, process ownership, environment, hooks, skills, MCP, untrusted input.

6. **SQLite and artifact ownership**
   Transactions, intents/receipts, events, change feed, backup, retention.

7. **Project and repository mapping**
   Zero-to-many bindings, per-device locations, add/detach, monorepos, forks.

8. **Task/run/workflow/attempt/session/workspace lifetimes**
   IDs, state machines, fencing, cancellation, reconciliation.

9. **Chat input ordering and interruption**
   Queue durability, two acknowledgements, continuing prior work, provider
   steering, races, cancel/supersede distinction.

10. **Workflow version and patch policy**
    Node vocabulary, bounds, authority deltas, upgrades, repair, compensation.

11. **Integration connector contract**
    Mappings, field ownership, cursor/webhook, receipts, reconciliation.

12. **MCP brokerage and grants**
    Discovery, permission, approval, audit, local/cloud placement.

13. **Skill format, resolution, and trust**
    Open format, scopes, pins, snapshots, scripts, dependencies.

14. **Knowledge claims and scope**
    Provenance, authority, visibility, validity, contradiction, revocation.

15. **Cloud authority and local-runner leases**
    Link/unlink, aggregate authority, fencing, artifact/secret movement.

ADRs record decisions and evidence; they do not duplicate these documents.

## Architecture validation criteria

These are observable properties the design must retain, grouped by concern.

### Identity and project

- Project identity survives adding, replacing, and detaching repositories.
- Shared/exported state contains no local checkout path or credential locator.
- Two devices map one binding to different paths with equivalent logical
  provenance.
- A collaborator can read permitted history without source access.
- A multi-repository change set reports independent publication outcomes.

### Runtime and input

- Renderer cannot directly invoke Node, shell, SQLite, keychain, or arbitrary
  filesystem APIs.
- Every command and message acceptance is validated and idempotent.
- Interrupt acknowledgement survives restart.
- Interrupt-and-continue preserves unfinished prior work and new input order.
- Cancellation, replacement, interruption, and retry are observably distinct.
- Process cancellation terminates the complete owned tree.
- Stale controllers cannot advance state.

### Workflow

- Status rebuilds from durable facts.
- Restart at each transition converges deterministically.
- Unknown external effects reconcile before retry.
- Graph patches cannot rewrite running/completed work.
- Loops, fan-out, repairs, retries, and budgets are bounded.
- Active runs do not change when definitions or skills update.

### Integration and skills

- Webhook duplicates/reordering do not duplicate mutations.
- Outbound commands produce receipts and reconcile lost responses.
- Local-only mode requires no public webhook.
- MCP visibility does not imply tool permission.
- Skill dependencies do not grant tools, credentials, paths, or network.
- Historical skill content hashes remain attributable after update/removal.

### Persistence, security, and scale

- State and record events commit atomically.
- Backup restores all referenced artifacts or reports precise omissions.
- Secret canaries are absent from persisted/logged/exported surfaces.
- Symlink/traversal and executable-shadowing tests pass.
- The stated 100-project/16-run/million-event envelope passes.
- Login, linking, sharing, cloning, upload, and cloud execution remain separate
  explicit actions.

## Evidence that would invalidate this architecture

The design should be revisited if evidence shows that:

- the first provider offers no versioned structured interface adequate for
  lifecycle and approvals;
- supported platforms cannot reliably own/terminate process trees;
- interruption cannot be distinguished from cancellation or lost input;
- an external mutation cannot be made idempotent or reconciled;
- the fixed graph requires routine unbounded agent mutation;
- skill delivery requires modifying user working copies;
- local persistence cannot meet recovery/capacity targets;
- collaboration design would expose machine paths or vendor subscription
  credentials;
- users derive no value from retained decisions, evidence, and knowledge beyond
  what an existing agent workspace already provides.

The last condition is the strategic one. If the durable project record is not
useful, Charrette is merely a thinner agent supervisor in a mature market.

## Primary references

- [Superset repository](https://github.com/superset-sh/superset)
- [Agent Orchestrator architecture](https://github.com/Untrivial-ai/agent-orchestrator/blob/main/docs/architecture.md)
- [OpenHands runtime architecture](https://docs.openhands.dev/openhands/usage/architecture/runtime)
- [Codex app-server](https://learn.chatgpt.com/docs/app-server)
- [Codex SDK](https://learn.chatgpt.com/docs/codex-sdk)
- [Agent Client Protocol](https://github.com/agentclientprotocol/agent-client-protocol)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [OpenAI Agents SDK orchestration](https://developers.openai.com/api/docs/guides/agents/orchestration)
- [LangGraph durable execution](https://docs.langchain.com/oss/javascript/langgraph/thinking-in-langgraph)
- [Temporal workflows](https://docs.temporal.io/workflow-definition)
- [Archon](https://github.com/coleam00/Archon)
