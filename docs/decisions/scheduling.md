# Scheduling

This document covers when Althar's work runs on this computer: how many
agents work at once, what goes first, how the board's Running and Up next
lanes read, what happens when the connection or a service fails, the
automations that start work on a schedule, and how the window shows Althar's
share of the computer's load.

**Replaces:** ADR-029,
ADR-032,
ADR-037,
ADR-049,
ADR-060,
ADR-061,
ADR-063,
ADR-065

## How many agents work at once

A computer runs as many tasks' agents at once as its cores and memory allow.
The rest wait their turn and start on their own when a place frees. The number
exists because six full test runs at once once rebooted a laptop. A lead with
its installs, builds and tests easily takes several GB and many cores.

- **The default is worked out at each launch, from this computer,** and isn't
  stored. Each task counts 2.5 cores and 3 GB, and 4 GB are left for the
  system, the person's own apps and Althar itself. The number is the lower of
  the two figures, at least 1 and at most 16. So 16 GB and 10 cores give 4.
  The formula is one pure function, `packages/runtime/src/atOnce.ts`. A
  computer that gains memory, or a profile moved to another one, gets a
  number that fits.
- **The person can set their own number,** from 1 to 16, in Settings, which
  says the number and why ("4: this Mac has 16 GB and 10 cores"). It is kept
  per computer, not per project, since the computer is what runs out. It takes
  effect at once. When it is lowered, what is at work carries on and nothing
  new starts until there is room. When it is raised, what waits starts.
- **The number limits what Althar starts by itself.** It is not a hard
  ceiling. What the person does can take the computer past it for a while (see
  [What goes first](#what-goes-first)), and the small-task lane adds one place
  (see [The quick lane](#the-quick-lane)). Cards then say "4 of 4 agents busy,
  and 1 more".

### What counts as an agent at work

- **These count:** a task's lead while a step of its run is under way, while
  it resolves a conflict or fixes checks, or while it is in a turn. A task's
  reviewer counts while a review is under way, or while it is in a turn.
  Each of a lead's helpers takes a place of its own while it starts or is in
  a turn, apart from its lead's and its reviewer's: four of a task's at
  once, the rest waiting their turn whatever is free ([tasks §
  Helpers](tasks.md#helpers)).
- **These don't count:** the coordinator, the permission judge, and the runs
  Althar makes itself (`run_project`). They are light or the person's own, and
  counting the coordinator would let a task waiting on its plan deadlock the
  line.
- **An agent waiting on the person keeps its place for five minutes**
  (`askGrace`), on a question or a permission. An answer that comes soon then
  goes on while the agent's prompt cache is still warm. After that the agent
  takes no place.
- **What an agent left running counts only while it works.** A test run in
  the background counts. A dev server waiting for a browser does not. Every 2
  seconds, while anything is left running, Althar reads the process tree with
  its CPU time (`processTree.ts`). The tree is at work if a process started or
  ended, or if its CPU grew by at least 5% of one core. It stops counting after
  30 seconds with no work (`busy.quiet`), so a pause in a test run doesn't
  flip it back and forth. Where the CPU can't be read, as on Windows, it
  counts, because when in doubt Althar protects the computer.
- **One task, one place.** What a task's agents left running is part of the
  task's place, never a second one, so a task never waits behind its own
  server.

## What goes first

What waits stands in one of four orders (`Order` in `Busy.ts`). Within each,
what waited longest goes first.

1. **What the person did:** their answer to a question or a stuck step, what
   they say to an agent, an agent they start or switch to, a task they resume.
   It never waits. It starts even if every place is taken, and new work then
   waits until the computer is back under the number. The person can only act
   so fast, so this can't run away.
2. **The work of a task already under way:** the step after another, a step
   carried on after a restart or back from a usage limit, a conflict or check
   round, and what Althar tells an agent, such as a failed check or a nudge to
   carry on.
3. **New work:** a plan's first step, as the coordinator files it or the
   person starts it, and the first turn of a review's lead. This is the line
   the person can reorder (see [Running and Up next](#running-and-up-next)).
4. **An automation's run** goes after everything else. Only one
   automation's task is at work at a time.

The order decides whose work waits, and it should be the work nobody is
looking at yet. A lead that waits behind new work also reads its whole
context again when it goes on.

### A task keeps its place between its steps

The step after another on the same task takes the place of the agent before
it, ahead of anything that waits. This covers the review after the lead's step,
the lead settling after a review, and a follow-up's review. Servers that agent
left running go on in the same place. Work of a task that has to wait while
another of its agents is at work gets the task's place first once it frees.
What the person said to an agent, and hasn't been delivered yet, counts as that
agent's next turn on its way, so the place isn't given away between turns.

### Waiting is kept

A waiting step is written in the store as held for a busy computer, and a
waiting round keeps what it will ask its lead. After a restart they wait on in
the same order. A waiting task can be stopped, and resumed it waits again.
While its first step waits, its plan can still be changed. Its card and view
say what it waits for, such as "Waiting: 4 of 4 agents busy on this Mac". A
waiting task is left out of its own count, so it never waits behind itself.

## The quick lane

A task planned small has one place beyond the number, so a one-line fix never
waits behind long tasks. Before this lane, waiting for a place was the largest
part of a small task's time ([small-task-timeline.md](../research/small-task-timeline.md)).

- **Planned small is read from the plan, never written:** the lead runs at a
  light effort (`low`, or Codex's `minimal`), and every review step is
  skipped. A person who adds a review, or a harder effort, takes the task out
  of the lane. `quickLane.ts` holds the rule.
- **The lead takes a place of the number where one is free, and the lane's
  otherwise.** Past both, it waits as any task does. Only other small tasks
  stand before it in the lane.
- The fast lane for small changes, with its review after merge, plans tasks
  this way. It is described in [tasks.md](tasks.md).

## Running and Up next

The board's Running lane is what an agent works on now. Up next is everything
that goes on by itself, in the order it will.

- **Running** holds a task with an agent at work (in a turn, starting, or on
  its step), or with checks Althar is watching. Its count counts only those. A
  stopped task stays at Running's foot, saying so, and isn't counted.
- **Up next** reads in this order:
  1. **What continues:** a task already under way whose next work waits for a
     place, with none of its agents at work. Its row says what continues and
     why it waits ("Continues · Review", "6 of 6 agents busy on this Mac"). It
     keeps the order of [What goes first](#what-goes-first) and can't be
     dragged. Its agent's cache is warm and its work half done. A person who
     wants it sooner says so to its agent, which then goes at once.
  2. **The line:** new work no agent has worked on yet, in the person's order.
     They drag a task to a place (`MoveInLine`). Each task in the line takes
     one of the times the line stood at, kept on the task (`line_at`), so the
     order survives a restart and a task that joins later goes to the end.
     "Back to oldest first" (`LineOldestFirst`) clears it. The line is ordered
     within a project; it doesn't reorder other projects' work.
  3. **What is paused:** a step held for a usage limit or for the connection,
     under its own divider, saying what it waits for ("Codex is out of usage
     until 13:40", "Waiting for the connection"). Once it can go on, it asks
     for a place as work under way.
  4. Plans on their countdown, then plans held.
- **Nothing moves under the person.** While the pointer is over Running or Up
  next, or a row is being dragged, a task that would change lanes stays where
  it is and moves once the pointer leaves. When it moves, the card travels to
  its new lane ([desktop-app.md](desktop-app.md) covers motion).

## A lost connection and a failing service

A step survives a lost connection of any length, and a short outage of its
agent's service, without the person.

- **A turn that failed on its connection or service is not a missing
  report.** The adapter reads the failure from the prompt's response as well
  as from session updates. Such a turn is never reminded, and doesn't count
  toward a step getting stuck for no report.
- **The step is held the way a usage limit holds one,** with the same record
  and the same loop bringing it back, after a restart too. It gives up its
  place and asks for one again as work under way.
- **Offline, it waits for the connection, however long.** The main process
  reads Electron's `net.isOnline()` and tells the runtime. The runtime also
  checks the agent's service with a light request. Once both answer, the turn
  goes again in the session it was in, told quietly that it stopped on the
  connection. An agent that says it is reconnecting while its service doesn't
  answer has that turn stopped and held at once.
- **Online, a failing service is tried again** after 15 seconds, a minute,
  then four minutes (`Connectivity.ts`). A fourth failure in a row makes the
  step Stuck, naming the service and what it said. A turn that goes through
  resets the count. The agents' own retries come first.
- **While the computer is offline, no new work starts.** Only what the person
  did takes a place. One word in the window's bar says "Offline", never a
  card per task.
- **Every Stuck card can be tried again,** on the same agent in the same
  session. Where the connection or session failed rather than the work, Try
  again is the card's main button. The coordinator's chat offers Try again
  under a turn that ended in an error.

## Automations

An automation is a kept request and a schedule. Each time it fires, Althar
keeps an occurrence and starts an ordinary task for it. The person uses this
for a morning review of new pull requests, weekly release notes, or a nightly
dependency bump.

- **Three records, three lifetimes.** The automation itself (`automations`)
  belongs to the person, on the computer it was made on. Its definitions are
  kept one per change and never edited (`automation_definitions`). An
  occurrence is one time it was due, run or not (`automation_occurrences`). An
  occurrence is unique for its slot, so a day's 9:00 runs once however often
  the clock is read. It names its task in the same transaction that makes the
  task, so a restart never makes a second.
- **A slot is a local time** in the computer's zone, never more often than
  once an hour (`slots.ts`). A time that daylight saving skips runs an hour
  later; a repeated time runs the first time. Each automation starts a fixed
  few minutes after its time.
- **The clock is the runtime's.** It looks every 30 seconds while Althar
  runs, with or without a window open. A slot the computer slept through, or
  Althar was closed for, runs once when it is back, if it is within half the
  time to the next slot (at most 12 hours). A slot past that is missed, and
  says so. Missed slots are never replayed as a backlog. Nothing runs after
  Quit or while the computer is asleep, and the screen says so. Open at login
  covers a restart.
- **What a run does is fixed when it fires,** never asked of the
  coordinator. It starts a task from its prompt, which ends in a report, a
  draft pull request or a ready one. Or it reviews pull requests that someone
  other than the person opened and no task reviews yet: up to five a run,
  oldest first, one review task each. A review run is an ordinary review
  ([reviews.md](reviews.md)).
- **It waits its turn and keeps small.** A run's work goes after everything
  else, one automation's task at a time. It is skipped, and says why, in these
  cases:
  - its last run still goes;
  - every automation is paused ("Pause all automations" in Settings);
  - it has five pull requests open;
  - it is past 24 runs a day across automations;
  - its agent is signed out, out of usage or refused by its model's provider,
    and no other agent on a plan could take its place.

  A skipped run says which, and what would make it run ("OpenCode Go refused
  its sign-in, and no other plan had room. Sign in to OpenCode Go in
  Settings."). A second such skip in a row is one call in Needs you, not one a
  night; its "Run it now" runs the automation. Where another plan could take
  the run, it starts there, its line saying so. Out of usage, that holds only
  where the project's rule is `move`: under `wait` or `ask` the run starts on
  its own agent and holds for the reset or asks, as any task does. A run picks
  its agent, account and model as any step does, per use included, under the
  caps any task has. It works at most its minutes, and three failures in a row
  pause the automation, saying why.
- **With nobody there, it goes ahead.** Its task allows everything where the
  automation says, which is the default. An unattended run can never push to
  the default branch (`runRules` in `automated.ts`), because nobody is there
  to answer that ask. What it posts is signed with its name ("From Althar's
  morning review, by Claude Code"). Its first review waits for the person,
  whose "Post this automation's reviews from now on" lets the next ones post
  themselves. A review of a pull request from outside the team always waits.
- **Agents write them, and the person turns them on.** The tools to propose
  and change an automation are in the one pool the coordinator and leads
  share ([coordinator.md](coordinator.md)). Each puts a card in the thread. A
  change that reaches further than before needs the person to turn the
  automation on again, and the card has Undo. Pausing goes ahead on the
  agent's word. **Resuming and Run now always go on a card the person
  presses,** because both spend their plan while they may be away. This is one
  of the limits kept by name in
  [what-agents-may-do.md](what-agents-may-do.md).

Not built yet: events as triggers (a review asked for, checks failing on main,
a label), a run that carries on its open pull request instead of opening
another, and runs in the cloud.

## Althar's share of the load

Two short meters in the window's bar show CPU and memory, with Althar's part
of each drawn in its own colour. They open a peek with the last two minutes
and each piece of work's share. When the computer slows, this says whether
Althar's work is the cause, and which task.

- **The runtime reads the computer** (`MachineLoad.ts`), because only it
  knows which process is whose. The window asks for a reading (`GetLoad`)
  every three seconds while the meter is on and the window is in view, and
  never otherwise. The runtime reads at most once every 2.5 seconds however
  many windows ask, and keeps two minutes of readings in memory.
- **Everything Althar starts for a piece of work carries it in its
  environment** (`ALTHAR_WORK=task:<id>`, `coordinator:<project>` or
  `run:<project>`). Everything it starts inherits that, across process groups
  and `nohup`. So a server an agent left in the background, even an earlier
  launch's, is still counted to its task. A task's lead, its steps' agents and
  its runs are the task's; a coordinator's work is its project's.
- **CPU counts what reaped children used.** On a Mac, a small C program built
  at first use with the Command Line Tools asks `proc_pid_rusage` for every
  process (`processReader.ts`). On Linux, `/proc` says it. Without the tools,
  `ps` reads the processes, and short-lived work goes uncounted. Memory on a
  Mac is each process's footprint, as Activity Monitor shows it.
- **Althar itself is a row of its own:** the app, its windows and the
  runtime, counted in Althar's part.
- **Windows can't list processes,** so there the meters show the computer
  alone.
- **The meter is an app preference, on by default** (`showLoad`), switched in
  Settings or from the peek. Memory pressure draws the memory meter full,
  since a Mac keeps memory full of cache on purpose. Neither meter adds words
  about strain or heat.

## Changes

- 8 Nov 2026: written from the ADRs under Replaces.
- 10 Nov 2026: a lead's helpers each take a place of their own, four of a task's at once (ADR-087, [tasks § Helpers](tasks.md#helpers)).
