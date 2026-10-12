# ADR-031: A machine runs as many tasks' agents at once as its cores and memory allow, and the rest wait their turn

- **Status:** Accepted
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
  - **What counts is a task at work:** a step of its run admitted or under
    way (implement, review, settle), a quick task's lead (`start_task`), and
    a lead asked to resolve a conflict or fix the checks on one, since each
    runs a lead. A task's steps follow one another in its one place, so it
    never waits on itself. The coordinator, the permission judge and the
    runs Althar makes itself (`run_project`) don't count: they are light, or
    the person's own.
  - **A lead waiting on the person's answer to a question doesn't count:**
    it isn't using the machine. **One idle but with something it left
    running still running counts** ([ADR-022](022-what-agents-leave-running.md)):
    that is often when its tests run.
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
    person, a step back from a usage limit, and a conflict or check-fix
    round. What the person does to an agent themselves (a message, an
    answer) never waits; it counts all the same.
  - **Waiting is a state Althar shows and keeps.** A waiting step is written
    in the store as held for a busy machine, and a waiting round keeps what
    it will ask its lead, so a restart doesn't lose either: after one, they
    wait on, in the same order. The person can still stop a waiting task;
    resumed, it waits again for a place. The home, the task's card, the board and the task say
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
