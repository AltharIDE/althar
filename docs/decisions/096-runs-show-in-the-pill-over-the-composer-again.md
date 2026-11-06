# ADR-096: Runs show in the pill over the composer again

- **Status:** Accepted
- **Date:** 2026-11-06
- **Owner:** Repository maintainers
- **Context:** [ADR-090](090-run-opens-its-list-and-runs-where-it-is-picked.md)
  made what Althar runs "Run's to say": the chip over a task's composer kept
  only what its lead left running, and the Running pill over the project's
  composer was removed. In use, the person opened a task whose lead had
  started a run and saw nothing over the composer saying something ran, only
  a small count on the Run button in the header. A server left running is
  easy to forget, and the one place the person looks while they talk to the
  agent is the composer's edge.
- **Decision:**
  - **ADR-090's "Nothing over the project's composer says what runs" and
    "Althar's own runs of the task are Run's to say" are reversed.** The pill
    over a task's composer lists what its lead left running and the task's
    runs under way, in the same rows: name, address (opens in the browser),
    how long it has been up, and Stop. The pill over the coordinator's
    composer lists the project's runs of no task ("Run on main", a branch or
    a pull request), in the same row.
  - **Each process is its own row.** A run and a process its lead left running
    share no identity, only possibly the address they print, and one may still
    be starting or have failed to bind; so they are never merged, and each row
    stops its own.
  - **A run's output stays in its card** in the thread, so its row has no
    Output.
  - **How long it has been up is the whole reminder.** The row's time keeps
    ticking; the pill doesn't nag.
  - Everything else in ADR-090 holds: Run opens its list and runs where it
    is picked, its count stays on the button, and the run's card stays.
- **Alternatives considered:**
  - **Only the Run button's count.** What ADR-090 chose; the person did not
    find it, so a run was forgotten.
  - **A second pill for runs.** Two chips on the edge for one idea; the
    task's chip already holds the lead's processes in the same row.
- **Consequences:**
  - A run is now said in the Run list, its card and the pill; the three
    share the same state, so they agree.
  - A task's pill is shown while a run goes, even if its lead has left
    nothing running.
