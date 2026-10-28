# ADR-067: A settled task stops everything it left running, and what Althar lost track of is found by its mark

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
  - **Reopened, a task's agents start again on demand**, as they did after
    abandoning.
  - **A settled task's folder is held only by what was started from it after
    it settled**; a run from before goes with the folder, on schedule.
- **Alternatives considered:**
  - **Stopping only through the agent**, as marking done did: misses the
    server under the shell, and everything once the agent has gone.
  - **Killing by process group alone**: the group's leader is the shell, gone
    already; its members can only be found by their mark or their tree.
  - **Sweeping every marked process whose work is unknown**: an agent's test
    run of Althar, and another Althar's work, are unknown to this store too.
- **Trade-off:**
  - **A settled task's lead is gone until it is next asked for**: writing to
    it starts it again, with a brief, not the session it had.
  - **Windows has no marks to read**: there, settling stops the agents and
    runs Althar tracks, and an agent's keeper's job ends what it started.
