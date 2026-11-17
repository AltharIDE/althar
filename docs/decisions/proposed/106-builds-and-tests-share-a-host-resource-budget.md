# ADR-106: Agent process families share CPU while Althar backs off under pressure

- **Status:** Implemented; native capability checks run in CI
- **Date:** 2026-11-15
- **Owner:** Runtime and provider-adapter maintainers
- **Related:** [ADR-032, admission of agents](../scheduling.md#how-many-agents-work-at-once), [the instant UI requirement](../foundations.md#the-ui-is-instant), and [proposed ADR-103, execution hosts](103-projects-live-locally-or-on-a-host-and-place-work-in-pools.md).

## Decision

Treat an agent and its ordinary descendant processes as one scheduling unit, independent of language or test framework. Share CPU between worker units where the OS provides the controls; preserve inherited background priority and pace new work under sustained machine pressure everywhere. Spare CPU remains available to a worker when others are idle.

This is automatic background behavior. There are no resource prompts, new settings, per-language adapters, worker flags in project manifests, or new command tools for agents to call. Commands keep their existing permission and sandbox paths. A process can run Rust, Go, Python, a custom script or a nested test runner without a scheduler integration for that language.

## Process controls

`Sessions.ts` stamps each provider session with `ALTHAR_WORKER`. The launcher derives a private runtime-scoped scheduling identity from that marker. Native commands of one session share the identity, so launching several tool calls does not multiply that session's CPU weight. Helpers and replacement sessions have their own identities. The existing work marker remains responsible for task and project attribution.

| Platform | Background scheduling |
| --- | --- |
| Linux | Where cgroup v2 CPU control is delegated, use a private background parent with weight 10 and equal worker children with weight 100. An exec wrapper joins the worker group before executing the command; ordinary descendants inherit membership. Weights are work-conserving, rather than fixed CPU quotas. |
| Windows | The keeper uses an optional named parent Job Object shared by the worker's commands, with CPU weight 1. Each command retains its separate mandatory lifetime job. The child is created suspended and given below-normal priority before it runs. If optional job nesting is denied, retry the never-started child without the scheduling parent; command execution is not retried after it has begun. |
| macOS | The exec wrapper attempts the OS background policy through `taskpolicy`, while preserving ordinary background niceness. This is a best-effort priority policy, not a promise of equal CPU shares or a hard CPU cap between process families. |

Unavailable optional controls fall back to background priority without asking the person to change OS permissions or disabling a provider. Foreground launches keep their existing behavior. Wrappers exec the original command with its arguments and streams intact, preserving the Unix process-group identity. The native platform checks exercise those paths rather than assuming Linux success certifies another OS.

Linux scheduling groups have reference-counted lifetimes. The last owned command releases its worker group after process cleanup; launches racing with teardown wait for that generation to retire. Failed launch releases its allocation too. Cleanup kills remaining members of the private group, retries empty-group removal briefly and removes the private parent when unused. Resource names are scoped to the current runtime so cleanup cannot target an earlier runtime's worker by PID reuse.

## Pressure-aware admission

`Busy.ts` combines the existing configured agent cap with a temporary effective admission limit. The saved setting is never rewritten. Running builds continue: the pressure policy controls additional autonomous admissions, rather than freezing or killing current work. Existing queue priorities, explicit stop behavior and priority of the person's direct actions remain.

A cheap host observation reads CPU counters, memory and native memory pressure where available, without scanning or attributing every process. It runs while task agents are active or work waits; an idle runtime waits for an event instead of polling. It does not depend on opening the load meter.

- CPU saturation with runnable load above 1.25 per core is contention. On Windows, where Node reports no runnable load, sustained saturation among several active workers is the fallback signal. Full CPU usage by an uncontended build is allowed.
- Sustained contention or memory warning for 15 seconds reduces new admission by one place. Critical native memory pressure, or less than 5% available memory without a native pressure signal, leaves one place immediately. One place remains so work can make progress.
- Healthy pressure sustained for 30 seconds restores one place, up to the configured cap. Native macOS pressure is preferred over cache-heavy memory utilization.
- Invalid, repeated stale or discontinuous readings restore normal admission rather than leaving a stale restriction. Read failures fall back and leave one debug diagnostic until readings recover. Idle work resets the temporary policy. All sampling and recovery use Effect's clock.

The configured cap and effective limit serve different purposes: Settings retains the person's chosen cap; queued-work counts reflect current admission. Existing work may temporarily exceed a reduced effective limit and is left running.

## Boundaries

CPU controls are per runtime and its workers, not a new persistent machine-wide command broker. Independent runtimes observe overall host pressure but do not maintain a shared lease journal. Linux without usable delegation and Windows with denied optional CPU nesting keep priority and admission control. macOS uses background policy and admission rather than claiming the same CPU-weight mechanism.

A provider can detach work, change priority or use an external service. Simulators, container daemons and Flatpak host services may sit outside the process family Althar can directly influence. Their pressure can still slow additional work; this implementation does not claim hard memory ceilings, ownership of those services or perfect fairness for escaped processes. It never adds a privileged helper or commandeers the person's existing simulator.

## Verification

- Unit tests exercise equal worker weights, shared native-command ownership, teardown races, denied delegation, partial failures, optional-controller fallback, argument and protocol preservation, failed-launch cleanup, and resource identity isolation.
- Pressure tests cover spikes, sustained backoff, critical memory, gradual recovery, native pressure signals, stale data and clock discontinuities. Real queue integration verifies direct actions, stop, recovery, sensor failure and preservation of the configured setting.
- `resource-controls.yml` runs native launch and process-tree checks on Linux, Windows and macOS. Linux gets a private test delegation; the application itself requires no privileged setup. Windows reports whether CPU-weight nesting is available and verifies its priority fallback when it is not.
- A bounded Linux experiment pins two worker families to one allowed CPU. One has four busy children and the other has one. It reports CPU shares before and after group scheduling, memory and foreground-probe latency. Results are measurements rather than flaky timing assertions.

This replaces the withdrawn Vitest-only approach and the subsequent universal-execution-broker proposal. Native platform results and measured limits belong in the pull request; passing a synthetic worker-count experiment alone does not establish support for all OS resource mechanisms.
