# ADR-074: CI gates a merge on Linux, and a release on everything

- **Status:** Accepted
- **Date:** 2026-10-31
- **Amends:** ADR-001's gates ([ARCHITECTURE.md](../../ARCHITECTURE.md), Static checks and gates)
- **Owner:** Repository maintainers
- **Context:** CI ran every check on every pull request, and again in the
  merge queue: a change to the runtime, the UI kit or the desktop app paid
  for six Windows jobs, four parts of the runtime's tests and four of the
  end-to-end run, twice. The organisation runs about 20 jobs at once, so a
  queued pull request mostly waited for machines, and the Windows jobs were
  the longest (in one queue build, about 47 job-minutes against about 19 for
  the Linux ones). Windows was also where tests flaked most for their time:
  45 of a week's 139 flakes on about 0.6 times Linux's runs, on machines a
  median 3.4 times slower, 13.6 at worst (docs/plans/tests-that-hold.md).
  And what only ran after merge broke main for everyone: on 30 October three
  pull requests that had passed their own checks failed first in the queue,
  on end-to-end specs they hadn't run, and took six behind them down too.
  #451 cut each pull request to what its change reaches and moved Windows
  after merge; #442 and #449 brought the end-to-end run onto the pull
  request and quarantine. This records the arrangement as a whole.
- **Decision:**
  - **A pull request runs what its change reaches, on Linux:** the checks of
    the packages it changes and of those that build on them, and the unit
    tests whose imports reach a changed file, in whatever package
    (`packages/testing/src/select.ts`, which writes its plan on the run's
    summary); and, once it is ready for review and its change reaches the
    app, the desktop app's whole end-to-end run. A change any test may rest
    on (the lockfile, the root config, the lint rules, the patches,
    `@althar/testing`, a workflow) runs everything; docs run nothing. Its
    new and changed tests run many times over (`stress`), and the one
    Windows job is the end-to-end smoke test, for a change to code that
    behaves differently there.
  - **The merge queue checks each pull request again on main as it will
    be,** up to three entries built at once, each on main and the entries
    ahead of it. A build runs what its entry and those ahead of it change
    against main, since a passing build at a group's head merges the whole
    group. It runs the pull request's own workflows, end-to-end run
    included, but not `stress` or the smoke test, which ran on the same
    change: a group with a pull request whose own head failed either fails,
    and one whose stress run is still going waits for it. `merge queue` is
    the one check main's rules require.
  - **A test that fails runs once more,** in every job but `stress` and
    `nightly`. One that passes only then files an issue labelled `flaky`,
    and while its issue is open the test is quarantined: it still runs, but
    its failure goes on its issue and the job's summary instead of failing
    the job.
  - **After merge, `post-merge` gates the rest on main:** every check and
    unit test, Windows' included, the coverage gates, the end-to-end run, the
    smoke test and the installer on Windows, and the Linux packages; merges
    in quick succession share a run. Every night `nightly` runs the whole
    unit suite in a shuffled order, once on Linux and five times over on
    Windows, and the day's changed tests ten times on Windows, with no
    retry.
  - **Main may be red on Windows or coverage between merges; a release never
    is.** A failed `post-merge` opens "Main is red", naming the merges since
    the last green run, and closes it when main is green again. `release`
    cuts a tag only on a commit `post-merge` passed on, Windows included.
- **Alternatives considered:**
  - Everything on every pull request and again in the queue, as before:
    nothing reaches main unchecked, but at about twice the jobs a change, a
    queue that waits for machines, and Windows' slowness and flakes in the
    way of every merge.
  - Everything in the queue alone, the pull request running only its
    checks: half the jobs, but a break is found only once queued, where it
    takes the entries behind it down, as on 30 October.
  - Windows' unit tests on the pull request only for runtime changes: most
    changes still reach the runtime's tests, so it would save little, and
    a Windows-only flake would still hold up an unrelated merge.
  - Coverage in the queue for the gated packages: closes the last gap below,
    at the cost of the full suites with coverage on every entry. Left for
    when the gap is seen to matter.
- **Trade-off:** a break only Windows shows, or a fall below a coverage
  floor, can land on main, and is found within the hour by `post-merge`
  rather than before merge; until it is fixed or reverted, main is red for
  everyone, though nothing released is. Selecting tests by what imports
  reach can miss a test that reads a file by a path built at run time;
  `post-merge` runs everything and catches that too. A quarantined test
  says nothing while its issue is open.
- **Revisit when:** CI's capacity grows enough to run Windows and coverage
  before merge; a Windows-only break or a coverage fall reaches main more
  than now and then; or "Main is red" stays open long enough to hold up
  work.
