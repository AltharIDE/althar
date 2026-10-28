# ADR-068: A settled task stops everything it left running, and what Althar lost track of is found by its mark

- **Status:** Accepted
- **Date:** 2026-10-28
- **Owner:** Repository maintainers
- **Context:** The person asked whether Althar stops a task's processes once
  it is in Settled. It didn't. A merge, the most common way a task settles,
  stopped nothing: not its lead's or steps' agents, not what they left
  running, not its runs. Marking done stopped what agents left running and the
  task's runs, but not the agents; abandoning stopped the agents and runs.
  Stopping what an agent left running, by its agent or as its session closes,
  ends the shell Claude Code ran it in, not the server that shell started,
  which runs on under launchd. On the person's Mac, a day in, 20 processes
  (about 490 MB resident) of 5 settled tasks still ran: 3 agents with their
  Claude Code processes, 3 Storybooks with their esbuild workers, a site
  preview its lead had left and the task's own run of the site, the oldest 21
  hours after its task merged. A forgotten server also kept its task's folder
  from ever being cleaned up (ADR-056) and could keep a place among the agents
  at work.
- **Decision:**
  - **Every way a task settles says so in one place** (`LeftBehind.settled`):
    a merge read back or heard from its host, marking done, abandoning,
    leaving out commits after a merge, a review posted, a round that made
    nothing new putting a merged task back. It runs after the settled fact,
    in the background, at most four minutes, and nothing waits on it or fails
    for it.
  - **What it stops:** every agent on the task's threads (lead, steps,
    reviewer), once its turn ends (at most two minutes), what each left in the
    background first, through its agent; the task's runs; and last every
    process outside Althar's own tree whose environment carries the task's
    work (`ALTHAR_WORK`, ADR-063), with all it started: asked to stop (TERM),
    it and its process group, then killed three seconds later. What wouldn't
    stop is logged and said in the task's thread as one line.
  - **What Althar lost track of is swept by its mark**, twenty seconds after
    it starts and every five minutes after: a process outside Althar's tree
    that carries a settled task's work, or a removed project's, stops, and so
    does an agent left idle a minute on a settled task with nothing waiting
    for it. A process with no mark, or with work this store doesn't know (as
    another Althar's, an agent's test run), is never touched; nor is Althar
    itself or anything it runs under.
  - **A command an agent left running stops with everything it started**,
    whether the person stops it, settling does or its agent's session closes
    (`stopping.ts`): while its shell still holds the file Claude Code sends its
    output to, the shell is found with `lsof`, only among what the agent
    started, and with it everything below it. Once the agent has stopped the
    shell, each of those, and the shell's process group, is asked to stop and
    then killed, as above. A dev server, Storybook or `vp preview` no longer
    outlives its command.
  - **Marking done no longer waits on, or refuses for, what agents left
    running**: the task is done at once, and settling stops the rest after,
    as for a merge; an agent that refuses to stop a command, or never
    answers, costs ten seconds in the background and one line in the thread.
  - **Reopened, a task's agents start again on demand**, as they did after
    abandoning. Settling stops only the runs started before it was said, and
    none once the task opened again while its agents' turns ended, so a run
    the person starts on it since stays.
  - **A settled task's folder is held only by what was started from it after
    it settled**; a run from before goes with the folder, on schedule.
- **Alternatives considered:**
  - **Stopping only through the agent**, as marking done did: misses the
    server under the shell, and everything once the agent has gone.
  - **Keeping marking done refused while a command wouldn't stop**: an agent
    that never answered held Done for good, and the command is killed
    with its group either way.
  - **Killing by process group alone, after the agent stopped the command**:
    the group's leader is the shell, gone by then, and nothing says which
    group was its. So the shell is found first, by the output file it holds,
    and its tree and group are stopped after it.
  - **Leaving a command's processes to the sweep**: it only sees settled
    tasks' work, so a server the person stopped on an open task ran on.
  - **Sweeping every marked process whose work is unknown**: an agent's test
    run of Althar, and another Althar's work, are unknown to this store too.
- **Trade-off:**
  - **A settled task's lead is gone until it is next asked for**: writing to
    it starts it again, with a brief, not the session it had.
  - **Windows has no marks to read, no process groups and no `lsof`**:
    there, settling stops the agents and runs Althar tracks, and an agent's
    keeper's job ends what it started.
  - **Codex says no output file for a command**: what it left running is
    stopped through it alone, and the sweep finds what outlives a settled
    task.
