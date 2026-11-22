# ADR-112: Panels are read-only connectors with a view, devops first: Kubernetes and Prometheus

> A proposal, not built. Where it would fold in:
> [code-hosts.md § Connectors](../code-hosts.md#connectors) (a third kind of
> connector, beside code hosts and trackers), [desktop-app.md § The
> workbench](../desktop-app.md#the-workbench) (a panel beside the
> conversation), and [what-agents-may-do.md § Althar's tools outside the
> sandbox](../what-agents-may-do.md#althars-tools-outside-the-sandbox) (the
> read tools). The plan is [Althar for the whole team](../../plans/whole-team.md).

- **Status:** Proposed
- **Date:** 2026-11-22
- **Owner:** Connector, runtime and desktop maintainers
- **Related:** [ADR-011, connectors](../code-hosts.md#connectors),
  [ADR-029, read only while shown](../scheduling.md#althars-share-of-the-load),
  [ADR-053, the workbench](../desktop-app.md#the-workbench),
  [ADR-097, the person's MCP servers](../the-persons-setup.md#in-every-role),
  [ADR-100, a page beside the conversation](../desktop-app.md#a-web-page-beside-the-conversation),
  [ADR-108, lenses](108-a-role-is-a-lens-not-a-separate-app.md),
  Ops A (the Ops sandbox profile) and Ops B (environments, the plan/apply
  gate, locks, a run log).

## Context

Devops takes a feature over once it ships and runs it, and wants to see
what runs, and whether it is well, beside the conversation, as engineering
sees checks and pull requests. Their agents need to read the same, to turn
an alert into an incident task and to check a rollout. Nothing in Althar
reads a cluster or a metric today, and `~/.kube` is one of the places
agents' sandboxes are kept from (`secrets.ts`).

## Decision

**A panel is a read-only connector and a view.** The connector is
Althar's own, on the service's API, as code hosts and trackers are
(ADR-011): sealed credentials, a fake for tests, a contract suite, and
capabilities it declares. The view opens beside the conversation as a
fifth kind in the workbench, after a document, a file, a page and a
canvas, or fills a room (Environments, [ADR-108](108-a-role-is-a-lens-not-a-separate-app.md)).
A lens pins the panels its role wants.

**Read-only, and only reads.** No panel writes, scales, restarts or
applies. A change to a cluster is a task in the repository, through Ops
B's plan/apply gate; a panel only shows what happened.

**Agents read through Althar's tools,** served to the shared pool beside
`canvas_*` and `page_*`, not with credentials in their sandbox. The tools
are reads, so nothing asks: `cluster_read` (a resource, a list, events, a
rollout's status) and `metrics_query` (an instant or range PromQL query,
and the active alerts). The person's own MCP servers for the same services
still reach agents as they do (ADR-097); panels don't replace them.

**First, Kubernetes:**

- **Connected from the person's kubeconfig:** they pick contexts and
  namespaces per project, as an environment (`dev`, `staging`, `prod`).
  Althar reads the file and runs its credential plugins itself, in the
  runtime, outside every agent's sandbox, as its own git runs.
- **Verbs `get`, `list` and `watch` only,** on workloads, pods, events,
  services, ingresses, jobs and nodes. Secrets are never read; a
  ConfigMap's keys are shown, not its values.
- **The view:** each environment's workloads, ready against desired, pods
  restarting or failing, recent warnings, and the rollout of what the
  feature's `ops.md` names.

**Then Prometheus:**

- **A base URL, and a token or basic auth where it needs one,** sealed as
  code hosts' tokens are. Grafana is linked from the view, not read.
- **The view:** the active alerts, and the queries `ops.md` names for the
  feature, as small charts.
- **An alert is offered as a task:** "Look into it" drafts an Incident
  look plan with the alert, the query and the environment. Only on the
  person's press; an automation may do it later (ADR-061).

**Read while shown.** A panel's connector reads only while a window shows
it or an agent asks, off the thread, within its service's limits, as the
load meter does (ADR-029). Nothing is polled with the window closed.

**Until a panel exists,** a page beside the conversation (ADR-100) already
shows Grafana, ArgoCD or a cluster's dashboard; a devops lens pins one.

## Alternatives

- **Only pages:** the service's own dashboard beside the conversation. No
  work, and the stopgap above, but agents can't read it as data and its
  sign-in lives in a browser session.
- **Only MCP servers.** They can't be listened to, differ by version, and
  give no view; the same reason as ADR-011.
- **Credentials in the devops agent's sandbox,** `kubectl` and all.
  That's Ops A's decision for the tasks that need it, with writes; a panel
  needs neither.
- **Writes from the start.** Rejected: Ops B decides how a change to a
  running system is planned, gated and logged.

## Consequences

- A third connector model beside code hosts and trackers, which later
  panels reuse: ArgoCD or Flux, a cloud's status, Sentry, Datadog; and
  for other lenses, a tracker's cycle (product) or a Figma file (design,
  if links and screenshots fall short).
- Devops sees and reads its systems without any agent holding their
  credentials.

## What an implementation touches

- `packages/connectors/src/model.ts` (a `Source` model beside `CodeHost`
  and `Tracker`), new `kubernetes.ts` and `prometheus.ts` with fakes and
  contract suites, `trackers.ts` as the pattern for capabilities.
- New `packages/runtime/src/Panels.ts`, serving its tools to the pool with
  `ToolServer.ts` (`POOL`), wired in `Runtime.ts`; views in
  `packages/contracts/src/Api.ts`.
- `apps/desktop/src/renderer/shared/ThreadHost.tsx` and
  `packages/ui/src/thread/Workbench/Workbench.tsx` (the panel kind),
  `features/projectSettings/` (connecting environments), and the main
  process's sealed store for the tokens, as code hosts'.
- `packages/provider-adapters/src/secrets.ts` stays as it is: `~/.kube`
  stays out of agents' reach unless Ops A opens it.
