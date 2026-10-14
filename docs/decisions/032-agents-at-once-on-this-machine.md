# ADR-032: A machine runs as many tasks' agents at once as its cores and memory allow, and the rest wait their turn

- **Status:** Accepted; what counts, and its follow-up below, superseded by
  [ADR-037](037-a-task-keeps-its-place-until-its-work-comes-back.md)
- **Date:** 2026-10-13
- **Owner:** Repository maintainers
- **Context:** Althar set no limit on tasks at once, and had no queue
  ([usable.md](../plans/usable.md), 1 and 3 October 2026): a cap would be
  arbitrary. Then six full test runs at once rebooted a MacBook on
  10 October, and leads working on Althar itself report load averages of 60
  to 136, with tests timing out. A lead with its installs, builds and test
  runs easily takes several GB and many cores, so a handful at once is
  already more than a laptop can carry. This reverses that decision, for
  launch on 14 October; the rest of DEV-58 comes later.
- **Decision:**
  - **What counts is an agent at work,** each in a place of its own: a
    task's lead while a step of its run is admitted or under way
    (implement, settle; a quick task's, from `start_task`), while it is asked
    to resolve a conflict or fix the checks on one, or while it is in a
    turn; and a task's reviewer while a review is admitted or under way, or
    in a turn. The coordinator, the permission judge and the runs Althar
    makes itself (`run_project`) don't count: they are light, or the
    person's own.
  - **A lead or reviewer waiting on the person's answer to a question
    doesn't count:** it isn't using the machine. **One idle but with
    something it left running that is at work counts**
    ([ADR-022](022-what-agents-leave-running.md)): that is often when its
    tests run. A server it left running that sits idle doesn't (see the
    follow-up below).
  - **A step after another on the same task** (the review after the lead's
    step, the lead settling after a review) takes the place of the agent
    before it, unless what that agent left running is at work: then the two
    would be two agents at work, and the next step waits for a place of its
    own.
  - **The default is worked out at each launch, from this machine,** and
    isn't stored: the lower of a figure from its cores (`os.cpus()`) and one
    from its memory (`os.totalmem()`), at least 1 and at most 16, the active
    runs Althar is built for ([07](../architecture/07-persistence-security-and-cloud.md)).
    Each task counts **2.5 cores** and **3 GB**, and **4 GB** are left for
    the system, the person's own apps and Althar itself. So 8 GB and 8 cores
    give 1, 16 GB and 10 cores give 4, and 64 GB and 16 cores give 6. The
    figures are conservative on purpose: a lead's test run alone can fill
    several cores and GB, and a machine that waits a little is better than
    one that reboots. One small, pure function holds the formula
    (`packages/runtime/src/atOnce.ts`), with its tests.
  - **The person can set their own number,** from 1 to 16, in Settings,
    beside keeping this Mac awake, which says the number and why ("4: this
    Mac has 16 GB and 10 cores"), and can go back to the default. Only their
    own number is kept, in this machine's settings, not a project's: it is
    per machine. It takes effect at once, with no restart: lowered, what is
    at work carries on and nothing new starts until there is room; raised,
    what waits starts.
  - **Past the number, the next task's work waits, and starts on its own**
    when a place frees, **first come, first served:** what waited longest
    goes first. That holds for a plan's first step when its countdown ends,
    a quick task, a step carried on after a restart or resumed by the
    person, a step back from a usage limit, a conflict or check-fix round,
    the step after another, and a stuck step the person answered (handed
    to another agent, or told what to do), which is held with their answer.
    What the person does waits too, where it would set an agent not at work
    going: their answer to a question is kept at once and told once there
    is a place, and what they say to an idle lead, or an agent they start
    or switch to, waits in its thread until then. Each turn of a lead or a
    reviewer asks again, so a second message doesn't ride on the first's
    place. A lead at work on a step takes no other place for its turns.
  - **Waiting is a state Althar shows and keeps.** A waiting step is written
    in the store as held for a busy machine, and a waiting round keeps what
    it will ask its lead, so a restart doesn't lose either: after one, they
    wait on, in the same order; so do a kept answer and a turn that waits,
    kept on its thread, which starts its agent again once there is a place.
    Stopping an agent lets its waiting turn go. The person can still
    stop a waiting task (resumed, it waits again for a place), and change
    its plan while its first step waits, nothing of it started yet: who
    leads, who reviews, and how it ends. The home, the task's card, the
    board and the task say
    what it waits for: "Waiting: 4 of 4 agents busy on this Mac". Settings
    says nothing of what runs now.
- **Alternatives considered:**
  - **Keep no limit.** It is what rebooted the machine.
  - **A fixed number for everyone.** Too many for an 8 GB laptop, too few
    for a 64 GB workstation.
  - **Store the default at first launch.** A machine that gains memory, or a
    profile moved to another machine, would keep a number that no longer
    fits; working it out at each launch costs nothing.
  - **Per project.** The machine is what runs out, not the project.
  - **Count the coordinator and the judge.** They are short and light, and
    a task waiting on its own coordinator's plan would deadlock the queue.
- **Trade-off:** The default is a guess from two numbers, not a measure of
  what each task takes; a light task waits behind the cap as a heavy one
  does. A person who knows their work is light can raise it.
- **Deferred:** a queue order beyond first-come (priority, the person's
  choice), a cap per agent, footprints measured from what each task's
  processes take, and holding work back under memory pressure.
- **Revisit when:** people raise or lower the number often, which says the
  default is wrong; or once footprints are measured, so the default can
  follow what tasks actually take.

## Follow-up: what is left running counts only while it works (2026-10-13)

- **What went wrong.** With the number at 4, one task was at work and the
  rest waited. Every task whose lead had left a server running (a prototype's
  Vite server, a preview, Storybook) held a place for as long as the server
  lived, though its step was done and the server did nothing: four ready
  prototype tasks held all four places. Counting what a lead left running was
  right for a test run and wrong for a server that waits for a browser.
- **Decision.** What an agent left running takes a place only while its
  process tree **does work**, read the way the CPU and memory meter reads it
  (`ps`, the agent's process and everything it started, `processTree.ts`).
  Every 2 seconds, while any session has something running, Althar reads each
  process of the tree with its CPU time and compares it with the last
  reading. It is work if a process started or ended since, or if the CPU time
  of the processes present in both rose by at least 5% of one core over that
  time (the tree's total falls when a process ends, so totals can't be
  subtracted). Work counts at once. It stops counting only after **30 seconds
  without** any, so a test run that pauses for a moment doesn't flip back and
  forth, and a server that starts working again (a request, a rebuild)
  counts again at the next reading. A server just started counts until it
  has been quiet for those 30 seconds. Where the CPU can't be read (the agent
  is no process of its own, `ps` fails, as on Windows), it counts, as
  before: when in doubt, protect the machine. A task's own step or turn
  counts whenever it runs, as before, whatever its server does.
- **Admitting what waits.** A reading that turns work into idle looks at the
  queue at once, so a waiting task starts as soon as the server it waited for
  goes quiet (up to 30 seconds after its last use, and one reading), without
  another turn ending or anyone answering. Stopping the server or its
  session does the same, as before.
- **Who holds the places.** A task that waits for a place now carries who
  holds them: each task at work, and, for one kept only by what it left
  running, that server. Where it waits, its plan card or its thread says "Held
  by" those tasks, the kept ones with "(a server it left running)", and a
  "Keeping a place" pill lists each server with the task it is from and a
  Stop, the same list as Running. The words of the wait ("Waiting: 4 of 4
  agents busy on this Mac") are unchanged. When who holds the places changes,
  the waiting task's card and its own thread are told, so an open view reads
  them again.
- **Alternatives.**
  - *Classify instead:* a background process that listens on a port and is
    the session's only background work counts as a server, not as work. Needs
    the port of a process tree (`lsof`, not portable), or the guess from its
    output that `leftRunning.ts` already makes for a link, which a server that
    prints no address defeats. And a dev server that rebuilds on each save, or
    a test runner with a watch UI, listens on a port and works; only CPU says
    which. Rejected, and it would still need a clock for a server that stops
    listening.
  - *Count nothing left running.* Tests the lead started in the background
    would run unbounded again, the reason this counts it.
  - *A longer or shorter quiet time.* 30 seconds covers a test run waiting on
    a network call or a build step between suites; it is an option
    (`busy.quiet`), with the reading interval (`busy.sample`).
- **Trade-off.** `ps` can't show a worker that starts, works and ends
  entirely between two readings: its CPU time goes with it, and on macOS its
  parent's own time doesn't include it (checked). Such work is seen only by a
  reading that finds the worker alive, so a tree whose only work is bursts
  that each dodge every reading for 30 seconds (15 readings) is taken for
  idle and releases its place. Readings every 2 seconds, and counting until
  none has shown work for 30, make that unlikely for a test run or a build,
  whose workers live seconds, and cost about a `ps` listing (15 ms) a
  reading; closing it for good needs the kernel's own accounting of reaped
  children, which `ps` doesn't give on macOS. A server idle for 30 seconds
  still holds its place for those 30 seconds, and one that serves a burst of requests holds it while they
  last. The 5% line is a guess: a server that always burns a little (a
  watcher polling), or whose tree keeps starting a process, counts, which
  errs toward waiting, not toward load.
