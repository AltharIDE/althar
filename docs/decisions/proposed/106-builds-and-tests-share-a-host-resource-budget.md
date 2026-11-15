# ADR-106: Builds and tests share a host resource budget

> A proposal, not built. DEV-86's Vitest-only implementation has been withdrawn from this change. This document does not claim resource enforcement exists today.

- **Status:** Proposed
- **Date:** 2026-11-15
- **Owner:** Runtime and provider-adapter maintainers
- **Related:** [ADR-032, admission of agents](../scheduling.md#how-many-agents-work-at-once), [ADR-007, provider permissions](../what-agents-may-do.md#how-a-request-reaches-althar), and [proposed ADR-103, worker hosts](103-projects-live-locally-or-on-a-host-and-place-work-in-pools.md).
- **Context:** Leads independently start builds, tests and simulators. Each tool can use the whole computer, and one command can launch many workers or nested builds. Several leads multiply that load. Rust linking and simulators also consume enough memory that counting CPUs alone is inadequate. Setting a Vitest environment variable fixes one runner's fanout, while leaving the same problem in other tools.

## Decision

Schedule expensive execution on the computer that runs it. One host resource broker admits managed jobs against shared capacity across projects, leads and runtime profiles. The unit of scheduling is a job and its actual execution lifetime, rather than an agent turn or a particular test framework.

The broker, managed executor, tool adapters and platform enforcement have separate responsibilities:

| Part | Responsibility |
| --- | --- |
| Host resource broker | Own capacity, queue jobs fairly, grant allocations and account for them until execution has ended |
| Managed executor | Authorize and launch a command, own its process group or job, retain output, handle cancellation and reconcile after a crash |
| Tool adapter | Make a known tool use its granted allocation efficiently; configure Cargo, a test runner or Xcode without making that tool the scheduler |
| Platform controller | Apply and report the CPU and memory controls the host actually supports, and own named resources such as simulator devices |
| Provider integration | Route execution through the executor before launch; report unsupported paths explicitly |

This is local execution infrastructure. It does not implement cloud placement or the mobile companion. Under ADR-103 the same broker belongs on each worker host; a remote project home must not budget execution against its own cores.

## Allocation and admission

A job request carries an authenticated owner (task, thread and session), execution target, command and working directory, and a host-owned resource profile. Its grant records CPU capacity, memory reservation and any named exclusive slots. CPU capacity is an amount of execution capacity, not a count of processes or test files.

The host's capacity policy leaves headroom for the person's applications and Althar. CPU availability, physical memory and current pressure are inputs to that policy. Exact defaults need measurements on supported hosts; copying the agent cap's assumptions into a hard memory limit would risk killing legitimate builds.

- Acquire the whole resource vector atomically before launch. A job must not hold a simulator while waiting indefinitely for memory, or hold CPU while waiting for a simulator.
- Queue owners fairly. A lead flooding the queue must not get every subsequent grant. Use round-robin admission between owners, with FIFO within each owner and aging or reservations for large jobs so a stream of small jobs cannot starve them.
- Allocate from current available capacity. One busy lead can borrow spare capacity; four active leads share it. A saved cap on active agents remains a separate admission setting.
- Reject a request larger than host policy can ever admit, with its reason. Temporary pressure queues it. Do not silently reduce a request into something unable to run.
- A command whose resource behavior is unknown gets a conservative exclusive heavy-work reservation by default. A smaller concurrent profile must be backed by host controls or a validated adapter, rather than an agent declaring that its command is cheap.
- Lower capacity or growing memory pressure holds back new grants. Pausing a process does not reclaim its memory, and a pressure response must not pretend it does.

Resource reservations bound admission. Hard CPU or memory limits are a distinct capability. Record which a job received; do not label estimates or worker flags as OS enforcement.

## A common execution path

Provide one managed execution API to native adapters and provider bridges, with an MCP interface for agents. Submission returns a job ID promptly, including while queued. Reading output, reading state and cancelling refer to that ID and authenticated owner. A long build must not depend on one HTTP tool call remaining connected.

The executor owns the real launch. A model asking for a lease and later claiming that its command ended is not sufficient. Built-in tools, scripts and nested shells must enter the managed path before they start expensive work. No command-name allowlist can establish that an arbitrary script is cheap.

Keep command authorization separate from resource admission. A grant never permits a command that project rules or a sandbox forbid. Revalidate authorization and the session's authority immediately before a queued command starts. Moving execution into the runtime must not bypass the provider's filesystem or network restrictions: the managed launcher needs the equivalent approved execution boundary.

The current code has useful pieces, but no universal execution boundary:

- `provider-adapters/src/native/tools.ts` owns native tool subprocess launches, so its execution path can be integrated directly.
- `runtime/src/Launches.ts` and `Setups.ts` own project and setup commands. Heavy work there must share the same host budget, including work started by a person's button.
- ACP providers run their own commands. `Sessions.ts` receives permission callbacks and tool-call updates, but updates can arrive after launch. Codex's documented safe-command path can also bypass a permission callback. Permission callbacks alone cannot guarantee admission.
- `ToolServer.ts` supplies a session-authenticated MCP surface, but an MCP tool plus instructions does not prevent a provider's built-in executor bypassing it.

For each provider, verify a mandatory pre-execution integration or disable its competing execution tools and use the managed executor. Use a capability record rather than assuming all providers behave like one. An unsupported path must be identified as unmanaged; it cannot silently inherit the managed-execution guarantee. Resource scheduling must not introduce per-command user confirmations for ordinary authorized work.

## Job lifetime, cancellation and recovery

Use an explicit lifecycle: queued, starting, running, stopping, then exited, failed or cancelled. Keep the allocation through starting and stopping. Release only after the command and the children it owns have ended, or after cleanup has proved they are gone.

- Cancel while queued: remove the request without spawning anything.
- Cancel while starting: coordinate the grant and launch so a process cannot start after cancellation has returned.
- Cancel while running: stop the owned process group or job, collect the result and only then release the allocation.
- A shell exiting does not mean its children have exited. A provider reporting tool completion does not prove it either.
- Session or task shutdown cancels its queued jobs and stops its running jobs. A long-lived development server remains an explicit project run, rather than holding an anonymous build lease forever; its resources are accounted for as a service.
- Keep bounded output and an exit result independently of a model turn. Bound retained job history and output storage so finished work does not grow the broker indefinitely.
- Journal allocations and OS identities before launch, using process start identity as well as PID. On restart, reconcile surviving work before issuing replacements. A lost owner or expired heartbeat does not make capacity free while its processes still run. Never blindly retry a command with an uncertain outcome.

There is one broker per execution host and OS user, reached through authenticated local IPC and singleton ownership, not one independent pool for each project or profile. Multiple desktop or CLI runtimes on the same computer must share it. A worker-host journal records local execution, rather than making several project databases competing capacity authorities.

## Tool and platform support

Any executable can use the managed executor. Adapters improve its behavior within an allocation; an unknown executable must still be schedulable without inventing a framework adapter first.

| Workload | Adapter responsibility beyond generic execution |
| --- | --- |
| Rust | Budget Cargo build jobs and Rust test-harness threads separately; account for compiler/linker children and memory, including build scripts |
| JavaScript and Python tests | Configure each runner's workers; coordinate workspace packages and nested runners within the same allocation |
| Xcode and simulator tests | Coordinate build jobs, test parallelism and owned simulator devices; retain device slots through actual teardown |
| Unknown scripts and custom tools | Use the conservative profile and available host controls; report capability limits rather than guessing from the command's name |

Framework knobs such as `VITEST_MAX_WORKERS` are optional outputs of an adapter. Root package scripts and all user repositories must not become prerequisites for the resource manager's correctness. Competing jobs cannot each be given the entire machine merely because their tools use different flags.

Platform support must be demonstrated, not inferred from a process-tree abstraction:

| Host | Enforcement work and limits |
| --- | --- |
| Linux | Investigate delegated cgroup v2 CPU and memory control with children attached before execution. An unprivileged desktop or Flatpak may lack delegation; report that limitation and use the stated conservative admission policy, rather than claiming a cgroup was installed. |
| Windows | Extend the existing keeper's Job Object with supported CPU and memory controls, set before resuming the child. Test nested jobs and denied assignments on real Windows. |
| macOS | Establish what a native launcher can enforce on supported releases. Niceness, QoS and a process group are not aggregate CPU or RAM limits. Use conservative admission where hard controls are unavailable and state that capability explicitly. |

Simulators and other services can be launched by system daemons outside the command's descendant tree. A simulator controller must allocate specific devices and verify ownership and teardown. A generic process-group quota cannot be advertised as controlling those services. The person's pre-existing simulator or service must not be commandeered or stopped.

Admission and cleanup run off the thread answering the window, following the [instant UI requirement](../foundations.md#the-ui-is-instant). Queued work and stop requests use the existing asynchronous progress paths; this proposal does not introduce a new screen design.

## Delivery and verification

Deliver integrated slices, with capability boundaries visible throughout:

1. Build the host broker, journal, allocation model and fair queue. Demonstrate two runtime clients sharing one budget and crash recovery that does not double-allocate surviving work.
2. Connect the managed executor to a real native command path and its existing permission and sandbox boundary. Exercise an unknown CPU-heavy executable and its children, queued jobs, output and cancellation. A broker module without a launch integration is not a completed slice.
3. Add provider integrations with verified pre-execution behavior, and route project/setup heavy work through the broker. Test any bypass or unsupported capability explicitly. Do not broaden authorization while replacing execution.
4. Add tool adapters for Rust and multiple test runners. Test composed workspace commands as well as one runner. Tool knobs must not be the only mechanism sharing host capacity.
5. Validate Windows controls, native macOS builds and simulator ownership on their actual hosts. The simulator contract can be developed alongside existing mobile work, without implementing companion features here.

Acceptance includes:

- Mixed Rust builds, another test runner and an unknown executable contend for one CPU/memory budget, with bounded reservations, fair progress and borrowing of idle capacity.
- An owner submitting many jobs cannot monopolize the next grants; large jobs eventually run.
- Queued cancellation never launches a process. Failed launch returns capacity. A surviving child prevents premature release. Restart does not duplicate jobs or grants.
- Jobs requesting a simulator slot cannot overlap on the same device; cancellation and failures retain ownership until cleanup is verified.
- Capacity changes, memory pressure and oversized requests have explicit outcomes. An agent cannot evade accounting by declaring an arbitrary command to be cheap.
- Provider tests prove admission happens before launch, including parallel calls, background commands and scripts. Existing command permissions and sandbox limits still hold after queueing.
- Each supported host reports its actual admission and enforcement capabilities. Linux test success does not certify native Windows or macOS behavior.
- Measure sustained CPU use, peak memory, process fanout, queue fairness and UI responsiveness before and after with mixed workloads. The earlier Vitest-only worker-count benchmark is not validation of this design.

DEV-86 remains in progress until execution integration and the relevant host checks exist. This proposal is reviewable groundwork, not evidence that those acceptance criteria pass.
