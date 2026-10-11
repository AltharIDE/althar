# ADR-023: Althar runs the project itself, with no agent

- **Status:** Accepted
- **Date:** 2026-10-11
- **Owner:** Repository maintainers
- **Context:** To see the project running, the person asked an agent: the
  coordinator, which only reads and was refused the install, or a lead,
  whose sandbox may refuse a server its port. Either way a model spent a
  turn on what one command does, and nothing in Althar knew how the project
  runs. Claude's desktop app keeps a launch configuration per project and
  starts the dev server itself; Cursor's agents start one and wait for it to
  say it is ready. Running the project needs no model.
- **Decision:**
  - **Althar keeps how each repository runs:** the command that runs it,
    such as `bun run dev`, and what makes a fresh copy ready first, run
    before it each time, such as installing its packages where none are
    installed. Until one is kept it is worked out from the repository: its
    package.json's dev script, else its start or serve script, with the
    package manager its lockfile names; else a Procfile's web process; else a
    Makefile's dev, run or serve target. Installing never changes the
    lockfile.
  - **Agents keep it up to date,** with `set_run_command`: the coordinator,
    and leads, since they make the changes that move it. The coordinator
    reads the repository and keeps one when Althar can't tell, or tells
    wrong. A null command goes back to working it out.
  - **Althar runs it,** with no agent: in a task's worktree, to see what the
    task built, or in a copy of the default branch of its own (beside the
    coordinator's, made fresh each time it starts, what git ignores kept).
    The person starts it from the task's menu or the project's front, and the
    coordinator with `run_project` when the person asks it to. A run already
    going in the same place is the one there is.
  - **Althar owns the process:** recorded as its own (purpose `run`), in a
    process group of its own, with the inherited environment every child
    gets (docs/architecture/07). It stops when the person stops it or Althar
    quits; one an earlier launch left is stopped by reconciliation, as an
    agent's is.
  - **It shows where what agents leave running shows** (ADR-022): in the
    Running pill over the composer, with where it answers once what it
    prints says (read every half second for ten minutes), Stop, and, once it
    ended by itself, how, until cleared. A task's pill has its own runs; the
    coordinator's has every run in the project, each saying where it runs,
    the task's title or the default branch. Runs are kept in memory; none
    outlives Althar.
  - **Each run leaves a card in the thread it was asked for in:** where it
    runs, the command, where it answers, as a link, and how long it has been
    up, with Stop. It follows the run, and stays once the run is over,
    saying how it ended (stopped, or exited with its last line) with Run
    again. A run Althar's restart ended is marked stopped. The coordinator's
    `run_project` waits up to 30 seconds for the address, so its reply can
    link it, or say how the run ended.
  - **The mini task is not how to run it** (DEV-55): it is for something
    small an agent does.
- **Alternatives considered:**
  - **A mini task whose lead runs it.** A model's turn for one command, and
    a sandbox in the way.
  - **The person types the command once, in Settings.** A setting nobody
    finds until it fails; agents already read the repository.
  - **A launch file in the repository, like `.claude/launch.json`.** It would
    be the team's to keep, and every tool its own; a kept command is
    Althar's, and can be written there later.
  - **A picture of the page on the card,** taken when it first answers.
    Althar would open the page itself, in a browser of its own, for every
    run; the address is one click away.
  - **One quiet line in the thread, no card.** Stop and the address only in
    the pill, which is closed until opened.
- **Trade-off:**
  - **One command per repository.** Several services that run together, or
    a different command per task, are kept as one line.
  - **A run of a task and a run of the default branch may want the same
    port.** The second says so in what it prints.
  - **Windows runs it in its own shell, untried here.**
- **Revisit when:**
  - A project needs several processes to run together.
  - Ports can be read from the process tree on every platform, so where a run
    answers doesn't rest on what it prints.
