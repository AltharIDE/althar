# Architecture

This document defines the **durable engineering target** for the Althar repository. Code and tooling may temporarily lag behind it, but work should move them toward it. A material mismatch needs a convergence plan or an explicit, time-bound exception. Changing the code does not silently change the target; changing the target requires a recorded decision.

These rules apply to every app and package. They do not fix Althar's product model or mandate one folder structure. Each app and package has its own `ARCHITECTURE.md` for its specific design. Althar is experimental; its abstractions should be able to change without making the code unsafe or opaque.

## Design

### Responsibilities and readability

Give each module a clear responsibility. Keep domain decisions separate from presentation, persistence, provider integrations, and operating-system effects. Put effects behind explicit interfaces; depend on stable contracts instead of another package's internals.

Use the smallest design that supports current behavior. Add an abstraction when it clarifies a real boundary or removes repeated complexity. Prefer readable names and explicit control flow over cleverness.

### Types and boundaries

Write all hand-authored application, package, test, configuration, and script code in TypeScript (`.ts` or `.tsx`) with strict compiler settings. Avoid `any`, unchecked casts, non-null assertions, and suppression comments. If one is necessary, explain the invariant and keep it local.

Validate untrusted values at runtime, including files, network responses, provider output, and persisted data. Types alone do not validate them.

### State and compatibility

Define who owns each piece of state and its lifecycle. Make side effects, error states, cancellation, and retries explicit. An interrupted or retried operation must not silently duplicate or lose work.

State the compatibility promise for public APIs, persisted data, exports, and cross-process or service messages. Prefer backward-compatible changes. Breaking changes need a versioned transition, migration, and recovery or rollback path. Test contracts across the real boundary.

### Data and dependencies

Keep project data portable and inspectable. Minimise sensitive-data collection and retention, keep secrets out of source and logs, and use least privilege. Treat dependencies and external integrations as trust boundaries.

Keep the dependency surface small. Before adding one, weigh its benefit against maintenance, security, licence, compatibility, and performance costs. Upgrade deliberately and test the result.

## Verification

### Tests and coverage

Work test first for new behavior and regressions: write a failing test for the observable contract, implement it, then refactor. Exploratory work needs tests before it ships. AI-generated code receives the same review and verification as hand-written code.

Require **at least 90% line and branch coverage in each app and package** for production code, measured in CI. A repository average cannot hide a weak area. Exclude only generated or genuinely untestable code, and document the reason beside the coverage configuration. Coverage is a floor, not proof of correctness.

Test valuable behavior: invariants, boundaries, invalid input, failures, recovery, cancellation, and concurrency where relevant. Use unit tests for isolated logic, integration tests for real boundaries, and end-to-end tests for critical journeys. Prefer realistic fixtures and observable outcomes. Tests that merely repeat the implementation or inflate coverage do not count as useful evidence.

### Static checks and gates

Use strict TypeScript, type-aware linting, formatting, dependency and import-boundary rules, and build checks. Keep warnings and suppressions visible and justified.

CI must block merge and release on failed static checks, tests, coverage, or production builds, plus applicable accessibility and end-to-end checks. A check is a gate only when CI runs it and fails on a violation. A passing local run does not replace that gate; an untested failure path remains incomplete even when coverage is high.

### Reproducibility

Builds and tests must work from a clean checkout in supported environments. Commit the lockfile, pin the toolchain, document required configuration, and avoid undocumented local state. CI must use the same supported commands as developers and verify the locked dependency graph.

## Runtime quality

### Accessibility

Build for accessibility from the first implementation. Target WCAG 2.2 AA where it applies. Use semantic elements, accessible names, keyboard and assistive-technology support, visible focus, adequate contrast, reduced motion, and layouts that work at different sizes. Automated audits supplement manual interaction checks.

### Performance

Consider performance in every design. Avoid unnecessary work, blocking operations, unbounded queries, excessive rendering, and large bundles. Define measurable budgets for important paths in the local architecture document. Profile representative data and devices before optimising, and add regression checks where a budget matters.

### Failures and diagnostics

Make failures diagnosable without leaking private data. Use actionable errors and, where appropriate, structured diagnostics with enough context to trace an operation across boundaries. Handle empty, slow, offline, partial, and interrupted states deliberately.

## Documentation and decisions

### Local architecture documents

Each `apps/*/ARCHITECTURE.md` and `packages/*/ARCHITECTURE.md` explains the component's purpose and owner, public API, dependency direction, state and data flow, trust boundaries, important failure modes, accessibility and performance constraints, and how its checks run. State the intended design and material implementation gaps with a path to convergence. Keep speculative proposals separate from the accepted target.

### Decisions and exceptions

Record consequential decisions in an ADR with context, alternatives considered, trade-offs, owner, and a trigger for revisiting it. Record exceptions with an owner, reason, expiry, and convergence plan. An exception must not silently become the architecture.

## ADR log

ADR-001 is recorded here. Later decisions are one file each in [`docs/decisions/`](docs/decisions/), numbered in sequence. Preserve earlier decisions and mark them superseded when the target changes.

- [ADR-002](docs/decisions/002-acp-for-every-agent.md) — 2026-09-28: ACP for every agent
- [ADR-003](docs/decisions/003-electron-shell.md) — 2026-09-28: Electron shell, with the runtime in a utility process
- [ADR-004](docs/decisions/004-coordinator-is-an-agent-session.md) — 2026-09-28: The coordinator is an agent session with Althar's tools
- [ADR-005](docs/decisions/005-althar-briefs-every-agent.md) — 2026-09-28: Althar briefs every agent, and a switch hands over everything
- [ADR-006](docs/decisions/006-worktree-per-task.md) — 2026-09-28: A git worktree per task
- [ADR-007](docs/decisions/007-permission-requests-reach-althar.md) — 2026-09-28: Every permission request reaches Althar
- [ADR-008](docs/decisions/008-shortcuts-in-behaviour-not-in-records.md) — 2026-09-28: Shortcuts in behaviour, never in recorded facts
- [ADR-009](docs/decisions/009-effect-on-the-runtime-side.md) — 2026-09-28: Effect on the runtime side
- [ADR-010](docs/decisions/010-desktop-app-mvvm.md) — 2026-09-28: The desktop app is MVVM, in feature folders

### ADR-001 — 2026-09-22: Repository-wide engineering target

- **Status:** Accepted
- **Owner:** Repository maintainers
- **Context:** Althar will change quickly, and code produced with AI assistance needs a stable, reviewable engineering standard across apps and packages.
- **Decision:** This document defines the durable target state. Local architecture documents specialise it; code and tooling converge toward it. Material changes to the target require a new ADR, and temporary exceptions have an owner and expiry.
- **Alternatives considered:** Treat documentation as a snapshot of current code, or leave standards to each package. Both make drift and inconsistent quality harder to detect.
- **Trade-off:** Strong shared rules and gates impose implementation and maintenance cost; explicit exceptions keep the target clear while that work is completed.
- **Revisit when:** Evidence shows a rule no longer improves correctness or maintainability, or a product change requires a different repository-wide boundary.
