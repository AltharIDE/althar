# ADR-106: Althar quietly backs off when its work crowds the machine

> Proposed, not implemented. This replaces the earlier resource-broker proposal with a smaller, best-effort improvement. The Vitest-only implementation remains withdrawn.

- **Status:** Proposed
- **Date:** 2026-11-15
- **Revised:** 2026-11-16
- **Owner:** Runtime and provider-adapter maintainers
- **Related:** [ADR-032, admission of agents](../scheduling.md#how-many-agents-work-at-once), [the instant UI requirement](../foundations.md#the-ui-is-instant), and [proposed ADR-103, execution hosts](103-projects-live-locally-or-on-a-host-and-place-work-in-pools.md).
- **Context:** Several agents building or testing at once can make the computer unpleasant to use. The useful outcome is that Althar quietly gives the person's apps room and starts less additional work when the machine is already struggling. It does not need to establish a security boundary, intercept every command or prove an exact resource quota first.

## Decision

Add a small, automatic governor around Althar's existing background processes and admission queue. Use the machine's observed pressure and the work Althar already tracks. It applies regardless of whether a process happens to run Rust, Go, Python, a test runner or a custom script.

The feature runs with sensible defaults. It needs no new setup, resource panel, permission prompts or per-language configuration. Agents use their ordinary tools. A person should mostly notice that the computer remains usable while Althar works.

## First version

1. **Keep agent work in the background.** Althar already starts agent processes and native command children at lower priority through `provider-adapters/src/process.ts`. Keep that behavior and cover ordinary descendant processes where the platform permits. The runtime and work the person directly waits on keep their existing priority.
2. **Watch the machine while Althar has active work.** Reuse the existing process and machine readings, including descendants, for sustained CPU contention and memory pressure. Monitoring must work while the load meter is closed, stay off the UI thread and avoid frequent expensive scans.
3. **Ease back on new work when pressure persists.** Extend the existing admission queue so fewer additional autonomous agent turns start while the machine is struggling. Include Althar-owned heavy setup and launch work where it can use the same policy without changing ordinary command authorization. Use the configured agent cap as an upper bound; keep any temporary reduction separate from the person's saved setting.
4. **Recover gradually.** After pressure stays low, let more queued work start again. Use different backoff and recovery thresholds or a short stable period so the limit does not oscillate on every reading. Keep useful progress possible and preserve the existing queue priorities, stop behavior and priority of the person's direct actions.
5. **Use practical process controls where available.** Group scheduling controls can improve sharing between worker trees on platforms that already support them. They are an incremental improvement. Lack of cgroup delegation, a denied OS call or weaker macOS controls must not prevent normal work from starting.

High CPU utilization alone is not a fault. One build on an otherwise idle computer should be able to use spare CPU. Backoff should respond to sustained contention or memory pressure, rather than trying to keep CPU usage permanently low.

The first version primarily changes what starts next. It does not promise to resize an already running compiler's workers or rebalance every ongoing command instantly. Let running work finish; do not freeze or kill builds merely because the governor sees pressure. Explicit user stop and existing process cleanup still work as before.

## Integrate with what exists

| Existing part | Role in this change |
| --- | --- |
| `runtime/src/Busy.ts` | Own the temporary admission reduction and recovery alongside the existing agent cap and queue |
| `runtime/src/MachineLoad.ts`, `machine.ts`, `processTree.ts` | Reuse cheap background observations and existing process ownership; distinguish stale or unavailable readings |
| `provider-adapters/src/process.ts`, `processTrees.ts`, `keeper.ts` | Keep background priority and use available worker-tree controls without making them a startup requirement |
| `runtime/src/Launches.ts`, `Setups.ts` | Share pressure policy for Althar-owned heavy work where practical, while preserving the person's existing run and stop semantics |

The governor observes processes and machine pressure, rather than maintaining a list of command names or toolchains. A new language needs no scheduler change. Framework worker flags can be optional tuning later; they are not prerequisites for useful behavior.

Do not introduce a new MCP command runner, make agents acquire resource leases, patch every provider's shell execution or move commands outside their existing sandbox for this first version. Provider loops and command permissions continue through their current paths.

## Best-effort boundaries

Normal descendants usually inherit background priority. A provider may change its children's priority, detach work or launch something through an external service. A simulator or container daemon may therefore sit outside the tree Althar can directly influence. Overall machine pressure should still cause Althar to start less additional work. We can improve ownership of a specific backend later if measurements show it matters.

Linux and Windows can offer stronger process-group controls than a portable priority adjustment; macOS needs its own practical behavior and measurement. Exact CPU shares, hard RAM ceilings and exclusive simulator-device ownership are not promises of this feature. Do not add privileged helpers, VMs or a mandatory machine-wide daemon to obtain those promises before shipping a useful improvement.

If a reading or optional control fails, retain normal background priority and the existing agent cap, retry observations with bounded backoff and keep the diagnostic in the app's log. Do not leave work queued forever, disable a provider or ask the person to repair resource-control permissions. Keep policy state within the current runtime and rebuild it from observations after startup; a durable cross-profile lease journal is not required.

Pressure policy must not repeatedly lower Unix niceness in a way it cannot later undo without privilege. Preserve existing background priority as the dependable baseline; use reversible controls only where their behavior has been checked.

## Verification and delivery

Build an integrated change in the existing runtime, then measure it. The acceptance target is a clear improvement in responsiveness under ordinary mixed load, with no added workflow friction:

- With fake machine readings and the test clock, sustained pressure reduces new admissions, brief spikes do not, and sustained recovery restores capacity within the configured cap.
- Missing or stale telemetry and denied optional controls fall back without blocking progress, prompting the user or flooding the log.
- Queue order and direct user actions retain their existing semantics. Stop works while work waits, and reducing admission does not kill or suspend running commands.
- Real subprocess tests cover a command starting several children, without depending on a particular language or test framework.
- Measure CPU contention, peak memory, concurrent work and app responsiveness before and after with several builds or test commands running together. Check that a single workload can still make good use of an idle machine and that the governor's own monitoring is cheap.
- Exercise the default fallback on macOS, Linux and Windows, and any optional platform control on the host where it will run. Do not require identical enforcement mechanisms or eliminate every load spike to call the improvement useful.

Start with background priority, observed pressure and paced admission. Add stronger controls or special handling only when an observed problem justifies them. Cloud placement, companion features, per-language adapters and a universal execution service are separate work.

DEV-86 stays in progress until this runtime behavior is implemented and measured. This document describes the intended first version; it is not evidence that the governor already exists.
