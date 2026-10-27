# ADR-063: Althar's part of the load is everything its work started, however it runs, and Althar itself

- **Status:** Accepted
- **Date:** 2026-10-27
- **Owner:** Repository maintainers
- **Context:** The load meter (ADR-029) counted as Althar's work the agent
  processes this launch started and the runs still running, with whatever
  their process trees held at a reading, each process's own CPU time from
  `ps`. The person saw CPU at 83% with Althar's work at 8% while Althar's
  agents were clearly what was busy, and said the figures were false. Measured
  on their Mac, they were: sampled every 2.5 seconds as the meter does, `ps`
  saw 53% of a test run's CPU and 2% of a loop of `git` calls, as a process
  that starts and ends between two readings is never listed, and a parent's
  time doesn't count its children's; on a workload like an agent's turn the
  meter counted 17 to 25% of what was used. 116 of the 178 processes under
  agents ran in process groups of their own, and 49 processes holding 5.8 GB,
  servers and Storybooks agents had started in the background, had left every
  tree for launchd, some of them an earlier launch's. Althar itself, its
  windows, GPU process and runtime, 8 processes and 0.9 GB, counted nowhere.
- **Decision:**
  - **Everything Althar starts for a piece of work carries it in its
    environment**, `ALTHAR_WORK=task:<id>`, `coordinator:<project>` or
    `run:<project>`, which all it starts inherits, through process groups,
    sessions and `nohup` alike. A process no tree reaches has its environment
    read once (`KERN_PROCARGS2` on a Mac, `/proc/<pid>/environ` on Linux), and
    if it names work the store knows, it and all it started are that work's,
    whether this launch started it or an earlier one did. Work another
    Althar's store knows, such as one an agent runs for its tests, isn't
    counted.
  - **A process's CPU time counts what its reaped children used.** The kernel
    adds a child's time, and its own reaped children's, to its parent's when
    the parent reaps it. On a Mac `ps` doesn't say it, so a small C program
    asks `proc_pid_rusage` for every process this user runs, with its parent,
    start time and memory footprint, built at first use with the Command Line
    Tools' compiler into Althar's temporary folder, as the Windows keeper is
    (`processReader.ts`); on Linux, `/proc/<pid>/stat` says it. Between two
    readings a piece of work's CPU is what each of its processes' time grew,
    less the time each that ended had at the reading before, taken off the
    forebear that reaped it, which counted it again.
  - **A process's memory on a Mac is its footprint**, as Activity Monitor's
    Memory column shows, which counts what macOS has compressed; elsewhere,
    its resident size.
  - **Althar itself is a part of its own**, `Load.althar`: the app's main
    process and what it started that is no work's, shown as an "Althar" row
    among the work's, which opens nothing, and counted in Althar's part.
- **Alternatives considered:**
  - **Matching on the process group, or the session.** Agents' shells and
    tools start groups of their own: most of an agent's processes would be
    missed.
  - **A native Node module** for `proc_pid_rusage`: one to build, sign and
    ship for every platform, where a C file built at first use needs none.
  - **`ps -S`**, which sums dead children into their parent on BSD: macOS's
    `ps` takes it and counts nothing more.
  - **Attributing what no listing sees from the machine's total**, the CPU
    busy less every listed process's: it holds the kernel's work and other
    apps' short commands too.
  - **Counting Spotlight and `fseventsd`'s work on worktrees as Althar's.**
    Nothing says which of their work a worktree caused; they stay other apps'.
- **Trade-off:**
  - **A reading costs about what `ps` alone did**: the reader lists 850
    processes in about 10 ms, and reads the environment of the few new
    processes no tree reaches, around 20 a reading on a busy Mac. On a workload
    like an agent's turn the meter now counts 95 to 98% of the CPU
    `/usr/bin/time` and `ps` say was used: the end of a process reaped by one
    that is no work's, as an orphan is, is lost, and a piece of work whose
    process ended after its parent can read a little low for one reading.
  - **macOS keeps the environment of its own programs** (`/bin/sh`, `sleep`)
    to itself: an orphaned shell counts nowhere, what it started does.
  - **Without the Command Line Tools** nothing is built, and `ps` reads the
    processes as before, its markers from `ps -E`, short-lived work uncounted.
  - **Footprints count compressed memory at its full size**, as Activity
    Monitor does: under heavy compression Althar's part can reach all the
    memory in use, where the bar holds it.
- **Revisit when:**
  - Althar ships a native module for something else: the reader could be one
    of its calls.
  - Work runs where this computer can't list it, as an agent out on the device
    from a Flatpak.
