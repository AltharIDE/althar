# ADR-029: How hard the computer works is read by the runtime, only while a window shows it

- **Status:** Accepted
- **Date:** 2026-10-11
- **Owner:** Repository maintainers
- **Context:** Agents run test suites, builds and dev servers on the person's
  own Mac, several tasks at a time, across projects. When the Mac slows,
  nothing in Althar said whether its work was the cause, or which task. Of
  five designs prototyped in Storybook, the person chose the one the
  comparison recommended: two short meters in the window's bar, CPU and
  memory, with Althar's work's part of each in cobalt, opening a peek with
  the last two minutes and each piece of work's share. They asked for it to
  be switched on and off in Settings, for every window, and for no word
  about heat. Only the runtime knows which process is whose: it records
  every agent process it starts with its pid and session (07), and keeps
  its runs of the project in memory (ADR-023). The contracts keep one
  stream, `Watch`, and no per-screen subscriptions.
- **Decision:**
  - **The runtime reads the computer, with the processes, in one place.**
    `MachineLoad` takes a reading of every core's time (Node's `os.cpus`),
    memory in use as Activity Monitor counts it (`vm_stat` on a Mac,
    /proc/meminfo on Linux), the pressure macOS reports (`sysctl
    kern.memorystatus_vm_pressure_level`) and one `ps` listing with each
    process's parent, CPU time and resident memory. Between two readings it
    works out the CPU, and each piece of work's part: the agent processes
    this launch started and still runs, joined to their threads, tasks and
    projects in the store, and each run still running, each with everything
    it started, a process counted once. A task's lead, its steps' agents and
    its runs are the task's; a coordinator's is its project's.
  - **A read, `GetLoad`, not a stream.** The window asks every three seconds
    while the meter is on and the window is in view (react-query's interval,
    paused while hidden), and never otherwise. The runtime reads at most
    once every 2.5 seconds however many windows ask, answering the rest
    from the last reading, and keeps the last two minutes of readings for
    the trace. A first reading, or one after a gap, waits half a second for
    a second to measure between.
  - **A preference of the app's, on by default** (`showLoad`, kept with the
    others in `desktop.json`), changed in Settings' "This Mac" sheet or by
    the switch in the peek.
  - **Memory pressure is the one strain said in a word** ("Memory is tight",
    "Memory is short"), since the meters can't show it: a Mac keeps memory
    full of cache on purpose. A full CPU draws its meter in full ink and
    says nothing. Heat isn't read.
- **Alternatives considered:**
  - **The main process reads the computer** (`process.getSystemMemoryInfo`,
    `app.getAppMetrics`, `powerMonitor`). It doesn't know whose an agent's
    process is, so the runtime would read the processes anyway, at another
    moment: Althar's part could come out larger than the whole. Electron's
    free memory on a Mac counts cache as in use, and `getAppMetrics` covers
    only Chromium's own processes, not what the runtime starts.
  - **A `Watch` event every few seconds.** Every window would be sent it,
    and the computer read, whether the meter shows or not; the read keeps
    the cost to while someone can see it.
  - **Native counters** (`host_statistics64`, `proc_pidinfo`) for memory and
    processes, without spawning. A native module to build and sign for one
    reading every few seconds; the commands cost a few milliseconds.
  - **Heat** (`powerMonitor`'s thermal state). The person found it noise.
- **Trade-off:**
  - **A reading costs a `ps`, a `vm_stat` and a `sysctl`**: about 17 ms on
    an M-series Mac with 600 processes, once every three seconds while the
    meter shows, under 1% of one core. Nothing while it is off or hidden.
  - **A process's memory is its resident size**, added up: memory shared
    between processes counts in each, so a piece of work's memory can read
    a little higher than Activity Monitor's footprint. Its CPU is exact
    between two readings; a process that ended between them takes what it
    used with it.
  - **Windows has no `ps`**: Althar's part is unknown there, and the meters
    show the computer alone. The packaged app is a Mac's only, for now.
- **Revisit when:**
  - The meter should say more than now and the last two minutes, such as a
    task's load over its life: that is a record, and belongs to the store.
  - Readings need to be cheaper, or more often: a native module, or
    `proc_pidinfo` for the processes Althar knows.
  - Althar runs work on another machine: whose load the bar shows.
