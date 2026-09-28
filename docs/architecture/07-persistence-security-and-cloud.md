# Persistence, Security, Scale, and Cloud

## Local persistence

Use one SQLite database per local Charrette profile and one
content-addressed artifact store.

The runtime is the sole database writer. The renderer, Electron main process,
provider children, skills, and MCP servers never open the database directly.

SQLite is appropriate for the initial control plane if the implementation
enforces:

- foreign keys;
- WAL mode;
- bounded busy timeout;
- one application writer queue;
- short transactions with no filesystem, Git, provider, or network I/O;
- pagination for every unbounded query;
- explicit checkpoint policy based on WAL size and idle opportunity;
- append-only forward migrations;
- online backup plus artifact-manifest verification;
- routine integrity checks and tested restoration.

A generic Postgres repository abstraction inside the local runtime would add
indirection without making SQLite behavior distributed.

## Canonical data model

Minimum table families:

```text
identity and scope
  profiles, devices, actors, projects, memberships, scope_refs

source and workspaces
  repository_bindings, repository_locations
  task_repository_requirements
  workspaces, workspace_snapshots
  change_sets, repository_changes

work and workflow
  tasks, runs, run_attempts
  workflow_definitions, workflow_versions
  workflow_executions, execution_graph_revisions
  nodes, node_attempts, graph_patch_proposals

agent interaction
  interaction_threads, user_inputs, turn_deliveries
  provider_installations, provider_principals
  provider_sessions, runtime_instances, processes

attention and knowledge
  permission_requests, attention_requests, findings, decisions
  knowledge_claims, claim_relations

integrations and capabilities
  integration_connections, external_resource_bindings
  external_identities, sync_cursors, webhook_subscriptions
  external_observations, external_mutation_receipts
  mcp_servers, mcp_tool_grants
  credential_refs, execution_grants

skills
  skill_definitions, skill_versions, skill_bindings
  skill_resolution_snapshots

evidence and operations
  observations, artifacts, artifact_links
  record_events, change_log, command_receipts
  leases, schema_migrations
```

This is a conceptual minimum, not a demand that the first local release creates
one table per line. The important point is preserving distinct identities and
lifetimes when those capabilities exist.

Use globally unique sortable IDs, integer aggregate revisions, UTC timestamps,
and explicit terminal/tombstone facts. Store external provider IDs as data,
never as Charrette primary keys.

### Schema rules

The local schema follows these rules; `@charrette/persistence-sqlite` tests the
ones that can be tested.

- **Vocabularies are lookup tables** (`vocab_<name>`), so a new word is an
  insert. SQLite cannot alter a `CHECK`, and rebuilding a referenced table is
  the expensive way to add a state.
- **Every row that changes state has a revision,** and a change records the new
  revision in the record and the feed.
- **Every project-scoped row carries its project,** and references between
  them are composite, `(id, project_id)`, so no row can point into another
  project. The record, the feed and artifacts carry it too; in the cloud it is
  the partition, the filter for each member's feed, and the export boundary.
- **Device-only data stays in device-keyed tables,** such as where a device
  keeps its worktrees, so linking a project to the cloud never carries it.
- **Every reference to an artifact,** including one inside a JSON column, also
  has an `artifact_links` row, so cleanup marks what is used without parsing
  JSON.
- **"One active" rules are partial unique indexes:** one active attempt per
  run, one unfinished attempt per node, one active turn per thread.
- **Migrations run with foreign keys off,** then `PRAGMA foreign_key_check`,
  then on: SQLite's procedure for rebuilding a table others reference.

## Transaction and effect pattern

External effects do not occur inside database transactions.

Use a durable intent/receipt pattern:

1. Validate a command and expected revision.
2. Commit canonical intent, record event, outbox/work item, and command receipt.
3. A worker claims the work under a fenced controller generation.
4. Perform the external effect with idempotency metadata where available.
5. Commit the observation and mutation receipt.
6. Project the result and schedule verification/reconciliation.

The local runtime may implement the outbox as ordinary SQLite tables. It does
not require a message broker.

Unknown effects are a first-class state. They are not flattened into `failed`.

## Record, change feed, and raw protocol data

Keep three concerns separate:

### Operational record

User-inspectable, durable facts:

- run admitted;
- workspace prepared;
- approval requested/answered;
- external mutation confirmed;
- verification failed;
- graph revision accepted;
- skill snapshot resolved.

Records are normalized and redacted. They should remain intelligible after
provider logs are deleted.

### Client change feed

A compact resumable invalidation stream:

- monotonically increasing local cursor;
- aggregate/type/ID/revision;
- retention and snapshot recovery;
- no promise of permanent audit semantics.

### Raw/diagnostic protocol capture

Optional, bounded, encrypted where appropriate, and more aggressively redacted.
It lives in its own file, not the canonical database, and keeps raw bytes: it
neither bloats the canonical database's backups and WAL, nor refuses a
malformed line, which is exactly what a protocol violation needs to show.
It records enough to debug adapter/version failures but is not canonical state
or an automatic cloud-sync format.

## Artifacts

Store bytes by cryptographic hash:

1. write to a temporary file;
2. flush;
3. compute/verify size and hash;
4. atomically rename into the content-addressed store;
5. commit the database metadata/reference.

Artifact metadata includes:

- media type and size;
- content hash;
- producing run/node/attempt;
- provenance and external source;
- visibility;
- sensitivity and redaction state;
- retention class;
- encryption/key reference where required.

Use mark-and-sweep garbage collection from canonical references. A mutable
refcount alone is too fragile after crashes, restore, or partial migration.

Provider transcripts, tool output, patches, screenshots, logs, and generated
files may contain secrets. Default retention must differ by artifact class.

## Backup, export, and restore

A backup is not successful until restoration is tested.

- Use SQLite's online backup mechanism.
- Capture an artifact manifest with hashes.
- Include schema/application compatibility metadata.
- Never copy a live database file and WAL independently as an ad hoc backup.
- Verify restored references and report missing/corrupt blobs explicitly.
- Export project records with stable IDs and provenance, but strip local paths,
  credential locators, process IDs, and device grants by default.
- A project export does not imply a runnable project on another device.

## Security boundaries

### Renderer

- context isolation on;
- sandbox on where Electron permits;
- Node integration off;
- narrow preload API;
- schema validation on both IPC sides;
- no arbitrary command, SQL, path, URL, or secret APIs;
- navigation, new-window, permission, and external-protocol allowlists;
- strict CSP and no remote privileged content.

### Runtime

- all paths resolved and checked against registered roots;
- symlink and traversal behavior tested;
- executable resolution cannot be shadowed by an untrusted repository;
- child environment is allowlisted;
- process groups/job objects are owned and fenced;
- logs and errors are redacted before persistence/client delivery;
- database and keychain operations stay inside audited modules.

### Repository/workspace

Repository content is hostile input. It may contain:

- executable hooks/scripts;
- malicious filenames and symlinks;
- huge trees or watcher bombs;
- prompt injection;
- workspace configuration that tries to broaden tools;
- build steps that exfiltrate environment or credentials.

The MVP is trusted-host execution under the user's OS account. Charrette must
say so. It constrains its own operations but cannot honestly claim to sandbox a
provider or arbitrary build process without an OS/container isolation layer.

Git hooks are disabled for Charrette-owned automated operations unless a
specific workflow grants them. Repository-local binaries and configuration are
not trusted as runtime dependencies.

### Provider, connector, MCP, and skill boundaries

- Provider output is an observation, not proof of an effect.
- Connector payloads and webhooks are untrusted and tenant-bound.
- MCP tool metadata and results are untrusted; tool availability is not
  permission.
- Skill instructions are untrusted content; skill scripts are untrusted code.
- Every credential has a custodian, principal, scope, host, and expiry/revocation
  path.
- A capability cannot be broadened by prompt text or a dependency declaration.

## Threats requiring explicit tests

1. Path traversal through provider artifact paths.
2. Symlink escape from an allowed workspace.
3. Repository-local executable shadowing a provider or Git binary.
4. Secret leakage through logs, environment, process lists, artifacts, or
   diagnostic export.
5. Prompt injection requesting broader MCP or integration authority.
6. Replayed/forged webhook crossing tenant boundaries.
7. Malicious skill update or dependency substitution.
8. Stale controller/process writing after replacement.
9. Renderer compromise invoking privileged IPC.
10. Backup/export containing machine paths or credentials.
11. External URL or custom protocol opening unsafe handlers.
12. Artifact decompression/archive bombs and oversized tool results.

## Approval integrity

An approval is a capability grant for an exact action, not a chat sentiment.

Persist:

- request and action type;
- normalized parameters and digest;
- affected resources;
- input/diff/artifact hashes;
- actor and principal;
- policy version;
- decision and reasoning;
- expiry and consumption.

Any relevant change invalidates the approval. “Approve all” must still be
bounded by action class, resources, duration, and run.

## Scheduling and scalability

The MVP target envelope:

- 100 projects;
- 500 repository bindings/locations;
- 16 concurrently active runs;
- 1,000,000 operational record events;
- 10 GB referenced local artifacts;
- UI change delivery p95 below 250 ms while healthy;
- command commit p95 below 100 ms excluding external work;
- ordinary restart reconciliation below 30 seconds.

These are validation targets, not marketing limits.

### Admission control

Use separate bounded pools for:

- provider sessions;
- Git/workspace preparation;
- verification/build processes;
- connector/network calls;
- artifact hashing/indexing.

Each task receives project/user priority, resource estimate, and budget.
Interactive attention responses should not wait behind background hydration.

Backpressure is visible:

- queued reason;
- estimated position or blocking resource;
- concurrency/budget control;
- pause/cancel;
- no unbounded in-memory promise or event queues.

### Observation

Use targeted watchers only while a workspace is active. Debounce/coalesce
filesystem invalidations and verify state with Git before recording a durable
fact. Poll low-frequency facts when watchers are less reliable.

Metrics:

- queue wait and active duration by node type;
- provider event lag and dropped/degraded events;
- process/resource use;
- DB transaction/checkpoint latency and WAL size;
- artifact bytes and GC;
- connector rate-limit/retry state;
- reconciliation and uncertain-effect counts;
- attention wait time;
- graph repairs and approval frequency.

Metric labels use bounded cardinality; IDs belong in traces/logs, not metric
dimensions.

### Diagnostics

A diagnostic bundle is user-reviewed and redacted. It includes:

- app/runtime/adapter versions;
- OS/architecture;
- schema migration state;
- capability and support matrices;
- process-lifecycle summary;
- bounded structured logs;
- database integrity summary;
- missing artifact report;
- configurable project/resource identifiers.

It excludes credentials, raw environment, arbitrary source files, and unredacted
provider transcripts by default.

## Local authority

In the MVP, the local runtime is canonical for the local profile. If two devices
receive copies of a project export, they are independent forks—not synchronized
writable replicas.

Backup/mirroring and shared collaboration are different products:

- **Backup/mirror:** one canonical writer; copies restore or inspect.
- **Shared project:** one cloud command authority orders aggregate revisions.

Do not market file synchronization of SQLite/artifacts as collaboration.

## Cloud authority

The cloud is introduced when sharing or cross-device continuity is actually
valuable.

### Shape

Start as a private modular monolith:

- authenticated API/client gateway;
- canonical command/query modules;
- Postgres;
- durable job/outbox mechanism;
- object storage;
- webhook ingress;
- local-runner lease/control channel;
- audit and policy modules.

Do not copy local SQLite files to the cloud. Migrate through explicit versioned
commands/snapshots.

### Per-operation authority

Avoid a single `project.mode` such as local/synced/collaborative. Authority is
per operation/aggregate:

- shared project metadata and tasks may be cloud-authoritative;
- repository bytes and local workspaces remain on a device;
- a hosted executor may own one leased node attempt;
- local drafts may remain local until published;
- integration connections may live in cloud or on an approved runner.

The client resolves the authoritative endpoint behind one typed control-plane
API.

### Local runner leases

A cloud-authoritative run delegated locally requires:

- device registration and user-visible trust;
- declared provider/repository/skill/integration capabilities;
- short-lived lease with fencing token;
- heartbeats and expiry;
- command/result idempotency;
- artifact upload/download policy;
- secret delivery scoped to attempt and host;
- cancellation and disconnection semantics;
- stale-runner writes retained only as observations.

Lease expiry alone cannot prove the process stopped. A later stale result may be
diagnostically useful but cannot advance canonical state without reconciliation.

### Link, share, and unlink

These are separate actions:

1. Authenticate an account.
2. Register/trust a device.
3. Link or create a cloud project.
4. Choose metadata/artifact/source visibility.
5. Invite collaborators and assign roles.
6. Optionally enable a local runner or hosted execution.

Unlinking must state whether it:

- removes only this device association;
- leaves or deletes remote project data;
- creates/retains a local fork;
- revokes runner capability;
- affects other collaborators.

Login never implies upload, scanning, cloning, or sharing.

## Deletion and revocation

Deletion semantics are explicit and reference-aware:

- archive hides an object from ordinary selection;
- detach stops future use but preserves history;
- revoke prevents future authority;
- tombstone preserves identity for sync/reconciliation;
- erase removes eligible content under retention/legal/security policy.

Revoking a skill, connection, credential, or repository does not falsify old
runs. Historical references retain metadata/content hashes while secret
material and future capability disappear.

## Verification gates

- Only the runtime can write SQLite.
- Crash tests never produce a record event without its canonical state change.
- One million record events meet query and change-feed targets.
- Active backup restores with every referenced blob or a precise missing report.
- Secret canaries are absent from DB records, renderer errors, logs, bundles,
  and process arguments.
- Symlink/path traversal cannot escape registered roots in Charrette-owned
  operations.
- Sixteen-run soak tests keep queues bounded and UI responsive.
- Stale controller and lease tokens cannot advance state.
- Two exported copies are never presented as synchronized collaboration.
- Account login alone uploads nothing.
- Cloud linking excludes local paths and credential references.

## References

- [Electron process model](https://www.electronjs.org/docs/latest/tutorial/process-model)
- [Electron security checklist](https://www.electronjs.org/docs/latest/tutorial/security)
- [Electron utility process API](https://www.electronjs.org/docs/latest/api/utility-process)
- [SQLite write-ahead logging](https://sqlite.org/wal.html)
- [SQLite online backup API](https://sqlite.org/backup.html)
- [OAuth 2.0 for native apps, RFC 8252](https://www.rfc-editor.org/rfc/rfc8252.html)
